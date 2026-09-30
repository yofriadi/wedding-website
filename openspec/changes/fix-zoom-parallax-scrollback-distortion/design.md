## Context

`ZoomParallax.astro` renders a full-stage collage of 11 wedding and family photographs using a "Parent Scaling" architecture:

- 11 full-screen absolute wrappers (`.zoom-wrapper`), centered in the viewport.
- Each wrapper contains an absolutely positioned card (`.zoom-inner`) sized to a bento grid slot using `vw` for width and `lvh` for height.
- A scroll-driven scrub via Motion (`scroll()`) scales each wrapper upward as the guest scrolls through a 400lvh runway. The center image scales up ~4x to cover the stage while surrounding images scale 5x–9x radially outward off-screen.

During forward scrolling, the center hero image remains visible and covers the stage. In commit `1f9fdbb`, `will-change: transform` was removed from the center wrapper to resolve "GPU texture scale-freeze during scroll zoom". However, the remaining 10 wrappers kept `will-change-transform`.

When a visitor scrolls back up through the runway, the 10 outer cards fly back into view from off-screen toward their initial bento positions. In Chromium (Chrome, Edge, Android Chrome), two compounding issues manifest:

1. The 10 outer images suffer from GPU texture scale-freeze: Chromium's compositor caches a 1x raster tile for elements with `will-change: transform`, scaling and downsampling this backing store during reverse motion rather than dynamically re-rasterizing the underlying photo at rest.
2. When scroll progress returns to `<= 0.1`, the script writes `el.style.transform = "scale(1)"`, locking Chromium into keeping each wrapper as an active transformed layer rather than dropping back to the clean, non-transformed state identical to `prefers-reduced-motion: reduce`.
3. In addition, the `<picture>` element wrapping `<img>` is unstyled (`display: inline`). Normalizing `<picture>` to a block container matching `.zoom-inner` provides a defensive guarantee that child image box dimensions and `object-fit: cover` resolve unambiguously across all layout passes.

In Firefox (Gecko), CSS transforms are dynamically re-rasterized, so texture scale-freeze does not occur. Under reduced motion, `will-change` is cancelled (`will-change: auto !important`) and no transforms are applied, which is why the static grid always looks sharp.

## Goals / Non-Goals

**Goals:**

- Eliminate texture blur, pixelation, and downsampling distortion when scrolling back in `ZoomParallax` on Chromium browsers.
- Eliminate persistent GPU compositor layers on `.zoom-wrapper` when at rest, matching the reduced-motion baseline (`transform: ""`, computed `none`).
- Defensively normalize `<picture>` element box sizing in `.zoom-inner` to guarantee unambiguous block containment for `object-fit: cover`.
- Maintain full parity between Chromium and Firefox during forward and reverse scroll.
- Verify through automated Playwright tests that transforms reset cleanly to `""` (computed `none`) and image dimensions match `.zoom-inner` slots at the start of the section after reverse scrolling.

**Non-Goals:**

- Altering the bento grid slot geometry (slot coordinates, widths, heights in `vw` and `lvh` remain unchanged).
- Changing image resolution ladder or srcset generation rules in `media-candidates.ts`.
- Modifying reduced-motion layout or lite-tier collapse behavior (which already correctly renders the static bento grid).

## Decisions

### D1: Drop `will-change: transform` from all `.zoom-wrapper` elements

Commit `1f9fdbb` removed `will-change: transform` from the center slot because Chromium freezes raster textures on elements promoted via `will-change: transform`. The 10 outer slots were left with `will-change-transform` under the assumption that fast motion during forward scroll masks resolution loss. However, on reverse scroll, guests deliberately watch these 10 photos return to rest.

**Decision**:

- Remove `will-change-transform` from `.zoom-wrapper` markup.
- Remove `.zoom-wrapper[data-is-center="true"] { will-change: auto !important; }` in CSS, as it is no longer needed.
- Retain the reduced-motion and lite-tier rules (`will-change: auto !important`) as defensive guarantees.
- Modern Chromium and Gecko compositor engines smoothly handle scroll-driven transforms on modern mobile hardware without requiring premature `will-change` promotion hints, while avoiding texture rasterization freeze.

### D2: Defensively normalize box geometry for `.zoom-inner picture`

By default, the HTML `<picture>` element is an inline box (`display: inline`). Inside `.zoom-inner` (which has definite `width: ...vw` and `height: 20lvh`), wrapping a block `<img>` in an unstyled inline box creates potential layout ambiguities during parent transform churn.

**Decision**:

- Add defensive normalization rule:
  ```css
  .zoom-inner picture {
    display: block;
    width: 100%;
    height: 100%;
  }
  ```
- This ensures that `<picture>` creates a block container matching `.zoom-inner`'s exact bounds, guaranteeing `height: 100%` on `<img>` computes unambiguously and `object-fit: cover` clips cleanly without distortion across all browser engines.

### D3: Clear inline transforms to `""` at baseline and at `progress <= 0.1`

In `bindScrollZoom()`, the script previously set `(w as HTMLElement).style.transform = "scale(1)"`. Inside `scroll()`, whenever `progress <= 0.1`, it wrote `el.style.transform = "scale(1)"`.

Writing `scale(1)` creates a CSS transform (`matrix(1, 0, 0, 1, 0, 0)`), which forces browsers to maintain a separate stacking context, containing block, and GPU layer candidate even when at rest.

In contrast, `teardownScrollZoom()` explicitly observed:

> _"Clear rather than write scale(1): the collapsed grid should match the reduced-motion state exactly (no inline transform at all), and a non-`none` transform keeps each of the ten full-viewport wrappers a containing block and a layerization candidate even with will-change released."_

**Decision**:

- In `bindScrollZoom()`, baseline reset clears transforms: `(w as HTMLElement).style.transform = ""`.
- In `scroll()`, when `progress <= 0.1`, clear transform: `el.style.transform = ""`.
- When `progress > 0.1`, apply the scaled transform: `el.style.transform = "scale(" + currentScale + ")"`.
- This ensures that when the user scrolls back to the beginning of `ZoomParallax` (or before scrolling starts), all 11 wrappers exit the transformed state entirely, matching the reduced-motion baseline.

## Risks / Trade-offs

- **[Risk] Frame rate impact on low-end devices without `will-change`**:
  _Mitigation_: Tested on mobile emulation and headless environments. Transform-only animations driven by Motion's RAF handler run efficiently without `will-change`. The center wrapper has run without `will-change` since commit `1f9fdbb` with 60fps performance. Furthermore, removing 10 permanent full-viewport compositor layers drastically reduces GPU memory overhead.
- **[Risk] Layerization churn at the dwell boundary (`progress <= 0.1`)**:
  _Mitigation_: The threshold is `progress <= 0.1` (the initial 10% dwell band where scale is held at 1). In normal scrolling, users pass through this threshold in a few frames; during dwell at rest, no churn occurs. Geometrically, wrappers are already `position: absolute` with explicit `z-index`, so stacking context and containing block properties remain stable while the compositor drops the backing store.
