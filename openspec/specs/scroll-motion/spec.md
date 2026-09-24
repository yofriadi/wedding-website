# scroll-motion Specification

## Purpose

Behavioral requirements for the scroll-driven set pieces (HeroZoom, ZoomParallax, TimelineScroll, FamiliesReveal): performance discipline (no per-frame layout work), initialization hygiene, viewport sizing, reduced-motion fallbacks, and physically consistent, scrub-consistent reveal motion.

## Requirements

### Requirement: ZoomParallax honors reduced motion

When the user prefers reduced motion, the ZoomParallax component SHALL present the bento grid as static content: no scroll-driven zoom animation is bound, the section collapses to a single viewport of height, and the stage is not pinned. The identical static presentation SHALL apply while the media tier is `lite` or `pending` (see the `media-tiering` capability), whether or not reduced motion was requested, and while the media tier is absent from the document entirely the component SHALL behave as it does on a `full` tier.

#### Scenario: Reduced-motion user scrolls past the grid

- **WHEN** `prefers-reduced-motion: reduce` is active and the user scrolls through the ZoomParallax section
- **THEN** every image remains at its natural grid scale, no wrapper receives a scroll-driven transform, and the section occupies exactly one viewport of scroll distance

#### Scenario: Motion-permitted user scrolls the grid on a full tier

- **WHEN** reduced motion is not requested, the media tier is `full`, and the user scrolls through the ZoomParallax section
- **THEN** the existing tunnel zoom sequence runs unchanged (wrappers scale per their data-scale targets, center image scales to fill)

#### Scenario: Motion-permitted user scrolls the grid on a lite tier

- **WHEN** reduced motion is not requested and the media tier is `lite` or `pending`
- **THEN** no wrapper receives a scroll-driven transform, the stage is not pinned, and the section occupies exactly one viewport of scroll distance

#### Scenario: Tier downgrades mid-scroll

- **WHEN** the media tier downgrades from `full` to `lite` while the guest is scrolling the section
- **THEN** the scroll-driven transforms stop, every wrapper returns to its natural grid scale, and the section collapses to one viewport

### Requirement: TimelineScroll honors reduced motion with full content access

When the user prefers reduced motion, the TimelineScroll component SHALL present every timeline node's content (date, photo, description) in a readable vertical layout, with no scroll-driven circle, pan, or reveal animations and no pinned multi-viewport scrub region. Content inside pin wrappers SHALL reflow exactly as unwrapped content does. The intro title card (`#title-layer-bottom`) SHALL reflow as the story's opening heading — positioned in flow at the top of the story, above the first node — rather than remaining an absolute stage overlay, and the reflow reset SHALL also clear the standalone `translate` property (Tailwind v4's `-translate-*` utilities) so no reflowed content stays shifted off-center.

#### Scenario: Reduced-motion user reads the story

- **WHEN** `prefers-reduced-motion: reduce` is active and the user reaches the timeline section
- **THEN** all six nodes' dates, photos, and descriptions are visible in document order as a vertical flow (Mula-mula intro, Februari 2025, Oktober 2025, November 2025, 11 April 2026, and the 10 October 2026 finale), the connector SVG and both circle overlays are hidden, and the section height is content-driven rather than the animated scrub runway

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

### Requirement: Timeline connector geometry is not recomputed per scroll frame

The TimelineScroll connector paths SHALL be recomputed only in response to layout changes (initialization, resize, layout settle), never from scroll events, because connector geometry is invariant relative to the moving track.

#### Scenario: Scrolling does not trigger path recomputation

- **WHEN** the user scrolls through the timeline section after initialization has settled
- **THEN** no `getBoundingClientRect()` reads or SVG path `d`/length writes occur as a result of scroll events

#### Scenario: Resize still recomputes paths

- **WHEN** the viewport is resized
- **THEN** connector paths are recomputed to match the new node geometry

### Requirement: ZoomParallax initializes exactly once per page load

On initial page load the ZoomParallax component SHALL bind its scroll-driven animations exactly once: one live set of scroll bindings and one layout flush. Initialization is no longer driven by `DOMContentLoaded` alone — a `net-tier:change` resolution may arrive first, because the head script's measurement can settle between module evaluation and `DOMContentLoaded`. Whichever of the two runs first SHALL create the bindings and the other SHALL NOT create a second set. A `resize` that changes the viewport width MAY rebuild the bindings; a height-only resize SHALL NOT. The flush count is an implementation consequence rather than an observable contract: tests SHOULD assert the visible outcome (one promotion, a correct zoom sequence, no duplicated transform writes) rather than the number of layout flushes.

#### Scenario: Initial page load

- **WHEN** the page finishes its initial load with the media tier already resolved
- **THEN** ZoomParallax initialization binds exactly once (one set of scroll bindings, one layout flush)

#### Scenario: Tier resolves before DOMContentLoaded

- **WHEN** a `pending` media tier resolves to `full` after the component's module has been evaluated but before `DOMContentLoaded` fires
- **THEN** the collage is promoted once and the zoom sequence runs correctly, with only one live set of scroll bindings and no duplicated transform writes

#### Scenario: Tier resolves after initialization

- **WHEN** a `pending` media tier resolves to `full` after `DOMContentLoaded` with no bindings live
- **THEN** one set of scroll bindings is created at resolution

### Requirement: Pinned stages are sized to the chrome-hidden viewport

The scroll runways and sticky stages of HeroZoom and ZoomParallax, and their viewport-height-dependent element positions, SHALL be sized in `lvh` (the large viewport: browser chrome hidden) with a `vh` fallback declaration — because every mobile browser retracts its URL bar on the first downward scroll, so the chrome-hidden viewport is the state a pinned sequence is actually watched in. TimelineScroll's sticky stage and scroll runway SHALL be sized in `svh` (with a `vh` fallback declaration) so the stage does not jump when browser chrome expands during reverse scrolling. FamiliesReveal's type sizing and its JS-normalised reveal units SHALL likewise be derived from `lvh`, never from the dynamic viewport. Runways and stage geometry SHALL NOT use `dvh`, and scroll-driven geometry derived in JavaScript SHALL NOT be measured from the dynamic viewport (`window.innerHeight`), because both re-resolve while browser chrome collapses and would change a scrub's length or alignment mid-scroll.

#### Scenario: Mobile browser with its URL bar retracted

- **WHEN** a guest scrolls into a pinned sequence on a mobile browser, so the URL bar has collapsed
- **THEN** each pinned stage fills the visible viewport exactly — no band of section background is exposed beneath a stage that was sized to a smaller viewport

#### Scenario: Browser chrome collapses during a scroll

- **WHEN** the URL bar retracts or reappears part-way through a pinned sequence
- **THEN** the section's scroll runway, stage height, and scrub-derived geometry are unchanged, so the sequence does not jump, and no set of scroll bindings is torn down and rebuilt in response to the height-only `resize`

#### Scenario: Browser without large-viewport units

- **WHEN** the browser does not support `lvh` units
- **THEN** the stages fall back to their `vh` sizes and remain functional (legacy `vh` already resolves to the large viewport on iOS Safari)

### Requirement: HeroZoom fallback listener is visibility-scoped

The HeroZoom rAF scroll fallback (browsers without named view-timeline support) SHALL process scroll work only while the hero section is within or near the viewport, and SHALL read the section's bounding rect at most once per animation frame.

#### Scenario: User scrolls far past the hero

- **WHEN** the hero section is more than one viewport away from the visible region
- **THEN** scroll events perform no rect reads and no style writes for the hero

#### Scenario: User scrolls back into the hero

- **WHEN** the user scrolls back toward the hero section after having passed it
- **THEN** the fallback resumes updating the hero animation state and reflects the current scroll position

#### Scenario: Frame budget while active

- **WHEN** the fallback processes an active frame
- **THEN** it performs at most one `getBoundingClientRect()` read of the section

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

### Requirement: Timeline finale grows from an infinitesimal seed

The TimelineScroll closing expansion circle SHALL grow from an infinitesimal seed radius (sub-pixel, e.g. `0.001px`) rather than appearing from `circle(0px)`, so the final "Menikah" reveal grows outward from the timeline's end dot instead of popping into existence.

#### Scenario: Reaching the end of the timeline

- **WHEN** the user scrubs past the final node toward the end of the section
- **THEN** the closing circle visibly grows outward from the timeline's end dot — at no point does it switch abruptly from invisible to visible at a finite size, and the authored (pre-JS) clip value matches keyframe 0 exactly

### Requirement: Timeline connectors render as fluid curves

Connector lines between consecutive story dots (line-1 through line-4) SHALL render as fluid curves rather than hard 90° corners, using the single shipped curve builder — one cubic Bézier S-curve per connector (M a C midX a.y, midX b.y, b.x b.y), giving horizontal tangents at both dots with no intermediate vertices — computed from the measured dot centers. The connector from dot-4 (November 2025) to dot-5 (11 April 2026) SHALL use the same S-curve construction (via the shared `setSmoothIntoNode5` builder, including its <360px narrow-screen guard that ends the curve short of node 5's centered card before approaching the dot horizontally). The final connector into the finale (line-5, dot-5 to the dot-6 anchor) SHALL remain orthogonal (V–H–V), with its first turn dropped low enough that the horizontal leg passes below node 5's popped content on desktop widths (≥768px).

#### Scenario: Default fluid curves

- **WHEN** the timeline renders
- **THEN** lines 1–4 contain no sharp corners and leave/arrive horizontally at each connected dot

#### Scenario: November-to-April is one continuous curve

- **WHEN** the timeline renders
- **THEN** the November 2025 → 11 April 2026 gap is bridged by a single S-curve connector with no intermediate dots and no intermediate vertices, leaving dot-4 and arriving at dot-5 horizontally

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

### Requirement: Popped content never overlaps the next node

Node spacing and exit travel SHALL be sized so that a node's popped content has fully exited the viewport before the next node's content begins to pop, at mobile (~390px) and desktop (~1440px) reference widths.

#### Scenario: No simultaneous content at any scroll position

- **WHEN** the user scrubs through the timeline at any speed, in either direction
- **THEN** at no scroll position are two nodes' content blocks (photo/date/description) visible simultaneously

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

### Requirement: FamiliesReveal reveal is driven by viewport position, not a pinned runway

The FamiliesReveal section SHALL flow with the document — it SHALL NOT contain a sticky stage or a taller-than-content scroll runway — and each revealable unit (word or divider) SHALL map its ink to its own position in the viewport: at the ghost floor while its centre is below the reveal band (≈90% of the viewport down), ramping to full ink as its centre crosses the band (≈57.5% of the viewport down, ≈42.5% up from the bottom), and remaining at full ink as the unit continues travelling upward out of view. The mapping SHALL be driven by the container's scroll position without reading layout geometry per frame.

#### Scenario: Words ink as they cross the centre band

- **WHEN** the guest scrolls so the section travels up through the viewport
- **THEN** words below the band sit at a faint-but-readable ghost opacity, words crossing the band ramp toward full ink, and the reveal reads as a colour wave travelling up the copy

#### Scenario: Inked words stay inked while leaving the viewport

- **WHEN** a word has crossed the reveal band and the guest keeps scrolling down
- **THEN** the word remains at full ink opacity while it continues moving upward, and scrubbing back down returns it through the same ramp to the ghost floor

#### Scenario: No pinned stage

- **WHEN** the section is anywhere in the visible viewport
- **THEN** no descendant is `position: sticky` and the section's height is its content's height plus authored padding

### Requirement: FamiliesReveal scrub costs one style write per frame

The FamiliesReveal scrub SHALL advance by writing a single normalised scroll-position value to one registered CSS custom property on the section per animation frame, with each unit's opacity derived from that property and its own pre-measured document position in CSS. The per-frame work SHALL NOT scale with the number of revealed units, and scroll handling SHALL NOT read layout geometry. The scrub binding SHALL be scoped to the section's visibility so that scrolling far from the section performs no work for it.

#### Scenario: Word count does not multiply frame work

- **WHEN** the guest scrolls through the section after initialization
- **THEN** a maximum of one custom-property write occurs per animation frame and no `getBoundingClientRect()` read or per-word style assignment occurs as a result of a scroll event

#### Scenario: Scrolling far past the section is inert

- **WHEN** the section is more than one viewport away from the visible region and the guest scrolls
- **THEN** no style writes are performed for the families reveal

#### Scenario: Height-only resize does not rebuild the scrub

- **WHEN** mobile browser chrome collapses or retracts, emitting a height-only `resize` while the width is unchanged
- **THEN** the section's scrub binding and pre-measured unit positions are neither torn down nor re-measured

### Requirement: FamiliesReveal honors reduced motion

When the user prefers reduced motion, the FamiliesReveal section SHALL present both family blocks as static, fully-revealed content and SHALL NOT bind a scroll-driven scrub. The same fully-revealed presentation SHALL hold when JavaScript is unavailable or has failed to load.

#### Scenario: Reduced-motion guest reads the families

- **WHEN** `prefers-reduced-motion: reduce` is active and the guest scrolls to the section
- **THEN** all words of both blocks are at full ink opacity on arrival

#### Scenario: No-JS presentation

- **WHEN** the section renders without its script executing
- **THEN** the content is fully revealed and readable rather than permanently ghosted
