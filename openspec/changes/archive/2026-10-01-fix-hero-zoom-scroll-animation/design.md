## Context

`HeroZoom.astro` powers the opening visual sequence: a full-bleed wedding photo that zooms out as the guest scrolls down a 350lvh runway, followed by a pre-blurred layer fade and a sequential reveal of the couple's names, ampersand, event label ("Pernikahan"), and wedding date.

The component uses a dual-engine architecture:

1. **Modern CSS Scroll-Driven Animations**: `@supports (view-timeline: --hero-progress block) and (animation-timeline: --hero-progress)` uses CSS `@keyframes` bound to a named `--hero-progress` view timeline.
2. **JavaScript rAF Fallback**: For browsers without named view-timeline support, an `IntersectionObserver`-gated `requestAnimationFrame` loop calculates section scroll offset and writes inline styles to match the keyframe stages.

In production builds (`astro build`), Vite invokes LightningCSS (1.33.0) to bundle and minify styles. LightningCSS compresses separate `animation:` and `animation-timeline:` declarations into the CSS `animation` shorthand (`animation: linear both <keyframes> --hero-progress`). However, current browser implementations (both Chromium and WebKit/Safari) do not accept custom dashed-ident timeline names in the shorthand, dropping the entire animation declaration as invalid CSS (upstream parcel-bundler/lightningcss#1342).

Because `CSS.supports("view-timeline: --hero-progress block")` evaluates to true in modern engines, the JavaScript fallback skips running. With the 7 overlay declarations dropped by the parser, `.animate-blur`, `.animate-overlay`, and all title elements fall back to their base CSS: `opacity: 1`, `transform: translateY(0)`, `filter: blur(0px)`. The hero appears fully revealed from scroll 0. Meanwhile, `.animate-image` (which survived shorthand collapse only because it carried `var(--ease-out-zoom)`) zooms to `scale(1)` within the first 28% of travel (~590px). For the remaining 72% of the pinned travel, the hero is completely static, presenting the appearance of being "zoomed out and stuck."

## Goals / Non-Goals

**Goals:**

- Guarantee that CSS scroll-driven animation declarations remain valid and active across all 8 animated rules after production bundling with LightningCSS.
- Explicitly prevent LightningCSS from collapsing `animation-timeline` into invalid shorthand syntax.
- Verify that the view timeline anchor contract (0% progress at `scrollY = 0`, 100% progress at the 250lvh unpin boundary) accurately scrubs the keyframe distribution.
- Unify the zoom easing curve between CSS (`var(--ease-out-zoom)`) and the JavaScript rAF fallback, correcting misleading inline comments.
- Establish a test harness to boot the production standalone server (`dist/server/entry.mjs`) alongside static CSS bundle inspections.
- Enable the WebKit Playwright project to execute the new production built-server test.

**Non-Goals:**

- Modifying `DesktopGate` or `WelcomeGate` scroll-locking behavior (both correctly lock scroll on initial load until their respective criteria/gestures are met).
- Retiming or restyling reduced-motion behavior (`prefers-reduced-motion: reduce`).

## Decisions

### D1: Prevent shorthand collapse under LightningCSS across all 8 animated rules

LightningCSS merges `animation` and `animation-timeline` based on CSS Animations Level 2 syntax, unaware that browsers fail to parse dashed-idents in the shorthand. However, LightningCSS bails on shorthand synthesis when an unparsed CSS custom property (`var(...)`) is present in the timing function.

**Decision**: Apply an unparsed CSS variable token (e.g. `var(--ease-linear, linear)` and `var(--ease-out-zoom)`) to the timing function of all rules inside the `@supports` block:

- `.animate-image`: `animation: image-scroll-effect var(--ease-out-zoom) both;`
- `.animate-blur`: `animation: blur-reveal var(--ease-linear, linear) both;`
- `.animate-overlay`: `animation: overlay-reveal var(--ease-linear, linear) both;`
- `.animate-aisha`: `animation: aisha-reveal var(--ease-linear, linear) both;`
- `.animate-amp`: `animation: amp-reveal var(--ease-linear, linear) both;`
- `.animate-yofri`: `animation: yofri-reveal var(--ease-linear, linear) both;`
- `.animate-pernikahan`: `animation: blur-reveal-pernikahan var(--ease-linear, linear) both;`
- `.animate-date`: `animation: blur-reveal-date var(--ease-linear, linear) both;`

All 8 rules maintain separate `animation-timeline: --hero-progress;` and `animation-range: 0% 100%;` declarations. The presence of `var(...)` across all 8 declarations prevents shorthand consolidation.

### D2: Timeline anchor contract and keyframe synchronization

`#hero-container` has `height: 350lvh`, housing a sticky `100lvh` stage. The pinned travel is exactly `250lvh` (`sectionHeight - viewportHeight = 2110px` on an 844px viewport).

- `view-timeline-inset: 100% 100%` insets the scrollport boundaries so that at `scrollY = 0`, progress starts at `0.00%`, and at `scrollY = 250lvh` (when the section bottom reaches the viewport bottom and begins unpinning), progress reaches `100.00%`.
- Keyframe phase boundaries across the 250lvh travel:
  - Zoom-out: 0% → 28%
  - Pause: 28% → 35%
  - Aisha reveal: 35% → 42%
  - & reveal: 39% → 46%
  - Yofri reveal: 43% → 50%
  - Pernikahan blur reveal: 53% → 66%
  - Date blur reveal: 59.5% → 72.5%
  - Hold: 72.5% → 100%

### D3: Easing unification in the JavaScript fallback

`HeroZoom.astro:431-432` computes:

```javascript
const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic, matches the CSS curve.
const scale = 1.75 - eased * 0.75; // easeOutCubic, matches the CSS curve.
```

`--ease-out-zoom` = `cubic-bezier(0.33, 1, 0.68, 1)` (`global.css:27`) is the canonical **easeOutCubic** bezier (easings.net), _not_ easeOutQuint (`cubic-bezier(0.22, 1, 0.36, 1)`). The existing JS polynomial `1 - Math.pow(1 - progress, 3)` (easeOutCubic) already approximates that bezier within a max deviation of ~0.003 eased-progress units (~0.002 of the 0.75 scale travel), so CSS/JS parity is already satisfied and the "matches the CSS curve" comments are correct.
**Decision (corrected)**: Make **no** change to the easing exponent. An earlier revision of this design mislabeled the bezier as easeOutQuint and prescribed `1 - Math.pow(1 - progress, 5)`; numerically that polynomial deviates from `--ease-out-zoom` by up to 0.18 eased-progress units (~0.14 scale units, ~18% of the zoom travel), which would _break_ the spec's "JavaScript fallback scrub parity" scenario and exceed the ±0.05 test tolerance. The JS fallback stays at exponent 3.

### D4: Production-build test harness & WebKit project inclusion

Testing the production build requires running against `dist/server/entry.mjs` because the default dev server never runs LightningCSS minification.
**Decision**:

1. **Readiness protocol**: Add `startBuiltTestServer(database: TestDatabase, port = 0)` in `apps/web/tests/support/server.ts`. Unlike the dev server (which uses IPC and a Vite test middleware token), `dist/server/entry.mjs` is standalone. The helper will allocate an ephemeral port using `availablePort()`, pass `HOST: "127.0.0.1"` and `PORT: String(port)` in the environment, spawn `node dist/server/entry.mjs`, and poll `/api/rsvp/count` until it returns HTTP 200. It returns `{ baseUrl, stop, logPath }`.
2. **Build freshness**: In `apps/web/tests/hero-zoom-built.spec.ts`, execute `pnpm --filter web build` in `test.beforeAll` (or enforce it before server start), ensuring the static bundle check and server boot always run against fresh build artifacts.
3. **Spec execution & Viewport isolation**:
   - The test sets `test.use({ viewport: { width: 393, height: 852 } })` to ensure `DesktopGate` is inactive.
   - It dismisses `WelcomeGate` using `dismissWelcomeGate`.
   - It asserts on Chromium and WebKit that all 8 hero elements have active `ViewTimeline` animations.
   - It verifies scroll scrub progression.
   - For fallback verification, it stubs `CSS.supports` to return `false` for view-timeline and asserts on element inline styles (`element.style.transform`, `element.style.opacity`), which prove the rAF loop is driving properties independently of active CSS animations.
4. **WebKit matcher**: Update `playwright.config.ts` from `testIgnore: /^(?!.*media-tiering)/` to `testIgnore: /^(?!.*(media-tiering|hero-zoom-built))/`.

## Risks / Trade-offs

- **[Risk] Stale build artifacts masking CSS regressions** → _Mitigation_: The test owns building freshly via `test.beforeAll`, preventing silent false-positives against older bundles.
- **[Risk] Polynomial approximation difference** → _Mitigation_: The fallback test checks scroll states with a small numeric tolerance (`±0.05`), reflecting the slight difference between polynomial cubic and cubic-bezier.
