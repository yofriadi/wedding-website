# Design: fix-scroll-motion-findings

## Context

The landing page pins the user through three stacked scroll-driven sequences: `HeroZoom` (300svh, CSS view-timeline with a rAF fallback), `ZoomParallax` (400vh, `motion` scroll scrub scaling a bento grid into a tunnel), and `TimelineScroll` (1200vh, `motion` scroll scrub driving a shrinking circle, a 1100vw track pan, SVG connector draws, and threshold-triggered node reveals). A motion-craft review approved the staged `HeroZoom` rewrite but blocked the committed components on missing `prefers-reduced-motion` handling and flagged per-scroll-frame SVG recomputation, double initialization, `vh`-based stage sizing inconsistent with the svh hero, a never-disengaging fallback listener, and a mixed scrub/timed reveal model in timeline nodes.

Constraints: no new dependencies; visual behavior on the supported (non-reduced-motion) path must not be re-timed; the audience is wedding guests on a wide device/browser spread (the rAF paths are the mainstream path on Safari ≤25).

## Goals / Non-Goals

**Goals:**

- `prefers-reduced-motion: reduce` users get complete, readable content from both components with zero scroll-driven movement.
- No per-scroll-frame layout work in `TimelineScroll`; no permanent scroll listeners in the `HeroZoom` fallback.
- One initialization per page load in `ZoomParallax`.
- Pinned stages sized with `svh` consistently across all three components.
- Node reveals reverse consistently when scrubbing backward.

**Non-Goals:**

- Trimming dead-scroll hold lengths (pacing is a creative decision, deferred).
- Replacing the clip-path circle shrink with a scaled element.
- Tuning the dot overshoot (`scale(1.35)`).
- Fixing the pre-existing no-JS state of `TimelineScroll` for non-reduced-motion users (see Open Questions).

## Decisions

### D1. Reduced-motion state = readable content, not a frozen frame

Reduced motion means content parity through a different presentation, not a screenshot of some animation midpoint:

- **`ZoomParallax`**: the bento grid _is_ the content. Reduced motion skips the JS scrub entirely; CSS collapses the 400vh container to one viewport and un-pins the stage, leaving the static grid. No content is lost.
- **`TimelineScroll`**: the content is only reachable through the horizontal pan, so a frozen frame is useless. Under `prefers-reduced-motion: reduce`, CSS reflows the track into a vertical stack: track becomes a normal-flow column (`width: auto`, `transform: none`), nodes become `position: relative` flow items with their dates/photos/descriptions forced visible, SVG connectors and both circle overlays are hidden, and the section height collapses from 1200vh to auto. JS additionally skips all `animate()`/`scroll()` bindings when `matchMedia` matches.
- **Alternative considered**: keeping the horizontal layout and revealing everything statically — rejected: nodes 3–9 sit at 275–965vw, unreachable without the pan.
- **Alternative considered**: `motion`'s `useReducedMotion` — rejected in favor of plain `matchMedia` at init: zero library coupling and it matches the pattern `HeroZoom` already uses.

### D2. Reduced-motion preference is read once at init

Both components check `matchMedia("(prefers-reduced-motion: reduce)").matches` inside their init and bail before binding animations. Live OS-preference toggling mid-session requires a reload. This matches `HeroZoom`'s behavior and keeps the already-involved `TimelineScroll` lifecycle simple. The CSS media queries carry the visual state regardless, so even stale JS state cannot produce motion.

### D3. `TimelineScroll` path geometry recomputes on resize/settle only

The SVG and all nine dots are descendants of `#timeline-track`, so their positions relative to the track are invariant under the track's transform — scroll cannot change the connector geometry. The per-frame `scroll` listener is removed; the existing resize handler, init retry, and 220ms settle timeout remain as the only recompute triggers.

**Alternative considered**: throttling the scroll recompute — rejected: recomputing constant geometry at any frequency is waste.

### D4. `ZoomParallax` initialization — finding revised during implementation

**Original plan:** remove the readyState/`DOMContentLoaded` fallback so `astro:page-load` is the single entry point.

**Discovered during verification:** `astro:page-load` never fires on this site — `Layout.astro` does not use `<ClientRouter />`, and that event only fires when the router is present. Browser-verified: an `astro:page-load` listener registered before load observed zero events after full page load. The readyState branch was the _only_ working initializer; the review's "double init" premise was wrong (it would only hold on a ClientRouter site).

**Implemented:** the readyState/`DOMContentLoaded` fallback branch is kept (commented as covering the initial load; `astro:page-load` retained for future ClientRouter adoption). There is no double initialization today, so "initializes exactly once per page load" already holds. If `<ClientRouter />` is ever added, this branch should be revisited (it would then double-init; `TimelineScroll` already neutralizes such duplicates via its `initRaf` cancel).

### D5. `svh` migration follows the `HeroZoom` fallback-pair pattern

Stage heights (`h-screen` on both sticky stages) move to the `height: 100vh; height: 100svh;` pattern in component CSS. Vertical positions currently in inline styles (`top: Nvh` on the nine timeline nodes; `ROW_H`-derived `top`/`height` on the bento slots) move into component `<style>` rules keyed by id/data attributes so the vh→svh fallback pair can be expressed; inline styles keep only horizontal values (`left`) and dimensions that are not viewport-height-dependent. `vw` values are untouched.

### D6. `HeroZoom` fallback gates on visibility, not completion

An `IntersectionObserver` on `#hero-container` (rootMargin `100% 0px 100% 0px`) toggles an active flag; `scheduleUpdate` no-ops while inactive. The two `getBoundingClientRect()` calls per frame collapse into one read. IO has been supported since iOS 12.2, safely covering every browser that reaches this fallback; if IO is somehow missing, behavior stays as today (always-on).

**Alternative considered**: latching after `scrolled >= travel` — rejected: it needs extra unlatch logic for scroll-back and still does rect reads every frame.

### D7. Node photos join the threshold-triggered driver

The scrubbed `photoAnim` is deleted; photos reveal inside `showDetails()`/`hideDetails()` with the same `animate()` shape as date/description (`translateY(18px) → 0`, opacity, ease `[0.16, 1, 0.3, 1]`, small stagger). Reversal is now uniform per node.

**Alternative considered**: making date/description scrubbed like the photo — rejected: it would discard the staggered overshoot reveal, the one moment the review explicitly praised.

## Risks / Trade-offs

- **[Vertical reflow looks rough — nodes were art-directed for absolute positions]** → Favor content parity over polish: simple flex column, generous spacing, existing card styles carry over. Verify with DevTools reduced-motion emulation at mobile + desktop widths.
- **[svh geometry shifts node positions slightly vs vh on mobile]** → Content stays in view; visual spot-check at iPhone-class widths. Fallback pair keeps pre-svh browsers at today's layout.
- **[Removing scroll-driven recompute misses a geometry edge case (e.g., late font swap)]** → The settle timeout and resize handler already cover late layout shifts; worst case is a few pixels of connector misalignment until the next resize.
- **[Dropping the readyState fallback leaves a non-Astro host without animation]** → Static grid is readable; acceptable degradation for a hypothetical host that doesn't exist today.
- **[IO gating adds one more observer]** → One observer on one element; negligible versus the per-frame work it removes on low-end iOS.

## Migration Plan

Pure frontend, no data/API surface. Implement per-component in the task order (TimelineScroll → ZoomParallax → HeroZoom) so each commit is independently revertable. Verify with the existing Playwright setup where practical plus manual reduced-motion emulation (`@media (prefers-reduced-motion: reduce)` in DevTools / Playwright `reducedMotion: 'reduce'`). Rollback = git revert of the offending component commit.

## Open Questions

- Should the reduced-motion vertical reflow double as the no-JS baseline (progressive-enhancement flip: readable markup first, horizontal scrub as the enhancement)? Desirable, but a larger restructure — deferred to a follow-up change.
- Hold-length pacing trims (HeroZoom ~240svh, TimelineScroll ~1050vh) — deferred to a creative review pass.
