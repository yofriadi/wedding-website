# scroll-motion Spec Delta

## MODIFIED Requirements

### Requirement: TimelineScroll honors reduced motion with full content access

When the user prefers reduced motion, the TimelineScroll component SHALL present every timeline node's content (date, photo, description) in a readable vertical layout, with no scroll-driven circle, pan, or reveal animations and no pinned multi-viewport scrub region. Content inside pin wrappers SHALL reflow exactly as unwrapped content does. The intro title card (`#title-layer-bottom`) SHALL reflow as the story's opening heading — positioned in flow at the top of the story, above the first node — rather than remaining an absolute stage overlay, and the reflow reset SHALL also clear the standalone `translate` property (Tailwind v4's `-translate-*` utilities) so no reflowed content stays shifted off-center.

#### Scenario: Reduced-motion user reads the story

- **WHEN** `prefers-reduced-motion: reduce` is active and the user reaches the timeline section
- **THEN** all six nodes' dates, photos, and descriptions are visible in document order as a vertical flow (Mula-mula intro, Februari 2025, 5 April 2025, 28 Juni 2025, 11 April 2026, and the 10 October 2026 finale), the connector SVG and both circle overlays are hidden, and the section height is content-driven rather than the animated scrub runway

#### Scenario: Reduced-motion user sees the intro heading first

- **WHEN** `prefers-reduced-motion: reduce` is active and the story renders
- **THEN** the "Mula-mula" intro heading appears in flow at the top of the story, above the first node's content — not as a floating overlay centered mid-story

#### Scenario: Reflowed content stays centered

- **WHEN** `prefers-reduced-motion: reduce` is active and any centered label (including the finale title) renders in the story
- **THEN** the label is not shifted off the left edge of the viewport by a residual `translate` value — every reflowed element renders where the flow places it

#### Scenario: No scroll-driven bindings under reduced motion

- **WHEN** `prefers-reduced-motion: reduce` is active and the page script initializes
- **THEN** the TimelineScroll script binds no `animate()`/`scroll()` scrub animations to the track, overlays, or nodes

#### Scenario: The finale anchor stays hidden on both paths

- **WHEN** either the animated or the reduced-motion presentation renders
- **THEN** `#dot-6-anchor` remains non-visible (it is a measurement point for the finale pan, never meant to paint)

### Requirement: Timeline connectors render as fluid curves

Connector lines between consecutive story dots (line-1 through line-4) SHALL render as fluid curves rather than hard 90° corners, using the single shipped curve builder — one cubic Bézier S-curve per connector (M a C midX a.y, midX b.y, b.x b.y), giving horizontal tangents at both dots with no intermediate vertices — computed from the measured dot centers. The connector from dot-4 (28 Juni 2025) to dot-5 (11 April 2026) SHALL use the same S-curve construction (via the shared `setSmoothIntoNode5` builder, including its <360px narrow-screen guard that ends the curve short of node 5's centered card before approaching the dot horizontally). The final connector into the finale (line-5, dot-5 to the dot-6 anchor) SHALL remain orthogonal (V–H–V), with its first turn dropped low enough that the horizontal leg passes below node 5's popped content on desktop widths (≥768px).

#### Scenario: Default fluid curves

- **WHEN** the timeline renders
- **THEN** lines 1–4 contain no sharp corners and leave/arrive horizontally at each connected dot

#### Scenario: June-to-April is one continuous curve

- **WHEN** the timeline renders
- **THEN** the 28 Juni 2025 → 11 April 2026 gap is bridged by a single S-curve connector with no intermediate dots and no intermediate vertices, leaving dot-4 and arriving at dot-5 horizontally

#### Scenario: Finale connector stays angular

- **WHEN** the timeline renders
- **THEN** line-5 (dot-5 to the dot-6 anchor) keeps its orthogonal vertical-horizontal-vertical shape

#### Scenario: Finale first turn clears node 5's card

- **WHEN** the timeline renders at desktop widths (≥768px) and node 5's photo/date/description are popped
- **THEN** line-5's horizontal leg passes below node 5's content stack with no stroke-over-content crossing (below 768px the connector-over-photo crossings of the story S-curves remain the accepted exception)

### Requirement: Timeline node spacing is widened with the runway growing at constant pan speed

Consecutive story nodes SHALL be spaced uniformly at 210vw gaps (dots at 50, 260, 470, 680 and 890vw) on a 1090vw track, with the finale keeping its compact 150vw jog to the dot-6 anchor at 1040vw. The section's scroll runway SHALL be 1249svh (1149svh scrollable + 100svh stage) with a `vh` fallback pair, sized so the horizontal phase covers the track at the shipped cruise speed while the intro circle shrink, finale jog, vertical descent, and closing expansion keep their shipped scroll durations (≈66svh intro, ≈753svh horizontal cruise, ≈104svh jog, ≈150svh descent, ≈65svh expansion, ≈11svh tail). The horizontal pan speed SHALL remain ≈1.12 viewport widths per viewport height scrolled — the 630vw of removed horizontal pan removes a proportional ≈564svh of runway. Node reveal beats (reveal window, staggers, line-draw gaps) SHALL keep their shipped absolute scroll lengths; only their progress fractions re-derive over the shorter scrollable distance. During the finale jog the camera SHALL keep panning right at cruise depth — no diagonal descent — and only begin the vertical descent after the anchor column is centered (an L-route: right, then down).

#### Scenario: Uniform story gaps

- **WHEN** the timeline track layout is measured
- **THEN** consecutive story node horizontal offsets are equal to each other and approximately 210vw (the finale jog of ~150vw excepted by design)

#### Scenario: Constant cruise speed

- **WHEN** the user scrolls through one full node-to-node cycle
- **THEN** the track pans at approximately 1.12 viewport widths per viewport height of scroll, with no slope kink across the horizontal phase

#### Scenario: Non-horizontal phases keep their scroll duration

- **WHEN** the user scrubs through the intro circle shrink, the finale jog, the vertical descent, or the closing expansion
- **THEN** each spans its shipped scroll distance (≈66svh, ≈104svh, the descent to `VERT_END`, and the expansion to `EXPANSION_END`) — only the horizontal phase's runway shrank

#### Scenario: The finale jog is horizontal-only

- **WHEN** the user scrubs through the finale jog (between the story cruise's end and the anchor column's centering)
- **THEN** the track pans right with no vertical camera movement (its vertical offset stays at the cruise depth of zero), and the vertical descent begins only once the pan completes

#### Scenario: Reveal beats keep their absolute scroll length

- **WHEN** any node's photo/date/description pops, or a connector draws between two dots
- **THEN** the beat spans the same number of viewport heights scrolled as before the trim (reveal window ≈21.5svh, photo→date stagger ≈4.3svh, date→description ≈8.6svh, post-pop line-draw gap ≈43svh), regardless of the shorter total runway

### Requirement: Node content pops only upon connection

A timeline node's content (photo, date, description) SHALL remain fully hidden until the connector line reaches its dot; the reveal SHALL NOT begin before the connect moment. The reveal SHALL be a pop — a rapid fade-in combined with a scale overshoot (growing past 100% and settling back) — staggered across photo, date, and description, with each part's transform origin pointing toward the dot. Node 5's side-staged content (positioned ~50vw right of its dot) SHALL pop only while it is off-screen, entering the viewport fully formed — the pop timing is deliberately decoupled from the content's centering moment (see Open Questions in the change's design).

#### Scenario: Content hidden before connection

- **WHEN** the scroll position is before a node's connect threshold (the connector has not reached the dot)
- **THEN** that node's photo, date, and description are fully invisible (opacity 0)

#### Scenario: Staggered pop on connection

- **WHEN** the scroll position crosses the connect threshold
- **THEN** the photo, date, and description pop in sequence (scale from below 1 to an overshoot above 1, settling at 1), staggered with the photo leading

#### Scenario: Partial scroll gives partial pop

- **WHEN** the scroll position rests partway through a node's reveal window
- **THEN** the node's content shows the corresponding intermediate pop state rather than a completed or absent reveal

#### Scenario: Node 5's side-staged content enters formed

- **WHEN** the pan brings node 5's side-staged content (positioned ~50vw right of the dot) into the viewport
- **THEN** the content enters fully formed — its pop completes while the content is still off-screen, and no partially-popped state is visible on entry. (Whether the pop should instead fire at the content's centering moment is an explicitly parked open question; see `timeline-fluid-flow-rescope`.)

#### Scenario: Timeline nodes ride with the track

- **WHEN** any content node pops and the user keeps scrolling
- **THEN** its content moves with the track immediately (centered under its dot as authored), with no stand-still phase — the pin-and-release beat was walked back and is not part of the timeline
