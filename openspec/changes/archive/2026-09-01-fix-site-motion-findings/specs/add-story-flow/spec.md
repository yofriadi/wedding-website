# add-story-flow Spec Delta

## ADDED Requirements

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
