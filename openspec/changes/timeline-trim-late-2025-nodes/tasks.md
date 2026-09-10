# Tasks: timeline-trim-late-2025-nodes

All edits are in `apps/web/src/components/TimelineScroll.astro` unless noted. Geometry values come from design.md (§D2–D3); do not invent new numbers.

## 1. Markup: remove nodes, retighten the track

- [x] 1.1 Delete the node-5 block (`<!-- Node 5 -->`, 26 Oktober 2025), node-6 block (1 November 2025), and node-7 block (29–30 November 2025) from `#timeline-track`.
- [x] 1.2 In the connector SVG, reduce the eight `line-*` paths to five: keep `line-1`–`line-4` and rename the finale `line-8` → `line-5` (delete the old `line-5/6/7` paths).
- [x] 1.3 Move node 8 from `left: 1520vw` to `left: 890vw`; move `#dot-9-anchor`, `#node-9-label-bottom`, and `#node-9`'s inner positioning div from `left: 1670vw` to `left: 1040vw`.
- [x] 1.4 Set the track width to 1090vw in both places: the `w-[1720vw]` class and the inline `style="...width: 1720vw;"`.
- [x] 1.5 Update the stale HTML/CSS-position comments only where they claim wrong facts (e.g. the runway comment block); leave the "Uniform 210vw gaps" and "150vw turn-to-turn spacing" comments — they are true again.

## 2. CSS: runway and node bookkeeping

- [x] 2.1 `.timeline-section`: `height: 1813vh/1813lvh` → `1249vh / 1249lvh`; rewrite the pinned-runway comment to the new budget (scrollable 1149lvh = intro 66 + horizontal 753 + jog 104 + descent 150 + expansion 65 + tail 11).
- [x] 2.2 Delete the `#node-5`, `#node-6`, `#node-7` `top:` rules.
- [x] 2.3 Reduced-motion block: remove the `[data-node5-pin]/[data-node6-pin]/[data-node7-pin]` entries from the reflow-reset selector list, and the `data-node5-*`/`data-node6-*`/`data-node7-*` entries from the force-visible list.

## 3. Script: rewire the choreography

- [x] 3.1 Phase constants: `INTRO_END 0.0574`, `FINALE_TURN 0.7128`, `FINALE_MID 0.7607`, `FINALE_CORNER 0.8033`, `VERT_END 0.9339`, keep `EXPANSION_START = VERT_END + 0.004`, `EXPANSION_END 0.9904`.
- [x] 3.2 Pan table: `PAN_END_X = -990` (1040vw dot centered at 50vw); keyframe x values `-840 / -915 / -990 / -990`; y values and `FINALE_*`/`PAN_*_Y` formulas unchanged.
- [x] 3.3 Beat constants: `REVEAL_WINDOW 0.0188`, `STAGGER_DATE 0.0037`, `STAGGER_DESC 0.0075`, post-pop line-draw gap `+ 0.0373` (was 0.025), finale line gap `+ 0.0089` (was + 0.006 — re-derived from its shipped ≈10.3lvh absolute per the D2 invariant), `finalDotReady = FINALE_CORNER + 0.0566` (was + 0.038).
- [x] 3.4 Remove the `node5/6/7`, `dot5/6/7`, `line6/7/8` lookups and their entries in the bail-out null check; add the `line5` lookup/check. Compact `points` to `[dot1, dot2, dot3, dot4, dot8, dot9Anchor]`.
- [x] 3.5 `lens` array: `setSmooth(line1..3)` unchanged, `line-4 = setSmoothIntoNode8(points[3], points[4])`, `line-5 = setFinale(points[4], points[5])`.
- [x] 3.6 `connect()` is now sequence-indexed (connect(5) = the dot-8 connection — index ≠ DOM id, see design D4): `NODE8_CONTENT_AT = connect(5)`; `setupNodeAnimation(2|3|4, connect(n))` unchanged; delete `setupNodeAnimation(5|6|7, …)`; `setupNodeAnimation(8, connect(5), NODE8_CONTENT_AT)`.
- [x] 3.7 Draw schedule: `lineDraw(line2, connect(2)+0.0373, connect(3))`, `lineDraw(line3, connect(3)+0.0373, connect(4))`, `lineDraw(line4, connect(4)+0.0373, connect(5))`; delete the old line5/6/7 draws.
- [x] 3.8 Finale animation targets `line5`: re-index the leg math to `points[4]`/`points[5]` and `lens[4]`; `line8Start` → `connect(5) + 0.0089`; variable names may be renamed for clarity.
- [x] 3.9 Delete `ORIGIN_Y` entries 5, 6, 7; keep 2, 3, 4, 8 as-is.

## 4. Capture harness sync (`apps/web/scripts/capture-scroll.mjs`)

- [x] 4.1 Mirror the new constants and pan table (same values as 3.1–3.2; `PAN_END_X` comment now −990).
- [x] 4.2 `deriveStops`: measure dots `[1, 2, 3, 4, 8]` plus `#dot-9-anchor`; keep the sequence-indexed `connect()`; drop the node-5/6/7 stop pairs; node-8 stops key off `connect(5)`; the card-centering stop becomes `progressAtPanX(-890)`; the dot-9-formation stop uses `FINALE_CORNER + 0.0566`. Renumber stop names so they stay ordered.
- [x] 4.3 Line-clearance probe: iterate `line-1..line-5`. (The `data-node{n}-*` selector loops tolerate missing nodes — optional tidy to `[2,3,4,8]`, not required.)

## 5. Verification

- [x] 5.1 `node apps/web/scripts/capture-scroll.mjs` passes at 320/375/390/1440: exclusivity, line clearance (strict ≥768px), node-6 hand-off, and reduced-motion probes all green; eyeball `09-*`→… stops so line-4 draws as one continuous S into dot-5 with the `<360px` guard active at 320. (Passed 2026-09-08 after the addendum fixes: 84 exclusivity + 84 line-clearance + 4 hand-off + reduced-motion, zero violations; desktop strict clearance green, mobile crossings the accepted exception, guard verified in the 320 run.)
- [x] 5.2 Manual dev pass: scrub forward and backward through the whole section (desktop ~1440 and a mobile width); confirm pops land on their dots, node 8's card enters formed, dot-9 forms below the viewport during the descent, and the expansion lands centered on dot-9.
- [x] 5.3 Reduced-motion pass: exactly six nodes in document order (Mula-mula heading, Feb 2025, Oktober 2025, November 2025, 11 Apr 2026, 10 Oct 2026), nothing clipped or overlapped.

## 6. Session addenda (user-directed, 2026-09-08)

The verification pass surfaced two follow-ups folded into this change by the user:

### 6.1 Renumber the surviving nodes (node-8 → node-5, node-9 → node-6)

The surviving DOM ids renumber sequentially so id = sequence position again. `node-8`/`dot-8`/`data-node8-*` become `node-5`/`dot-5`/`data-node5-*`; `node-9`/`dot-9`/`data-node9-*` become `node-6`/`dot-6`/`data-node6-*` (including `dot-9-anchor` → `dot-6-anchor`, `node-9-label-bottom` → `node-6-label-bottom`, `data-node9-date-bottom` → `data-node6-date-bottom`). This dissolves the design-D4 "index ≠ DOM id" hazard: `connect(5)` is the dot-5 connection in both readings, so the points array, pop wiring, harness loops, and ORIGIN_Y keys all use plain sequence numbers.

- [x] 6.1.1 `TimelineScroll.astro`: renumber ids/attrs/CSS selectors/JS vars/comments for node-8→node-5 and node-9→node-6 (markup, reduced-motion block, `points` array comment, `ORIGIN_Y`, pan-table comments).
- [x] 6.1.2 `capture-scroll.mjs`: same renumbering (stop names `09-*`/`10-*`/`11-*` → node-5 wording, dot lists `[1,2,3,4,5]` + `#dot-6-anchor`, hand-off/reduced-motion probes).
- [x] 6.1.3 Re-check no stray `node-8|node-9|dot-8|dot-9|data-node8|data-node9` references remain in the app.

### 6.2 Drop the finale's first turn below node-5's (11 April) card

The real-photo swap made node-5's card tall; the first-turn horizontal leg at `FINALE_ELBOW_T = 0.25` (y ≈ 65.75lvh) crossed the popped card at ≥768px. Two levers were tuned together so the first leg is as short as possible: the elbow constant **and the video card's height cap** (the cap is the real floor — it alone bounded how far up the turn could move). The card's video cap tightened `75lvh−100px` → **`55lvh−96px`** (matching the family style of node-2/3's `64lvh−96px`; on tall viewports the fixed `md:h-[420px]` governs so the card is unchanged there), dropping the card's floor to ≈65–69lvh across the pinch heights. **`FINALE_ELBOW_T = 0.30`** then puts the first turn at **73.9lvh desktop / 71.5lvh mobile** — ≈5lvh under the card floor at every measured viewport height (44–57px clearance; uniform because both cap and elbow scale in lvh), with ≈26lvh of runway still below the turn. `FINALE_TURN_Y`/`PAN_TURN_Y` re-derive from the same constant (formulas unchanged), so the camera's first turn coincides with the line's — the stroke still reads as the route. The finale stays a V–H–V shape (spec: "remains orthogonal"). Walk-back history: 0.45 (≈98.4lvh, cleared but rode the bottom edge) → 0.40 (≈90.2lvh, still too deep) → 0.30 + cap tighten (final).

- [x] 6.2.1 `TimelineScroll.astro`: `FINALE_ELBOW_T = 0.30` plus the video cap tightened to `55lvh−96px` (walked back from 0.45 → 0.40 per user feedback — the card cap was the real floor, so both moved together); rationale comments updated; `FINALE_TURN_Y`/`PAN_TURN_Y` derive unchanged.
- [x] 6.2.2 `capture-scroll.mjs` mirrors nothing new (no elbow constant there) but the strict line-clearance probe must go green at ≥768px.
- [x] 6.2.3 Re-run `node apps/web/scripts/capture-scroll.mjs` (all widths): all probes green.
- [x] 6.2.4 Update the change's design.md (D3 elbow note) to record the elbow retune.

### 6.3 Finale camera takes an L-route (user-directed, 2026-09-08)

The finale jog previously panned diagonally — right and down together between `FINALE_TURN` and `FINALE_MID` (−840→−915vw while descending to `PAN_TURN_Y`), then finished right, then descended. The user asked for the camera to keep panning right at cruise depth through the whole jog, then go down: the diagonal `FINALE_MID` waypoint is deleted from `PAN_KEYFRAMES`, so the camera holds y=0 from `FINALE_TURN` (pan −840vw) to `FINALE_CORNER` (pan −990vw, anchor column centered) and only then descends to `VERT_END`. The line still draws its authored V–H–V; its draw keyframes re-anchor from `[turn, FINALE_MID, corner, vert]` to `[turn, corner, vert]` (the horizontal leg now draws at exactly the camera's pan rate through the jog, tip riding the centerline at elbow depth; the final leg draws during the descent, landing centered on dot-6 — the tip drifts ≈24lvh up over the descent window, in-frame throughout). `FINALE_TURN_Y`/`PAN_TURN_Y` become obsolete (the camera no longer turns down mid-jog) and are deleted; `FINALE_MID` is removed everywhere. Phase boundaries and every scroll length are unchanged — only the path between them.

- [x] 6.3.1 `TimelineScroll.astro`: delete the `FINALE_MID` waypoint + `FINALE_TURN_Y`/`PAN_TURN_Y`, hold `y: 0` through the jog, re-anchor the line-5 draw keyframes to `[FINALE_TURN, FINALE_CORNER, VERT_END]`, update the route comment.
- [x] 6.3.2 `capture-scroll.mjs`: mirror the new pan table, delete `FINALE_MID`, restore the `12-jog-start` stop, rename `13-*` to jog-mid and `14-*` to corner.
- [x] 6.3.3 Re-run `node apps/web/scripts/capture-scroll.mjs` (all widths): all probes green; verify the track y stays 0lvh through the jog and the expansion still centers (0px error).
- [x] 6.3.4 Record the route change in design.md (D9).

### 6.4 Migrate TimelineScroll to svh (user-directed, 2026-09-08)

Mobile browser chrome expanding on reverse scrolling caused the pinned stage and runway to jump back and forth when sized with `lvh`. TimelineScroll migrated to `svh` (with `vh` fallback):

- [x] 6.4.1 `TimelineScroll.astro`: section runway `1249vh / 1249svh`, stage `100vh / 100svh`, node positions and finale anchor use `svh` with `vh` fallback; card max-heights moved to component `<style>`.

- [x] 6.4.2 `TimelineScroll.astro`: JS vertical unit detection uses `1svh`.

- [x] 6.4.3 `zoom-reveal-once.spec.ts`: fix rule walker recursion for leaf rules.

- [x] 6.4.4 Verification: `capture-scroll.mjs` and Playwright tests pass (182 passed).
