# add-story-flow Spec Delta

## Purpose

The single invite-only submission flow that combines wish text and photos in one screen, entry-pointed from the story rail.

## ADDED Requirements

### Requirement: Add-story tile visible only to eligible invitees

The story rail SHALL show an "Add Story" tile only when an invite cookie is present AND the caller has no submission (`mine` is null); it SHALL NOT render for public visitors or for invitees who already posted.

#### Scenario: Public never sees the tile

- **WHEN** a visitor without a cookie views the rail
- **THEN** no add-story tile exists in the DOM

#### Scenario: Eligible invitee sees the tile

- **WHEN** an invite holder with no prior submission loads the page
- **THEN** the add-story tile renders in the rail

#### Scenario: Posted invitee does not see the tile

- **WHEN** a cookie holder with an existing submission loads the page
- **THEN** no add-story tile renders

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
