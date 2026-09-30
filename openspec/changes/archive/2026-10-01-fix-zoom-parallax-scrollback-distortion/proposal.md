## Why

When scrolling back up into and through `ZoomParallax.astro`, collage images in Chromium browsers (Chrome, Edge, Mobile Chrome) appear distorted, blurry, or pixelated compared to Firefox and compared to the clean static bento grid displayed under `prefers-reduced-motion: reduce`.

This issue stems from three compounding factors:

1. **GPU texture scale-freeze (`will-change-transform`)**: The `.zoom-wrapper` elements for the 10 outer slots declare `will-change-transform`. In an earlier fix (`1f9fdbb`), `will-change: transform` was removed from the center focus wrapper to eliminate GPU texture scale-freeze during forward zoom, but the 10 surrounding wrappers kept the class under the assumption that forward motion masks resolution loss. When scrolling back up, those 10 outer images fly back into view towards `scale(1)`. In Chromium, `will-change: transform` allocates a fixed-resolution GPU backing store at initial layout size; scaling it back down leaves downscaling artifacts, bilinear blur, and jagged edges. Firefox (Gecko) does not freeze raster backing textures on `will-change: transform` and re-rasterizes CSS transforms dynamically. Furthermore, reduced motion explicitly releases `will-change` via `.zoom-wrapper { will-change: auto !important; }`, which is why the static grid never suffers from this distortion.
2. **Persistent `scale(1)` transform vs clean reduced-motion baseline (`""`)**: In `bindScrollZoom()`, wrappers are initialized with `transform = "scale(1)"`, and `scroll()` writes `scale(1)` whenever `progress <= 0.1`. Setting `transform: scale(1)` retains a transformed containing block and active compositor layer in Chromium even when the user has scrolled all the way back to rest. In contrast, `teardownScrollZoom()` explicitly notes that clearing `transform` to `""` matches the clean reduced-motion state and drops the layerization candidate.
3. **Inline `<picture>` box model & defensive normalization**: In `ZoomParallax.astro`, each `<img class="zoom-image">` is wrapped inside an unstyled `<picture>` tag defaulting to `display: inline`. Defensively setting `.zoom-inner picture { display: block; width: 100%; height: 100%; }` guarantees that `<picture>` establishes an explicit block container matching `.zoom-inner`'s bounds across all layout passes.

## What Changes

- **Drop `will-change-transform` from all collage wrappers**: Remove `will-change-transform` from `.zoom-wrapper` in `ZoomParallax.astro` (and clean up the now-redundant center wrapper override), preventing GPU backing texture scale-freeze across all 11 slots during both forward and reverse scrolling.
- **Ensure `<picture>` fills `.zoom-inner`**: Style `.zoom-inner picture` with `display: block; width: 100%; height: 100%` ensuring unambiguous block containment for `object-fit: cover`.
- **Clear transforms at rest when scrolling back**: In `bindScrollZoom()` and `scroll()`, reset wrapper inline transforms to `""` when `progress <= 0.1` (and at initial baseline) instead of writing `scale(1)`. This allows Chromium to discard the GPU transform layer and render the images at full native 1:1 pixel density, matching the reduced-motion baseline.
- **Add automated regression tests**: Verify that scrolling through and back in `ZoomParallax` resets wrapper transforms to `""` (computed `transform: none`) at the top of the runway, and that each `.zoom-image` bounding box matches its `.zoom-inner` slot box.

## Capabilities

### Modified Capabilities

- `scroll-motion`: Update ZoomParallax requirements so that scrolling back to the start of the section clears inline transforms to match the clean reduced-motion baseline, releases GPU compositor layer hints, and guarantees proper `<picture>` element box sizing across all browser engines.

## Impact

- **Affected code**: `apps/web/src/components/ZoomParallax.astro`, `apps/web/tests/zoom-reveal-once.spec.ts`.
- **Dependencies & Build**: No new dependencies or build configuration changes.
- **Performance**: Reduces GPU compositor memory consumption by eliminating 10 unnecessary full-screen backing layers in Chromium while eliminating scrollback texture blur.
