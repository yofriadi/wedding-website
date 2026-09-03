# add-story-flow Spec Delta

## Purpose

Adds the rotating wish placeholder: the empty wish input cycles template suggestions as writing prompts while the flow is open — bounded, self-terminating, and silent once the guest starts typing.

(Base spec lands with the `guest-submissions` archive — see proposal D-ordering note.)

## ADDED Requirements

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
