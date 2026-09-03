# Proposal: rsvp-star-confirm

## Why

The RSVP form currently makes guests stage a decision (Attending/Decline toggle), optionally step a party size, then submit — three interactions for a wedding where attendance is effectively binary and the invitation is understood to cover a couple, not a precisely counted party. Meanwhile the section is hard-locked to a dark presentation while the rest of the site is beginning to follow the device theme (loading screen, welcome gate). This change collapses the form to a single confirm button carrying an animated-CTA treatment — a pill whose rim is a rotating conic gradient, so a light circles the button — gives a confirmed guest a disabled "confirmed" state with the same rim, and makes the section theme-aware.

## What Changes

- **Single confirm-reservation button**: the invitee controls reduce to the invite's display name + one "Confirm Reservation" submit button. **BREAKING (UI-only)**: the Attending/Decline choice and the party-size stepper are removed. The POST body is always `{ attending: true, partySize: 1 }` — valid under the existing `/api/rsvp` schema, which is unchanged. A previously declined invitee can still confirm; a confirmed invitee sees a disabled confirmed state (no UI path back to declined — accepted by the couple; the API remains the support path).
- **Confirmed state**: `rsvpAttending === true` server-renders the button disabled with a confirmed label; a successful submit flips the fresh button into that state without a reload. The rim keeps rotating on the disabled button.
- **StarButton ported to Astro** (`components/StarButton.astro`): the rim is a conic gradient rotating once per `--star-btn-duration` (3s), with an opaque interior plate inset by the rim width turning that gradient into a band. Ported from badminton-match-manager's `AnimatedCtaButton` (`src/components/ui/animated-cta-button.tsx` + its `.rotatingGradient` rule) — same two ingredients, no React, and no starfield. The rotation is a registered custom property animated by CSS, so the component ships **no script at all**: nothing measures the box, so there is nothing to keep in sync or recompute on resize. Static readable fallback for `prefers-reduced-motion`, forced-colors, and browsers that cannot register the angle.
- **Theme-aware section**: the RSVP section (background, counter, labels) follows `prefers-color-scheme` — dark is the baseline look, light inverts the section to black-on-white — using the same CSS-custom-property + media-query pattern as WelcomeGate. The button is always the inverse of the page: a near-white pill on the dark section, a near-black pill on the white one. Two polarity tokens (`--star-btn-surface` / `--star-btn-ink`) carry that flip and every other color is one of them, so the two themes are each other's mirror by construction. The rim's base stop is the page's own ground, so the band fades into the page and only the sweep reads, as a halo. Device theme only; no toggle, no stored preference. Note: only this section flips; adjacent sections stay dark for now (seam accepted, whole-page pass is future work).
- **FAQ copy reconciliation** (copy-only): the plus-one answer's "you'll confirm attendance for your party" no longer matches a UI without party-size confirmation; reworded to a simple attendance confirmation.

## Capabilities

### New Capabilities

- `star-button`: The reusable themed confirm-button component — rotating conic-gradient rim, opaque interior plate, no starfield, dark/light polarity tokens, and static degradation (reduced motion / forced colors / no `@property`). Pure CSS: no script.

### Modified Capabilities

- `rsvp-section`: The invitee-controls requirement changes (single confirm button, fixed body, confirmed state replaces choice + stepper + change-of-mind resubmission) and a new theme-aware-presentation requirement is added; the FAQ party-wording requirement is updated to match.

> Merge-order note: the `rsvp-section` capability's source requirements live in the complete-but-unarchived `rsvp-live-count` change. This delta assumes `rsvp-live-count` archives first (same pattern `swipe-gate-reveal` used against `invite-only-personalization`).

## Impact

- **Code**: new `apps/web/src/components/StarButton.astro`; `apps/web/src/components/RsvpSection.astro` (invitee form branch rewritten, script slimmed ~60 lines, theme vars); `apps/web/src/pages/index.astro` (`#rsvp-section` background becomes var-driven); `apps/web/src/components/WeddingFAQ.astro` (one sentence).
- **API/DB/deps**: none — `/api/rsvp`, `lib/rsvp.ts`, schema, and dependencies are untouched; `{ attending: true, partySize: 1 }` already validates against the shipped zod schema (cap ≥ 1 by `max_party_size` default).
- **Tests**: `apps/web/tests/rsvp.spec.ts` anonymous/counter tests unaffected; additions for theme emulation and button degradation; authed flow stays curl-level per repo convention.
- **Behavior**: confirmed-guest counter semantics shift — each confirmation adds exactly 1 (`partySize` fixed), so the number reads as confirming invitations rather than heads for 2-person invites (accepted by the couple as approximate).
