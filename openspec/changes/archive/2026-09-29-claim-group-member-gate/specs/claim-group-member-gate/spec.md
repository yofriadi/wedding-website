# claim-group-member-gate Specification

## Purpose

An entry-level interactive claim gate for visitors arriving on a group invitation link. Displayed immediately after the loading screen shimmer phrases and before the welcome gate, it prompts the visitor to enter their name and claim their personal member slot up front. The gate features a minimalist underline text input with character scale animations, an active blinking cursor, and a dynamic "Mulai" button. Once claimed, the gate smoothly transitions into the welcome gate displaying their personal name, and unlocks downstream RSVP confirmation and photo upload capabilities without mid-scroll interruptions or page reloads.

## ADDED Requirements

### Requirement: Entry claim gate presentation and eligibility

The homepage SHALL render an entry claim gate stacked between the loading overlay (z-50) and the welcome gate (z-40) when a request carries an unclaimed group invite cookie with available quota (`kind === "group"` and `claimedCount < maxMembers`). For standalone individuals, already-claimed members, anonymous visitors, and group invites that are already at full capacity (`claimedCount >= maxMembers`), the claim gate SHALL NOT be shown and the sequence SHALL proceed directly from the loading screen to the welcome gate. The claim gate surface SHALL be full-bleed fixed (`fixed inset-0 z-45`), follow the device color scheme (near-black in dark mode, white in light mode), and rely on the page's root scroll lock without prematurely releasing it. Focus on the input field SHALL be applied only after the loading screen has completed its fade-out dismissal.

The gate SHALL carry an initialization-keyed failsafe: if client scripts fail to execute or initialize within a bounded delay (10 seconds), the failsafe SHALL auto-dismiss `#claim-gate` via CSS animation (`opacity: 0; visibility: hidden; pointer-events: none;` matching the welcome gate failsafe) and reveal the welcome gate so an unscripted client is never trapped. A successfully initialized script SHALL immediately cancel this failsafe so that an active typing interaction never times out.

#### Scenario: Unclaimed group visitor with available slots sees claim gate

- **WHEN** a visitor with an unclaimed group cookie where `claimedCount < maxMembers` loads the homepage and the loading overlay finishes
- **THEN** the claim gate appears before the welcome gate with the input active and scroll locked

#### Scenario: Standalone individual bypasses claim gate

- **WHEN** a visitor with an individual invite cookie loads the homepage and the loading overlay finishes
- **THEN** the claim gate is bypassed and the welcome gate appears directly with their personalized greeting

#### Scenario: Already-claimed member bypasses claim gate

- **WHEN** a visitor with a claimed member cookie loads the homepage and the loading overlay finishes
- **THEN** the claim gate is bypassed and the welcome gate appears directly with their personalized member greeting

#### Scenario: Full-capacity group bypasses claim gate

- **WHEN** a visitor with a group cookie where `claimedCount >= maxMembers` loads the homepage and the loading overlay finishes
- **THEN** the claim gate is bypassed and the welcome gate appears directly displaying the group name

#### Scenario: Anonymous visitor bypasses claim gate

- **WHEN** a visitor without an invitation cookie loads the homepage and the loading overlay finishes
- **THEN** the claim gate is bypassed and the welcome gate appears directly with an empty greeting

#### Scenario: Active typing does not time out

- **WHEN** a visitor remains on the claim gate typing their name for longer than 30 seconds with working scripts
- **THEN** the failsafe does not fire and the claim gate remains visible and interactive

### Requirement: Minimalist underline input and character scale animation

The claim gate SHALL present a single-line text input formatted as a horizontal baseline underline without a surrounding rectangular box or background fill, accompanied by a blinking vertical bar cursor (`|`). As the user types characters into the input, each inserted character SHALL animate into view with a scaling animation from small to full size. When characters are deleted or backspaced, the deleted characters SHALL animate in reverse, scaling down before disappearing. Caret navigation or edits inside existing text SHALL re-synchronize display spans without desynchronizing the cursor.

The visual display SHALL be rendered using `aria-hidden="true"` spans backed by an underlying native `<input>` inside a `<form method="post" action="/api/invite/claim">` whose accessible name derives from the visible `<label for="claim-gate-input">` ("Tulis nama Anda") without a conflicting `aria-label`, allowing native virtual keyboards, typing, backspacing, selection, and pasting up to 120 characters. Pressing Enter SHALL submit the form via script (`preventDefault()` prevents URL parameter leaking). Under `prefers-reduced-motion: reduce`, character scale animations SHALL be bypassed.

#### Scenario: Typing animates characters in

- **WHEN** the visitor types a character into the claim input
- **THEN** the character animates into position by scaling up from a smaller initial size to its resting typography scale

#### Scenario: Backspacing animates characters out

- **WHEN** the visitor deletes a character from the claim input
- **THEN** the character scales down and disappears before the layout collapses

#### Scenario: Blinking cursor indicates active typing focus

- **WHEN** the input is rendered and focused
- **THEN** a vertical bar cursor blinks rhythmically immediately following the trailing character (or at the start of the underline when empty)

#### Scenario: Accessibility backing is preserved

- **WHEN** assistive technology reads the claim gate input
- **THEN** it announces the accessible input name and current value without double-announcing the visual animation spans

### Requirement: Dynamic "Mulai" action button

The claim gate SHALL include an action button labeled "Mulai" (Start) positioned beneath the underline input. When the input field contains fewer than 1 trimmed characters (`displayName.trim().length < 1`), the "Mulai" button SHALL be hidden (`opacity: 0`, pointer events disabled). Once the visitor inputs at least 1 non-whitespace character, the "Mulai" button SHALL smoothly animate into view and become clickable. If the visitor subsequently deletes characters such that the trimmed length drops to 0, the button SHALL smoothly animate out of view. The button SHALL be styled as an outlined curved wide pill (`border-radius: 999px`) matching the visual style of the site's action pills without icons or logos.

#### Scenario: Button hidden initially

- **WHEN** the claim gate is first presented with an empty input
- **THEN** the "Mulai" button is not visible and cannot be activated

#### Scenario: Button appears at one character

- **WHEN** the visitor types at least 1 non-whitespace character into the input
- **THEN** the "Mulai" button smoothly animates into view and becomes clickable

#### Scenario: Button hides when input is empty

- **WHEN** the visitor deletes text so the trimmed length falls to 0
- **THEN** the "Mulai" button animates out of view and is disabled

### Requirement: Claim submission taxonomy, error safety, and seamless multi-surface handoff

Activating the "Mulai" button (or pressing Enter in the input when valid) SHALL submit `POST /api/invite/claim` with `{ displayName }`. During submission, the button SHALL indicate a busy state and prevent duplicate submissions.

The client SHALL handle all server outcomes according to a comprehensive taxonomy:

- **Success (`201` or `200`)**: The claim gate SHALL perform a smooth fade-out animation and remove itself from the DOM, revealing the welcome gate beneath it. The welcome gate SHALL dynamically update its greeting element to display the newly claimed member's `displayName` and arm its swipe-to-open interactions without reloading the page. Simultaneously, the client SHALL dispatch a `claim:success` event on `window` carrying `{ displayName }` to unhide the RSVP confirm button and reload the photo trail state.
- **Quota Full (`409 group_full`)**: If the last slot was claimed concurrently while the user was typing, the gate SHALL NOT remain trapped; it SHALL inform the user and smoothly hand off to the welcome gate under the group's collective display name, allowing the visitor to browse the site in the read-only capacity state.
- **Identity Stale / Not Group (`404` or `409 not_a_group`)**: If the group cookie is no longer recognized or maps to an individual invite, the gate SHALL dismiss and hand off to the welcome gate keeping its server-rendered greeting without updating the name, ensuring the visitor is not stuck on an invalid claim screen.
- **Origin Check Failure (`403 cross_origin_post`)**: The gate SHALL display an inline error and remain available for a safe retry.
- **Validation Failure (`400`)**: An inline validation error SHALL appear and the input SHALL remain editable to retry.
- **Ambiguous Outcome (Status `>= 500` or connection drop)**: The gate SHALL display the `AMBIGUOUS_CLAIM_COPY` text verbatim (`"Something went wrong and your spot may already be claimed. Please don't keep retrying — reload the page, and if this form is still here, let us know and we'll sort it out."`) alongside a reload action and an affordance to continue browsing as a read-only guest, ensuring the user is never stuck in an inescapable lockout.

#### Scenario: Successful claim reveals welcome gate with claimed name and unlocks surfaces

- **WHEN** the visitor taps "Mulai" with a valid name and the claim succeeds
- **THEN** the claim gate fades out smoothly, the welcome gate reveals displaying the visitor's newly claimed name, and swipe-up is armed without a page reload

#### Scenario: Quota full at submission time hands off to group browsing

- **WHEN** the visitor submits a claim but the last available slot was taken concurrently (`409 group_full`)
- **THEN** the visitor is notified and the gate transitions smoothly to the welcome gate under the group identity, allowing browsing without locking them out

#### Scenario: Stale cookie hands off to welcome gate

- **WHEN** a claim request receives a 404 or 409 not_a_group response
- **THEN** the gate dismisses and hands off to the welcome gate with its server-rendered greeting rather than trapping the visitor

#### Scenario: Ambiguous server error prevents blind retries without locking out

- **WHEN** a claim request encounters a 5xx response or dropped connection
- **THEN** ambiguous-outcome guidance is presented with a reload button and a continue-as-guest affordance, preventing duplicate claims while avoiding a lockout

#### Scenario: Client error allows retry

- **WHEN** a claim request returns a 400 or 403 error
- **THEN** an inline error message appears, the input value is preserved, and the "Mulai" button remains available to retry
