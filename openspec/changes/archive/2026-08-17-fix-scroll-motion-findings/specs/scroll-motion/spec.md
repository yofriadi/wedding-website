## ADDED Requirements

### Requirement: ZoomParallax honors reduced motion

When the user prefers reduced motion, the ZoomParallax component SHALL present the bento grid as static content: no scroll-driven zoom animation is bound, the section collapses to a single viewport of height, and the stage is not pinned.

#### Scenario: Reduced-motion user scrolls past the grid

- **WHEN** `prefers-reduced-motion: reduce` is active and the user scrolls through the ZoomParallax section
- **THEN** every image remains at its natural grid scale, no wrapper receives a scroll-driven transform, and the section occupies exactly one viewport of scroll distance

#### Scenario: Motion-permitted user scrolls the grid

- **WHEN** reduced motion is not requested and the user scrolls through the ZoomParallax section
- **THEN** the existing tunnel zoom sequence runs unchanged (wrappers scale per their data-scale targets, center image scales to fill)

### Requirement: TimelineScroll honors reduced motion with full content access

When the user prefers reduced motion, the TimelineScroll component SHALL present every timeline node's content (date, photo, description) in a readable vertical layout, with no scroll-driven circle, pan, or reveal animations and no pinned 1200vh scroll region.

#### Scenario: Reduced-motion user reads the story

- **WHEN** `prefers-reduced-motion: reduce` is active and the user reaches the timeline section
- **THEN** all nine nodes' dates, photos, and descriptions are visible in document order as a vertical flow, the connector SVG and both circle overlays are hidden, and the section height is content-driven rather than 1200vh

#### Scenario: No scroll-driven bindings under reduced motion

- **WHEN** `prefers-reduced-motion: reduce` is active and the page script initializes
- **THEN** the TimelineScroll script binds no `animate()`/`scroll()` scrub animations to the track, overlays, or nodes

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

### Requirement: Pinned stages use svh sizing with vh fallback

The sticky stages of ZoomParallax and TimelineScroll, and their viewport-height-dependent element positions, SHALL use `svh` units with a `vh` fallback declaration, consistent with HeroZoom, so mobile browser chrome does not clip stage content.

#### Scenario: Mobile browser with dynamic chrome

- **WHEN** the page is viewed on a mobile browser whose URL bar reduces the visible viewport
- **THEN** each pinned stage fits within the visible viewport and no stage content is clipped by the difference between `vh` and visible height

#### Scenario: Browser without svh support

- **WHEN** the browser does not support `svh` units
- **THEN** the stages fall back to their `vh` sizes and remain functional

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

Each TimelineScroll node's photo, date, and description SHALL be driven by the same threshold-triggered reveal/hide mechanism, so scrubbing backward never leaves a node's photo in a different visibility state than its text.

#### Scenario: Scrubbing backward through a connected node

- **WHEN** the user scrolls forward past a node's connect threshold and then scrolls backward past its disconnect threshold
- **THEN** the node's photo, date, and description all hide through the same threshold-triggered path with no residual visible state

#### Scenario: Scrubbing forward through a connect threshold

- **WHEN** the user scrolls forward past a node's connect threshold
- **THEN** the node's photo, date, and description reveal with the existing staggered, overshoot-eased timing
