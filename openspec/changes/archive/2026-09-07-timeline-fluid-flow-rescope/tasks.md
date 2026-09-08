# Tasks: timeline-fluid-flow-rescope

## 1. Spec re-scope (documentation-only)

- [x] 1.1 In `openspec/specs/scroll-motion/spec.md`, remove the requirement "Pinned nodes stand still after connecting, then release and exit" with all five scenarios, and remove the "Rounded variant available for preview" scenario from the fluid-curves requirement. Re-scope the spacing requirement wording to the shipped geometry: 210vw story gaps, 1720vw track, 1813lvh runway (1713lvh scrollable), ≈1.12 vw/vh cruise; correct the finale-seed requirement to the literal sub-pixel circle seed (`circle(0.001px)`, not `scale(0.001)`)
- [x] 1.2 Record the walk-back decisions in this change's `design.md`: pin-and-release dropped (nodes ride; that is the wanted final behavior), rounded variant dropped (shipped single-cubic builder is the wanted look), pacing consciously shortened because the planned runway scrolled too long
- [x] 1.3 Run `openspec validate` for the change; fix any lint findings

## 2. Reduced-motion story fixes

- [x] 2.1 In `TimelineScroll.astro`'s `@media (prefers-reduced-motion: reduce)` block, reflow `#title-layer-bottom` as the story's opening heading (static, in-flow, above the first node) so the "Mula-mula" card no longer paints centered mid-story over node content
- [x] 2.2 In the same block, clear Tailwind v4's standalone `translate` property (`translate: none !important` alongside `transform: none`) so reflowed centered labels — including the nowrap finale title — are not shifted half their own width off the left edge
- [x] 2.3 Verify with the capture harness's reduced-motion audit at 390px and 1440px: intro heading in flow and on top, all photos visible, finale title visible, centered, and after node 8

## 3. Finale seed + node-9 stability

- [x] 3.1 Author `#timeline-circle-expansion` at `clip-path: circle(0.001px at 50% 50%)` (matching keyframe 0 exactly) and align the expansion keyframes' first two values to the same seed, satisfying the promoted "grows from an infinitesimal seed" requirement literally
- [x] 3.2 Replace node-9's px-resolved pan keyframes with the same vw/lvh keyframe strings the track uses (`trackTransformValues`), so a real layout resize re-resolves both identically and dot-9 stays on the expansion-circle center
- [x] 3.3 Verify: at `VERT_END` the dot-9 center is within 2px of the viewport's horizontal center at 320/390/1440; after a width change the hand-off still holds (no rebuild needed)

## 4. Image format hydration

- [x] 4.1 Change the AVIF `<source>` elements in `TimelineScroll.astro`, `StoryViewer.astro`, and `ZoomParallax.astro` from `data-src` to `data-srcset` (the hydrator in `index.astro` already copies `data-srcset` → `srcset`); confirm the guest-photo path keeps its no-AVIF guard untouched
- [x] 4.2 Verify in devtools that hydrated timeline/story/parallax pictures actually select the AVIF variant in a supporting browser

## 5. Dev first-load + capture harness

- [x] 5.1 Add `optimizeDeps: { include: ["motion"] }` to `apps/web/astro.config.mjs` so motion is pre-bundled at server start (Astro component scripts are outside Vite's initial dep scan; the mid-load discovery is the reported first-load breakage)
- [x] 5.2 Rewrite `apps/web/scripts/capture-scroll.mjs` against the live choreography: derive connect stops from the measured dots + pan table, read native scroll-driven animation state instead of canceling "frozen" WAAPI and applying a synthetic frame, target the real homepage by default (dismiss the entry gate; the bare test page had no Layout/global CSS so every probe read garbage), and assert node-9 hand-off, exclusivity, line clearance, and the reduced-motion story
- [x] 5.3 Run the harness against a fresh dev server; require zero violations at 320/375/390/1440 and the two reduced-motion audits

## 6. Verification

- [x] 6.1 `pnpm --filter web build` passes; `astro dev` cold start wires the timeline scrub on the first load (no mid-load "dependency optimized: motion", no manual reload needed)
- [x] 6.2 Animated path: intro card shows at the section top pre-JS; expansion grows from the sub-pixel seed at `EXPANSION_START` and completes by `EXPANSION_END`; scrubbing back to the top returns to the intro state
- [x] 6.3 Reduced-motion path: the vertical story reads top-to-bottom — "Mula-mula" heading first, nine nodes in order, finale title centered last
