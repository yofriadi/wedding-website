# scroll-motion Spec Delta

## MODIFIED Requirements

### Requirement: Node content pops only upon connection

A timeline node's content (photo, date, description) SHALL remain fully hidden until the connector line reaches its dot; the reveal SHALL NOT begin before the connect moment. The reveal SHALL be a pop — a rapid fade-in combined with a scale overshoot (growing past 100% and settling back) — staggered across photo, date, and description, with each part's transform origin pointing toward the dot. Node 8's side-staged content (positioned ~50vw right of its dot) SHALL pop only while it is off-screen, entering the viewport fully formed — the pop timing is deliberately decoupled from the content's centering moment (see Open Questions in the change's design).

#### Scenario: Content hidden before connection

- **WHEN** the scroll position is before a node's connect threshold (the connector has not reached the dot)
- **THEN** that node's photo, date, and description are fully invisible (opacity 0)

#### Scenario: Node 8's side-staged content enters formed

- **WHEN** the pan brings node 8's side-staged content into the viewport
- **THEN** the content enters fully formed — no partially-popped state is visible on entry

### Requirement: TimelineScroll honors reduced motion with full content access

When the user prefers reduced motion, the TimelineScroll component SHALL present every timeline node's content (date, photo, description) in a readable vertical layout, with no scroll-driven circle, pan, or reveal animations and no pinned multi-viewport scrub region. Content inside pin wrappers SHALL reflow exactly as unwrapped content does. The intro title card (`#title-layer-bottom`) SHALL reflow as the story's opening heading — positioned in flow at the top of the story, above the first node — rather than remaining an absolute stage overlay, and the reflow reset SHALL also clear the standalone `translate` property (Tailwind v4's `-translate-*` utilities) so no reflowed content stays shifted off-center.

#### Scenario: Reduced-motion user reads the story

- **WHEN** `prefers-reduced-motion: reduce` is active and the user reaches the timeline section
- **THEN** all nine nodes' dates, photos, and descriptions are visible in document order as a vertical flow, the connector SVG and both circle overlays are hidden, and the section height is content-driven rather than the animated scrub runway

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
- **THEN** `#dot-9-anchor` remains non-visible (it is a measurement point for the finale pan, never meant to paint)

### Requirement: Timeline connectors render as fluid curves

Connector lines between consecutive timeline dots (line-1 through line-7) SHALL render as fluid curves rather than hard 90° corners, using the single shipped curve builder — one cubic Bézier S-curve per connector (M a C midX a.y, midX b.y, b.x b.y), giving horizontal tangents at both dots with no intermediate vertices — computed from the measured dot centers. The final connector into the finale (line-8, dot-8 to the dot-9 anchor) SHALL remain orthogonal (V–H–V) regardless of style.

#### Scenario: Default fluid curves

- **WHEN** the timeline renders
- **THEN** lines 1–7 contain no sharp corners and leave/arrive horizontally at each connected dot

#### Scenario: Finale connector stays angular

- **WHEN** the timeline renders
- **THEN** line-8 (dot-8 to the dot-9 anchor) keeps its orthogonal vertical-horizontal-vertical shape

### Requirement: Timeline node spacing is widened with the runway growing at constant pan speed

Consecutive timeline nodes SHALL be spaced uniformly and materially wider than the legacy uneven 100–125vw gaps (shipped: 210vw story gaps on a 1720vw track, with the finale keeping a compact 150vw jog before its descent). The section's scroll runway SHALL be 1813lvh (1713lvh scrollable + 100lvh stage) with a `vh` fallback pair, sized so the horizontal phase covers the wider track while the intro circle shrink, finale vertical pan, and closing expansion keep their shipped scroll durations. The horizontal pan speed SHALL be ≈1.12 viewport widths per viewport height scrolled (the planned 280vw gaps narrowed to the shipped 210vw, and the vertical phase lengths compressed to three quarters), and the resulting section height SHALL be 1813lvh.

#### Scenario: Uniform widened gaps

- **WHEN** the timeline track layout is measured
- **THEN** consecutive node horizontal offsets are equal to each other and approximately 210vw (the finale jog excepted by design)

#### Scenario: Constant cruise speed

- **WHEN** the user scrolls through one full node-to-node cycle
- **THEN** the track pans at approximately 1.12 viewport widths per viewport height of scroll, with no node-8 slope kink across the horizontal phase

#### Scenario: Non-horizontal phases keep their scroll duration

- **WHEN** the user scrubs through the intro circle shrink, the finale vertical pan, or the closing expansion
- **THEN** each spans its shipped scroll distance (≈66lvh, the extended finale descent to `VERT_END`, and the expansion to `EXPANSION_END`) — only the horizontal phase's runway grew

### Requirement: Timeline finale grows from an infinitesimal seed

The TimelineScroll closing expansion circle SHALL grow from an infinitesimal seed radius (sub-pixel, e.g. `0.001px`) rather than appearing from `circle(0px)`, so the final "Menikah" reveal grows outward from the timeline's end dot instead of popping into existence.

#### Scenario: Reaching the end of the timeline

- **WHEN** the user scrubs past the final node toward the end of the section
- **THEN** the closing circle visibly grows outward from the timeline's end dot — at no point does it switch abruptly from invisible to visible at a finite size, and the authored (pre-JS) clip value matches keyframe 0 exactly

## REMOVED Requirements

### Requirement: Pinned nodes stand still after connecting, then release and exit

**Reason:** Walked back during the final preview pass — content riding the track from the moment it pops is the intended shipped behavior. The promoted spec no longer describes a stand-still beat that the product deliberately does not have; the no-overlap and spacing requirements continue to govern the ride behavior.

## ADDED Requirements

### Requirement: Timeline theming inverts OS polarity by design

The TimelineScroll section SHALL theme its canvas and overlays as each other's opposite: the authored (fallback) presentation is the dark world (near-black canvas, white ink/dots/connectors, white circle overlays) and `prefers-color-scheme: dark` swaps to a white canvas with black ink and black circle overlays — i.e. the section always renders the opposite polarity of the OS preference, deliberately inverting the repo's usual pattern (dark fallback + `prefers-color-scheme: light` override). Theming SHALL use CSS custom properties (`--timeline-*`) on the section root with a single `prefers-color-scheme: dark` override block, device preference only — no toggle, no stored preference. The rationale is functional, not aesthetic: each scroll phase's circle overlay must contrast its own canvas at both the shrink and the expansion, and the inverted authoring direction guarantees that in both themes.

#### Scenario: Light OS renders the dark world

- **WHEN** the OS preference is light and the timeline section renders
- **THEN** the canvas is near-black with white ink and white circle overlays

#### Scenario: Dark OS renders the light world

- **WHEN** the OS preference is dark and the timeline section renders
- **THEN** the canvas is white with black ink and black circle overlays, with equivalent contrast between overlays and canvas at both the shrink and expansion moments

#### Scenario: No toggle, no storage

- **WHEN** the user changes the OS color scheme
- **THEN** the timeline follows the device preference immediately on the next paint, with no stored preference or manual override
