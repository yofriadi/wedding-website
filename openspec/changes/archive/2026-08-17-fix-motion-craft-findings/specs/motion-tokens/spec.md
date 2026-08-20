## ADDED Requirements

### Requirement: Motion easing and duration values live in shared tokens

Motion easing curves used by more than one component SHALL be defined once as shared tokens (CSS custom properties in the global theme, with a matching JS constant per script where `animate()` needs numeric arrays), rather than hand-typed at each call site.

#### Scenario: Adding a new animated component

- **WHEN** a component needs the house ease-out curve
- **THEN** it references the shared token/constant instead of re-typing `cubic-bezier(0.16, 1, 0.3, 1)`, and no component outside the token definition contains a literal copy of that bezier

#### Scenario: Token and constant agree

- **WHEN** the CSS token and the JS constant for the house ease-out curve are compared
- **THEN** they are the same four values, by contract documented in the token definition

### Requirement: Token set covers the house curves

The shared motion token set SHALL include at least the house ease-out curve (`cubic-bezier(0.16, 1, 0.3, 1)`) and a strong ease-in-out curve (`cubic-bezier(0.77, 0, 0.175, 1)`), defined in the global theme so both CSS and script consumers can adopt them.

#### Scenario: Inspecting the global theme

- **WHEN** the global stylesheet's theme block is read
- **THEN** it contains `--ease-out-expo` and `--ease-in-out-strong` (or equivalently named) tokens with those exact values
