# Proposal: claim-group-member-gate

## Why

Group invitation visitors currently have to scroll through the entire homepage narrative to find an inline claim form in the RSVP section, and claiming triggers an abrupt full-page reload that restarts the entire loading and welcome sequence. Introducing a mandatory entry-level claim gate immediately after the loading phrases and before the welcome gate lets group guests claim their member slot up front, see their name appear instantly on the welcome gate, and enter the site smoothly. Client-side state handoff then unlocks both the RSVP confirmation and photo upload capabilities without mid-scroll interruptions or page refreshes.

## What Changes

- **Entry Claim Gate (`<ClaimMemberGate />`)**: For visitors arriving with an unclaimed group invitation that has available quota, an interactive claim gate displays immediately after the loading screen shimmer phrases and before the welcome gate. Claiming is mandatory on group links below capacity so every visiting group member establishes their identity up front.
- **Minimalist Underline Input & Character Animations**: The claim gate features an underline-only text input with an active blinking cursor bar. Typed characters animate in with a scale transition from small to normal size, and character deletion animates in reverse (scaling down to disappear). The presentation layer uses `aria-hidden="true"` spans backed by a native accessible `<input>` inside a `<form method="post" action="/api/invite/claim">` with `preventDefault()` handling.
- **Conditional "Mulai" Button**: An action button labeled "Mulai" (Start) is hidden initially and reveals once the user inputs at least 1 non-whitespace character (`displayName.trim().length >= 1`). The button uses a curved wide pill design (`border-radius: 999px`) matching the visual language of the site's action pills without icons or logos.
- **Seamless Claim & Multi-Surface Handoff**: Tapping "Mulai" sends `POST /api/invite/claim { displayName }`. Upon success (`201` or `200`):
  - The claim gate smoothly fades out and hands off to the welcome gate.
  - The welcome gate dynamically updates its centered greeting to the new member's name, re-pins scroll to 0, and arms swipe-to-open interactions without a page reload.
  - The RSVP section unhides its pre-wired `<form data-rsvp-form>` so the "Confirm Reservation" button is ready when scrolled to.
  - The guest photo trail (`photo-trail.ts`) resets its cached group state and runs `reloadPhotos()` so the photo upload CTA unlocks without requiring a browser reload.
  - Because claiming precedes gate opening, the welcome gate's commit gesture records the open metric under the claimed member identity rather than the pre-claim group identity.
- **RSVP Section Mid-Scroll Form & Release Removal**: The inline claim form inside `RsvpSection.astro` is removed. Additionally, the browser-side identity release feature (`GET /{id}?fresh=1` and "Not you? Claim your own spot") is permanently removed: once claimed on a browser, member identity is sticky. Group links that are at capacity display read-only capacity messaging; open-quota unclaimed visitors see read-only entry guidance; individual and claimed member identities render their respective RSVP controls.
- **Safety, Failsafe & Capacity Fallbacks**:
  - If a group is already at full capacity (`claimedCount >= maxMembers`) on load, the claim gate is bypassed entirely, proceeding directly to the welcome gate with the group name.
  - If the last slot is taken concurrently while a user is typing on the claim gate (`409 group_full`), the gate informs the user and smoothly transitions into the welcome gate in the read-only group browsing state, never trapping them.
  - Stale cookies (`404` or `409 not_a_group`) transition to the welcome gate keeping the server-rendered greeting without updating the name.
  - `WelcomeGate` pauses its 15-second CSS failsafe while the claim script is active so guest typing cannot cause the welcome gate to prematurely dismiss.
  - A claim gate CSS failsafe (10s, ending in `opacity: 0; visibility: hidden; pointer-events: none`) ensures uninitialized scripts never trap a visitor.
  - Ambiguous failure outcomes (>= 500 or connection drop) provide `AMBIGUOUS_CLAIM_COPY` alongside a reload action and continue-as-guest affordance, preventing duplicate slot allocation without locking the guest out.

## Sequencing Note

`group-invitations` must be archived BEFORE `claim-group-member-gate` so that the `REMOVED Requirements` delta against `group-invitations` resolves against the main spec.

## Capabilities

### New Capabilities

- `claim-group-member-gate`: The entry claim gate UI component, character typing/deletion animations, dynamic "Mulai" button reveal threshold (minimum 1 character), claim submission lifecycle, failsafe protections, and seamless handoff to the welcome gate, RSVP section, and photo trail.

### Modified Capabilities

- `welcome-gate`: Stacking, handoff, failsafe pause while claim gate is active, scroll re-pin, and dynamic greeting update when transitioning from the claim gate without a page reload.
- `rsvp-section`: Removal of the mid-scroll inline claim form for group visitors, permanent removal of the "Not you?" release control, and client-side unhiding of the confirm button for freshly claimed members without a page reload.
- `guest-photo-trail`: State re-synchronization on entry claim completion, ensuring the photo upload CTA unlocks without requiring a page reload.

_Prerequisite Note:_ This change's deltas supersede the inline mid-scroll claim form, full-page reload clauses, and identity release clauses (`?fresh=1`) from the unarchived `group-invitations` change.

## Impact

- **Web components & scripts (`apps/web`)**:
  - New component `src/components/ClaimMemberGate.astro`.
  - Updates to `src/pages/index.astro`: Orchestrates the sequence between `#loading-screen`, `ClaimMemberGate`, and `WelcomeGate`.
  - Updates to `src/components/WelcomeGate.astro`: Pauses failsafe auto-dismissal while claim gate is active, dynamically updates `#gate-greeting`, and coordinates arming.
  - Updates to `src/pages/[id].ts`: Permanently removes `?fresh=1` release handling and quota check on redirect.
  - Updates to `src/components/RsvpSection.astro`: Ships `<form data-rsvp-form hidden>` for open-quota group renders, unhides on `claim:success`, updates to capacity message on `claim:capacity`, and removes identity release controls.
  - Updates to `src/scripts/photo-trail.ts`: Re-synchronizes group state upon entry claim completion via `reloadPhotos()`.
- **Test helpers & specs**:
  - Updates to `apps/web/tests/helpers.ts` (`dismissWelcomeGate` completes entry claim when `#claim-gate` is present).
  - New Playwright specs `apps/web/tests/claim-member-gate.spec.ts`.
- **Docs**: Updates to `SPEC.md` reflecting entry-level slot claiming, no-reload handoff, and member open metrics.
