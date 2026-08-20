# interaction-motion Specification

## Purpose

Behavioral requirements for the interactive UI motion layer — story viewer (modal, slides, progress), FAQ accordion, loading screen — covering easing/duration contracts, physicality, interruptibility, composite-only properties, hover gating, and reduced-motion behavior.

## Requirements

### Requirement: Interactive motion is confined to composite properties

The story viewer's progress indication and slide transitions SHALL animate only `transform` and `opacity` (composite properties), and SHALL NOT write layout-triggering properties (`width`, `height`, `top`, `left`) on any per-frame code path.

#### Scenario: Progress bar ticks

- **WHEN** a story is playing and the 50ms progress interval fires
- **THEN** the active segment's fill advances via `transform: scaleX()` from a `transform-origin: left`, and no `style.width` write occurs on any progress element

#### Scenario: Inactive segments are not rewritten per tick

- **WHEN** the active story index changes
- **THEN** past segments are set to `scaleX(1)` and future segments to `scaleX(0)` exactly once per index change, and subsequent progress ticks write only the active segment

#### Scenario: Slide transition

- **WHEN** the user advances to the next or previous story
- **THEN** both slides animate a full `transform: translateX()` keyframe pair (not an independent `x`/`y` shorthand), and the panel entrance/exit composes `translateY` and `scale` into a single transform

### Requirement: Modal and panel transitions use ease-out in both directions

Story viewer entrances and exits SHALL use the house ease-out curve in both directions; exits SHALL be faster than entrances (asymmetric timing), because an exit confirms an action the user already took.

#### Scenario: Closing the story viewer

- **WHEN** the user closes the modal (close button, Escape, or end-of-stories)
- **THEN** the panel exit animates with `cubic-bezier(0.16, 1, 0.3, 1)` over 150ms — never an ease-in curve — and the backdrop opacity fade completes in 200ms

#### Scenario: Opening the story viewer

- **WHEN** the user opens a story viewer
- **THEN** the panel entrance uses `cubic-bezier(0.16, 1, 0.3, 1)` over 300ms (unchanged from current behavior)

### Requirement: Story hand-off is event-driven, not timer-driven

When one story viewer finishes and hands off to the next (or previous) viewer, the closing of the outgoing viewer SHALL be driven by the incoming viewer's first slide becoming ready — not by a fixed timeout.

#### Scenario: Next viewer's image decodes slowly

- **WHEN** a viewer's last story ends, the next viewer opens, and its first slide image takes longer than the slide-in duration to load
- **THEN** the outgoing viewer remains open (not closing on a timer) and is closed via the existing non-animated close path only after the incoming viewer's first slide is ready, so no black flash appears between viewers

#### Scenario: Ready signal never arrives

- **WHEN** the incoming viewer's first slide fails to signal readiness within 800ms
- **THEN** a fallback timeout closes the outgoing viewer so the hand-off can never deadlock

### Requirement: Story viewer honors reduced motion

When the user prefers reduced motion, the story viewer SHALL keep opacity-based feedback and drop movement: modal backdrop and panel fade without `scale`/`translateY`, and slides cross-fade without `translateX` sliding.

#### Scenario: Reduced-motion user opens a story

- **WHEN** `prefers-reduced-motion: reduce` is active and the user opens a story viewer
- **THEN** the panel appears via opacity fade only (no scale/y transform), and advancing stories cross-fades slides in place without horizontal sliding

#### Scenario: Motion-permitted user opens a story

- **WHEN** reduced motion is not requested
- **THEN** the panel entrance (scale + translateY) and slide transitions (translateX) run as specified for motion-permitted users

### Requirement: Story cover hover motion is pointer-class gated

The story cover's hover scale-up SHALL apply only on devices with hover-capable, fine pointers, so touch taps never trigger a false hover grow.

#### Scenario: Touch device taps a story cover

- **WHEN** a touch-primary device (no `hover`/`pointer: fine`) taps a story cover
- **THEN** no scale transform is applied to the cover image as a result of the tap

#### Scenario: Desktop hovers a story cover

- **WHEN** a hover-capable, fine-pointer device hovers a story cover
- **THEN** the cover image scales up to 1.1 over 300ms as it does today

### Requirement: FAQ badge pops on open

When a FAQ accordion item opens, its number badge SHALL animate a subtle scale pop alongside the existing fill-color change, giving the state change physicality.

#### Scenario: Opening a FAQ item

- **WHEN** the user expands a FAQ item
- **THEN** the number badge scales 1 → 1.08 → 1 with the house ease-out curve (~300ms) while its background transitions to the active fill color

### Requirement: Loading phrases crossfade rather than cut

The loading screen's rotating phrases SHALL transition through a short blur-masked crossfade instead of replacing text instantly.

#### Scenario: Phrase rotation

- **WHEN** the loading phrase advances to the next in the list
- **THEN** the outgoing phrase fades and blurs out (≤2px blur) while the incoming phrase fades in, completing within ~150ms, with no frame showing an empty phrase slot

### Requirement: FAQ hover handlers do not animate to current values

The FAQ accordion SHALL NOT contain hover handlers that animate properties to the values those elements already hold (no-op animations).

#### Scenario: Hovering a FAQ item

- **WHEN** the pointer enters or leaves a FAQ item that is not active
- **THEN** no `animate()` call fires for the number badge background/scale on hover, and no visual change occurs beyond the button's existing utility-class transitions
