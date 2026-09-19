# Tasks: families-text-reveal

## 1. Component shell and content (SSR)

Spec: `families-section` → "Family block content", "Section placement in the homepage composition". Design: D1, D2.

- [x] 1.1 Create `apps/web/src/components/FamiliesReveal.astro` with a frontmatter `blocks` array carrying the couple's copy verbatim: block one `Keluarga` / `Bapak Ch. Fuad Ery Pribadi` / `Ibu Siti Mufrodah` / `Jl. Dr. Wahidin 49, Surakarta`; block two `Keluarga` / `Bapak Hermansyah` / `Ibu Nur Faizah` / address split into two lines `Jl. Kemanggisan Ilir No. 58a,` and `Palmerah, Jakarta Barat`. No role labels, no added names or honorifics (D2)
- [x] 1.2 In the frontmatter, split every line on whitespace into word units and number them in document order across both blocks; assert the total is 28 and emit `--n` (unit count) on the stage element. Keep the ordering as a single named function so the D5 block-major → row-major flip is one edit
- [x] 1.3 Render the markup: `<section id="families-section">` → `<div id="families-stage">` → per block a `<header>` heading, a name list, the divider element (1.6), and the address rows. Block two's address renders as two separate rows so the authored break never depends on wrapping
- [x] 1.4 Render each word as the two-tier structure: `<span class="fw" style="--s:<start>">` containing `<span class="fw-ghost" aria-hidden="true">` (absolutely positioned) and `<span class="fw-ink">` (in flow, defines layout). Astro's `{…}` expression interpolation handles escaping — do not hand-build HTML strings (D7)
- [x] 1.5 Render the divider as a real element with a ghost rule and an ink rule, not a pseudo-element, so it can carry its own `--s` (D9)
- [x] 1.6 Compose into `apps/web/src/pages/index.astro`: import and place `<FamiliesReveal />` immediately after `<HeroZoom />`, before `<QuranVerse />` (which section 6 then removes)
- [x] 1.7 Verify SSR: `curl` the homepage and confirm all 28 words appear in the response in block order, that `Palmerah, Jakarta Barat` is in its own row element, and that every ghost span carries `aria-hidden="true"` and no ink span does

## 2. Runway and pinned stage

Spec: `scroll-motion` → "FamiliesReveal runway is a pinned viewport stage", MODIFIED "Pinned stages are sized to the chrome-hidden viewport". Design: D8.

- [x] 2.1 Section runway `height: 200vh; height: 200lvh;` with the `vh`-first fallback pair; stage `height: 100vh; height: 100lvh;` plus `sticky top-0` — never `dvh`, never `svh` (this is a downward-watched pin, so it follows the HeroZoom/ZoomParallax `lvh` rule, not TimelineScroll's `svh` rule)
- [x] 2.2 Give the section `position: relative; z-index: 0` and the stage `mx-auto flex items-center` with the max-width container; **do not** add `overflow: hidden` / `overflow: clip` / `transform` to the section or any ancestor — clipping on a sticky ancestor silently kills the pin
- [x] 2.3 `contain: paint` on the stage only
- [x] 2.4 Verify in a browser: the stage is pinned for the full 100lvh of travel and its bottom edge never exposes a band of section background on a mobile-emulated viewport with the URL bar retracted

## 3. Reveal mechanism

Spec: `families-section` → "Two-tier word reveal", "Continuous reveal chain". Design: D3, D4.

- [x] 3.1 Add `@property --families-p { syntax: "<number>"; inherits: true; initial-value: 1; }` to the component's `<style>`, and declare `--families-p: 1` on the stage so the authored, pre-JS, and reduced-motion state is fully revealed
- [x] 3.2 Ink tier: `opacity: clamp(0, calc((var(--families-p) - var(--s)) * var(--n)), 1)` — multiplication only, no division inside `calc()`. Each word's `--s` is `index / 28`
- [x] 3.3 Ghost tier: `position: absolute`, `opacity: 1`, `color: var(--families-ghost)`; ink tier `color: var(--families-ink)`. Confirm the two tiers share geometry so no word shifts or reflows as it reveals
- [x] 3.4 Divider: `transform: scaleX(clamp(0, calc((var(--families-p) - var(--s)) * var(--n)), 1))` with `transform-origin: left center`; its `--s` sits at its block's names→address boundary
- [x] 3.5 Do **not** set `will-change` on the ink tier (28 layers held for the session; see the retired QuranVerse compositor-hint requirement) — measure first, only revisit if a device pass shows jank

## 4. Theme pair

Spec: `families-section` → "Device-theme ink pair". Design: D6.

- [x] 4.1 Declare the dark baseline on `#families-section`: `--families-bg: #0a0a0a`, `--families-ink: #ffffff`, `--families-ghost: color-mix(in oklab, var(--families-ink) 20%, transparent)`, `--families-rule` derived from the ink
- [x] 4.2 Add the `@media (prefers-color-scheme: light)` inversion: `--families-bg: #ffffff`, `--families-ink: #000000`, ghost at 15%
- [x] 4.3 Paint `background-color: var(--families-bg)` on the section; remove any reliance on `body`'s `bg-neutral-950`. Every painted element (heading, names, address, divider, both tiers) must resolve through these variables — grep the component for hard-coded hex/`rgb()` outside the two theme blocks and find none
- [x] 4.4 Do not use Tailwind `dark:` utilities anywhere in this component — `<html class="dark">` is decorative and `global.css` defines no `@custom-variant dark`, so class-based dark would not track the device
- [x] 4.5 Verify: with DevTools emulating light, all text is black on white including the divider; switching the emulated scheme at runtime re-colours with no reload and no script

## 5. Scroll scrub

Spec: `scroll-motion` → "FamiliesReveal scrub costs one style write per frame". Design: D3, D4, D12.

- [x] 5.1 `<script>` (non-inline, bundled): `import { scroll } from "motion";` and bind `scroll((p) => stage.style.setProperty("--families-p", String(p)), { target: section, offset: ["start start", "end end"] })` — the explicit offset is what reproduces Magic UI's `ScrollOffset.All` default; do not rely on a library default
- [x] 5.2 Return before binding when `matchMedia("(prefers-reduced-motion: reduce)").matches`
- [x] 5.3 Initialize via the `document.readyState` / `DOMContentLoaded` branch. `astro:page-load` never fires here (no `<ClientRouter />`) — documented repo trap, do not wire it
- [x] 5.4 Hold the returned cleanup in an array and re-bind only on a **width** change; ignore height-only `resize` (mobile chrome collapsing) so bindings are never rebuilt mid-scroll
- [x] 5.5 Instrument once (dev-only counter, removed before commit): confirm the callback fires at most once per animation frame, performs no `getBoundingClientRect()`, and — via an IntersectionObserver gate — performs no work at all while the section is more than one viewport away

## 6. Retire QuranVerse

Spec: `families-section` → "Verse section is retired"; `scroll-motion` delta REMOVED ×2. Design: D11.

- [x] 6.1 Remove the `QuranVerse` import and `<QuranVerse />` from `apps/web/src/pages/index.astro`; delete `apps/web/src/components/QuranVerse.astro`
- [x] 6.2 Re-grep `--ease-blur-reveal` consumers and confirm `EventTimes.astro` still uses it, so the token is kept and motion-tokens' "no dead tokens" rule holds. Then reword `apps/web/src/styles/global.css:17`'s attributing comment from QuranVerse to EventTimes, and update the cross-reference in `EventTimes.astro:25`
- [x] 6.3 Grep for any surviving reference to `#verse-container`, `.blur-reveal`, `.translation-text`, `.reference-text`, `--verse-*` in `apps/web/src` and clean up or note each hit. (`apps/web/scripts/capture-scroll.mjs` checked: its selectors are hero/timeline-scoped only, no verse reference, so the scroll captures need no edit.) The `#verse-*` variables live in the deleted component's own `<style>` and go with it — confirm nothing in `index.astro`'s `:root` belongs to the verse
- [x] 6.4 `pnpm build` and `pnpm --filter web check-types` (i.e. `astro check`) both pass with the component gone

## 7. Layout, fit, and tests

Spec: `families-section` → "Responsive block layout", "All revealed content fits the pinned stage". Design: D8.

- [x] 7.1 Blocks stack below `md` and sit in two equal side-by-side columns from `md` up; each block centre-aligned; heading visually distinct from names, names distinct from address
- [x] 7.2 Replace Magic UI's `py-20` stage padding with ~`8lvh`, and size body type as `min(2.6rem, 3.6lvh)` with a ~`0.9rem` floor; the heading and address scale from that base rather than from fixed `rem` steps
- [x] 7.3 New Playwright spec `apps/web/tests/families-reveal.spec.ts` asserting, at 320×568 and 375×667 with the scrub at `--families-p: 1`: stage content box `scrollHeight <= clientHeight`, last address row's bottom edge inside the stage's bottom edge, no horizontal overflow, and the computed body font-size reported so a regression below ~0.85rem is visible
- [x] 7.4 Same spec: pinning behaviour — at 50% of the runway the stage's top is `0`, block one is the revealed prefix and block two the unrevealed suffix; at 100% every word's opacity is `1`; scrubbing back to 50% returns the same boundary (reverse-scrub consistency)
- [x] 7.5 Same spec: accessibility — the section's accessible text contains each word exactly once (Playwright 1.62 removed `page.accessibility`; the sanctioned alternative is the DOM accessible-text walk)
- [x] 7.6 Same spec: `reducedMotion: "reduce"` context → section height is content-driven, stage computed `position` is not sticky, all ink opacities are `1`, and no scrub callback ran
- [x] 7.7 Same spec: JS disabled (`javaScriptEnabled: false`) → section renders fully revealed and readable
- [x] 7.8 Run `apps/web/scripts/capture-scroll.mjs` (families pass) and eyeball 320/375/390/1440 captures at 0/25/50/75/100% of the pinned travel for the reveal boundary, the divider, and the ghost alpha

## 8. Close-out

- [x] 8.1 `pnpm check` (oxlint + oxfmt) clean on the new/edited files
- [x] 8.2 Re-read both delta specs against the shipped component and confirm every scenario maps to a passing check or a recorded manual observation
- [ ] 8.3 Real-device pass (iOS Safari + Android Chrome): the reveal band feels right on a phone (ghost readable, ink lands by ~42.5% from the bottom), URL-bar collapse does not rescale the ramp (the `--families-y`/`--d` units are `lvh`-normalised), and the ghost is comfortably visible on an OLED
- [x] 8.4 ~~Confirm the D5 ordering call~~ — superseded by the owner-review rework (section 9): with position-driven reveal, desktop rows at the same height ink together and mobile reads top-to-bottom; the ordering question is moot
- [x] 8.5 Note in the PR: after the owner-review rework the families section is content-height flow content — the pinned variant's +100vh scroll tax never shipped; net scroll length before `ZoomParallax` is approximately unchanged

## 9. Owner-review rework (post-implementation)

The couple reviewed the first implementation against the docs demo and redirected: the copy must **travel through the viewport** (no pinned stage) with each word inking as it crosses the centre band, and the font must be the demo's actual font. Design D0 records the rework; both spec deltas were rewritten to the new mechanism.

- [x] 9.1 Load the real font: `@fontsource-variable/geist` (the docs demo's font, verified from the live page) via `Layout.astro`; `--font-sans` token updated — the old "Inter" token named a family that was never loaded anywhere, so the whole site silently fell back to system sans
- [x] 9.2 Rebuild the reveal as position-driven travel: no runway, no sticky stage, single-tier words; each word's opacity maps its own document position against one normalised `--families-y` driver (ghost ≈0.08 below ~90% viewport, full ink by ~57.5%, inked all the way up); per-word `--d` measured at init and on width-only resize — never in the scroll path
- [x] 9.3 Divider reveals by the same position rule (opacity, same `--d` mechanism) instead of the chain `scaleX`
- [x] 9.4 Reduced-motion and no-JS both keep the authored fully-inked presentation (huge authored `--families-y`, `--d` fallback 0 — verified: a `100000` fallback cancels the driver and ghosts everything, caught by the no-JS test)
- [x] 9.5 Rewrite `apps/web/tests/families-reveal.spec.ts` for the new mechanics: word-centre scroll stops (ghost below band / gradient mid-sweep / inked above / stays inked leaving / reverse un-reveals), no-sticky + content-height assertions, accessible text once, theme pair runtime recolour, one-write-per-frame + zero rect reads in the scroll path, `lvh`-only units — 10/10 passing
- [x] 9.6 Update the `capture-scroll.mjs` families pass to travel-based stops (entering ghost → mid-sweep gradient → fully inked → reverse) and re-run: 20 captures, 0 violations, eyeballed 375 mid-sweep + 1440 dark sweep
- [x] 9.7 `pnpm build` + `pnpm --filter web check-types` + oxlint/oxfmt clean after the rework
