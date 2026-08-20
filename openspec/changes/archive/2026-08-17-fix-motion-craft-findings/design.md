# Design: fix-motion-craft-findings

Commit at authoring time: `02da2da`

## Context

Audit of the full motion surface (recon of every component with `transition`/`animation`/`animate()`/`scroll()`), vetted against the eight-category motion-craft playbook (purpose & frequency, easing & duration, physicality & origin, interruptibility, performance, accessibility, cohesion & tokens, missed opportunities). The previous change (`fix-scroll-motion-findings`) already hardened the three scroll set pieces; every remaining finding is in the interactive UI layer or is a deliberate delight opportunity. This design covers **why each target value is what it is**; tasks.md carries the file/line edits.

House conventions observed in the repo (must be extended, not replaced):

- The de-facto house ease-out curve is `cubic-bezier(0.16, 1, 0.3, 1)`, currently hand-typed 8× (TimelineScroll ×5, StoryViewer ×1, plus inline `[0.16, 1, 0.3, 1]` arrays in the same two files). A sibling curve `cubic-bezier(0.33, 1, 0.68, 1)` exists in HeroZoom's scroll-timeline CSS.
- Springs, where used (WeddingFAQ): `stiffness 300–400, damping 20–30`.
- Press feedback `active:scale-[0.96]` + `transition-[transform,colors] duration-200` is already on every button.
- Tailwind v4: theme tokens live in the `@theme` block in `src/styles/global.css`.

## Goals / Non-Goals

Goals: fix the four HIGH findings, the four MEDIUM/LOW findings, the three delight opportunities, and land the token consolidation — all without re-timing any sequence that already feels right.

Non-goals: re-timing the scroll set pieces (HeroZoom/ZoomParallax/TimelineScroll scrub keyframes stay untouched except the finale seed); touching WishMarquee (dormant — commented out of the page); any RSVP/upload functionality; any dependency changes.

## Decisions

### D1 — Finale seed: `scale(0.001)`, not `scale(0)`

Nothing in the real world appears from nothing. The expansion layer (`#timeline-circle-expansion-fill`) is a `200vmax` circle centered at screen center; at `0.001` it is sub-pixel and invisible, so the change costs nothing visually but guarantees the circle _grows_ rather than pops. This mirrors the intro circle's own language, which seeds at an 8px-radius clip before shrinking — the finale simply extends it. `scale(0)` → `scale(0.001)` in the keyframes array only; the inline `style="transform: scale(0)"` in markup should become `scale(0.001)` too for consistency (pre-init flash safety).

### D2 — Exit easing: house curve, faster

Modal/panel exits must ease-out (they confirm an action the user already took — the response should be instant). Entry already uses `ease: [0.16, 1, 0.3, 1]` at `0.3s`; the exit adopts the same curve at `0.15s` — exits faster than entrances, same family, no new curve invented. The backdrop `opacity` exit stays `0.2s` (fades don't need retiming).

### D3 — Hand-off: event-driven, timer-free

Today `index.astro` opens the next viewer then closes the current one on a blind 300ms timer. If the next viewer's first image is slow to decode, the old viewer is already closing while the new one is still blank → black flash. Redesign: the orchestrator passes a callback (or listens for a DOM event) so the _next viewer_ closes the _current_ one when its first slide is actually ready (image `onload`/`decode()` resolution), falling back to a timeout (800ms) only as a safety net. This keeps the crossfade interruptible and honest. The close call itself reuses the existing `closeStory({ animate: false })` path so the visual result is unchanged when things go well.

### D4 — Progress bar: `scaleX`, active-bar-only writes

`setProgress` currently writes `style.width` on **all** bars every 50ms — a layout-triggering write on the hottest loop in the UI. Replace with `transform: scaleX(value/100)` + `transform-origin: left` (composite-only), and split responsibilities: past bars → `scaleX(1)`, future bars → `scaleX(0)` are written **only when the active index changes** (not per tick); the active bar alone is written per tick. `100%` width stays as the base (scale is relative to it).

### D5 — `x` shorthand → full transform

Motion's independent-value shorthands (`x`, `y`, `scale`) run on the main thread; full `transform` strings ride the accelerated path. The slide in/out at `StoryViewer.astro:411/416` becomes `transform: ["translateX(100%)", "translateX(0%)"]` keyframe pairs. Modal open keeps `scale`/`y` composing into one `transform` string (`translateY(16px) scale(0.95)` → `none`) so a single accelerated transform drives the panel.

### D6 — Reduced motion in StoryViewer: fade-only

Keep opacity feedback (comprehension aid), drop movement: modal backdrop fades, panel fades without `scale`/`y`, slides cross-fade without `translateX`. This matches the "fewer and gentler, not zero" principle and the repo's existing pattern of reduced-motion branches gating whole sequences.

### D7 — Hover gating for the story cover

`group-hover:scale-110` on touch devices fires on first tap as a false hover (the grow then sticks). Gate via `@media (hover: hover) and (pointer: fine)` in the component's scoped `<style>` block, replacing the utility classes for the scale-only part; color/other transitions on the cover stay utility-based.

### D8 — QuranVerse reduced motion: fade-only words, paused ambience

Words fade in over ≤0.2s (opacity only), no `translateY(30px)` and no per-word delay staggering (all words of a group appear together). The `float`/`pulse-slow` ambient loops get `animation-play-state: paused` … in practice simplest is `animation: none` with the static appearance preserved (radial glow at its 0%/100% opacity 0.5 state, blur blob stationary).

### D9 — Badge pop on FAQ open

The number badge fill flips color on open; adding `scale: [1, 1.08, 1]` on the same `animate()` (house ease-out curve, ~0.3s) gives the state change physicality. Subtle by design: 1.08 is a pop, not a bounce; reserve bounce for playful moments.

### D10 — TextShimmer phrase crossfade (~150ms, blur-masked)

The loading screen is the first thing guests see; a hard text cut every 2s reads as a glitch. The custom element keeps two stacked `<span>` layers; on phrase change the outgoing text fades/blurs out while the incoming fades in (~150ms total). `filter: blur(2px)` only during the transition — cheap and Safari-safe (well under the 20px budget).

### D11 — Scrub-consistent node reveals

Node content currently bursts via time-based `animate()` on a scroll threshold — fine forward, wrong in reverse (scrolling back re-plays a forward burst). Convert `showDetails`/`hideDetails` to a scrubbed animation attached to the same section timeline as `line-8` (progress-mapped keyframes around each node's connect threshold), so reversing scroll scrubs the reveal in reverse. Keep the existing timing _shape_ (dot overshoot `scale 0.6 → 1.35 → 1`, photo/desc `translateY` reveals, 80ms stagger baked into keyframe `times`).

### D12 — Tokens

Add to `@theme` in `global.css`:

```css
--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
--ease-in-out-strong: cubic-bezier(0.77, 0, 0.175, 1);
```

CSS-side usages reference `var(--ease-out-expo)`. JS-side `animate()` calls keep the numeric array (Motion takes arrays, not CSS var strings) but reference a shared exported constant `EASE_OUT_EXPO = [0.16, 1, 0.3, 1]` defined once per script (TimelineScroll/StoryViewer) — document in the spec that the CSS token and JS constant are the same value by contract.

### D13 — Delete dead hover code

The FAQ `mouseenter`/`mouseleave` handlers animate `numberBg` to `scale: 1, backgroundColor: badgeBase` — the values it already has (no hover feedback was ever shipped). Deleting is safer than "fixing" (adding hover feedback would be a design decision); the pop (D9) carries the feedback instead.

## Risks / Trade-offs

- **Playwright coverage**: existing `tests/story-viewer.spec.ts` covers only basic open/next. New coverage is required in group 9: forward hand-off (last story of viewer N advances to viewer N+1 with no black flash under throttled network), reverse hand-off (`startIndex: 'last'` honored — previously a dead parameter), progress fill via `transform: scaleX`, and (optional, lowest priority) the loading-phrase crossfade.
- **Scrub-consistent reveals (D11)** is the largest change: it rewrites the reveal driver for 8 nodes. Mitigation: same keyframe shape, same thresholds, verified by reverse-scroll feel-check in slow motion.
- **Blur crossfade (D10)** adds a transient `filter` — bounded at 2px/150ms, removed at rest.
- **Worktree drift (found in adversarial review, 2026-08-17)**: the working tree carries uncommitted changes to `TimelineScroll.astro` (~287 lines), `ZoomParallax.astro`, and `HeroZoom.astro` on top of the `02da2da` stamp — including the `scrubWithScroll` paused-`anim.time`/callback-`scroll()` machinery this change's task 5.2 assumes. All file:line references in tasks are against `02da2da`. **Executors must rebase/re-verify line numbers and the existence of quoted code before editing** (the plan's standing drift rule), and the commit stamp must be refreshed if the dirty tree lands first.

## Migration Plan

Single PR, ordered so each step is independently verifiable: tokens → StoryViewer batch → index.astro hand-off → TimelineScroll (seed + scrub reveals) → WeddingFAQ → QuranVerse → TextShimmer. Each group has its own verification section in tasks.md; nothing ships half-applied because each component's edits are self-contained.
