# Design: rsvp-star-confirm

## Context

`rsvp-live-count` shipped a three-stage invitee form (choice toggle → optional party stepper → submit) against a cookie-authenticated, schema-validated upsert endpoint (`POST /api/rsvp` with `{ attending: boolean, partySize?: number }`). The couple has decided the form is heavier than the question warrants: the invitation covers a couple, `partySize` is speculation, and "decline" is better handled personally than through the site. Simultaneously the site's newest surfaces (loading screen, welcome gate) follow `prefers-color-scheme` via CSS custom properties with a dark baseline, while the RSVP section hard-codes `bg-neutral-950`.

The visual target is badminton-match-manager's `AnimatedCtaButton` (`src/components/ui/animated-cta-button.tsx` plus the `.rotatingGradient` rule in its `globals.css`): a 50px pill whose full-bleed conic gradient is covered by an opaque `::after` inset 5px, leaving a 5px band of gradient as the rim, with the gradient's `from` angle animated 0→360deg over 3s via a registered `--r` custom property. The project is pure Astro (no `@astrojs/react`; every animated component is `.astro` + vanilla `<script>` or a custom element), so the React component must be ported, not vendored — same conclusion as the NumberTicker port (D1 of `rsvp-live-count`).

## Goals / Non-Goals

**Goals:**

- One-button confirm flow with a disabled confirmed state (server-rendered for returning invitees, client-flipped after submit).
- The animated-CTA look, ported to Astro: rotating conic-gradient rim + opaque interior plate + flat label — no starfield, and no script.
- Dark/light theming for the section and the button via device preference, following the repo's var + media-query pattern.
- No API, DB, or dependency changes.

**Non-Goals:**

- A decline path in the UI (the API keeps accepting `attending: false` for direct/support use).
- Party-size accuracy; whole-page light-theme conversion (adjacent sections stay dark — accepted seam); theme toggle or stored preference; a confirmation screen (the disabled button is the confirmation); any geometry-aware lighting (an earlier iteration ran a rAF loop along a measured perimeter path — dropped in favor of the reference's two-ingredient CSS rim, see D3).

## Decisions

### D1. Port the effect to `StarButton.astro` — static Astro markup + scoped `<style>`; no React, no script

The original is React only for prop plumbing (`children`, style vars, `asChild` via Radix `Slot`). Astro templates the markup natively and props map to attributes, so the port keeps the repo's zero-hydration architecture (rationale carried over from `rsvp-live-count` D1) and goes one step further: the effect is entirely declarative, so the component ships **no JavaScript at all**. The component is used once here but is built generic (slot for label, passthrough `type`/`class`/`data-*`).

Not ported: `asChild`/`Slot` (no consumer needs a link-shaped CTA here — an Astro `<slot />` covers the label, and rendering the same styles on an `<a>` would be a `class` passthrough, not a wrapper), the `width`/`height` props (tokens do the same job with no prop surface), and the reference's separate `AnimatedCtaContent` span (the label span is inlined).

### D2. Remove the starfield; keep: rotating rim + flat interior + plain label

The starfield of the earlier StarButton iteration (`StarBackground` SVG, `backgroundColor`/`currentColor` tint) stays dropped — the couple asked for it gone, and removing it decouples the interior from `currentColor`, which makes the dark/light inversion a pure token swap instead of a re-tint. Remaining look: a flat opaque interior plate in the button's own surface color, a 5px rotating gradient rim, and a plain label in the ink color. No hairline border either: the rim band is the button's edge, and a border on top of it would read as a second, static ring.

### D3. The rim is the reference's two-ingredient CSS trick — gradient on the root, opaque plate inset by the rim width

**Decision:** reproduce the reference exactly, in CSS only:

- the button root paints `conic-gradient(from var(--star-btn-angle), base, sweep, base)` and clips it with its own `border-radius` + `overflow: hidden`;
- `::after`, inset by `--star-btn-rim-width` (5px) with radius `calc(radius - rim-width)` so its corners stay concentric, paints the opaque plate. That inset is the whole effect: it is what turns a full-bleed gradient into a band;
- `--star-btn-angle` is registered via `@property` (`syntax: "<angle>"`) and animated 0→360deg by `star-btn-spin`, linear, `--star-btn-duration` (3s), infinite.

Registration is load-bearing, not decoration: an unregistered custom property is an untyped token and does not interpolate, so the gradient would sit at 0deg and jump on the final frame — i.e. never appear to move. A browser without `@property` support therefore lands on the static ring, which is the intended fallback anyway.

Both outer stops are the base color so the ring closes on itself with no seam, and the base is the _page's_ ground rather than a third color — so the band fades into the page and only the sweep reads, as a halo rather than a two-tone collar.

**Why not the previous iteration (rAF loop along a measured `offset-path`):** it existed to light the label from the same point as the border light, which required knowing the box — hence path measurement, a `ResizeObserver`, an `IntersectionObserver`, visibility pausing, and an easing profile, roughly 250 lines of script for one button. The reference achieves a comparable read with two CSS declarations and no measurement, so resize correctness, tab-visibility cost, and border/label desync all stop being problems that need solving rather than problems solved carefully. The trade is a rim that sweeps as a rotating gradient rather than a discrete orb travelling the perimeter, and a label that no longer glows in sync — accepted: the user asked for this button.

**Degradation matrix (normative for the spec):** `prefers-reduced-motion: reduce` → `animation: none`; the rim renders at its initial angle (a static band) and the label is unaffected. No `@property` support → the same static band, with no feature query needed (the animation simply cannot move an untyped property). JS disabled → no effect whatsoever; nothing was script-driven. Tab hidden / button off-screen → the browser throttles its own animation; there is no loop to pause. A disabled button keeps the full presentation, including rotation and full opacity — `disabled` affects interactivity, not the effect (the reference's 50% dim is deliberately dropped) — while reduced motion still takes precedence (disabled + reduce → static, by declaration order on `animation`). Forced-colors mode → gradients are dropped by the palette swap, so the rim becomes a 2px system-color outline at `outline-offset: -2px` (inset, so the box does not grow) and the label plain system-color text.

### D3a. Two fixes the reference needs before it ships here: a visible focus ring and a fluid width

Both are defects in the reference at this site's scale, not preferences:

- **Focus.** The reference relies on the UA ring, which lands _on_ the 5px rim and disappears into the sweep — the site's single CTA would have no perceivable keyboard focus. Replaced with `:focus-visible { outline: 2px solid var(--star-btn-surface); outline-offset: 3px }`: the surface (not the ink) because outside the pill the ground _is_ the ink, and offset so the ring clears the band instead of reading as part of it. `:focus-visible` rather than `:focus`, so a pointer press leaves nothing behind. Forced-colors overrides it to `Highlight` at a larger width, since the inset system outline is already occupying the rim's position there.
- **Width.** The reference's flat `px-14` (3.5rem) with a 16px label overflows a 320–375px viewport once the label is the longer confirmed copy ("Reservation Confirmed ✓" measured 356px inside a 375px screen). Padding and type are therefore clamped against the viewport (`clamp(1.25rem, 6vw, 3.5rem)` / `clamp(0.8125rem, 3.2vw, 1rem)`), reaching the reference figures from ~500px up, and the reference's `min-width: max-content` is dropped in favor of `max-width: 100%` — `max-content` would win over any cap and re-introduce the overflow, while an inline-flex button already sizes to its content. The label stays `white-space: nowrap`, so the pill's 58px height is never broken by a wrap; the fluid-width test asserts exactly that at 320–1280px.

### D4. Fixed submit body `{ attending: true, partySize: 1 }`; confirmed state replaces re-submission UI

The zod schema accepts this today (`attending: true` requires `1 ≤ partySize ≤ max_party_size`; `max_party_size` ≥ 1 by DB default), so `/api/rsvp`, `lib/rsvp.ts`, and the schema are untouched. Consequences, accepted with the couple:

- Counter semantics: every confirmation adds exactly 1 — the number reads as confirming invitations, not heads (couple-approved approximation).
- A declined invitee (`rsvpAttending === false`) still gets the confirm button (the POST upserts over the decline — the endpoint's change-of-mind semantics, minus UI support for the reverse direction).
- A confirmed invitee (`rsvpAttending === true`) gets the button `disabled` + `aria-disabled="true"` with the confirmed label; the rim animation continues (it is decorative and communicates the section's state, not interactivity). After a successful submit the client script flips the fresh button to that state — label swap, `disabled = true` — **moves focus to it** (the pressed control is being replaced as the section's action; the disabled state keeps focus from being lost to `<body>`), and **announces the outcome** via the section's note element as an `aria-live="polite"` region ("Your reservation is confirmed."). No reload; then triggers the count poll as today.

Label copy: "Confirm Reservation" (fresh), "Reservation Confirmed" + check (confirmed). No more "Send"/"Update" duality — the state is carried by the button itself.

### D4a. Leftover UI contract cleanup (dead props + stale copy)

The simplification orphans two pieces of the current contract, both removed in the same change:

- **Props**: `maxPartySize` and `rsvpPartySize` become dead the moment the stepper dies. `RsvpSection.astro`'s Props interface drops them, and `index.astro`'s call site (`index.astro:259-264`) stops passing `inviteMaxPartySize`/`inviteRsvpPartySize`. (`rsvpAttending` stays — it drives the confirmed-vs-fresh rendering. The frontmatter lookups in `index.astro` can keep resolving the values; only the pass-down goes.)
- **Error copy**: the 400 message "That response isn't within your party size — please adjust and retry." (`RsvpSection.astro:237`) references a control that no longer exists. With the body fixed, a 400 is practically unreachable (max_party_size ≥ 1 always accepts), but the handler stays for safety with copy that doesn't name a removed control: "Couldn't save your RSVP. Please try again."

### D5. Theme tokens: dark baseline, light via `prefers-color-scheme`, scoped to the section

Two independent token sets with no cross-references — ownership decides where each is declared:

**Component-owned (`--star-btn-*`, declared on the button's root element by `StarButton.astro`):** element-level declarations, so the component is self-contained and correct wherever it is dropped; the section never declares or overrides these.

| Token                                                                 | Dark page                 | Light page                   |
| --------------------------------------------------------------------- | ------------------------- | ---------------------------- |
| `--star-btn-surface` (the interior plate + the rim's sweep)           | `#fafafa`                 | `#0a0a0a` (swapped)          |
| `--star-btn-ink` (the label + the rim's base, i.e. the page's ground) | `#0a0a0a`                 | `#fafafa` (swapped)          |
| `--star-btn-plate`, `--star-btn-rim-sweep`                            | `var(--star-btn-surface)` | derived — no per-theme value |
| `--star-btn-label`, `--star-btn-rim-base`                             | `var(--star-btn-ink)`     | derived — no per-theme value |

**Section-owned (`--rsvp-*`, declared at `:root` in `index.astro`'s existing `<style>` block — the file that owns `#rsvp-section`):** the same pattern as that file's shipped `--loading-bg`; `RsvpSection.astro` consumes them by inheritance. Declaring them from `RsvpSection.astro`'s scoped styles is not an option — the `#rsvp-section` element lives in `index.astro`.

| Token                                     | Dark                    | Light                       |
| ----------------------------------------- | ----------------------- | --------------------------- |
| `--rsvp-bg`                               | `#0a0a0a` (neutral-950) | `#ffffff`                   |
| `--rsvp-fg` (counter digits, strong text) | `#fafafa` (neutral-50)  | `#0a0a0a`                   |
| `--rsvp-muted` (labels, name line)        | neutral-500/400 values  | neutral-500/400 equivalents |

Within each set: dark-page values as fallback, light overrides in a `prefers-color-scheme: light` block (WelcomeGate pattern). `index.astro`'s `#rsvp-section` wrapper swaps `bg-neutral-950` for `background-color: var(--rsvp-bg)`. Note on the button: it is deliberately the _inverse_ of the page rather than a match for it, so the light theme is "white section, black pill" and the dark theme is "black section, white pill". Only the two polarity tokens carry that flip; because every other color is one of them, the two presentations are each other's mirror by construction and a color can never be authored to suit one theme and break the other. There is no `color-mix()` left in the component — the rim's fade is the gradient's own interpolation between the two tokens, which is one fewer authored value than mixing them by hand.

Scope note: only this section flips with device theme; neighbors (wish marquee, FAQ) remain dark — accepted seam, recorded in the proposal.

### D6. FAQ copy reconciliation (copy-only)

The plus-one answer currently ends "you'll confirm attendance for your party" — a party-confirming UI no longer exists. Reword to a simple attendance confirmation (e.g. "you'll confirm your attendance"), keeping the capacity explanation untouched. The deadline wording is unaffected.

### D7. Testing strategy (repo convention: no-seed Playwright + curl for authed flows)

- **Section-level Playwright** (`tests/rsvp.spec.ts` additions, anonymous page — counter and copy render for everyone; `page.emulateMedia({ colorScheme })` per `venue-map-interactions.spec.ts:275`): light-scheme flips the section background to white and the counter digits/copy to near-black. Existing anonymous/counter tests keep passing unchanged.
- **Button-level Playwright** (`tests/star-button.spec.ts`, new): the button renders server-side only for invitees, and the no-seed convention means the real page shows no button to an anonymous test — so the button's behavior is verified against a committed static fixture (`tests/fixtures/star-button.html`: the component's rendered markup with its CSS, generated by `scripts/make-star-button-fixture.mjs` in task 1.4): dark/light token inversion, the rim's band geometry (plate inset = rim width, concentric radii, opaque plate, clipped gradient), the angle actually advancing on a 3s linear loop, reduced-motion and forced-colors static presentations, no-JS parity, and rotation continuing (undimmed) while disabled.
- **curl script** (authed, per `rsvp-live-count` 2.6 convention): the fixed body `{ attending: true, partySize: 1 }` on a fresh invite and on a declined invite (upsert over decline), 200 echo, count +1. The endpoint code does not change, so deep contract cases (responded_at survival, busy→503) are NOT re-verified here — they were covered by `rsvp-live-count` 2.6; this script only proves the new always-valid body behaves.
- **Manual visual check**: dark/light emulation on the real page, forced-colors mode, dark/light seam against adjacent dark sections.

## Risks / Trade-offs

- [Decline becomes UI-invisible] → Accepted by the couple; the API still accepts `attending: false` (curl/direct) for support cases; declines in the DB remain valid rows.
- [Party-size honesty] → Counter becomes invitation-count, not headcount; couple accepted ("just speculation"). No schema migration to undo later — `party_size` is simply always 1 going forward.
- [Animation cost] → One button, one CSS property animation on a gradient; the browser throttles it off-screen and in background tabs on its own. The rim repaints every frame (a gradient, not a composited transform), hinted with `will-change: background-image`; negligible for one 58px pill.
- [`@property` support] → Without it the angle cannot interpolate, so the rim renders at its initial angle: the intended static fallback, reached without a feature query.
- [Theme seam with adjacent dark sections] → Accepted now; a whole-page theme pass is explicitly future work.
- [No geometry-aware label glow] → Dropped with the rAF iteration (D3); the label is plain ink on the plate. Accepted: the reference button is what was asked for, and losing the loop also removes resize, visibility, and desync failure modes.

## Migration Plan

No DB or API migration. Deploy is a static asset + server bundle swap. Rollback is a revert — the form's removed UI is the only breaking part, and re-showing it needs no data changes (stored rows are unaffected; `party_size` values of prior multi-guest responses remain in the DB and keep counting until re-submission).

## Open Questions

None — label copy and the decline/party-size removals were confirmed with the couple.
