# add-story-flow Specification

## Purpose

TBD - created by archiving change guest-submissions. Update Purpose after archive.

## Requirements

### Requirement: Add-story tile visible only to eligible invitees

The story rail SHALL show an "Add Story" tile only when the server has RESOLVED the caller's invite (the `GET /api/submissions` payload's `inviteValid` is true) AND the caller has no submission (`mine` is null); it SHALL NOT render for public visitors, for invitees who already posted, or for a holder of a stale well-shaped cookie that resolves to no invite. (SSR may render the tile on cookie shape alone as an optimistic pre-filter; the client hides it once the payload proves the invite unresolved.)

#### Scenario: Public never sees the tile

- **WHEN** a visitor without a cookie views the rail
- **THEN** no add-story tile exists in the DOM

#### Scenario: Eligible invitee sees the tile

- **WHEN** an invite holder with no prior submission loads the page
- **THEN** the add-story tile renders in the rail

#### Scenario: Posted invitee does not see the tile

- **WHEN** a cookie holder with an existing submission loads the page
- **THEN** no add-story tile renders

#### Scenario: Stale cookie does not see the tile

- **WHEN** a cookie holder whose invite no longer resolves (deleted invite, reset database) loads the page
- **THEN** any SSR-rendered tile is hidden after the submissions fetch resolves, and no add-story tile remains visible

### Requirement: One-screen photo flow

The flow SHALL present a single photo picker (up to 3 photos, client-side type and size pre-validation) on one screen; at least one photo SHALL be required to submit, and the submit action SHALL be disabled or rejected client-side while no photo is selected.

#### Scenario: Photo submission

- **WHEN** an invitee selects one to three valid photos and submits
- **THEN** the submission is created with those photos

#### Scenario: Empty submit disabled

- **WHEN** no photo is selected
- **THEN** the submit action is disabled or rejected client-side

### Requirement: Add-story tile plays the example intro on first tap

The first activation of the add-story tile in a given browser SHALL play the three example stories as a full-screen story sequence; on reaching the end of the third example the flow SHALL open automatically. Every subsequent activation SHALL open the flow directly, skipping the intro. "First activation" SHALL be tracked with a persistent client flag (e.g. `localStorage`) set when the intro opens; when the flag cannot be persisted the intro MAY replay, and it SHALL never block opening the flow. Dismissing the intro before its end (e.g. Escape) SHALL NOT auto-open the flow.

#### Scenario: First tap plays the intro then opens the flow

- **WHEN** an eligible invitee activates the add-story tile for the first time in this browser
- **THEN** the three example stories play in sequence, and when the third finishes the add-story flow opens

#### Scenario: Later taps open the flow directly

- **WHEN** the same invitee activates the tile again (the intro flag is set)
- **THEN** the add-story flow opens immediately with no intro

#### Scenario: Bailing out of the intro does not open the flow

- **WHEN** the invitee dismisses the intro (Escape or close) before the third example ends
- **THEN** the flow does not auto-open, and the next tap opens the flow directly (the intro is marked seen)

### Requirement: Post-submit state transitions

On `201` the flow SHALL close, the add-story tile SHALL disappear, and the rail SHALL include the caller's photos.

#### Scenario: Successful submit

- **WHEN** the flow completes with `201`
- **THEN** the tile is gone and the caller's own photos appear in the rail

### Requirement: Error handling maps to inline states

`409` SHALL map to the already-posted state (tile gone, mine shown); `400` SHALL map to inline photo errors; network failure SHALL leave the flow open with a retry.

#### Scenario: Race loser sees already-posted

- **WHEN** a concurrent double-submit loses the race and receives `409`
- **THEN** the UI transitions to the already-posted state (indistinguishable from having posted)

#### Scenario: Validation error inline

- **WHEN** the server responds `400` (too many photos, oversized, disallowed type, or no photo)
- **THEN** the corresponding inline error shows and the flow stays open

### Requirement: The flow modal animates open and closed

Opening and closing the add-story flow SHALL animate on the composite path (opacity + transform) rather than flipping visibility instantly: entrance fades the backdrop while the panel rises and settles (`translateY(16px) scale(0.95)` → identity, ~200ms, house ease-out); exit is the same motion in reverse but faster (~120ms), because an exit confirms an action the user already took. After the exit completes, the modal returns to its inert rest state (`opacity-0`, `pointer-events-none`, `aria-hidden="true"`, no lingering inline styles). Under reduced motion the modal fades in place with no rise or scale.

#### Scenario: Opening the flow

- **WHEN** the guest opens the add-story flow from the rail tile
- **THEN** the backdrop fades in over ~150ms and the panel animates `translateY(16px) scale(0.95)` → `translateY(0) scale(1)` over ~200ms with `cubic-bezier(0.16, 1, 0.3, 1)`

#### Scenario: Closing the flow

- **WHEN** the guest closes the flow (Cancel, backdrop click, Escape, or post-submit)
- **THEN** the exit animates over ~120ms with the same curve in reverse, and on completion the root carries `opacity-0`, `pointer-events-none`, `aria-hidden="true"`, and no inline `opacity`/`transform` styles

#### Scenario: Reduced-motion open/close

- **WHEN** `prefers-reduced-motion: reduce` is active and the flow opens or closes
- **THEN** the transition is an opacity fade only — no panel rise or scale

#### Scenario: Rapid open/close

- **WHEN** the guest opens and closes the flow in quick succession
- **THEN** the animations retarget from their current values and never leave the modal stuck half-visible or interactive while hidden
