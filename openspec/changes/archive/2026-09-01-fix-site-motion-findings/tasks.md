# Tasks: fix-site-motion-findings

## 1. TimelineScroll reduced-motion repairs (design D1)

- [x] 1.1 In `apps/web/src/components/TimelineScroll.astro`'s existing `@media (prefers-reduced-motion: reduce)` block: delete `#title-layer-bottom,` from the `display: none !important` selector group (lines 473-478) so the group keeps only `#timeline-track > svg, #timeline-circle-overlay, #timeline-circle-expansion`; extend the `#node-1` rule (lines 561-563) with `visibility: visible !important`; add `#dot-9 { opacity: 1 !important; transform: none !important; }` directly after it. Do NOT touch `#dot-9-anchor` (hidden on both paths — measurement point), markup, or the `<script>`.
- [x] 1.2 Verify with `prefers-reduced-motion: reduce` emulation: "Mula-mula" renders above node 1; node 1's dot/date/photo/desc visible as the first story item; finale shows dot AND "10 October 2026 / Menikah". Repeat with reduced motion OFF and scrub the full timeline — the animated run must be pixel-identical.

## 2. AddStoryFlow modal motion (design D2)

- [x] 2.1 In `apps/web/src/scripts/add-story-flow.ts`: add `import { animate } from "motion";` and the `EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const` twin (with keep-in-sync comment, StoryViewer.astro:259-260 precedent).
- [x] 2.2 Rewrite `openFlow()`: remove only `pointer-events-none` (keep `opacity-0`); set `aria-hidden="false"` + body lock; `animate(root, { opacity: [0, 1] }, { duration: 0.15 })`; panel — reduced-motion: `style.transform = "none"` + opacity fade 0.15s, else `animate(panel, { opacity: [0, 1], transform: ["translateY(16px) scale(0.95)", "translateY(0px) scale(1)"] }, { duration: 0.2, ease: EASE_OUT_EXPO })`. Keep `startPlaceholderRotation()` and `wishInput.focus()` after the animation kickoff, in their current order.
- [x] 2.3 Rewrite `closeFlow()`: body unlock stays synchronous; root `animate(opacity [1,0], 0.12s).finished.then(onComplete)` where `onComplete` restores `opacity-0` + `pointer-events-none` classes, `aria-hidden="true"`, and removes inline `opacity`/`transform` from root and panel; panel mirrors open (reduced-motion fade-only, else `translateY(0px) scale(1) → translateY(12px) scale(0.95)` at 0.12s expo). `stopPlaceholderRotation()`/`setSubmitting(false)`/`clearSelectedPhotos()` stay synchronous. No markup change in `AddStoryFlow.astro`.
- [x] 2.4 Feel check: open/close from the rail tile — entrance matches the story-viewer feel (16px rise + 0.95 settle), exit faster; rapid open/close never sticks half-transparent; after close, `#add-story-flow` has no inline styles left; reduced-motion → fade-only.

## 3. Globalize runtime-tile styles (design D3)

- [x] 3.1 `apps/web/src/pages/index.astro`: change `.animate-fade-up` (line 693) and its reduced-motion rule (line 700) to `:global(.animate-fade-up)`; leave `@keyframes fade` / `fade-up` in place (declaration values byte-identical).
- [x] 3.2 `apps/web/src/components/StoryViewer.astro`: convert `.android-spinner` (line 212), `.android-spinner .path` (line 218), `.story-viewer .zoom-cover` (line 246), and the hover-gated `.story-viewer [data-open]:hover .zoom-cover` (lines 249-253) to `:global(...)` form. Leave `.story-segment` rules and both `@keyframes` blocks untouched.
- [x] 3.3 Verify in built CSS: `.animate-fade-up`, `.android-spinner`, `.zoom-cover` appear WITHOUT `data-astro-cid-*` selectors. Runtime: newly posted/rendered guest tiles rise+fade over 0.6s like SSR tiles (no stagger delay on runtime tiles); guest spinners rotate/dash on Slow-3G; guest covers hover-zoom on a real mouse and never on touch. SSR tiles unchanged.

## 4. Welcome-gate drawer curve (design D4)

- [x] 4.1 `apps/web/src/components/WelcomeGate.astro`: add `var GATE_EASE = 'cubic-bezier(0.32, 0.72, 0, 1);'` (with comment) after `STALE_VELOCITY_MS` in the tunables block; use it in the commit transition (line 305) and both snap-backs (lines 355, 363). Durations stay `COMMIT_MS`/`SPRING_MS`. Keep the script ES5.
- [x] 4.2 Verify: `tests/welcome-gate.spec.ts` passes; on touch, abort spring-back lands softly and flick-commit accelerates away; reduced-motion instant dismiss unchanged.

## 5. FAQ reduced motion (design D5)

- [x] 5.1 `apps/web/src/components/WeddingFAQ.astro` `<script>`: add `const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;` after `EASE_OUT_EXPO` (StoryViewer.astro:262-263 precedent).
- [x] 5.2 Branch `openItem`/`closeItem`: content — reduced: height snapped (`style.height = "auto"`/`"0px"`) + opacity tween 0.15s, default: unchanged `height: "auto"`/`0` tweens; `numberBg` — reduced: `backgroundColor` tween only 0.15s, default: unchanged pop; `icon` — reduced: `style.transform = "rotate(45deg)"/"rotate(0deg)"`, default: unchanged spring; `activeLine` — reduced: `style.transform = "scaleX(1)"/"scaleX(0)"`, default: unchanged spring. Color tweens (`numberText`/`titleText`/`iconSvg`) untouched in both modes.
- [x] 5.3 Verify reduced-motion emulation: open/close fades content, badge fills without pop, icon/underline switch instantly; rapid toggling never sticks; default path pixel-identical.

## 6. Marquee pause + state smoothing (design D6)

- [x] 6.1 `apps/web/src/components/WishMarquee.astro` `<style is:global>`: add `.marquee-root[data-state="real"]:hover .marquee-content, .marquee-root[data-state="real"]:focus-within .marquee-content { animation-play-state: paused; }` after the `[data-state="real"]` rule; add `transition: opacity 300ms ease;` to `.marquee-root`; add `.marquee-root { transition: none; }` inside the existing reduced-motion block.
- [x] 6.2 In the `<script>`: in `rebuild()`, capture each row's live `transform` X before clearing (`new DOMMatrixReadOnly(getComputedStyle(content).transform).m41`) into a locally-widened `resumeX`; in `rebuildRow()`, replace the `animationDelay` assignment with resume-aware `-(((|resumeX| % width)/width) * duration)s`, falling back to `-phase * duration` on first build. The aria-hidden twin clones the styled copy, inheriting both.
- [x] 6.3 Verify: real-state hover freezes all rows mid-scroll and resumes seamlessly (no restart); demo state never pauses; the data-state opacity flip cross-fades ~300ms; posting a wish / resizing continues rows from their pixel offset; first load keeps staggered phases; reduced-motion static + instant as before.

## 7. Leaflet reduced-motion + hover gating (design D7)

- [x] 7.1 `apps/web/src/components/venue-map.ts`: add `zoomAnimation: !prefersReducedMotion(),` (with comment) to the `new Map(...)` options. If the local Leaflet 2.0-alpha typings reject the option, STOP and report — do not cast.
- [x] 7.2 `apps/web/src/components/VenueMap.astro`: split `.venue-map-route-option:hover` (line 527) and `.leaflet-control-zoom a:hover` (line 703) — keep color declarations ungated, move `transform: translateY(-1px)` into `@media (hover: hover) and (pointer: fine)` blocks (StoryViewer.astro:249 precedent); extend the reduced-motion block (lines 762-766) with `.venue-map .leaflet-bar.leaflet-control-zoom a` in the `transition: none` group plus `.venue-map .leaflet-zoom-anim .leaflet-zoom-animated { transition: none; }`.
- [x] 7.3 Verify: reduced-motion → zoom-control clicks and double-click zoom are instant; chip/route fitBounds remains instant; touch taps produce no sticky lift; desktop hover lift/press unchanged; `tests/venue-map.spec.ts` passes.

## 8. Story viewer first-slide fade (design D8)

- [x] 8.1 `apps/web/src/components/StoryViewer.astro`: in `createSlideElement`'s `img.onload`, add `animate(img, { opacity: [0, 1] }, { duration: 0.15 });` directly after `img.classList.remove("opacity-0");` (keep both lines). No reduced-motion branch — opacity fade is the safe form already. No CSS transition on slides.
- [x] 8.2 Verify on Slow 3G: first slide fades in over the spinner (~150ms) instead of hard-cutting; navigated slides unchanged; `tests/story-viewer.spec.ts` passes.

## 9. Press-feedback consistency (design D9)

- [x] 9.1 `apps/web/src/components/AddStoryFlow.astro`: "Choose photos" label (line 61) and Cancel (line 110) → `transition-[colors,transform] duration-160 ease-out`; Share (line 118) → replace `transition-opacity duration-150` with `transition-[opacity,transform] duration-160 ease-out` (fallback form if the arbitrary-property utility misbehaves: paired `transition-colors transition-transform` / `transition-opacity transition-transform`). Scale values unchanged (0.98/0.97).
- [x] 9.2 `apps/web/src/components/StarButton.astro`: add `transition: transform 160ms ease-out;` to `.star-btn`; add `.star-btn:active { transform: scale(0.97); }` after the `.star-btn` rule; add `transition: none;` to the existing reduced-motion block. Do not touch rim rotation, plate, palette, focus, or forced-colors rules.
- [x] 9.3 Verify: all four controls ease into/out of press over ~160ms; Share's disabled opacity transition still works; CTA rim keeps rotating while pressed; reduced-motion CTA press is instant; `tests/star-button.spec.ts` + fixture regeneration (if the fixture captures component CSS) pass.

## 10. QuranVerse will-change release (design D10)

- [x] 10.1 `apps/web/src/components/QuranVerse.astro`: add `will-change: auto;` (with comment) to the `:global(.in-view) :global(.blur-reveal)` rule (lines 109-113). Base rule keeps its `will-change`.
- [x] 10.2 Verify: reveal plays identically; post-reveal `getComputedStyle(wordSpan).willChange === "auto"`; reduced-motion path unchanged.

## 11. Motion token consolidation (design D11)

- [x] 11.1 `apps/web/src/styles/global.css` `@theme`: add `--ease-out-strong: cubic-bezier(0.23, 1, 0.32, 1);`, `--ease-out-standard: cubic-bezier(0, 0, 0.2, 1);`, `--ease-out-zoom: cubic-bezier(0.33, 1, 0.68, 1);`, `--ease-blur-reveal: cubic-bezier(0.25, 0.1, 0.25, 1);` (each with an owning-component comment); grep `apps/web/src` for `ease-in-out-strong` — if still zero consumers, delete the token; if a consumer appeared, keep it and note the consumer in the task result.
- [x] 11.2 Point consumers at tokens: `VenueMap.astro` 8× `cubic-bezier(0.23, 1, 0.32, 1)` → `var(--ease-out-strong)` + ping → `var(--ease-out-standard)`; `HeroZoom.astro:143` → `var(--ease-out-zoom)`; `QuranVerse.astro:91-93` → `var(--ease-blur-reveal)` and simplify `:98-100` to bare `var(--ease-out-expo)`; rename `number-ticker.ts`'s `EASE_OUT` → `EASE_OUT_EXPO` (keep the sync comment). **Zero cubic-bezier value changes.**
- [x] 11.3 Verify: `grep -rn "cubic-bezier(" apps/web/src --include="*.astro" --include="*.ts" --include="*.css"` hits only `global.css`, `WelcomeGate.astro` (`GATE_EASE`), and JS twin arrays; build passes; full-page motion pass is byte-identical in timing (mechanical verification, not feel).

## 12. RSVP confirm celebration (design D12)

- [x] 12.1 `apps/web/src/components/RsvpSection.astro` `<script>`: add `import { animate } from "motion";` + `EASE_OUT_EXPO` twin. In the submit handler's success branch: set `confirmed = true` + `aria-disabled` FIRST (no double-submit window); then — reduced-motion or no label layers: `setLabel(confirmedLabel)` as today; else for each `[data-star-btn-text]` layer: await 150ms exit (`opacity [1,0]`, `translateY 0→-6px`), swap text, 200ms expo enter (`translateY 6px→0`); then `animate(confirmBtn, { scale: [1, 1.04, 1] }, { duration: 0.3, ease: EASE_OUT_EXPO })`; `confirmBtn.disabled = true` last. Keep `actionWrap?.focus`, note text, `void poll()` unchanged.
- [x] 12.2 Verify: success plays the crossfade + settle-pop (~350ms label, 300ms pop); reduced-motion → instant swap exactly as today; `tests/rsvp.spec.ts` passes (end state — disabled button, confirmed label, note text — unchanged).

## 13. Route polyline draw-in (design D13)

- [x] 13.1 `apps/web/src/components/venue-map.ts`: at the end of `addRouteLines()` (before `return lines;`), if `!prefersReducedMotion()`, for each line's `getElement()` that is an `SVGPathElement`: measure `getTotalLength()`, set inline `strokeDasharray`, WAAPI `strokeDashoffset len→0` over 500ms `cubic-bezier(0.23, 1, 0.32, 1)`, `fill: "forwards"`, and on finish restore the pre-animation dash state (executor verifies in DevTools whether Leaflet's `dashArray` is inline-style or attribute — restore saved value vs clear override accordingly; the airport connector must end dashed).
- [x] 13.2 Verify: selecting a chip sweeps the route from its origin pin toward the venue over ~0.5s alongside the pan; rapid chip switching never freezes a mid-draw path (old layers removed via existing `removeRouteLines`); soemarmo connector ends dashed; unselect removes instantly; reduced-motion renders complete paths; `tests/venue-map.spec.ts` passes.

## 14. Map placeholder crossfade (design D14)

- [x] 14.1 `apps/web/src/components/VenueMap.astro`: add `[data-venue-map-placeholder] { transition: opacity 250ms ease; }`, `.is-unmounting { opacity: 0; }`, and a reduced-motion `transition: none` for it in the component `<style>`.
- [x] 14.2 `apps/web/src/components/venue-map.ts`: replace the placeholder hide at the end of `initVenueMap()` — reduced-motion: `hidden` as today; else fade the container in via WAAPI (250ms `ease`), add `is-unmounting` to the placeholder, and after 260ms add `hidden` + remove `is-unmounting` + clear the container's inline opacity. `showVenueMapFallback` untouched.
- [x] 14.3 Verify: Slow-3G scroll to the section — placeholder dims out as the map fades in (one hand-off, no flash); map interactive through the swap; forced import failure → instant fallback; reduced-motion → instant; `tests/venue-map.spec.ts` passes (adjust the placeholder-hidden assertion to wait for `.hidden` with a timeout if it was synchronous — note the change in the task result).

## 15. Final verification

- [x] 15.1 `pnpm check-types` and `pnpm build` pass; full Playwright suite passes (`welcome-gate`, `story-viewer`, `venue-map`, `rsvp`, `star-button`, and friends).
- [x] 15.2 Manual sweep: one full page pass on desktop + touch emulation + `prefers-reduced-motion: reduce` emulation — every behavior above holds; default-path motion is unchanged except the deliberately re-timed items (gate curve, first-slide fade, modal entrance/exit, press transitions, marquee resume, RSVP celebration, route draw-in, placeholder crossfade).
