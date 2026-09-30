## 1. CSS Animation Declarations & Minification Safety

- [x] 1.1 In `apps/web/src/components/HeroZoom.astro`, update all eight animated rules (`.animate-image`, `.animate-blur`, `.animate-overlay`, `.animate-aisha`, `.animate-amp`, `.animate-yofri`, `.animate-pernikahan`, `.animate-date`) inside the `@supports` block to use CSS custom property values in their timing function (e.g. `var(--ease-linear, linear)` and `var(--ease-out-zoom)`), preventing LightningCSS from synthesizing the invalid shorthand.
- [x] 1.2 Run `pnpm --filter web build` and verify that the emitted CSS bundle under `apps/web/dist/client/_astro/*.css` contains separate, valid `animation-timeline: --hero-progress` declarations across all 8 classes and zero invalid `animation: ... --hero-progress` shorthands.

## 2. Fallback Easing & Keyframe Synchronization

- [x] 2.1 In `apps/web/src/components/HeroZoom.astro:431-432`, verify the JS fallback zoom easing matches the CSS `var(--ease-out-zoom)` curve. `--ease-out-zoom` = `cubic-bezier(0.33, 1, 0.68, 1)` is easeOutCubic (not easeOutQuint), and the existing `1 - Math.pow(1 - progress, 3)` already matches it within ~0.003, so the exponent stays at 3 — no change. NOTE: an earlier design revision mislabeled the bezier as easeOutQuint and prescribed exponent 5; that deviates by up to 0.18 and was reverted (see design.md D3).
- [x] 2.2 Verify that the JS rAF fallback phase boundaries match the CSS keyframe distribution (zoom: 0% → 28%, pause: 28% → 35%, Aisha: 35% → 42%, &: 39% → 46%, Yofri: 43% → 50%, Pernikahan: 53% → 66%, Date: 59.5% → 72.5%, Hold: 72.5% → 100%).

## 3. Test Infrastructure & Production Verification

- [x] 3.1 In `apps/web/tests/support/server.ts`, implement `startBuiltTestServer(database: TestDatabase, port = 0)` to boot `node dist/server/entry.mjs` against the isolated SQLite test environment, polling `/api/rsvp/count` for readiness, and returning `{ baseUrl, stop, logPath }`.
- [x] 3.2 In `apps/web/playwright.config.ts`, update the `webkit` project's `testIgnore` pattern from `/^(?!.*media-tiering)/` to `/^(?!.*(media-tiering|hero-zoom-built))/` so the built-server verification runs on WebKit as well as Chromium.
- [x] 3.3 Create Playwright test `apps/web/tests/hero-zoom-built.spec.ts`:
  - Enforce build freshness in `test.beforeAll` (running `pnpm --filter web build`).
  - Static bundle check: Read emitted CSS files in `apps/web/dist/client/_astro/` and assert zero instances of `animation: ... --hero-progress`.
  - Built server runtime check: Boot the built server via `startBuiltTestServer`, configure a mobile viewport (`viewport: { width: 393, height: 852 }`), dismiss the welcome gate, and assert that all 8 hero elements have active `ViewTimeline` animations in Chromium and WebKit.
  - Scroll scrub verification: Assert that image transform scrubs progressively from `scale(1.75)` to `scale(1)` without premature freeze, and that overlay/text opacities scrub sequentially.
  - Fallback scrub verification: Add a test with `CSS.supports` stubbed to return `false` for view-timeline and assert that the JS rAF fallback drives element inline styles (`style.transform`, `style.opacity`).
- [x] 3.4 Run `pnpm --filter web exec playwright test tests/hero-zoom-built.spec.ts` and verify all assertions pass cleanly on both Chromium and WebKit.
- [x] 3.5 Run `openspec validate fix-hero-zoom-scroll-animation` and verify schema compliance.
