# Proposal: fix-scroll-motion-findings

## Why

A motion-craft review of the landing page's three scroll-driven components (`HeroZoom`, `ZoomParallax`, `TimelineScroll`) blocked on one accessibility gap and surfaced several performance/hygiene issues. The two committed components (`ZoomParallax`, `TimelineScroll`) have **no `prefers-reduced-motion` handling** despite driving large-field motion (full-screen zoom tunnel, a 1100vw pan, an expanding circle) — the exact class of motion that triggers vestibular disorders. Alongside that, `TimelineScroll` recomputes SVG connector geometry on every scroll frame, `ZoomParallax` initializes twice on first load, pinned stages use `vh`/`h-screen` inconsistently with the svh-based hero, and the `HeroZoom` JS fallback keeps its scroll listener alive for the whole page session.

## What Changes

- **Add reduced-motion support to `ZoomParallax`**: users with `prefers-reduced-motion: reduce` skip the zoom sequence entirely and see the static, readable bento grid; the 400vh pin collapses to a single viewport.
- **Add reduced-motion support to `TimelineScroll`**: reduced-motion users skip the scrubbed circle/pan/reveal sequence and see the fully readable timeline (nodes, dates, photos, descriptions visible); the 1200vh pin collapses.
- **`TimelineScroll` performance**: connector path geometry is recomputed only on resize/layout-settle, never per scroll frame (geometry is constant relative to the moving track).
- **`ZoomParallax` lifecycle**: initialize exactly once on first page load (remove the duplicate `astro:page-load` + readyState-fallback double init).
- **Viewport-unit consistency**: `ZoomParallax` and `TimelineScroll` pinned stages and node geometry move from `vh`/`h-screen` to `svh`, matching `HeroZoom`, so mobile browser chrome doesn't clip stage content.
- **`HeroZoom` fallback hygiene**: the rAF scroll fallback disengages once the hero leaves the viewport (and re-arms on return), and reads the section rect once per frame instead of twice.
- **`TimelineScroll` node reveal consistency**: node photos reveal via the same threshold-triggered driver as their date/description, so scrubbing backward never desyncs photo vs. text state.

Explicitly out of scope (creative pacing/tuning decisions, tracked separately if desired): trimming dead-scroll hold lengths, swapping the clip-path circle shrink for a scaled element, and dot-overshoot tuning.

## Capabilities

### New Capabilities

- `scroll-motion`: Behavioral requirements for the landing page's scroll-driven motion system — reduced-motion behavior, pinned-stage viewport sizing, scroll-frame budget, initialization idempotency, fallback listener lifetime, and reversal-consistent node reveals.

### Modified Capabilities

None (no existing specs in `openspec/specs/`).

## Impact

- **Code**: `src/components/HeroZoom.astro` (fallback script only), `src/components/ZoomParallax.astro`, `src/components/TimelineScroll.astro`.
- **Dependencies**: none added; continues to use `motion` v13 (`animate`, `scroll`) and standard `matchMedia`/`IntersectionObserver` APIs.
- **Risk**: visual parity on the supported (non-reduced-motion) path must be preserved — all changes to that path are perf/lifecycle-only, no re-timing of existing keyframes.
