# media-tiering Specification

## Purpose

Adaptive runtime media tiering for mobile guests on unpredictable cellular links: evaluate connection quality via synchronous Network Information API heuristics and aggregate initial asset burst throughput measurement, setting `<html data-tier>` (`full`, `lite`, `pending`) before body parse to conditionally promote or defer expensive media (collage AVIFs, timeline video, soundtrack) while keeping a single JavaScript bundle and unified component tree.

## Requirements

### Requirement: Tier verdict before body parse

The document SHALL carry a media tier verdict on `<html data-tier>` with one of the values `full`, `lite`, or `pending`, set by an inline head script before any body media element is parsed. Where the Network Information API is present, the verdict SHALL be `lite` when `saveData` is set, when `effectiveType` is `slow-2g`, `2g`, or `3g`, or when `downlink` is below 1.2 Mbps; otherwise `full`. Where the API is absent, the verdict SHALL be `pending` until resolved by measurement or by the load-time locality inference described under "Measured burst-throughput refinement". Where the document carries no `data-tier` attribute at all — the head script absent, blocked, or failed — consumers SHALL treat the page as `full`, so a rolled-back or script-blocked build degrades to the untiered behavior rather than to a collapsed page whose media never loads.

#### Scenario: Save-Data guest

- **WHEN** a guest browses with the Save-Data preference enabled
- **THEN** `data-tier` is `lite` before the first body media element parses

#### Scenario: 3G-class guest on a supporting engine

- **WHEN** a guest on Chromium reports `effectiveType` of `3g`
- **THEN** `data-tier` is `lite` before the first body media element parses

#### Scenario: Engine without Network Information

- **WHEN** a guest browses on Safari or Firefox, which lack the Network Information API
- **THEN** `data-tier` is `pending` at parse time and resolves later by measurement

#### Scenario: Head script absent

- **WHEN** the page renders without the inline tier script having run
- **THEN** the collage is promoted, the scroll binding attaches, the video plays in view, and the soundtrack preloads — the untiered behavior

### Requirement: Measured burst-throughput refinement

The page SHALL refine the verdict by measuring the aggregate throughput of the initial asset burst: cumulative `transferSize` of resource-timing entries over the span from the earliest request start to the latest response end, counting only bytes actually transferred over the network, and counting only subresource assets that began downloading inside the initial burst window. Programmatic requests (`fetch`, `XMLHttpRequest`, beacons, pings) SHALL be excluded: this page issues same-origin API calls from a module script whose round-trip time would otherwise be measured as if it were throughput. Once at least 48 KB have transferred, a measurement below 220 KB/s SHALL set the tier to `lite`; a measurement at or above 220 KB/s SHALL resolve a `pending` tier to `full`. Assets whose bodies arrived without a payload transfer (a 304 revalidation, or a memory-cache hit) SHALL NOT count toward the measurement. Where no verdict is reached and the tier is still `pending`, the page SHALL resolve it at window `load` to `full` if at least five asset bodies arrived without a payload transfer, on the grounds that the deferred media is then already on the device; otherwise the 7 s failsafe SHALL resolve it to `lite`. A measured burst SHALL always outrank that locality inference, where payload below the 8 KB load-fallback floor counts as unjudgeable rather than as evidence of a slow link — a single round trip dominates it, and judging it would reintroduce the latency-measured-as-throughput defect the exclusions above exist to prevent. The inference SHALL NOT apply to a tier the Network Information API already resolved. A `pending` verdict SHALL resolve to `lite` no later than 7 s after navigation, and a window-`load` fallback SHALL judge earlier when at least 8 KB have transferred. Tier changes SHALL be one-way downgrades: a tier SHALL NOT move from `lite` to `full`, and a resolved downgrade SHALL NOT be reversed. Each resolution or downgrade SHALL dispatch a `net-tier:change` event on `window`.

#### Scenario: Pending resolves to full on a fast link

- **WHEN** a Safari guest on a fast connection completes the initial burst above 220 KB/s
- **THEN** the tier resolves to `full` and a `net-tier:change` event fires before the welcome gate can open

#### Scenario: Pending resolves to lite on a slow link

- **WHEN** a Safari guest on a Good-3G-class connection transfers the initial burst below 220 KB/s
- **THEN** the tier resolves to `lite` and a `net-tier:change` event fires

#### Scenario: Warm cache resolves pending to full on locality evidence

- **WHEN** a returning guest on an engine without the Network Information API loads the page, the initial burst transfers no payload, and at least five asset bodies arrived without transferring (304 revalidation headers, or a memory-cache hit reporting a real decoded size)
- **THEN** no verdict is derived from cache _timings_, and at window `load` the pending tier resolves to `full` on the locality evidence — the deferred media is already on the device, so promoting it costs conditional-GET headers rather than megabytes

#### Scenario: No locality evidence falls through to the failsafe

- **WHEN** the initial burst yields no verdict and fewer than five asset bodies arrived without transferring — resource timing blocked, an engine that reports no sizes at all, an `immutable` origin serving zero-transfer hits, or nothing requested
- **THEN** the pending tier resolves to `lite` by the 7 s failsafe

#### Scenario: Locality evidence never outranks a measured burst

- **WHEN** a returning guest's burst transfers enough payload to judge and measures below 220 KB/s
- **THEN** the tier resolves to `lite` despite the warm cache, because a measurement of the actual link outranks an inference that the media happens to be local

#### Scenario: Locality evidence never revisits a resolved tier

- **WHEN** the Network Information API resolved the tier to `full` or `lite` before the body parsed
- **THEN** the load-time locality inference does not run, and an API-`full` tier is neither re-resolved nor re-announced

#### Scenario: API verdict contradicted by measurement

- **WHEN** a Chromium guest reports `effectiveType` `4g` but the measured burst throughput is below 220 KB/s
- **THEN** the tier downgrades from `full` to `lite`

#### Scenario: No upgrade mid-session

- **WHEN** a lite guest's connection improves after the verdict
- **THEN** the tier remains `lite` for the rest of the pageview

#### Scenario: API round trips do not masquerade as throughput

- **WHEN** a returning guest loads the page from a warm cache and the only bytes transferred are the page's same-origin API responses
- **THEN** no verdict is derived from them, and an API-`full` tier is not downgraded

### Requirement: Tier-driven promotion of deferred collage media

The ZoomParallax collage images SHALL ship without an active `src`/`srcset` (deferred sources in data attributes plus intrinsic dimensions and alt text). On a `full` tier at parse time the deferred sources SHALL be promoted to live attributes synchronously during the initial parse, so their fetches start as early as markup-shipped sources would. On a `pending` tier the promotion SHALL happen when the tier resolves to `full`. On a `lite` tier each image SHALL be promoted when the collage approaches the viewport (intersection with a generous margin), and not before. Promotion SHALL be idempotent. The promotion margin is measured once when the observer is created and re-measured if the viewport changes; it is not scroll-scrub geometry and MAY derive from the viewport height — a deliberate carve-out from `scroll-motion`'s prohibition on measuring JS-derived scroll geometry from the dynamic viewport. Because all ten images sit inside one collapsed viewport-height box they intersect together, so the per-image observer satisfies "promoted when the collage approaches" without delivering per-photo granularity.

#### Scenario: Full tier fetches at parse time

- **WHEN** the tier is `full` during the initial parse
- **THEN** every collage image carries a live `src`/`srcset` immediately after the collage markup parses

#### Scenario: Lite tier pays per approach

- **WHEN** the tier is `lite` from the initial verdict and the guest has not scrolled near the collage
- **THEN** no collage image has a live `src` and no collage bytes are transferred

#### Scenario: Lite guest scrolls to the collage

- **WHEN** a lite guest scrolls the collage within the promotion margin
- **THEN** the collage images receive live sources and load

#### Scenario: Pending resolves full behind the loader

- **WHEN** a pending tier resolves to `full` while the loading screen is still up
- **THEN** the collage sources are promoted at resolution, before the gate can open

#### Scenario: Downgrade does not un-promote

- **WHEN** a `full` tier promoted the collage at parse time and the measurement then downgrades the tier to `lite`
- **THEN** the promoted sources stay live — in-flight `<img>` cancellation is unreliable across engines — so the downgrade changes layout and bindings, not what was already fetched

### Requirement: Lite collage renders as a static grid

While the tier is `lite` or `pending`, the ZoomParallax stage SHALL NOT pin (the stage SHALL NOT be sticky or otherwise taken out of normal flow, and the container SHALL be one viewport tall) and no scroll-driven zoom binding SHALL run. When a `pending` tier resolves to `full`, the binding SHALL attach; when a `full` tier downgrades to `lite`, the binding SHALL be torn down and the stage SHALL collapse to the static grid.

#### Scenario: Lite guest sees a readable grid

- **WHEN** a lite guest reaches the collage section
- **THEN** the ten photos render as a static bento grid in normal document flow

#### Scenario: Downgrade tears down the binding

- **WHEN** the tier downgrades from `full` to `lite` mid-pageview
- **THEN** scroll-driven transforms stop and the stage collapses to the static grid

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

The soundtrack element SHALL ship with `preload="none"`. On a `full` tier the page SHALL restore eager preloading once the tier resolves and SHALL start playback at the welcome-gate commit. On a `lite` tier the page SHALL NOT download the soundtrack at all: no preloading, no playback at commit, and no gesture-armed fallback; and the gate's music note SHALL be hidden so no playback is promised. A downgrade to `lite` that arrives after eager preloading began SHALL abort the download and leave the element with no source, so no further soundtrack bytes are fetched.

#### Scenario: Lite from the initial verdict transfers zero soundtrack bytes

- **WHEN** a guest whose verdict is `lite` before the body parses opens the gate and browses the page
- **THEN** no request for the soundtrack file is made during the pageview

#### Scenario: Downgrade aborts a preload already in flight

- **WHEN** a `full` tier restored eager preloading and the measurement then downgrades the tier to `lite`
- **THEN** playback stops, the element's sources are removed, and its network state returns to no-source so the download is abandoned

#### Scenario: Full tier buffers behind the gate

- **WHEN** a full-tier guest waits through the loading screen and gate
- **THEN** the soundtrack preloads in the background and begins at the commit gesture

### Requirement: Loader gates on first-view media only

The loading screen SHALL wait only for first-view media (the hero image fetched and decoded), raced against an 8 s ceiling, plus its minimum dwell. Below-fold media (collage, timeline photos, video) and animation bindings SHALL NOT gate the loading screen on any tier.

#### Scenario: Slow link opens after the hero

- **WHEN** a Good-3G guest's hero image has fetched and decoded while collage images are still in flight
- **THEN** the loading screen dismisses after its minimum dwell without waiting for the collage

#### Scenario: Missing collage never delays the open

- **WHEN** collage image requests fail outright
- **THEN** the loading screen timeline is unaffected

### Requirement: Single-bundle tiering

Tiering SHALL NOT introduce a second JavaScript bundle, duplicated component trees, or tier-conditional code splits. The tier SHALL be a runtime attribute consumed by the existing single bundle; the shipped JavaScript payload SHALL be identical across tiers, and the variants SHALL differ only in which assets are fetched and which bindings run.

#### Scenario: Identical JS across tiers

- **WHEN** the production build is inspected
- **THEN** the set and content of emitted script chunks are independent of any tier value
