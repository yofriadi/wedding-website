# Design: claim-group-member-gate

## Context

The wedding website supports group invitations where multiple guests share a single link, each claiming a personal member slot under an admin-set quota (`maxMembers`).

Previously, claiming a member slot was placed mid-scroll in `RsvpSection.astro`. When a visitor opened a group link, they watched the loading screen phrases, swiped open the welcome gate (which displayed the collective group name), scrolled through the homepage narrative, found an inline claim form, entered their name, and submitted. Claiming triggered an immediate `window.location.reload()`, which restarted the entire loading sequence and welcome gate a second time.

The user reviewed this flow and requested an entry-level claim gate displayed immediately after the loading phrases and before the welcome gate. The design (from mockup `claim-group-member-gate.png`, preserved in this change directory) features a minimalist underline input with an active cursor, character scale animations on typing and deletion, and a dynamic "Mulai" button styled after the site's action pills (`border-radius: 999px`).

Two key product decisions were confirmed during adversarial review:

- **E1 (Option A - Client-Side Multi-Surface Handoff)**: Instead of reloading the page, a successful claim updates `#gate-greeting` on the welcome gate, unhides the pre-wired RSVP confirm form in `RsvpSection`, and signals `photo-trail.ts` to unlock the photo upload CTA. The visitor enjoys a completely seamless transition with zero page reloads.
- **E2 (Option B - Mandatory Entry Gate)**: Anyone following a group link below capacity enters their name upon arrival so their member identity is established up front before entering the celebration site.

## Goals / Non-Goals

**Goals:**

- Provide a mandatory entry-level claim experience for unclaimed group invitations immediately after the loading overlay finishes.
- Present a minimalist underline input with an active blinking cursor bar (`|`) and real-time character-by-character scale animations on insert and delete.
- Back the visual animation with an accessible native `<input>` inside `<form method="post" action="/api/invite/claim">` supporting mobile virtual keyboards, caret navigation, paste, and assistive technologies.
- Display a dynamic "Mulai" (Start) button that remains hidden until the visitor enters at least 1 non-whitespace character.
- Style the "Mulai" button as an outlined curved pill (`border-radius: 999px`) matching the visual style of the site's action pills (`.claim-button`) without icons or logos.
- On successful claim submission, fade out the claim gate smoothly and hand off to the welcome gate, dynamically updating its greeting to the new member's name without a page reload.
- Seamlessly unlock the RSVP confirmation button and photo upload CTA in the client without requiring a browser reload.
- Remove the inline mid-scroll claim form and full-page reload loop from `RsvpSection.astro`.
- Safely handle concurrency (`409 group_full`) and stale identities (`404`, `409 not_a_group`) by transitioning to the welcome gate under the group/available name, preventing user lock-out.
- Safeguard against duplicate slot claims on ambiguous network/server errors (>= 500) using `AMBIGUOUS_CLAIM_COPY` while offering a path to continue as a guest.

**Non-Goals:**

- Modifying the backend claim API or database schema: `POST /api/invite/claim` and the atomic quota enforcement statement remain unchanged.
- Adding complex multi-step guest profiles: only `displayName` (1–120 characters) is collected.
- Allowing slot unclaiming or revocation from this client interface.

## Decisions

### D1. Layer stacking, orchestration & failsafe coordination

The homepage layout stacks full-screen overlay layers using z-index:

- `#loading-screen`: `z-50` (highest layer; renders shimmer phrases while hero media preloads).
- `#claim-gate`: `z-45` (rendered conditionally for eligible group invite visitors).
- `#welcome-gate`: `z-40` (renders guest greeting and swipe-to-open curtain).
- `<main>` content: below gates.

Eligibility for the claim gate is evaluated server-side in `index.astro`:

```ts
const canClaimAtEntry =
  inviteKind === "group" &&
  inviteGroupQuota !== null &&
  inviteGroupQuota.claimedCount < inviteGroupQuota.maxMembers;
```

**Stacking, Focus & Failsafe Coordination:**

1. When `canClaimAtEntry` is true, `#claim-gate` is rendered in initial markup between the loader and welcome gate. Focus on the text input is applied only after `#loading-screen` finishes its fade-out dismissal, avoiding premature virtual keyboard popups during the loading phrases.
2. While `#claim-gate` is active, `#claim-gate` carries `role="dialog" aria-modal="true"` with an accessible label, and `#welcome-gate` is marked `aria-hidden="true"` so assistive technologies focus exclusively on the claim input.
3. Main inertness follows today's pattern: `<main>` becomes inert when `WelcomeGate.astro` arms via `applyInert()` in `arm()`. Applying `inert` during the claim-gate phase is avoided because a CSS-only failsafe cannot clear the `inert` attribute if scripts fail. When `arm()` runs following a claim gate exit, it re-executes `window.scrollTo(0, 0)` to guarantee the scroll-zero invariant.
4. Because `WelcomeGate.astro` parses after `ClaimMemberGate.astro`, `WelcomeGate`'s script checks for `#claim-gate` presence directly on initialization. If present and not hidden, it pauses its 15-second auto-dismiss failsafe (`gate-failsafe`) so extended guest typing (>15s) cannot cause the welcome gate to prematurely dismiss. If `#claim-gate` dismisses without `WelcomeGate` successfully arming, the welcome failsafe is restarted.
5. `#claim-gate` carries an initialization-keyed failsafe: if client scripts fail to execute, a 10-second CSS animation dismisses `#claim-gate` with `opacity: 0; visibility: hidden; pointer-events: none;` (matching `gate-failsafe`). The moment the inline script initializes and binds events, this failsafe is cancelled so that active typing never times out. Welcome gate arming keys on `#claim-gate` being absent or hidden.

### D2. In-place multi-surface handoff (no page reload)

Upon tapping "Mulai" (or pressing Enter with a valid name):

1. The button enters a busy state (`aria-busy="true"`).
2. The client sends `POST /api/invite/claim { displayName: value.trim() }`.
3. The server responds with `201` (or idempotent `200`) and issues `Set-Cookie: ww_invite_id=<member_id>` on 201, binding the browser's cookie to the newly minted member ID.
4. On success:
   - **Welcome Gate:** The client updates `document.getElementById('gate-greeting').textContent = response.displayName`.
   - **Event Dispatch:** The client dispatches a `claim:success` event on `window` with `detail: { displayName: response.displayName }`.
   - **RSVP Section:** `RsvpSection.astro` renders `<form data-rsvp-form>` with the `hidden` attribute during group renders. This ensures the one-shot submit listener (`const form = document.querySelector("[data-rsvp-form]")`) at `RsvpSection.astro:354` binds normally on page load. On `claim:success`, the form simply removes `hidden`, presenting the active confirm button immediately without native GET submission pitfalls.
   - **Photo Trail:** `photo-trail.ts` listens for `claim:success` on `window`. It invalidates its cached `groupProbe` and invokes `reloadPhotos()`, which awaits `refresh()` and re-renders the upload pill enabled without a reload. The event listener is cleanly removed in `initPhotoTrail`'s cleanup disposer.
   - **Claim Gate Dismissal:** `#claim-gate` performs a smooth fade-out animation (`opacity: 0; transform: scale(0.98); transition: opacity 400ms, transform 400ms;`) and is removed from the DOM.
   - **Welcome Gate Arming:** `#welcome-gate` detects the dismissal and initializes `arm()`, locking root scroll and preparing the swipe-to-open curtain.

### D3. Underline input presentation, character scale animation & accessibility

The UI mockup specifies a bottom-border-only input with an active cursor and character scale animations:

- **DOM Structure:**
  ```html
  <div class="claim-input-container">
    <form method="post" action="/api/invite/claim" class="claim-form">
      <input type="text" class="claim-native-input" maxlength="120" autocomplete="name" />
      <div class="claim-visual-line" aria-hidden="true">
        <div class="claim-char-track">
          <span class="claim-char">A</span>
          <span class="claim-char">l</span>
          <span class="claim-cursor">|</span>
        </div>
      </div>
      <button type="submit" class="claim-submit" hidden>Mulai</button>
    </form>
  </div>
  ```
- **Typing Animation & Caret Reconciliation:**
  - When characters are appended, the new `<span class="claim-char">` animates with `@keyframes char-pop-in` (scaling up from 0.35 to 1.0).
  - When backspacing, the exiting character animates with `@keyframes char-pop-out` (scaling down from 1.0 to 0.35) before removal.
  - Caret navigation, selection, and non-trailing edits re-render the spans statically from `input.value` and position `<span class="claim-cursor">` at `selectionStart`.
  - Enter key in the input submits the form via script with `preventDefault()` preventing accidental URL parameter leaks.
- **Accessibility:**
  - The native `<input>` remains interactive and focusable with an accessible `<label>` ("Tulis nama Anda"), allowing screen readers to announce characters normally.
  - The animated character display is marked `aria-hidden="true"`, preventing double-announcements.
  - Error messages and status updates use `role="alert"` and polite live regions.
- **Reduced Motion:**
  - Under `prefers-reduced-motion: reduce`, character scale animations and fade transforms are replaced by instant swaps.

### D4. Dynamic "Mulai" button styling and threshold

- **Threshold:**
  - `trimmedLength < 1`: Hidden (`opacity: 0; visibility: hidden; transform: translateY(8px); pointer-events: none;`).
  - `trimmedLength >= 1`: Revealed (`opacity: 1; visibility: visible; transform: translateY(0); pointer-events: auto; transition: opacity 250ms, transform 250ms, visibility 250ms;`).
- **Button Styling:**
  - Outlined curved pill with `border-radius: 999px;` matching the visual style of the site's action pills (`.claim-button`).
  - Themed contrast matching dark and light modes.
  - No icons, logos, or extra embellishments.

### D5. Complete claim response taxonomy & ambiguous error protection

The claim handler covers all potential response statuses from `POST /api/invite/claim`:

- **`201` / `200` (Success)**: Proceed to multi-surface handoff and welcome gate reveal.
- **`409 group_full` (Concurrency Race)**: If another guest takes the final slot while a visitor is typing, the server returns `409 group_full`. The gate displays an informative message and smoothly fades out to the welcome gate displaying the group name, allowing them to browse as a read-only group visitor rather than being locked out.
- **`404` / `409 not_a_group` (Stale / Invalid Identity)**: The cookie is no longer a valid unclaimed group. The gate dismisses and hands off to the welcome gate keeping its server-rendered greeting (since no `displayName` is returned in the body) so the guest is not trapped.
- **`403 cross_origin_post` (Origin Failure)**: Displays an inline error alongside a reload action and continue-as-guest affordance, preventing permanent lockout.
- **`400` (Validation Failure)**: Displays an inline validation error and remains open for retry.
- **Status `>= 500` or Connection Drop (Ambiguous Outcome)**: In accordance with owner decision D3 (`openspec/changes/group-invitations/design.md:169`), the client relocates `AMBIGUOUS_CLAIM_COPY` verbatim from `RsvpSection.astro:472-473` (`"Something went wrong and your spot may already be claimed. Please don't keep retrying — reload the page, and if this form is still here, let us know and we'll sort it out."`). Because reverse proxies (like Caddy) synthesize 502/504 errors on upstream drop (documented at `RsvpSection.astro:522-530`), any status `>= 500` displays this guidance alongside a reload button and an affordance to continue browsing as a guest, preventing duplicate slot allocation without locking the guest out.
- **Scroll Lock Coordination:** The claim gate relies on the page's existing root scroll lock established by `WelcomeGate.astro` and does not independently clear `documentElement.style.overflow`.

### D6. Removal of mid-scroll claim form in `RsvpSection.astro` & Photo Trail update

`RsvpSection.astro` previously embedded `<form data-claim-form>` with inline claim inputs.
With entry claiming established:

- The inline claim form and its reload script are removed. Dead CSS rules for `.claim-field` and `.claim-button` are cleaned up.
- In their place, if an unclaimed group identity reaches the RSVP section (e.g. after failsafe dismissal), it displays a brief read-only guidance note ("Klaim tempat melalui gerbang undangan grup di awal halaman"); if the group is full, it shows the read-only capacity message.
- For a visitor who claimed their slot at the entry gate, the section unhides `<form data-rsvp-form>` upon receiving `claim:success`.
- In `photo-trail.ts`, `openClaimFlow()` and `GROUP_CLAIM_LABEL` reload triggers are removed; unclaimed group visitors see a hidden upload control (`button.hidden = true`), and freshly claimed members unlock the chooser upon entry claim completion via `reloadPhotos()`.

## Risks / Trade-offs

- **[Risk] Mobile virtual keyboard obscures input or button** → Centered vertically using dynamic viewport units (`dvh`), with tight 20px spacing between underline and "Mulai" button.
- **[Risk] Multiple characters inserted at once (autofill, paste)** → Input sync handler maps full `input.value` to spans cleanly, checking length threshold immediately.
- **[Risk] Concurrent claim races exhaust quota during typing** → `409 group_full` transitions gracefully to the welcome gate under the group name rather than trapping the visitor.
- **[Risk] Ambiguous server outcome causes duplicate slot claims** → Error handling follows `AMBIGUOUS_CLAIM_COPY` semantics for `>= 500`, guiding guests to reload once rather than retry blindly, while offering a guest continue path.
- **[Risk] JavaScript disabled or crashes before initialization** → `<noscript>` and a 10-second CSS failsafe ensure unscripted visitors bypass the overlay cleanly. Post-initialization script crashes remain an accepted residual risk.

## Migration Plan

1. Implement `ClaimMemberGate.astro` with input markup, character scaling animations, cursor blinking, "Mulai" button reveal, and `AMBIGUOUS_CLAIM_COPY` handling.
2. Update `index.astro` to render `ClaimMemberGate` conditionally for unclaimed group links and coordinate layer stacking.
3. Update `WelcomeGate.astro` to postpone its failsafe and arming until `ClaimMemberGate` exits/hides, restart failsafe on dismiss, re-pin scroll to 0 on arm, and dynamically update `#gate-greeting`.
4. Update `RsvpSection.astro` to ship `<form data-rsvp-form hidden>` for group renders and unhide on `claim:success`.
5. Update `photo-trail.ts` to retire `openClaimFlow()`, hide button for unclaimed group visitors, re-sync identity via `reloadPhotos()` on `claim:success`, and unlock the upload CTA without a reload.
6. Update test helpers in `apps/web/tests/helpers.ts` (`dismissWelcomeGate`) to complete entry claim when `#claim-gate` is present.
7. Add automated Playwright tests in `apps/web/tests/claim-member-gate.spec.ts` and verify existing test suites.
8. Update `SPEC.md` documentation.

## Open Questions

None. All architectural decisions, failure taxonomies, and cross-surface handoff mechanisms are fully resolved.
