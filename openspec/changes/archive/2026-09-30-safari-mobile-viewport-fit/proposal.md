## Why

On real devices, pinned stages (`HeroZoom`, `ZoomParallax`, `TimelineScroll`) fail to fit the screen on Mobile Safari when sized in `svh`, while appearing correct on Safari Desktop. Desktop Safari has static chrome (`100svh == 100lvh == 100dvh == 100vh`), masking unit issues. On Mobile Safari, browser chrome retracts upon scroll, expanding visible height by ~60–80px. Pinned stages sized in `100svh` remain locked to the smaller height, leaving an exposed bottom gap. Sizing with `dvh` or dynamic `window.innerHeight` causes scrub jumping as chrome moves. Furthermore, `scroll-motion/spec.md` still carries legacy text specifying `svh` for `TimelineScroll`. Standardizing to `lvh` (with `vh` fallback) across all pinned stages eliminates gaps and restores specification alignment.

## What Changes

- **Formalize Mobile Viewport Unit Hierarchy in `scroll-motion`**:
  - Reconcile `TimelineScroll` with `HeroZoom` and `ZoomParallax`: all scroll runways, sticky stages, and vertical node positions must be sized in `lvh` (Large Viewport Height) with a preceding `vh` fallback declaration (`height: 100vh; height: 100lvh;`).
  - Restrict `svh` strictly to static, pre-scroll first-view overlays (e.g. initial welcome gates or modals) that must avoid clipping under the bottom tab bar prior to user scroll.
  - Prohibit `dvh` and dynamic `window.innerHeight` in scroll scrub geometry, pinned runways, and stage scale calculations, carving out viewport-tracking floating UI (like `AddImageButton`) and approach margins.
- **Audit & Verify Section Viewport Geometry**:
  - Audit all viewport-dependent components (`HeroZoom`, `ZoomParallax`, `TimelineScroll`, `FamiliesReveal`, `QuranVerse`, `WelcomeGate`) to ensure strict adherence to the `vh` -> `lvh` fallback pattern.
  - Ensure all JavaScript scale and travel derivations measure against static DOM elements (`stage.getBoundingClientRect()`) or static probe elements (`measureLvh()`), rather than `window.innerHeight`.
- **Automated Declarations & Real-Device Verification**:
  - Extend Playwright regression test coverage across all pinned sections to assert that styles resolve to `lvh` and contain no `svh` or `dvh` on pinned stages.
  - Document a physical iOS Safari verification protocol covering both top address bar and bottom tab bar configurations during forward scroll and reverse scroll chrome expansion.

## Capabilities

### Modified Capabilities

- `scroll-motion`: Updates the requirement and scenarios for "Pinned stages are sized to the chrome-hidden viewport" and "Timeline node spacing is widened with the runway growing at constant pan speed" so that `TimelineScroll`, `HeroZoom`, and `ZoomParallax` uniformly require `lvh` with a `vh` fallback declaration, and clarifies the prohibition of `svh` and `dvh` on pinned stages and scroll runways.

## Impact

- **Affected Components**: `apps/web/src/components/TimelineScroll.astro`, `apps/web/src/components/ZoomParallax.astro`, `apps/web/src/components/HeroZoom.astro`, `apps/web/src/components/FamiliesReveal.astro`, `apps/web/src/components/QuranVerse.astro`, `apps/web/src/components/WelcomeGate.astro`.
- **Specs**: `openspec/specs/scroll-motion/spec.md`.
- **Tests**: `apps/web/tests/zoom-reveal-once.spec.ts` (extended with HeroZoom and TimelineScroll assertions) or dedicated viewport tests.
- **Dependencies**: None.
