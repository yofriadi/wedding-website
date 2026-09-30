# scroll-motion Spec Delta

## Purpose

Aligns the specification with the shipped Mobile Safari viewport unit architecture: reconciles `TimelineScroll` with `HeroZoom` and `ZoomParallax` to require `lvh` with a `vh` fallback declaration for all pinned stages and scroll runways, formalizes the prohibition against `svh` and `dvh` on pinned stages, and documents the dynamic chrome mechanics of Mobile Safari.

## MODIFIED Requirements

### Requirement: Pinned stages are sized to the chrome-hidden viewport

The scroll runways and sticky stages of HeroZoom, ZoomParallax, and TimelineScroll, and their viewport-height-dependent element positions, SHALL be sized in `lvh` (the large viewport: browser chrome hidden) with a `vh` fallback declaration (`height: 100vh; height: 100lvh;`) — because every mobile browser retracts its URL bar and bottom navigation toolbar on downward scroll, so the chrome-hidden viewport is the state a pinned sequence is actually watched in. FamiliesReveal's type sizing and its JS-normalised reveal units SHALL likewise be derived from `lvh`, never from the dynamic viewport.

Pinned runways and stage geometry SHALL NOT use `svh` — because `100svh` sizes to the chrome-expanded state, leaving the stage ~60–80px short of the screen once mobile browser chrome retracts and exposing a band of underlying canvas. Runways and stage geometry SHALL NOT use `dvh`, and scroll-driven geometry derived in JavaScript SHALL NOT be measured from the dynamic viewport (`window.innerHeight`) — with the deliberate carve-outs that `media-tiering`'s approach-promotion margin is not scrub geometry and MAY derive from `window.innerHeight`, and viewport-tracking floating UI (such as trailing action buttons anchored to the visible screen) MAY use `dvh` — because both re-resolve while browser chrome collapses or re-expands and would change a scrub's length, travel, or alignment mid-scroll.

Pre-scroll first-view overlays (`WelcomeGate`, `DesktopGate`, `#loading-screen`) SHALL cover the viewport with `fixed inset-0` rather than a viewport-height unit, because they are seen only at rest with browser chrome fully expanded. `svh` is reserved solely for the case where such a pre-scroll element requires an explicit height unit, so its content clears the expanded bottom tab bar before the first scroll; it SHALL NOT be used for any pinned runway, stage, or scrub-derived geometry.

#### Scenario: Mobile browser with its URL bar retracted

- **WHEN** a guest scrolls into a pinned sequence on a mobile browser, so the URL bar has collapsed and the bottom toolbar has retracted
- **THEN** each pinned stage fills the visible viewport exactly — no band of section background is exposed beneath a stage that was sized to a smaller viewport

#### Scenario: Browser chrome collapses during a scroll

- **WHEN** the URL bar and bottom toolbar retract on downward scroll or reappear on reverse scroll part-way through a pinned sequence
- **THEN** the section's scroll runway, stage height, and scrub-derived geometry are unchanged, the sequence does not jump or stutter, and no set of scroll bindings is torn down and rebuilt in response to the height-only `resize`

#### Scenario: Browser without large-viewport units

- **WHEN** the browser does not support `lvh` units
- **THEN** the stages fall back to their `vh` sizes and remain functional (legacy `vh` already resolves to the large viewport on iOS Safari)

### Requirement: Timeline node spacing is widened with the runway growing at constant pan speed

Consecutive story nodes SHALL be spaced uniformly at 210vw gaps (dots at 50, 260, 470, 680 and 890vw) on a 1090vw track, with the finale keeping its compact 150vw jog to the dot-6 anchor at 1040vw. The section's scroll runway SHALL be 1249lvh (1149lvh scrollable + 100lvh stage) with a `vh` fallback pair, sized so the horizontal phase covers the track at the shipped cruise speed while the intro circle shrink, finale jog, vertical descent, and closing expansion keep their shipped scroll durations (≈66lvh intro, ≈753lvh horizontal cruise, ≈104lvh jog, ≈150lvh descent, ≈65lvh expansion, ≈11lvh tail). The horizontal pan speed SHALL remain ≈1.12 viewport widths per viewport height scrolled — the 630vw of removed horizontal pan removes a proportional ≈564lvh of runway. Node reveal beats (reveal window, staggers, line-draw gaps) SHALL keep their shipped absolute scroll lengths; only their progress fractions re-derive over the shorter scrollable distance. During the finale jog the camera SHALL keep panning right at cruise depth — no diagonal descent — and only begin the vertical descent after the anchor column is centered (an L-route: right, then down).

#### Scenario: Uniform story gaps

- **WHEN** the timeline track layout is measured
- **THEN** consecutive story node horizontal offsets are equal to each other and approximately 210vw (the finale jog of ~150vw excepted by design)

#### Scenario: Constant cruise speed

- **WHEN** the user scrolls through one full node-to-node cycle
- **THEN** the track pans at approximately 1.12 viewport widths per viewport height of scroll, with no slope kink across the horizontal phase

#### Scenario: Non-horizontal phases keep their scroll duration

- **WHEN** the user scrubs through the intro circle shrink, the finale jog, the vertical descent, or the closing expansion
- **THEN** each spans its shipped scroll distance (≈66lvh, ≈104lvh, the descent to `VERT_END`, and the expansion to `EXPANSION_END`) — only the horizontal phase's runway shrank

#### Scenario: The finale jog is horizontal-only

- **WHEN** the user scrubs through the finale jog (between the story cruise's end and the anchor column's centering)
- **THEN** the track pans right with no vertical camera movement (its vertical offset stays at the cruise depth of zero), and the vertical descent begins only once the pan completes

#### Scenario: Reveal beats keep their absolute scroll length

- **WHEN** any node's photo/date/description pops, or a connector draws between two dots
- **THEN** the beat spans the same number of viewport heights scrolled as before the trim (reveal window ≈21.5lvh, photo→date stagger ≈4.3lvh, date→description ≈8.6lvh, post-pop line-draw gap ≈43lvh), regardless of the shorter total runway
