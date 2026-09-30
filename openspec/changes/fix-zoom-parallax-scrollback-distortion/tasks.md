## 1. ZoomParallax Markup & Styles

- [x] 1.1 In `apps/web/src/components/ZoomParallax.astro`, remove `${picture.isCenter ? "" : "will-change-transform"}` from `.zoom-wrapper` markup, eliminating permanent compositor layer hints across all 11 slots.
- [x] 1.2 In `apps/web/src/components/ZoomParallax.astro`, remove `.zoom-wrapper[data-is-center="true"] { will-change: auto !important; }` from `<style>`.
- [x] 1.3 In `apps/web/src/components/ZoomParallax.astro`, add CSS rule for `.zoom-inner picture` (`display: block; width: 100%; height: 100%;`) ensuring reliable box containment and aspect-ratio preservation for `object-fit: cover`.

## 2. Scroll Animation Transform Hygiene

- [x] 2.1 In `bindScrollZoom()`, update the baseline reset to clear inline styles (`w.style.transform = ""`) before stage measurement, avoiding persistent non-`none` transforms at rest.
- [x] 2.2 In `scroll()`, update the progress handler so that when `progress <= 0.1` (the initial dwell range), `el.style.transform = ""` is written instead of `scale(1)`.

## 3. Automated Testing & Verification

- [x] 3.1 In `apps/web/tests/zoom-reveal-once.spec.ts`, add an assertion for reverse scroll: scrolling forward through `ZoomParallax` and scrolling back to the start clears all wrapper inline transforms to `""` (computed `transform: none`) and verifies that `.zoom-image` bounding boxes match `.zoom-inner` slot boxes.
- [x] 3.2 Run `pnpm --filter web exec playwright test tests/zoom-reveal-once.spec.ts --project=mobile-chrome` and verify all tests pass.
- [x] 3.3 Verify visual quality and aspect ratio parity across Chromium and Firefox after full scrollback.
- [x] 3.4 Run `pnpm build` and `pnpm check-types` across the workspace to ensure build and type hygiene.
