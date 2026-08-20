# Proposal: fix-motion-craft-findings

## Why

A second motion-craft audit (following the merged `fix-scroll-motion-findings`) found that the three scroll set pieces are now solid, but the **interactive UI layer** still carries feel-breaking issues: a `scale(0)` finale on the timeline's emotional peak, an `easeIn` exit on the story-viewer modal (every close starts slow), story-to-story hand-off driven by blind timers, and a progress bar that animates `width` on a 50ms layout loop. The audit also surfaced accessibility gaps in the two components the previous change did not cover (StoryViewer has no reduced-motion handling at all; QuranVerse's 1.5s-per-word reveal and infinite ambient float have none), plus cohesion/dead-code hygiene items and three deliberate delight opportunities the celebratory format earns.

## What Changes

- **TimelineScroll finale** (`#timeline-circle-expansion-fill`): seed scale changes `0 → 0.001` so the closing circle grows from an infinitesimal point instead of popping from nothing at the "Menikah" reveal.
- **StoryViewer modal exit**: panel exit easing `easeIn` → the house ease-out curve `cubic-bezier(0.16, 1, 0.3, 1)`, duration `0.2s → 0.15s` (exits are faster than entrances).
- **Story hand-off orchestration**: replace the blind `setTimeout(300)` close in `index.astro` with an event-driven close driven by the next viewer's first slide being ready (`img.decode()`/`onload`), for both next and prev directions.
- **StoryViewer progress bars**: animate `transform: scaleX()` instead of `style.width`, with `transform-origin: left`, and update only the active bar per tick instead of rewriting all bars every 50ms.
- **StoryViewer slide transitions**: Motion `x` shorthand → full `transform: translateX()` keyframes (hardware-accelerated path).
- **StoryViewer reduced motion**: branch on `matchMedia("(prefers-reduced-motion: reduce)")` — keep opacity fades, drop `x` slide and panel `scale`/`y` movement.
- **StoryViewer cover hover**: gate `group-hover:scale-110` behind `@media (hover: hover) and (pointer: fine)` so touch taps don't fire a false 300ms grow.
- **QuranVerse reduced motion**: word reveal becomes fade-only (≤0.2s opacity, no `translateY(30px)`); ambient `float`/`pulse-slow` loops pause.
- **FAQ badge pop**: on open, the number badge scales `1 → 1.08 → 1` alongside the existing fill-color change (physicality for the state change).
- **Loading-screen phrase crossfade**: `TextShimmer` swaps phrases via a ~150ms blur-masked crossfade instead of a hard `textContent` cut.
- **Timeline node reveals scrub-consistent**: node content bursts become scroll-scrubbed like `line-8`, so reverse-scrolling plays the reveal in perfect reverse instead of a forward-only burst.
- **Motion tokens**: introduce `--ease-out-expo` (and duration companions) so `cubic-bezier(0.16, 1, 0.3, 1)` stops being hand-typed 8× across files; TimelineScroll/StoryViewer adopt the token.
- **Dead hover code**: delete the no-op `mouseenter`/`mouseleave` handlers in `WeddingFAQ.astro` (they animate to values the element already has).

## Capabilities

### New Capabilities

- `interaction-motion`: Behavioral requirements for the interactive UI motion layer — story viewer (modal, slides, progress), FAQ accordion, loading screen — covering easing/duration contracts, physicality (no `scale(0)`), interruptibility, composite-only properties, hover gating, and reduced-motion behavior.
- `motion-tokens`: Requirements for shared motion tokens (easing/duration) as the single source of motion timing values across components.

### Modified Capabilities

- `scroll-motion`: The timeline finale's `scale(0)` seed and the scrub-consistent node reveals change two requirements of the merged scroll-motion spec (physicality of the closing circle; reveal driver). Also adds a reduced-motion requirement for QuranVerse's word reveal, which lives in the scroll/reveal family.

## Impact

- **Code**: `src/components/StoryViewer.astro`, `src/components/TimelineScroll.astro`, `src/components/WeddingFAQ.astro`, `src/components/QuranVerse.astro`, `src/components/TextShimmer.astro`, `src/pages/index.astro`, `src/styles/global.css`.
- **Dependencies**: none added; continues on `motion` v13 (`animate`, `scroll`, `spring`) and platform APIs (`matchMedia`, `img.decode`).
- **Risk**: the StoryViewer changes touch the Playwright-covered flows (`tests/story-viewer.spec.ts`); the hand-off rework must preserve the auto-advance and keyboard behaviors. All non-reduced-motion visuals otherwise stay pixel-parity except where explicitly listed (finale seed, badge pop, phrase crossfade, exit timing).
