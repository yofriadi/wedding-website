# scroll-motion Specification

## Purpose

Behavioral requirements for the scroll-driven set pieces (HeroZoom, ZoomParallax, TimelineScroll) and the scroll/reveal family (QuranVerse): performance discipline (no per-frame layout work), initialization hygiene, viewport sizing, reduced-motion fallbacks, and physically consistent, scrub-consistent reveal motion.

## Requirements

### Requirement: ZoomParallax honors reduced motion

When the user prefers reduced motion, the ZoomParallax component SHALL present the bento grid as static content: no scroll-driven zoom animation is bound, the section collapses to a single viewport of height, and the stage is not pinned.

#### Scenario: Reduced-motion user scrolls past the grid

- **WHEN** `prefers-reduced-motion: reduce` is active and the user scrolls through the ZoomParallax section
- **THEN** every image remains at its natural grid scale, no wrapper receives a scroll-driven transform, and the section occupies exactly one viewport of scroll distance

#### Scenario: Motion-permitted user scrolls the grid

- **WHEN** reduced motion is not requested and the user scrolls through the ZoomParallax section
- **THEN** the existing tunnel zoom sequence runs unchanged (wrappers scale per their data-scale targets, center image scales to fill)

### Requirement: TimelineScroll honors reduced motion with full content access

When the user prefers reduced motion, the TimelineScroll component SHALL present every timeline node's content (date, photo, description) in a readable vertical layout, with no scroll-driven circle, pan, or reveal animations and no pinned multi-viewport scrub region. Content inside pin wrappers SHALL reflow exactly as unwrapped content does.

#### Scenario: Reduced-motion user reads the story

- **WHEN** `prefers-reduced-motion: reduce` is active and the user reaches the timeline section
- **THEN** all nine nodes' dates, photos, and descriptions are visible in document order as a vertical flow, the connector SVG and both circle overlays are hidden, and the section height is content-driven rather than the animated scrub runway

#### Scenario: No scroll-driven bindings under reduced motion

- **WHEN** `prefers-reduced-motion: reduce` is active and the page script initializes
- **THEN** the TimelineScroll script binds no `animate()`/`scroll()` scrub animations to the track, overlays, or nodes

#### Scenario: The finale anchor stays hidden on both paths

- **WHEN** either the animated or the reduced-motion presentation renders
- **THEN** `#dot-9-anchor` remains non-visible (it is a measurement point for the finale pan, never meant to paint)

### Requirement: Timeline connector geometry is not recomputed per scroll frame

The TimelineScroll connector paths SHALL be recomputed only in response to layout changes (initialization, resize, layout settle), never from scroll events, because connector geometry is invariant relative to the moving track.

#### Scenario: Scrolling does not trigger path recomputation

- **WHEN** the user scrolls through the timeline section after initialization has settled
- **THEN** no `getBoundingClientRect()` reads or SVG path `d`/length writes occur as a result of scroll events

#### Scenario: Resize still recomputes paths

- **WHEN** the viewport is resized
- **THEN** connector paths are recomputed to match the new node geometry

### Requirement: ZoomParallax initializes exactly once per page load

On initial page load the ZoomParallax component SHALL bind its scroll-driven animations exactly once: one set of scroll bindings and one layout flush. (Verified during implementation: without `<ClientRouter />`, `astro:page-load` never fires, so the `readyState`/`DOMContentLoaded` branch is the sole initializer and no double-init exists today.)

#### Scenario: Initial page load

- **WHEN** the page finishes its initial load
- **THEN** ZoomParallax initialization runs exactly once (one set of scroll bindings, one layout flush)

### Requirement: Pinned stages are sized to the chrome-hidden viewport

The scroll runways and sticky stages of HeroZoom, ZoomParallax and TimelineScroll, and their viewport-height-dependent element positions, SHALL be sized in `lvh` (the large viewport: browser chrome hidden) with a `vh` fallback declaration — because every mobile browser retracts its URL bar on the first downward scroll, so the chrome-hidden viewport is the state a pinned sequence is actually watched in. Runways and stage geometry SHALL NOT use `dvh`, and scroll-driven geometry derived in JavaScript SHALL NOT be measured from the dynamic viewport (`window.innerHeight`), because both re-resolve while browser chrome collapses and would change a scrub's length or alignment mid-scroll.

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

The TimelineScroll closing expansion circle SHALL grow from an infinitesimal scale seed (sub-pixel, e.g. `0.001`) rather than appearing from `scale(0)`, so the final "Menikah" reveal grows from the timeline's end dot instead of popping into existence.

#### Scenario: Reaching the end of the timeline

- **WHEN** the user scrubs past the final node toward the end of the section
- **THEN** the black closing circle visibly grows outward from the timeline's end dot — at no point does it switch abruptly from invisible to visible at a finite size

### Requirement: QuranVerse honors reduced motion

When the user prefers reduced motion, the QuranVerse section SHALL present its text as fade-in without per-word movement or per-word delay staggering, and its ambient looping animations (float, pulse) SHALL be disabled.

#### Scenario: Reduced-motion user reads the verse

- **WHEN** `prefers-reduced-motion: reduce` is active and the verse section enters the viewport
- **THEN** the Arabic text and translation fade in as whole groups (≤200ms opacity-only transitions, no `translateY` per word, no word-index delay stagger), and the ambient blur blob and radial glow are static

#### Scenario: Motion-permitted user reads the verse

- **WHEN** reduced motion is not requested
- **THEN** the word-by-word rising reveal and ambient float/pulse animations run as they do today

### Requirement: QuranVerse releases compositor hints after its reveal

The QuranVerse word spans' `will-change` hint SHALL apply only until the reveal completes; the terminal (`.in-view`) state SHALL clear it (`will-change: auto`) so compositor layers are not held for the rest of the page session.

#### Scenario: After the reveal settles

- **WHEN** the verse section has entered the viewport and the word reveal has completed
- **THEN** each revealed word's computed `will-change` is `auto`, and the reveal itself played with the hint active

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
