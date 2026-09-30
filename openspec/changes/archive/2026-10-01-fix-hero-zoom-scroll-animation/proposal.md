## Why

In production builds (`astro build`), `HeroZoom.astro` fails to animate on scroll in both Chrome and Safari. The hero text ("Pernikahan", "Aisha", "&", "Yofri", date) and blurred image layer appear immediately in their static fallback state (fully visible, unblurred, and zoomed out), while the image completes its zoom-out in the first 28% of scroll and sits static at `scale(1)` for the remainder of the 350lvh runway.

This occurs because Vite's CSS minifier (LightningCSS) optimizes separate `animation:` and `animation-timeline:` declarations into the CSS `animation` shorthand (`animation: linear both <keyframes> --hero-progress`). Browsers (Chromium and WebKit/Safari) do not support timeline names in the `animation` shorthand and drop the declaration as syntactically invalid (upstream parcel-bundler/lightningcss#1342). Because `CSS.supports("view-timeline: --hero-progress block")` evaluates to true in modern engines, the JavaScript rAF fallback is bypassed, stranding the hero with dropped CSS animations and leaving all seven reveal elements in their fully visible, un-animated fallback state.

## What Changes

- **Preserve CSS `animation-timeline` declarations under minification**: Structure `HeroZoom.astro` CSS animation properties across all eight animated rules so LightningCSS cannot collapse `animation` and `animation-timeline` into invalid shorthand syntax (using CSS variables for timing/easing).
- **Verify and document the timeline anchor contract**: Validate that the view-timeline mapping (0% progress at `scrollY = 0`, 100% progress at the unpin point `scrollY = 250lvh`) accurately drives the full sequence across the 350lvh pinned runway.
- **Synchronize JavaScript fallback parity and fix easing mismatch**: Unify the zoom curve between CSS (`var(--ease-out-zoom)`) and JavaScript (easeOutCubic vs quint) and synchronize phase boundaries across browsers without named view-timeline support.
- **Build serving harness and automated regression tests**: Provide a test harness capable of booting the production standalone server (`dist/server/entry.mjs`) alongside static CSS bundle inspections and runtime scroll scrub assertions on Chromium and WebKit.
- **Update WebKit Playwright configuration**: Extend `playwright.config.ts`'s `webkit` project matcher to include the new production built-server test.

## Capabilities

### Modified Capabilities

- `scroll-motion`: Update HeroZoom animation declarations to guarantee valid post-minification CSS in production, calibrate scroll timeline progress across the pinned runway, and unify easing curves between CSS and JavaScript engines.

## Impact

- **Affected code**: `apps/web/src/components/HeroZoom.astro`, `apps/web/playwright.config.ts`, `apps/web/tests/support/server.ts` (or dedicated built test helper).
- **Build & Dependencies**: No new dependencies; impacts production CSS minification output in `dist/client/_astro/*.css`.
- **Testing**: Adds an automated test verifying the built CSS bundle and runtime scroll behavior against the production standalone server.
