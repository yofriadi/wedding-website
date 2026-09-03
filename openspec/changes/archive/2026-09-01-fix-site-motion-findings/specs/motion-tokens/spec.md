# motion-tokens Spec Delta

## MODIFIED Requirements

### Requirement: Token set covers the house curves

The shared motion token set SHALL include the house ease-out curve (`cubic-bezier(0.16, 1, 0.3, 1)`) and SHALL name every easing curve shared by more than one call site — including the strong ease-out for short UI feedback (`cubic-bezier(0.23, 1, 0.32, 1)`), the standard decelerate curve for ambient pings (`cubic-bezier(0, 0, 0.2, 1)`), the scroll-scrubbed zoom curve (`cubic-bezier(0.33, 1, 0.68, 1)`), and the blur-reveal entrance curve (`cubic-bezier(0.25, 0.1, 0.25, 1)`) — defined in the global theme so both CSS and script consumers can adopt them. A token with zero consumers SHALL NOT be kept in the theme (dead tokens invite copy-paste of the wrong curve).

#### Scenario: Inspecting the global theme

- **WHEN** the global stylesheet's theme block is read
- **THEN** it contains `--ease-out-expo` plus named tokens for the strong ease-out, standard decelerate, scroll-zoom, and blur-reveal curves (or equivalently named) with those exact values — and no token that has zero consumers

#### Scenario: Single-consumer curves stay local

- **WHEN** a curve has exactly one consumer (e.g. the welcome gate's drawer curve)
- **THEN** it lives as a named local constant at that call site rather than a global token

## ADDED Requirements

### Requirement: JS easing twins share one name

Where scripts need the house ease-out curve as a numeric array, the local constant SHALL be named consistently (`EASE_OUT_EXPO`) across all consumers, next to a keep-in-sync comment pointing at the CSS token.

#### Scenario: Reading any script that eases with the house curve

- **WHEN** a script's easing constant for the house ease-out curve is inspected
- **THEN** it is named `EASE_OUT_EXPO` and carries the keep-in-sync comment, matching the other consumers
