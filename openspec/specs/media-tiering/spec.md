# media-tiering Specification

## Purpose

Adaptive runtime media tiering for mobile guests on unpredictable cellular links: evaluate connection quality via synchronous Save-Data preferences, setting `<html data-tier>` (`full` or `lite`) before body parse to choose the collage layout and whether to fetch the timeline video and soundtrack, while keeping a single JavaScript bundle and unified component tree. The tier also decides what the entry loader may gate on: `full` scrubs the collage with scroll, so its images are promoted and gated before the welcome gate reveals the HeroZoom-through-ZoomParallax sequence, while a COLLAPSED collage — `lite`, or `prefers-reduced-motion` on any tier — is a static, unmagnified grid whose images are deferred and whose centre slot claims bento sizes, so the gate waits on first-view media only.

## Requirements

### Requirement: Tier verdict before body parse

The document SHALL carry a media tier verdict on `<html data-tier>` with one of the values `full` or `lite`, set by an inline head script before any body media element is parsed. Where the Network Information API reports `saveData: true`, the verdict SHALL be `lite`; otherwise `full`. Where the API is absent (Safari, Firefox), the verdict SHALL default to `full`. Where the document carries no `data-tier` attribute at all — the head script absent, blocked, or failed — consumers SHALL treat the page as `full`, so a rolled-back or script-blocked build degrades to the untiered behavior rather than to a collapsed page whose media never loads.

#### Scenario: Save-Data guest

- **WHEN** a guest browses with the Save-Data preference enabled
- **THEN** `data-tier` is `lite` before the first body media element parses

#### Scenario: Standard connection on a supporting engine

- **WHEN** a guest on Chromium browses without Save-Data enabled
- **THEN** `data-tier` is `full` before the first body media element parses

#### Scenario: Engine without Network Information

- **WHEN** a guest browses on Safari or Firefox, which lack the Network Information API
- **THEN** `data-tier` is `full` before the first body media element parses

#### Scenario: Head script absent

- **WHEN** the page renders without the inline tier script having run
- **THEN** the collage is promoted, the scroll binding attaches, the video plays in view, and the soundtrack preloads — the untiered behavior

### Requirement: Tier-driven promotion of deferred collage media

The ZoomParallax collage images SHALL ship with low-fidelity LQIP placeholders in `src`/`srcset` and deferred master sources in `data-src`/`data-srcset`. On a `full` tier at parse time the deferred sources SHALL be promoted to live attributes synchronously during the initial parse, so their fetches start as early as markup-shipped sources would. While the collage is COLLAPSED — a `lite` tier, or `prefers-reduced-motion` on any tier, the two switches whose CSS produces the same static one-viewport grid — neither the parse-time promoter nor the entry loader SHALL promote the images: no scroll-driven transform magnifies them, so promotion stays with the component's own pass, and the centre slot's `sizes` claim SHALL be rewritten to the bento column before it is promoted so candidate selection lands on a generated variant rather than the 2592 px master. Reduced motion is not a tier downgrade: the verdict, the soundtrack and the video policy still follow `full`. Where a slot's `sizes` claim depends on the collapse state it SHALL be written before the slot is promoted: candidate selection runs the moment a `srcset` becomes live, so promoting first and re-claiming afterwards leaves the wider candidate downloaded and a second fetch in flight — which is why the parse-time promoter defers entirely while collapsed instead of promoting the outer slots early. Promotion SHALL mark the element with `data-promoted`; that marker, not the presence or absence of a `src`, is the sole idempotency mechanism, because every image now has a live placeholder `src` from the moment it parses. All promotion paths — the component observer, the page parse-time promoter and the entry loader — SHALL apply the same marker, and the page's two inline paths SHALL share one promotion implementation rather than each carrying a copy of the attribute-ordering rules. The component's approach observer MAY promote any image that remains unpromoted after the entry path and after client navigation. That observer's promotion margin is measured once when the observer is created and re-measured if the viewport changes; it is not scroll-scrub geometry and MAY derive from the viewport height — a deliberate carve-out from `scroll-motion`'s prohibition on measuring JS-derived scroll geometry from the dynamic viewport.

#### Scenario: Full tier fetches at parse time

- **WHEN** the tier is `full` during the initial parse
- **THEN** every collage image is promoted immediately after the collage markup parses

#### Scenario: Lite defers the collage to approach

- **WHEN** the tier is `lite` from the initial verdict and the guest has not scrolled near the collage
- **THEN** no collage image is promoted, no full-resolution collage bytes are transferred, and the loading overlay has already dismissed on first-view media alone

#### Scenario: Lite centre slot selects a generated variant

- **WHEN** a `lite` guest approaches the collage and its centre slot is promoted
- **THEN** the centre resolves to a generated `/generated/center-focus-w…` candidate, the 2592 px master is never requested, and no head hint preloads it

#### Scenario: Reduced motion on a full verdict collapses the centre claim

- **WHEN** the tier is `full` and the guest prefers reduced motion, so the CSS pins nothing
- **THEN** the centre slot resolves to a generated variant, the 2592 px master is neither requested nor preloaded, and the loading overlay gates on first-view media only

#### Scenario: Unpromoted fallback image approaches

- **WHEN** an image remains unpromoted after the entry path or a client navigation and its collage approaches the viewport
- **THEN** the component observer promotes it and the full-resolution asset loads

#### Scenario: No tier produces an empty frame

- **WHEN** the page renders on any tier
- **THEN** every collage slot displays a low-fidelity placeholder before its full-resolution asset resolves

#### Scenario: Placeholder is not re-fetched after promotion

- **WHEN** an image has been promoted to its full-resolution candidate
- **THEN** a later pass over the promoted markup is a no-op and issues no further requests, because the promotion marker — not the presence of a `src` — is what excludes it

### Requirement: Lite collage renders as a static grid

While the tier is `lite`, the ZoomParallax stage SHALL NOT pin (the stage SHALL NOT be sticky, and the container SHALL be one viewport tall) and no scroll-driven zoom binding SHALL run.

#### Scenario: Lite guest sees a readable grid

- **WHEN** a lite guest reaches the collage section
- **THEN** the collage photos render as a static bento grid in normal document flow

### Requirement: Timeline video fetches only on visibility or demand

The timeline video SHALL NOT carry an `autoplay` attribute and SHALL NOT transfer bytes at parse time on any tier. On a `full` tier the video SHALL play while at least half of its card is inside the viewport and SHALL pause once less than half of it remains. On a `lite` tier the video SHALL expose user controls and SHALL NOT play without an explicit guest action.

#### Scenario: No parse-time video fetch

- **WHEN** the page parses on any tier
- **THEN** no request for the timeline video is issued during the initial load

#### Scenario: Full tier plays in view

- **WHEN** a full-tier guest scrolls the video card into view
- **THEN** the video plays once at least half of its card is inside the viewport, and pauses again once less than half of it remains

#### Scenario: Lite tier requires a tap

- **WHEN** a lite guest scrolls the video card into view
- **THEN** the video stays paused with visible controls until the guest presses play

### Requirement: Soundtrack is tier-conditional

The soundtrack element SHALL ship with `preload="none"`. On a `full` tier the page SHALL enable eager preloading once the loading screen's entry-media gate settles — not on a fixed post-parse timer — so the soundtrack cannot compete for bandwidth with the very media that gate is waiting on, and SHALL start playback at the welcome-gate commit. On a `lite` tier the page SHALL NOT download the soundtrack at all: no preloading, no playback at commit, and no gesture-armed fallback; and the gate's music note SHALL be hidden so no playback is promised.

#### Scenario: Lite from the initial verdict transfers zero soundtrack bytes

- **WHEN** a guest whose verdict is `lite` opens the gate and browses the page
- **THEN** no request for the soundtrack file is made during the pageview

#### Scenario: Full tier buffers behind the gate

- **WHEN** a full-tier guest waits through the loading screen and gate
- **THEN** the soundtrack preloads in the background and begins at the commit gesture

### Requirement: Loader gates the HeroZoom-through-ZoomParallax entry sequence

The loading screen SHALL gate on what its layout can actually break. On `full` it SHALL wait for every image in HeroZoom and ZoomParallax to either load or fail, SHALL await image decoding where supported, and SHALL wait for ZoomParallax's initial binding/setup signal before removing the overlay. While the collage is COLLAPSED — a `lite` tier, or `prefers-reduced-motion` on any tier, neither of which pins the stage or magnifies a slot — it SHALL wait only for first-view (HeroZoom) media, and SHALL NOT wait for collage images or for the binding signal, so a component module that fails to execute there cannot hold the gate to its ceiling. That signal SHALL be emitted even when the component's own setup throws, so a failed animation binding cannot strand the gate on `full`. The entry wait SHALL be raced against a 16 s ceiling and followed by a 300 ms minimum dwell and a 300 ms fade, with the ceiling and the dwell BOTH measured from navigation start rather than from loader-script evaluation — the loader script sits at the end of `<body>`, so measuring from there would stack the whole HTML-streaming time on top of the bound. The dwell is a signal that the page is still working, not a beat to be read: it is matched to the fade rather than to the shimmer-phrase interval, so the shortest possible appearance is one coherent transition, and it binds only on a fast or warm-cache load since a cold one is held by the media gate itself. Timeline media, video, soundtrack, and sections after ZoomParallax SHALL NOT gate the loading screen on any tier.

#### Scenario: Entry media is ready before the welcome gate

- **WHEN** a scrubbed-collage guest's HeroZoom and ZoomParallax media has loaded/failed and ZoomParallax has initialized, or a collapsed-collage guest's first-view media has
- **THEN** the loading screen dismisses after its minimum dwell and only then can the welcome gate arm

#### Scenario: Slow link reaches the ceiling

- **WHEN** one or more entry assets remain stalled or fail to initialize
- **THEN** the loading screen dismisses no later than 16.3 s from navigation start (the 16 s ceiling plus its 300 ms fade) and the welcome gate can still arm

### Requirement: Single-bundle tiering

Both tiers SHALL be served from a single build and share an identical JavaScript bundle: the set and content of emitted script chunks are independent of any tier value. Tier differences SHALL be governed at runtime by `<html data-tier>`.

#### Scenario: Identical JS across tiers

- **WHEN** comparing the scripts served to a full-tier and a lite-tier guest
- **THEN** both guests receive identical script URLs and execute the same bundle
