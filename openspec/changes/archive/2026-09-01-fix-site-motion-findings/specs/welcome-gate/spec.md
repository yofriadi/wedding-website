# welcome-gate Spec Delta

## MODIFIED Requirements

### Requirement: Finger-tracked upward swipe reveal

On touch devices, dragging upward SHALL move the gate 1:1 with the finger (transform-only). Downward drag SHALL be clamped (the gate does not travel down). On release, the gesture SHALL commit when the gate has traveled past a viewport-relative threshold or the finger has upward flick velocity; a committed gate animates fully off the top edge; an aborted gate springs back to rest. Both non-tracking transitions — the commit sweep and the spring-back — SHALL use the iOS-like drawer curve `cubic-bezier(0.32, 0.72, 0, 1)` (not bare `ease-out`), keeping the existing durations (~400ms commit, ~250ms snap-back).

#### Scenario: Commit by distance

- **WHEN** the user drags the gate upward past the commit threshold and releases
- **THEN** the gate animates off-screen over ~400ms along the drawer curve and the reveal completes

#### Scenario: Commit by flick

- **WHEN** the user releases a short but fast upward swipe
- **THEN** the reveal commits even though the distance threshold was not reached

#### Scenario: Abort springs back

- **WHEN** the user drags upward slightly and releases without threshold or velocity
- **THEN** the gate springs back over ~250ms along the drawer curve to fully covering the viewport and remains armed

#### Scenario: No downward travel

- **WHEN** the user drags downward on the gate
- **THEN** the gate does not move downward with the finger
