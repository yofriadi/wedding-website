## 1. Motion tokens

- [x] 1.1 In `src/styles/global.css`, add to the existing `@theme` block: `--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);` and `--ease-in-out-strong: cubic-bezier(0.77, 0, 0.175, 1);` with a one-line comment noting the JS twin `EASE_OUT_EXPO = [0.16, 1, 0.3, 1]` must stay in sync
- [x] 1.2 In `src/components/StoryViewer.astro` script, define `const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;` near the top (after the `import`) and replace the inline `ease: [0.16, 1, 0.3, 1] as any` at the modal open (~line 459) with `ease: EASE_OUT_EXPO`
- [x] 1.3 In `src/components/TimelineScroll.astro` script, define the same `EASE_OUT_EXPO` constant and replace the five inline `ease: [0.16, 1, 0.3, 1]` occurrences (dot/photo/date/desc reveal animations, ~lines 763–783)

## 2. StoryViewer — easing, performance, hover gate

- [x] 2.1 Fix the panel exit easing: at ~line 493 change `ease: "easeIn"` → `ease: EASE_OUT_EXPO` and `duration: 0.2` → `duration: 0.15` (backdrop opacity exit at ~line 492 stays `0.2`)
- [x] 2.2 Convert slide transitions to full transforms. Replace ~lines 411 and 416:
      `animate(newSlide, { x: [direction > 0 ? "100%" : "-100%", "0%"] } as any, { duration: 0.3, ease: "ease-out" } as any)` →
      `animate(newSlide, { transform: [direction > 0 ? "translateX(100%)" : "translateX(-100%)", "translateX(0%)"] }, { duration: 0.3, ease: EASE_OUT_EXPO })`
      and the old-slide line analogously (`transform: ["translateX(0%)", direction > 0 ? "translateX(-100%)" : "translateX(100%)"]`)
- [x] 2.3 Compose the panel entrance into a single transform: at ~line 459 change `{ opacity: [0, 1], scale: [0.95, 1], y: [16, 0] }` → `{ opacity: [0, 1], transform: ["translateY(16px) scale(0.95)", "translateY(0px) scale(1)"] }`
- [x] 2.4 Compose the panel exit transform similarly: `{ opacity: [1, 0], scale: [1, 0.95], y: [0, 12] }` → `{ opacity: [1, 0], transform: ["translateY(0px) scale(1)", "translateY(12px) scale(0.95)"] }` (keep the `0.15s` + `EASE_OUT_EXPO` from 2.1)
- [x] 2.5 Rework `setProgress` to a transform-only fill. In the markup (~line 67), change the fill `<div class="h-full bg-white rounded-full w-0" data-progress-bar></div>` to `<div class="h-full bg-white rounded-full w-full" data-progress-bar style="transform: scaleX(0); transform-origin: left;"></div>` — the base must be full-width, because `scaleX` scales the element's own 100% width and a `w-0` base paints nothing. In the script, `setProgress` writes `bar.style.transform = `scaleX(${value / 100})`` for the active bar only; add an `updateSegmentStates()` helper called from `setStory` that sets past bars to `scaleX(1)` and future bars to `scaleX(0)` once per index change
- [x] 2.6 Gate the cover hover scale: in `StoryViewer.astro` markup (~line 41) remove `transition-transform duration-300 group-hover:scale-110` from the cover `<img>`; add a scoped style:
  ```css
  @media (hover: hover) and (pointer: fine) {
    .story-viewer [data-open]:hover .zoom-cover {
      transform: scale(1.1);
    }
  }
  .story-viewer .zoom-cover {
    transition: transform 300ms var(--ease-out-expo);
  }
  ```

## 3. StoryViewer — reduced motion

- [x] 3.1 At the top of the per-viewer setup, read `const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;` (module scope, read once)
- [x] 3.2 In `open()`: when `reducedMotion`, animate the panel with `{ opacity: [0, 1] }` only (no transform), backdrop unchanged; in the non-animated branch keep existing behavior
- [x] 3.3 In `close()`: when `reducedMotion`, animate `{ opacity: [1, 0] }` only for the panel
- [x] 3.4 In `setStory()` direction branch: when `reducedMotion`, animate slides with `{ opacity: [0, 1] }` (in) / `{ opacity: [1, 0] }` (out) instead of `translateX`; remove the old slide on `.finished`
- [x] 3.5 Spinner show/hide keeps `opacity` only under reduced motion (drop the `scale` keyframe from `showSpinner`/`hideSpinner`)

## 4. Story hand-off (index.astro)

- [x] 4.1 In `StoryViewer.astro`, expose a readiness signal: after the first slide's `img.onload` fires (inside `createSlideElement`), dispatch `new CustomEvent("story-first-slide-ready", { bubbles: true })` on the viewer element — fire it only for the first slide of a viewer's current open session (guard with a flag reset in `open()`)
- [x] 4.2 In `StoryViewer.astro` `open()`, extend the options contract to `{ animate?: boolean; startIndex?: number | "last"; onFirstSlideReady?: () => void }` — invoke `onFirstSlideReady` on first-slide readiness (same moment as the event in 4.1), and honor `startIndex` when computing the opening story index (today the first-unviewed/0 fallback ignores it)
- [x] 4.3 In `src/pages/index.astro`, replace both `setTimeout(() => { ... closeStory({ animate: false }) }, 300)` blocks (~lines 301–306 and 322–327) with: `const fallback = setTimeout(closeCurrent, 800);` plus `nextViewer.openStory({ animate: true, onFirstSlideReady: () => { clearTimeout(fallback); closeCurrent(); } })` where `closeCurrent()` calls `currentViewer.closeStory({ animate: false })`. **Regression guard**: the prev-hand-off today passes `startIndex: 'last'` (`index.astro:320`) but `StoryViewer.open()` never reads it (verified at `02da2da`) — dead parameter. Task 4.2 must also add `startIndex?: number | "last"` to the options contract and `open()` must honor it (`"last"` → `stories.length - 1`), otherwise reverse hand-off opens the wrong story
- [x] 4.4 Keep the existing `e.preventDefault()` semantics and auto-advance chain intact — the last viewer's `story-viewer-end` still closes its own modal when allowed

## 5. TimelineScroll — finale seed + scrubbed reveals

- [x] 5.1 Change the expansion seed from nothing to infinitesimal: in `TimelineScroll.astro` ~line 902 change `transform: ["scale(0)", "scale(0)", "scale(1)"]` → `transform: ["scale(0.001)", "scale(0.001)", "scale(1)"]`, and the markup inline `style="transform: scale(0);"` on `#timeline-circle-expansion-fill` (~line 310) → `style="transform: scale(0.001);"`
- [x] 5.2 Convert node reveals from threshold-triggered bursts to scroll-scrubbed animations: replace the `connected` flag + `showDetails()`/`hideDetails()` burst calls inside `setupNodeAnimation`'s scroll callback with a paused `animate()` per node-part (dot, photo, date, desc) whose `time` is driven by `scroll()` around the node's connect threshold — reuse the repo's existing `scrubWithScroll` pattern but with a progress window (from `connectAt - 0.01` to `connectAt + 0.02`) so partial scroll positions map to partial reveal; keep the exact existing keyframe shapes (dot `scale(0.6) → scale(1.35) → scale(1)`, photo `translateY(18px) → 0`, date/desc `translateY(12px) scale(0.98) → … → 1` with the 80ms stagger expressed as keyframe `times`)
- [x] 5.3 Delete the now-unused time-based `showDetails`/`hideDetails` functions and the `connected`/`disconnectAt` flag logic; `setHidden()` remains as the pre-scrub initial state
- [x] 5.4 Confirm reverse behavior: scrolling backward through a node scrubs its reveal back toward hidden (dot returns toward `scale(0.6)`, photo/desc return toward `translateY + opacity 0`)

## 6. WeddingFAQ — pop + dead code

- [x] 6.1 In `openItem()` (~line 165), change the badge animation to include the pop: `animate(numberBg, { scale: [1, 1.08, 1], backgroundColor: foreground }, { duration: 0.3, ease: [0.16, 1, 0.3, 1] })` (keep the existing spring if preferred, but the scale keyframes are the requirement)
- [x] 6.2 Delete the `button.addEventListener("mouseenter", …)` and `button.addEventListener("mouseleave", …)` blocks (~lines 141–151) — they animate `numberBg` to values it already has (no-op)

## 7. QuranVerse — reduced motion

- [x] 7.1 Add a reduced-motion media block to `QuranVerse.astro` styles:
  ```css
  @media (prefers-reduced-motion: reduce) {
    :global(.word-span) {
      transform: none;
      transition: opacity 0.2s var(--ease-out-expo);
      transition-delay: 0ms !important;
    }
    .reveal-simple {
      transform: none;
      transition: opacity 0.2s var(--ease-out-expo);
      transition-delay: 0ms !important;
    }
    .animate-float,
    .animate-pulse-slow {
      animation: none;
    }
  }
  ```
  (radial glow holds its 0%/100% opacity-0.5 resting state; blur blob is stationary)

## 8. TextShimmer — phrase crossfade

- [x] 8.1 In `TextShimmer.astro`, wrap the slot text in two layers: keep `<span data-text><slot /></span>` as the visible layer and add a second `<span data-text-out aria-hidden="true"></span>` stacked behind (position absolute, inset 0, pointer-events none)
- [x] 8.2 On phrase change, run a ~150ms crossfade: incoming text is set on `data-text` starting at `opacity 0`, outgoing text is copied into `data-text-out` which animates `opacity 1 → 0` + `filter: blur(0px) → blur(2px)`; incoming animates `opacity 0 → 1`. Implement with the Web Animations API (`el.animate(...)` — no new dependency), and clear the outgoing layer on finish

## 9. Verification

- [x] 9.1 Mechanical: `pnpm --filter web check-types` passes; `pnpm --filter web build` succeeds; `tests/story-viewer.spec.ts` passes including NEW cases: (a) forward hand-off — last story of a viewer advances into the next viewer with both modals never simultaneously hidden (no black flash), (b) reverse hand-off — from viewer N, prev navigation opens viewer N-1 at its LAST story (`startIndex: 'last'` honored), (c) progress fill renders via `transform: scaleX` (assert `style.transform`, not `width`)
- [x] 9.2 Feel check — StoryViewer (DevTools Animations panel at 10%): opening a story scales+fades the panel in from `0.95/16px` with ease-out; closing finishes in 150ms and _starts fast_ (never the slow-start easeIn); spamming next/prev never restarts a slide from a blank frame; the progress bar advances smoothly with no width layout (Performance panel: no purple Layout blocks while a story plays)
- [x] 9.3 Feel check — hand-off: let the last story of a viewer auto-advance into the next viewer on a throttled network (DevTools "Slow 4G"): no black flash, the outgoing viewer stays until the incoming first slide is ready; kill the image request entirely → the 800ms fallback still closes the outgoing viewer. Also reverse hand-off on touch: press the left half of the stage from the first story of viewer N → viewer N-1 opens at its last story
- [x] 9.4 Feel check — Timeline: scrub to the very end; the closing circle grows from the end dot (no pop). Scroll back up slowly: node reveals run in reverse exactly (photo hides as you scrub back). Animations panel at 10%: dot overshoot still reads as a single motion
- [x] 9.5 Feel check — FAQ: opening an item pops the badge subtly (1.08, not a bounce); hovering an inactive item triggers no badge animation
- [x] 9.6 Reduced motion (DevTools Rendering panel → emulate `prefers-reduced-motion: reduce`): story panel opens/closes fade-only, slides cross-fade in place; QuranVerse words fade in as groups with no rising; loading phrases still rotate via crossfade (opacity-only is acceptable; the blur may remain as it is non-positional)
- [x] 9.7 Reduced-motion regression on the three set pieces: HeroZoom static hero, ZoomParallax static grid, TimelineScroll vertical story — all unchanged from the previous change
- [x] 9.8 Touch emulation (DevTools touch device): tapping a story cover produces no grow-then-stick scale on the cover image
