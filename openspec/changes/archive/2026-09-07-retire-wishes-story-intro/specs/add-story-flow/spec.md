## REMOVED Requirements

### Requirement: One-screen flow with two optional inputs

**Reason**: Wishes are removed. The flow no longer has a wish input, so "two optional inputs, at least one non-empty" no longer describes it. Replaced by `One-screen photo flow` below.

**Migration**: See the ADDED `One-screen photo flow` requirement — the flow is a single photo picker requiring at least one photo.

### Requirement: Rotating wish placeholder

**Reason**: The wish input is removed, so there is no field whose placeholder could rotate. The couple-curated templates and all rotation logic (`WISH_PLACEHOLDER_TEMPLATES`, `startPlaceholderRotation`, the first-keystroke disable) are deleted.

**Migration**: None. `placeholder-verify.spec.ts` is deleted with the feature.

## ADDED Requirements

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

## MODIFIED Requirements

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
