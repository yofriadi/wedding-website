## Context

In `TimelineScroll.astro`, the timeline story presents photographic cards across an ultra-wide track (`#timeline-track`, `1090vw`). Three nodes feature photography:

- Node 2 (`left: 260vw`): `awal-perkenalan` (aspect 591/1280)
- Node 3 (`left: 470vw`): `keluarga-yofri` (aspect 1280/591)
- Node 4 (`left: 680vw`): `keluarga-acik` (aspect 2048/945)

All three images are marked up inside `<picture>` elements with AVIF and WebP candidate sets generated via `variantSrcset()`, intrinsic dimensions, and `loading="lazy"`.

The timeline is controlled by vertical scroll scrubbing that translates the track horizontally (`transform: translate(-Xvw, -Ylvh)`). Because the nodes are placed at `260vw`, `470vw`, and `680vw`, browser-native `loading="lazy"` heuristics consider them far off-screen. The browser does not issue network requests for them on initial page load, nor when the guest arrives at the top of the timeline section.

When the guest scrubs through the section, the horizontal transform pulls each node into view. Only as each node intersects the viewport does the browser initiate the network request. The node's pop reveal animation (`animate(photo, { opacity: [0, 1, 1], transform: ... })`) executes immediately across a tiny scroll window (`REVEAL_WINDOW = 0.0188`, ~21vh). Because network latency and off-thread image decoding take 150ms–800ms, the card pops open with an empty dark background (`--timeline-photo-frame`), and the photo abruptly flashes into view after the download finishes. This pattern repeats for Node 2, Node 3, and Node 4.

## Goals / Non-Goals

**Goals:**

- Eliminate empty-frame rendering and late photo pop-in during timeline scroll.
- Pre-fetch and decode device-matched photo candidates before each node enters the visible screen.
- Preserve `loading="lazy"` in server-rendered HTML so initial page load and above-the-fold media (Hero LCP) remain unhindered.
- Provide a smooth visual opacity transition if an image is still downloading under extreme network throttling.
- Maintain full support for responsive candidates (AVIF/WebP), reduced motion, and no-JS fallback.

**Non-Goals:**

- Altering the choreography, scroll runway lengths, or connector geometry of `TimelineScroll`.
- Adding timeline photos to the initial welcome-gate / loading screen barrier (explicitly forbidden by `media-tiering`).
- Introducing heavy external dependencies or bespoke virtual scroller libraries.

## Decisions

### 1. Approach-Based Promotion via Existing Section IntersectionObserver

- **Decision**: Trigger preloading of all three timeline photos using the existing `IntersectionObserver` on `#timeline-section`, which operates with `rootMargin: "100% 0px"`.
- **Rationale**:
  - `TimelineScroll` already initializes an observer with `100% 0px` rootMargin to handle geometry updates.
  - 1 viewport height of approach margin, combined with the intro circle shrink (~66lvh) and horizontal pan to Node 2 (~161lvh to `connect(2)`), gives the browser **~325lvh** (roughly 3 to 8 seconds of active scrolling) of runway before Node 2's card opens.
  - The aggregate payload for all 3 images on mobile is under 45 KB (AVIF variants: 22 KB + 8.7 KB + 12 KB). Pre-fetching all 3 simultaneously on approach costs minimal bandwidth and ensures that continuous scrolling past Node 2, Node 3, and Node 4 encounters zero pending network requests.
- **Alternatives Considered**:
  - _Per-node staggered observers_: Observing each node with a horizontal rootMargin. Rejected because horizontal intersection observation within a CSS-transformed track is unreliable across browser engines (especially Safari/WebKit).
  - _Adding to loading screen_: Explicitly rejected by `media-tiering` spec: "Timeline media, video, soundtrack, and sections after ZoomParallax SHALL NOT gate the loading screen on any tier."

### 2. Browser Pre-decode via `HTMLImageElement.prototype.decode()`

- **Decision**: When the approach observer fires, switch `img.loading = "eager"` and call `img.decode()` on each `<img>` inside `#timeline-track`.
- **Rationale**:
  - Setting `img.loading = "eager"` informs the browser to cancel lazy deferral.
  - `img.decode()` is a standard Web API that forces the browser to fetch the responsive candidate (derived from `<picture>` `<source>` candidate selection and current device DPI) and decode it into GPU/raster memory off the main thread before painting.
  - Calling `.catch(() => {})` on the returned promise ensures that aborted or non-fatal network glitches never throw unhandled errors.
- **Alternatives Considered**:
  - _`new Image().src = ...`_: Would bypass `<picture>` responsive candidate selection and hardcode a single format or URL, breaking `responsive-media` requirements.
  - _`<link rel="preload">`_: Cannot easily express art-directed or dynamic `<picture>` candidate selection for multiple formats without duplicating head logic.

### 3. Smooth Opacity Transition with `data-loaded`

- **Decision**: Add an opacity transition class to timeline images (`opacity-0 transition-opacity duration-300 data-[loaded=true]:opacity-100`) and set `data-loaded="true"` upon successful decode or load.
- **Rationale**:
  - If a visitor is on a high-speed connection, `img.decode()` settles while the user is still in ZoomParallax or the intro circle animation. When the node arrives, `data-loaded="true"` is already set, rendering the photo instantly with zero delay.
  - If a visitor scrolls very fast on a slow network, the image fades in smoothly over 300ms once downloaded rather than abruptly popping in.
  - `onerror="this.dataset.loaded='true'"` ensures that in the event of an image fetch or decode failure, the element does not stay indefinitely hidden at `opacity-0`.
  - To honor the repository's `progressive-enhancement` idiom (which requires a `<noscript>` style override alongside an `@media (scripting: none)` twin for engines like Safari that treat `scripting` as unsupported), a `<noscript><style>.timeline-node img { opacity: 1 !important; }</style></noscript>` block and `@media (scripting: none)` / `@media (prefers-reduced-motion: reduce)` rules apply `.timeline-node img { opacity: 1 !important; }` so non-scripted or reduced-motion visitors never see blank frames. In reduced-motion mode, `TimelineScroll` reflows into a vertical flex story with no horizontal transforms; `initTimeline()` exits early without creating scrub animations or observers, and native browser lazy loading handles vertical scroll naturally.

## Risks / Trade-offs

- **[Risk] Wasted bandwidth if visitor reverses scroll before reaching Node 2** → **Mitigation**: The preload triggers only when the visitor reaches within 1 viewport of `#timeline-section` (after completing HeroZoom, QuranVerse, FamiliesReveal, and ZoomParallax). Visitors who scroll that far are overwhelmingly committed to reading the story, and the total mobile payload is under 45 KB.
- **[Risk] Browser support for `img.decode()`** → **Mitigation**: Supported in all modern browsers (>97% global support). A feature-detection guard (`if ("decode" in img)`) falls back to `img.addEventListener("load", ...)` and `img.complete` checks.
