# media-tiering Specification

## Purpose

Adaptive runtime media tiering for mobile guests on unpredictable cellular links: evaluate connection quality via synchronous Save-Data preferences, setting `<html data-tier>` (`full` or `lite`) before body parse to conditionally promote or defer expensive media (collage AVIFs, timeline video, soundtrack) while keeping a single JavaScript bundle and unified component tree.

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

The ZoomParallax collage images SHALL ship with low-fidelity LQIP placeholders in `src`/`srcset` and deferred master sources in `data-src`/`data-srcset`. On a `full` tier at parse time the deferred sources SHALL be promoted to live attributes synchronously during the initial parse, so their fetches start as early as markup-shipped sources would. On a `lite` tier each image SHALL be promoted when the collage approaches the viewport (intersection with a generous margin), and not before. Promotion SHALL mark the element with `data-promoted`; that marker, not the presence or absence of a `src`, is the sole idempotency mechanism, because every image now has a live placeholder `src` from the moment it parses. Both promoters the page ships — the component's and the inline parse-time copy — SHALL apply the same marker. The promotion margin is measured once when the observer is created and re-measured if the viewport changes; it is not scroll-scrub geometry and MAY derive from the viewport height — a deliberate carve-out from `scroll-motion`'s prohibition on measuring JS-derived scroll geometry from the dynamic viewport.

#### Scenario: Full tier fetches at parse time

- **WHEN** the tier is `full` during the initial parse
- **THEN** every collage image is promoted immediately after the collage markup parses

#### Scenario: Lite tier pays per approach

- **WHEN** the tier is `lite` from the initial verdict and the guest has not scrolled near the collage
- **THEN** no collage image is promoted and no full-resolution collage bytes are transferred

#### Scenario: Lite guest scrolls to the collage

- **WHEN** a lite guest scrolls the collage within the promotion margin
- **THEN** the collage images are promoted and full-resolution assets load

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
- **THEN** the ten photos render as a static bento grid in normal document flow

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

The soundtrack element SHALL ship with `preload="none"`. On a `full` tier the page SHALL enable eager preloading 1200 ms after parse (before the loading screen's 2600 ms minimum dwell finishes) and SHALL start playback at the welcome-gate commit. On a `lite` tier the page SHALL NOT download the soundtrack at all: no preloading, no playback at commit, and no gesture-armed fallback; and the gate's music note SHALL be hidden so no playback is promised.

#### Scenario: Lite from the initial verdict transfers zero soundtrack bytes

- **WHEN** a guest whose verdict is `lite` opens the gate and browses the page
- **THEN** no request for the soundtrack file is made during the pageview

#### Scenario: Full tier buffers behind the gate

- **WHEN** a full-tier guest waits through the loading screen and gate
- **THEN** the soundtrack preloads in the background and begins at the commit gesture

### Requirement: Loader gates on first-view media only

The loading screen SHALL wait only for first-view media (the hero image fetched and decoded), raced against an 8 s ceiling, plus its minimum dwell. Below-fold media (collage, timeline photos, video) and animation bindings SHALL NOT gate the loading screen on any tier.

#### Scenario: Slow link opens after the hero

- **WHEN** a guest's hero image has fetched and decoded while below-fold assets are still in flight
- **THEN** the loading screen dismisses after its minimum dwell without waiting for the collage

### Requirement: Single-bundle tiering

Both tiers SHALL be served from a single build and share an identical JavaScript bundle: the set and content of emitted script chunks are independent of any tier value. Tier differences SHALL be governed at runtime by `<html data-tier>`.

#### Scenario: Identical JS across tiers

- **WHEN** comparing the scripts served to a full-tier and a lite-tier guest
- **THEN** both guests receive identical script URLs and execute the same bundle
