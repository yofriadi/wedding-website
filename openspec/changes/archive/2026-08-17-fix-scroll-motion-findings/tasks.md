## 1. TimelineScroll — reduced motion

- [x] 1.1 Add a `@media (prefers-reduced-motion: reduce)` block in `TimelineScroll.astro`: collapse section height (1200vh → auto), un-pin the stage, reflow `#timeline-track` into a vertical flow column (`width: auto`, `transform: none`), make nodes `position: relative` flow items in document order, force all node content visible (`data-node*-photo/date/desc`, `#node-1`), hide the connector SVG and both circle overlays
- [x] 1.2 In `initTimeline()`, check `window.matchMedia("(prefers-reduced-motion: reduce)").matches` and return before binding any `animate()`/`scroll()` scrub animations

## 2. TimelineScroll — performance and consistency

- [x] 2.1 Remove the per-scroll-frame path recomputation: delete the `onScroll` listener and its cleanup registration; keep the resize handler, init retry, and the 220ms settle timeout as the only `updatePaths()` triggers
- [x] 2.2 Move node photos into the threshold-triggered driver: reveal/hide photos inside `showDetails()`/`hideDetails()` with the same `animate()` shape as date/description (`translateY(18px) → 0`, opacity, ease `[0.16, 1, 0.3, 1]`, small stagger); delete the scrubbed `photoAnim` block
- [x] 2.3 Migrate viewport-height geometry to svh with vh fallback: stage `h-screen` → `100vh; 100svh;` pair in component CSS; move node `top` inline values into CSS rules keyed by node id; leave `vw` values untouched

## 3. ZoomParallax — reduced motion, lifecycle, svh

- [x] 3.1 Add reduced-motion support: CSS media query collapses the 400vh container to one viewport and un-pins the stage; `initZoomParallax()` returns early when `matchMedia("(prefers-reduced-motion: reduce)")` matches
- [x] 3.2 Remove the `document.readyState` / `DOMContentLoaded` fallback branch so `astro:page-load` is the single initialization entry point — **deviation**: `astro:page-load` never fires on this site (Layout has no `<ClientRouter />`), so removing the fallback left ZoomParallax uninitialized. Fallback branch retained; see design D4 update.
- [x] 3.3 Migrate stage height and bento slot vertical geometry (`ROW_H`-derived `top`/`height` inline values) to CSS vh→svh fallback pairs keyed per slot

## 4. HeroZoom — fallback hygiene

- [x] 4.1 Gate the rAF fallback with an `IntersectionObserver` on `#hero-container` (`rootMargin: "100% 0px 100% 0px"`): `scheduleUpdate` no-ops while inactive; keep always-on behavior if `IntersectionObserver` is unavailable
- [x] 4.2 Consolidate the two per-frame `getBoundingClientRect()` calls into a single read of the section rect

## 5. Verification

- [x] 5.1 Confirm the non-reduced-motion path is visually unchanged for all three sequences (desktop + mobile widths, no re-timing of existing keyframes)
- [x] 5.2 Verify reduced-motion emulation (DevTools or Playwright `reducedMotion: 'reduce'`): ZoomParallax shows a static one-viewport grid, TimelineScroll shows the full vertical story with all content visible, HeroZoom shows the static revealed hero
- [x] 5.3 Verify the scroll-frame budget: no `updatePaths()` work while scrolling the timeline; HeroZoom fallback performs no rect reads/style writes when the hero is more than one viewport away
- [x] 5.4 Spot-check svh sizing at iPhone-class widths with dynamic browser chrome: no clipped stage content
