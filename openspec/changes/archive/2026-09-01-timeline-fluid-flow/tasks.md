# Tasks: timeline-fluid-flow

## 1. Connector curves

- [x] 1.1 In `TimelineScroll.astro`'s `updatePaths()`, add `setSmooth(line, a, b)` (cubic S-curve: `M a C midX a.y, midX b.y, b`, horizontal tangents at both endpoints) and `setRounded(line, a, b, t)` (legacy H–V–H routing, corners replaced by quadratic arcs of radius `r = min(0.5 × |Δy|, 0.25 × |Δx|)` so the rounding is perceptible on long horizontal legs); keep `setVHV` untouched
- [x] 1.2 Add module-level `CONNECTOR_STYLE: "smooth" | "rounded"` selecting the builder for lines 1–7 (per-segment `t` bend constants still apply to `rounded`); line-8 always uses `setVHV`; default `"smooth"`
- [x] 1.3 Verify both styles: `pathLength="1"` draw scrub unchanged, tip meets the dot exactly at each connect, geometry still recomputed only on init/resize/settle (no per-scroll-frame `getBoundingClientRect`)

## 2. Spacing + runway

- [x] 2.1 Node `left` positions → 50/200/350/500/650/800/950/1100vw; `dot-9-anchor` and node-9's inner positioner → 1250vw; track width 1100vw → 1400vw (both the `w-[1100vw]` class and the inline `style` width)
- [x] 2.2 Section height 1200vh → **1426vh** (svh pair) as a CSS literal, with the additive derivation in a comment: intro 66vh + horizontal 952vh (1200vw at 1.26 vw/vh) + vertical finale 242vh + expansion 66vh = 1326vh scrollable + 100vh stage
- [x] 2.3 Re-author track + node-9 pan keyframes at a **constant cruise slope** (no node-8 slope kink): hold `0vw` to progress `0.0498`; `−1200vw` at `0.7678`; vertical `−83vh` over `0.7678→0.9502` (JS `vUnit` detection kept); hold to `1`. Keep the keyframe table as a single JS constant array reused by the D3 inverse mapping

## 3. Derived connect thresholds

- [x] 3.1 Derive `connect(N)` for nodes 2–8 at init: measure `nodeX(N)` from the dot centers already computed in `updatePaths()` (markup stays the single source of truth), then `connect(N) = progress at which panVw = −(nodeX(N) − 50vw)` using the pan keyframe table. Node-9's reveal threshold is NOT derived this way — it stays tied to the finale (vertical-end, ≈`0.9502`)
- [x] 3.2 Re-time line draws with correct indexing: line-N (dot-N → dot-N+1) reaches `pathLength=1` exactly at `connect(N+1)`, starts ≈ `connect(N) + 0.02`; line-1 starts at intro end (`0.0498`). **line-8 is exempt**: staged window starting ≈ `connect(8) + 0.005`, legacy fraction staging (`≈0.22 / 0.54 / 1`) mapped across `[start, 0.7678, 0.9502]`. Circle shrink, title fade, and node-1 reveal keep their legacy 66vh duration (progress `0→0.0498`)
- [x] 3.3 Node-8's content pop is timed to its centering moment (pan `−1100vw`, ≈`0.708`), not to `connect(8)` — its side-staged content must be on-screen when it pops. Verify by slow-scrubbing each connection that the line tip meets the dot (node-8's dot connects at ≈`0.678`, content pops at ≈`0.708`)

## 4. Pop-on-connect reveal

- [x] 4.1 Change every node's reveal window to `[connect, connect + 0.010]` — remove the `connectAt − 0.01` anticipation so nothing is visible before the line reaches the dot
- [x] 4.2 Replace fade+slide keyframes with pop keyframes on photo/date/desc: opacity `0→1` in the first ~40% of the window, scale `0.6 → 1.06 → 1` with `EASE_OUT_EXPO`; `transform-origin` toward the dot (y: above-dot blocks → `bottom`, below-dot → `top`; x: dot's horizontal position within the block, from the layout object)
- [x] 4.3 Update all three hidden-state sites to the scale shape so they agree: markup inline styles (`opacity: 0; transform: scale(0.6)` + per-block `transform-origin`, replacing the `translateY` states), `setHidden()`, and keyframe 0 of each reveal. The origin-x is a computed (non-literal) value from the layout object, so double-check all three sites agree. Verify no first-frame jump at the window boundary
- [x] 4.4 Keep the stagger order photo → date (+~0.002 progress) → desc (+~0.004); dot pop (0.6→1.35→1) unchanged; verify reversibility: scrub forward/backward through a connect — pop plays and fully reverses with no residual opacity/transform state

## 5. Pin-and-release (nodes 3, 5, 7)

- [x] 5.1 Wrap the content blocks of nodes 3, 5, 7 in a `data-nodeN-pin` wrapper with `class="absolute inset-0 will-change-transform"` (dots stay direct children; `calc(100% + Npx)` anchors keep resolving against the node box); nodes 2, 4, 6, 8, 9 unchanged
- [x] 5.2 Build the pin layout object in `updatePaths()` (refreshed on init/resize/settle): `contentWidth` = max **`offsetWidth`** over the wrapper's content **children** (the wrapper's own box is the 20px dot — never measure it; `offsetWidth` is transform-independent, so the `scale(0.6)` hidden state and mid-reveal resizes can't corrupt it); `anchorOffset` = shift putting the content's right edge at the dot, clamped so the left edge ≥ 4vw; `drift = min(contentWidth in vw, CONNECT_X − 20vw)`; plus each node's pop `originX` (dot's horizontal position within the content block) used by task 4.2
- [x] 5.3 In the scrub callback, set the wrapper's transform arithmetically (no keyframed pin): `translateX = anchorOffset + clamp(panVw(connect) − panVw(progress), 0, drift)` — note the operand order: `panVw` is negative and decreasing, so this grows positive after connect (reversed operands would clamp to 0 and the pin would never engage). Frozen during the pin, riding the track after release, reversible on backward scrub
- [x] 5.4 First extend `apps/web/scripts/capture-scroll.mjs` with progress-targeted stops (`scrollTo` at offsets derived from the section's progress fractions — it currently only does fixed 700px wheel steps), then verify the no-overlap invariant: at every node's pop moment, the previous node's content has fully exited. Reference widths: 320px, 375px, 390px, 1440px

## 6. Fallbacks + close-out

- [x] 6.1 Extend the reduced-motion CSS with rules **scoped to the pin wrappers** (`[data-node3-pin]` etc. and their children: `position: static !important; transform: none !important`) — do NOT generalize the existing `#node-1 > div > div, #node-9 > div > div` rule (its `width`/`margin`/`text-align` overrides would change unwrapped nodes). Verify the reduced-motion vertical story renders identically to today and no scrub bindings are created
- [ ] 6.2 Preview pass: screen-capture the full timeline with `CONNECTOR_STYLE = "smooth"` and `"rounded"`; pick the default with the couple (both variants stay available behind the constant)
- [ ] 6.3 Full slow-scrub pass forward and backward: curves draw smoothly, line-8 stays 90°, pops fire only at connect, pinned content holds ≥ ~23vh of scroll while the dot traverses it, releases and exits, finale (centering moment, vertical pan, expansion from dot-9) unchanged in feel and duration
- [ ] 6.4 Real-device pass (iOS Safari): svh runway behavior, pin smoothness during scroll momentum, no curve/card collisions at common viewport sizes
