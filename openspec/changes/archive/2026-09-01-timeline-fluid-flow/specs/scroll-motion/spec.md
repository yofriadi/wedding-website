# scroll-motion Spec Delta

## MODIFIED Requirements

### Requirement: Timeline node reveals reverse consistently

Each TimelineScroll node's photo, date, and description SHALL be driven by the same reveal mechanism, so scrubbing backward never leaves a node's photo in a different visibility state than its text — and the reveal itself scrubs with scroll in both directions (a forward burst does not replay when scrolling back). The reveal SHALL begin exactly when the connector line reaches the node's dot, never in anticipation of it.

#### Scenario: Scrubbing backward through a connected node

- **WHEN** the user scrolls forward past a node's connect threshold and then scrolls backward past its disconnect threshold
- **THEN** the node's photo, date, and description hide through the same threshold path with no residual visible state

#### Scenario: Scrubbing forward through a connect threshold

- **WHEN** the user scrolls forward past a node's connect threshold
- **THEN** the node's photo, date, and description reveal with the staggered pop timing (scale-overshoot), starting exactly when the connector line reaches the dot

#### Scenario: Reverse scrubbing plays the reveal in reverse

- **WHEN** the user scrolls backward through a node that is currently revealing
- **THEN** the node's reveal progress tracks the scroll position (scrubbed), rather than continuing or restarting a time-based forward animation

### Requirement: TimelineScroll honors reduced motion with full content access

When the user prefers reduced motion, the TimelineScroll component SHALL present every timeline node's content (date, photo, description) in a readable vertical layout, with no scroll-driven circle, pan, or reveal animations and no pinned multi-viewport scrub region. Content inside pin wrappers SHALL reflow exactly as unwrapped content does.

#### Scenario: Reduced-motion user reads the story

- **WHEN** `prefers-reduced-motion: reduce` is active and the user reaches the timeline section
- **THEN** all nine nodes' dates, photos, and descriptions are visible in document order as a vertical flow, the connector SVG and both circle overlays are hidden, and the section height is content-driven rather than the animated scrub runway

#### Scenario: No scroll-driven bindings under reduced motion

- **WHEN** `prefers-reduced-motion: reduce` is active and the page script initializes
- **THEN** the TimelineScroll script binds no `animate()`/`scroll()` scrub animations to the track, overlays, or nodes

## ADDED Requirements

### Requirement: Timeline connectors render as fluid curves

Connector lines between consecutive timeline dots (line-1 through line-7) SHALL render as fluid curves rather than hard 90° corners. Two variants SHALL be implemented and selectable via a single style constant: `smooth` (an S-curve that leaves and arrives at each dot with a horizontal tangent) and `rounded` (the legacy horizontal-vertical-horizontal routing with arc-rounded corners). The final connector into the finale (line-8, dot-8 to the dot-9 anchor) SHALL remain orthogonal regardless of the selected style.

#### Scenario: Default smooth curves

- **WHEN** the timeline renders with the default style constant
- **THEN** lines 1–7 contain no sharp corners and leave/arrive horizontally at each connected dot

#### Scenario: Rounded variant available for preview

- **WHEN** the style constant is set to `rounded`
- **THEN** lines 1–7 keep the legacy H–V–H routing but with visibly rounded corners instead of 90° turns

#### Scenario: Finale connector stays angular

- **WHEN** either curve style is active
- **THEN** line-8 (dot-8 to the dot-9 anchor) keeps its orthogonal vertical-horizontal-vertical shape

### Requirement: Timeline node spacing is widened with the runway growing at constant pan speed

Consecutive timeline nodes SHALL be spaced uniformly and materially wider than the legacy uneven 100–125vw gaps (target ≈150vw). The section's scroll runway SHALL grow additively so that the horizontal phase lengthens to cover the wider track while every other phase keeps its legacy scroll duration: intro circle shrink ≈66vh of scroll, finale vertical pan ≈242vh, closing expansion ≈66vh. The horizontal pan speed SHALL remain ≈1.26 viewport widths panned per viewport height scrolled, and the resulting section height SHALL be ≈1426vh (1326vh scrollable + 100vh stage).

#### Scenario: Uniform widened gaps

- **WHEN** the timeline track layout is measured
- **THEN** consecutive node horizontal offsets are equal to each other and approximately 150vw

#### Scenario: Pan speed preserved

- **WHEN** the user scrolls through one full node-to-node cycle
- **THEN** the track pans at approximately 1.26 viewport widths per viewport height of scroll, matching the pre-change pacing despite the longer runway

#### Scenario: Non-horizontal phases keep their scroll duration

- **WHEN** the user scrubs through the intro circle shrink, the finale vertical pan, or the closing expansion
- **THEN** each spans the same scroll distance as before the change (≈66vh, ≈242vh, and ≈66vh respectively) — only the horizontal phase's runway grew

### Requirement: Node content pops only upon connection

A timeline node's content (photo, date, description) SHALL remain fully hidden until the connector line reaches its dot; the reveal SHALL NOT begin before the connect moment. The reveal SHALL be a pop — a rapid fade-in combined with a scale overshoot (growing past 100% and settling back) — staggered across photo, date, and description, with each part's transform origin pointing toward the dot.

#### Scenario: Content hidden before connection

- **WHEN** the scroll position is before a node's connect threshold (the connector has not reached the dot)
- **THEN** that node's photo, date, and description are fully invisible (opacity 0)

#### Scenario: Staggered pop on connection

- **WHEN** the scroll position crosses the connect threshold
- **THEN** the photo, date, and description pop in sequence (scale from below 1 to an overshoot above 1, settling at 1), staggered with the photo leading

#### Scenario: Partial scroll gives partial pop

- **WHEN** the scroll position rests partway through a node's reveal window
- **THEN** the node's content shows the corresponding intermediate pop state rather than a completed or absent reveal

#### Scenario: Node 8's side-staged content pops at its centering moment

- **WHEN** node 8's dot has connected and the pan brings its side-staged content (positioned ~50vw right of the dot) to the viewport center
- **THEN** the content pops there — not earlier at its dot's connect moment, when it would still be partially off-screen

### Requirement: Pinned nodes stand still after connecting, then release and exit

For designated pinned nodes (a subset of content nodes, chosen for rhythm variation), the content pops positioned trailing its dot (right edge at the dot, clamped on narrow viewports so the content never clips the left edge) and then holds its on-screen position — counter-translated against the track pan — while its dot travels left across the content's width. The pin SHALL release at whichever condition occurs first: (a) the dot reaches the left edge of the pinned content, or (b) the dot reaches 20% of viewport width. The hold SHALL be a perceptible beat: the dot travels at least ~25vw between the pop and the release at reference widths. After release, the content SHALL move with the track and exit the viewport. Nodes outside the pinned set SHALL keep the ride behavior (content moves with the track from the moment it pops, centered under the dot as today). The finale node (dot-9) SHALL NOT pin.

#### Scenario: Content stands still while the dot travels

- **WHEN** a pinned node has popped and the user keeps scrolling
- **THEN** the node's content maintains a constant viewport position while its dot moves left with the track, and the stand-still spans at least ~25vw of dot travel (a perceptible beat, not a momentary hitch)

#### Scenario: Release at the content's left edge

- **WHEN** the dot reaches the left edge of its pinned content before reaching 20% viewport width (the wide-viewport case)
- **THEN** the content releases and begins moving left with the track, exiting the viewport

#### Scenario: Release at the 20vw cap

- **WHEN** the dot reaches 20% viewport width while its content is still pinned (the narrow-viewport case, where the content is wider than half the viewport)
- **THEN** the content releases regardless of the dot's position relative to the content's left edge

#### Scenario: Non-pinned nodes ride

- **WHEN** a node outside the pinned set pops
- **THEN** its content moves with the track immediately, with no stand-still phase

#### Scenario: Pinning reverses with backward scrolling

- **WHEN** the user scrolls backward through a released pin
- **THEN** the content retraces its path — re-engaging the stand-still and returning to its popped position — with no residual offset

### Requirement: Popped content never overlaps the next node

Node spacing, pin duration, and exit travel SHALL be sized so that a node's popped content has fully exited the viewport before the next node's content begins to pop, at mobile (~390px) and desktop (~1440px) reference widths.

#### Scenario: No simultaneous content at any scroll position

- **WHEN** the user scrubs through the timeline at any speed, in either direction
- **THEN** at no scroll position are two nodes' content blocks (photo/date/description) visible simultaneously
