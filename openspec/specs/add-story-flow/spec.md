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

### Requirement: One-screen flow with two optional inputs

The flow SHALL present a photo picker (optional, up to 3 photos with client-side type/size pre-validation) and wish text (optional, max 30 chars, single line) on one screen; at least one input must be non-empty to submit.

#### Scenario: Text-only submission

- **WHEN** an invitee submits wish text with no photos
- **THEN** the submission is created with wish text only

#### Scenario: Photo-only submission

- **WHEN** an invitee submits photos with no wish text
- **THEN** the submission is created with photos only

#### Scenario: Both together

- **WHEN** an invitee submits wish text and photos
- **THEN** one submission is created containing both

#### Scenario: Empty submit disabled

- **WHEN** both inputs are empty
- **THEN** the submit action is disabled or rejected client-side

### Requirement: Post-submit state transitions

On `201` the flow SHALL close, the add-story tile SHALL disappear, the wish marquee SHALL swap per its display states, and the rail SHALL include the caller's photos.

#### Scenario: Successful submit

- **WHEN** the flow completes with `201`
- **THEN** the tile is gone, the marquee reflects real content (or remains demo+be-first if this was wish-less and no wishes exist), and own photos appear in the rail

### Requirement: Error handling maps to inline states

`409` SHALL map to the already-posted state (tile gone, mine shown); `400` SHALL map to inline field errors; network failure SHALL leave the flow open with a retry.

#### Scenario: Race loser sees already-posted

- **WHEN** a concurrent double-submit loses the race and receives `409`
- **THEN** the UI transitions to the already-posted state (indistinguishable from having posted)

#### Scenario: Validation error inline

- **WHEN** the server responds `400` with a field error
- **THEN** the corresponding input shows an inline error and the flow stays open

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

### Requirement: Rotating wish placeholder

While the add-story flow is open and the wish input is empty, the input's `placeholder` SHALL cycle through couple-curated template wishes on an interval of approximately 4 seconds. Every template SHALL be at most 30 UTF-16 code units (the wish length limit). Rotation SHALL play at most one pass through the template list per flow open and then settle on the default placeholder. The first keystroke in a page session SHALL disable rotation for the rest of the session; clearing the field afterwards SHALL NOT resume it, and reopening the flow after typing SHALL NOT restart it. Rotation SHALL NOT run when the input is non-empty (note: closing the flow does not clear typed wish text, so a reopen may begin non-empty), when the flow is closed, or under `prefers-reduced-motion` (the static default placeholder is shown instead). The field's accessible name SHALL remain constant (the rotation changes only supplementary hint text).

#### Scenario: Empty input cycles suggestions once

- **WHEN** the flow is open and the wish input is empty
- **THEN** the placeholder rotates through the template list on the interval, once, then settles on the default

#### Scenario: First keystroke disables rotation

- **WHEN** the guest types in the wish input
- **THEN** rotation stops for the rest of the page session, and clearing the field does not resume it

#### Scenario: Closed flow idles

- **WHEN** the flow closes
- **THEN** the rotation timer stops, and reopening starts a fresh pass from the default — unless rotation was already disabled by typing, in which case reopening leaves the placeholder static

#### Scenario: Reopen with retained text

- **WHEN** the flow is reopened after the guest typed (closing does not clear the wish text)
- **THEN** the input is non-empty and rotation does not run

#### Scenario: Reduced motion

- **WHEN** the user prefers reduced motion
- **THEN** the placeholder stays static at the default
