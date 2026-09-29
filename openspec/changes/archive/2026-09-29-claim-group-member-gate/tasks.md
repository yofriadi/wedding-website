# Tasks: claim-group-member-gate

## 1. Claim Member Gate Component

- [x] 1.1 Create `apps/web/src/components/ClaimMemberGate.astro` with full-screen container (`fixed inset-0 z-45`), centered layout, underline baseline, active blinking cursor, and "Mulai" button container.
- [x] 1.2 Implement character input typing and deletion animations with scale transformations (`@keyframes char-pop-in`, `@keyframes char-pop-out`) synchronized with an underlying native `<input>` inside `<form method="post" action="/api/invite/claim">` (accessible name derived from visible `<label>`), caret positioning for non-trailing edits, `aria-hidden="true"` on visual spans, Enter keydown submission with `preventDefault()`, and reduced-motion support. Ensure input focus is applied only after `#loading-screen` dismissal.
- [x] 1.3 Implement dynamic "Mulai" button visibility: hidden when trimmed length is under 1 character, animated into view when trimmed length is 1 or more, and re-hidden if text drops to 0.
- [x] 1.4 Style the "Mulai" button as an outlined curved pill (`border-radius: 999px`) matching the visual design of the site's action pills (`.claim-button`) without icons or logos.
- [x] 1.5 Implement the `POST /api/invite/claim` submission handler, busy/disabled state during in-flight requests, and the complete response taxonomy:
  - `201` / `200`: trigger multi-surface handoff and smooth fade-out exit animation.
  - `409 group_full`: inform the user and gracefully hand off to the welcome gate under the group name (read-only mode).
  - `404` or `409 not_a_group`: hand off to the welcome gate keeping its server-rendered greeting so the guest is not trapped.
  - `403 cross_origin_post`: show inline error, safe to retry.
  - `>= 500` or connection drop: move `AMBIGUOUS_CLAIM_COPY` verbatim from `RsvpSection.astro:472-473` with proxy explanation comment from `:522-530` preserved, providing a reload button and an affordance to continue browsing as a guest.
  - `400`: show inline validation error, retryable.
- [x] 1.6 Add `<noscript>` styling and a 10-second CSS failsafe (`opacity: 0; visibility: hidden; pointer-events: none;`) cancelled immediately upon inline script initialization so that active guest typing never times out while unscripted visitors bypass the overlay cleanly.

## 2. Layer Orchestration & Multi-Surface Handoff

- [x] 2.1 Update `apps/web/src/pages/index.astro` to evaluate entry claim eligibility (`inviteKind === "group"` with open quota) and render `<ClaimMemberGate />` conditionally between `#loading-screen` and `<WelcomeGate />`.
- [x] 2.2 Update `apps/web/src/components/WelcomeGate.astro` to coordinate failsafes, inertness, and arming: mark `#welcome-gate` `aria-hidden="true"` while `#claim-gate` is active, pause `gate-failsafe` on script initialization while `#claim-gate` is present, restart failsafe on `#claim-gate` dismissal if `arm()` fails, re-pin `window.scrollTo(0, 0)` on arm, and arm swipe gestures once `#claim-gate` is absent or hidden.
- [x] 2.3 Wire the claim gate dismissal to dynamically update `#gate-greeting` with the newly claimed member's `displayName` so the welcome gate greets them personally without a browser reload.
- [x] 2.4 Dispatch a client-side identity event (`claim:success`) on `window` carrying `{ displayName }` upon claim completion to notify `RsvpSection.astro` and `photo-trail.ts` that member identity is active.

## 3. RSVP Section & Photo Trail Integration

- [x] 3.1 In `apps/web/src/components/RsvpSection.astro`, remove the inline mid-scroll claim form (`<form data-claim-form>`), name input, claim submit button, and reload script logic. Clean up dead `.claim-field` and `.claim-button` styles.
- [x] 3.2 Update `RsvpSection.astro` to render `<form data-rsvp-form hidden>` for group renders (preserving load-time one-shot submit listener attachment), and unhide it on `claim:success` to reveal and activate the confirm button dynamically without a page reload or native GET navigation.
- [x] 3.3 In `apps/web/src/scripts/photo-trail.ts`, retire `openClaimFlow()` and the `GROUP_CLAIM_LABEL` reload trigger; keep the photo upload CTA hidden (`button.hidden = true`) for unclaimed group visitors. On `claim:success`, invalidate `groupProbe` and invoke `reloadPhotos()` to re-evaluate and unlock the upload chooser without a reload. Remove the event listener in `initPhotoTrail`'s cleanup disposer.

## 4. Test Helpers, Testing & Documentation

- [x] 4.1 Update `apps/web/tests/helpers.ts` (`dismissWelcomeGate()`) so test fixtures holding an unclaimed group cookie complete entry claiming (or dismiss the gate) before attempting to dismiss the welcome gate.
- [x] 4.2 Create Playwright test spec `apps/web/tests/claim-member-gate.spec.ts` covering:
  - Claim gate reveals after loading screen for eligible group link visitors.
  - "Mulai" button hidden when empty, revealed at 1+ chars, and hidden on clear.
  - Submitting a valid claim sends `POST /api/invite/claim`, fades out the claim gate, updates the welcome gate greeting to the member name, and arms swipe-to-open without page reload.
  - Claim completion unhides `<form data-rsvp-form>`; sliding the button successfully submits `POST /api/rsvp` without page reload or navigation.
  - Claim completion unlocks the photo upload CTA via `reloadPhotos()`.
  - Full-capacity group links bypass the claim gate directly to the welcome gate.
  - Concurrent `409 group_full` during typing gracefully transitions to the welcome gate under the group name.
  - Stale cookie (`404`/`409 not_a_group`) hands off to the welcome gate.
  - Ambiguous outcome guidance on `>= 500` errors with reload/continue actions.
  - Active typing does not time out (>30s, using `test.slow()`).
  - Welcome gate failsafe delay stays visible (>15s) while typing (using `test.slow()`).
  - Claim gate failsafe fires and reveals welcome gate when script fails to initialize.
  - Individual, already-claimed member, and anonymous visitors bypass the claim gate.
- [x] 4.3 Run the Playwright test suite across all suites calling `dismissWelcomeGate()` (`rsvp.spec.ts`, `rsvp-retry.spec.ts`, `photo-trail.spec.ts`, `welcome-gate.spec.ts`, `welcome-gate-multitouch.spec.ts`, `origin-guard.spec.ts`, `families-reveal-wave-motion.spec.ts`, `zoom-reveal-once.spec.ts`, `event-times.spec.ts`, `guest-photo-smoke.spec.ts`, `magnetic-image-trail.spec.ts`, `scroll-fade.spec.ts`, `trail-photo-count.spec.ts`) to ensure zero regressions.
- [x] 4.4 Update `SPEC.md`, `README.md`, and `NOTE.md` documentation reflecting the entry claim gate flow, no-reload handoff, open metrics on member identity, and relocated `AMBIGUOUS_CLAIM_COPY`.
- [x] 4.5 Validate the change with `openspec validate claim-group-member-gate --strict` and `pnpm check-types`.
