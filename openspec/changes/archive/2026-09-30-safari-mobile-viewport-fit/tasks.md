# Implementation Tasks

## 1. Codebase Viewport Unit Audit

- [x] 1.1 **`HeroZoom.astro`**: Confirm runway (`350vh; 350lvh;`) and stage (`100vh; 100lvh;`) use the `vh -> lvh` fallback pair. Verify that no `svh` or `dvh` declarations are present on pinned elements.
- [x] 1.2 **`ZoomParallax.astro`**: Confirm runway (`400vh; 400lvh;`) and stage (`100vh; 100lvh;`) use the `vh -> lvh` fallback pair. Verify `centerScaleFactor` measures against `stage.getBoundingClientRect()` rather than `window.innerHeight`.
- [x] 1.3 **`TimelineScroll.astro`**: Confirm runway (`1249vh; 1249lvh;`), stage (`100vh; 100lvh;`), track (`250lvh;`), and node top positions (`#node-1` through `#node-6`) use the `vh -> lvh` fallback pair. Verify that `vUnit` in script evaluates to `lvh` (with `vh` fallback), never `svh`.
- [x] 1.4 **`FamiliesReveal.astro`**: Confirm stage spacing uses the `30vh; 30lvh;` `padding-block` pair and the `25vh; 25lvh;` `.families-canvas` gap pair. Verify `measureLvh()` probe uses `100lvh` to derive `lvhPx` for word travel thresholds.
- [x] 1.5 **`QuranVerse.astro`**: Confirm section uses `min-h-screen min-h-lvh`.
- [x] 1.6 **`WelcomeGate.astro`**: Confirm full-screen coverage uses `fixed inset-0` for pre-scroll state and CTA positioning at `bottom-24`.
- [x] 1.7 **Codebase Comment Sweep**: Clean up stale comments mentioning `svh` or legacy runway lengths across `zoom-reveal-once.spec.ts:12`, `TimelineScroll.astro:706`, `ZoomParallax.astro:330,668`, and `HeroZoom.astro:90` (stale 300lvh comment).

## 2. Specification Reconcile

- [x] 2.1 In `openspec/specs/scroll-motion/spec.md`, update "Requirement: Pinned stages are sized to the chrome-hidden viewport":
  - Remove stale clause stating `TimelineScroll's sticky stage and scroll runway SHALL be sized in svh`.
  - Declare that `HeroZoom`, `ZoomParallax`, and `TimelineScroll` sticky stages and runways SHALL be sized in `lvh` with a `vh` fallback declaration.
  - Reiterate the strict prohibition: runways and stage geometry SHALL NOT use `dvh` or `svh` (with carve-out for viewport-tracking floating UI like `AddImageButton`).
- [x] 2.2 In `openspec/specs/scroll-motion/spec.md`, update "Requirement: Timeline node spacing is widened with the runway growing at constant pan speed":
  - Replace legacy `1249svh (1149svh scrollable + 100svh stage)` and phase breakdowns (`≈66svh`, `≈753svh`, etc.) with `lvh` equivalents.
  - Preserve all 5 canonical scenarios in the specification delta.
- [x] 2.3 Verify the delta spec in `openspec/changes/safari-mobile-viewport-fit/specs/scroll-motion/spec.md` validates cleanly (`openspec validate safari-mobile-viewport-fit --strict`) and carries requirement text identical to the reconciled live spec, so archiving cannot silently revert it.
- [x] 2.4 Archive the change via `openspec archive safari-mobile-viewport-fit --yes`.

## 3. Automated Regression Testing

- [x] 3.1 Verify existing `apps/web/tests/zoom-reveal-once.spec.ts` passes, confirming `ZoomParallax` asserts `400lvh`, `100lvh`, and absence of `svh`/`dvh`.
- [x] 3.2 In Playwright test suite (implemented in dedicated `apps/web/tests/pinned-viewport-units.spec.ts`), implement per-component scoped CSS declaration checks for `HeroZoom` (`.hero-`) and `TimelineScroll` (filtering `.timeline-`, `#timeline-track`, `#node-`, and `#dot-` rules):
  - Strip CSS comments prior to pattern matching to avoid false positives on explanation comments mentioning `svh`/`dvh`.
  - Assert that pinned runways declare `1249lvh` / `350lvh` and stages declare `100lvh`.
  - Assert that no active CSS property declaration on pinned stages or track/node geometry uses `svh` or `dvh`.
- [x] 3.3 Run `pnpm test` (or `pnpm exec playwright test`) across Chromium and WebKit test suites.

## 4. Real-Device Mobile Safari Verification

- [x] 4.1 **iOS Safari (Bottom Tab Bar - default)**:
  - Scroll past WelcomeGate into `HeroZoom`: confirm URL bar collapses to minimal pill and bottom bar slides out.
  - Check stage bottom edge: confirm no section background stripe or gap appears beneath the pinned image.
  - Scrub through `ZoomParallax`: confirm outer collage images and center focus expand without bottom gap or texture distortion.
  - Scrub through `TimelineScroll`: confirm background circle covers the full viewport without bottom gap, and horizontal track stays centered.
  - Reverse scroll back upward: confirm toolbar re-expansion does not trigger scrub jumps, layout tearing, or unpinning glitches.
- [x] 4.2 **iOS Safari (Single Top Tab Bar)**:
  - Repeat scrub checks with Safari configured to single top bar in iOS Settings. Confirm identical seamless full-screen coverage.
