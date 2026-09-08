# Design: timeline-trim-late-2025-nodes

## Context

`TimelineScroll.astro` is a pinned, scroll-scrubbed story: dots on a 1720vw track are connected by drawn SVG paths while the track pans at ≈1.12 vw per lvh scrolled, each node popping its photo/date/description as the line lands. The shipped sequence (from `timeline-fluid-flow-rescope`) has nine nodes at uniform 210vw story gaps with a compact 150vw finale jog:

```
x (vw)   50    260    470    680    890    1100   1310   1520   1670
         n1    n2     n3     n4     n5     n6     n7     n8     n9-anchor
y(lvh)   50    34     64     44     59     35     49     25     180/188
              Feb    5 Apr  28 Jun 26 Okt 1 Nov  29-30  11 Apr 10 Okt 2026
              2025   2025   2025   2025   2025   Nov 25 2026
Runway: 1813lvh = 1713 scrollable (intro 66 + horizontal 1317 + jog 104
                  + descent 150 + expansion 65 + tail 11) + 100 stage
```

The story is cut to six nodes: n5/n6/n7 (the three late-2025 beats) leave, and 28 Juni 2025 flows straight into 11 April 2026. The user chose **re-tightening** (option B) over leaving a long empty sweep (option A), and chose to leave the now-unreferenced image assets in `apps/web/public` in place.

## Goals / Non-Goals

**Goals:**

- Delete nodes 5–7 with no dangling references anywhere (markup, SVG, JS wiring, CSS, reduced-motion fallbacks, capture harness).
- dot-4 → dot-8 becomes a single fluid S-curve from the existing `setSmoothIntoNode8` builder; all other connectors unchanged in character (lines 1–4 smooth S-curves, finale orthogonal V–H–V).
- Restore uniform 210vw story gaps (n8 → 890vw) and keep the finale geometry character-for-character (150vw jog, anchor → 1040vw, same verticals).
- Retune the runway so **every phase and every reveal beat keeps its shipped absolute scroll length in lvh**; only progress fractions move.
- Sync the capture harness so all probes (exclusivity, line clearance, node-9 hand-off, reduced motion) run green on the new layout.

**Non-Goals:**

- No content/copy changes to the surviving six nodes.
- No changes to the intro shrink, theming, reveal pop choreography, or finale _shape_ (the V–H–V route, the expansion sweep, dot-9 formation).
- No deletion of `apps/web/public/{october,november,november2}.*` — explicitly retained.
- No renumbering of DOM ids: `node-8`/`dot-8`/`node-9` keep their names (only their _sequence positions_ change). This keeps the diff surgical and preserves every `data-node8-*`/`ORIGIN_Y[8]` reference.
- The parked "Node 8 side-staged content pop timing" question from `timeline-fluid-flow-rescope` stays parked (`NODE8_CONTENT_AT` remains an alias of connect(8)'s moment).

## Decisions

### D1 — Pull node 8 left to restore uniform gaps (over leaving a long sweep)

Two readings of "remove the nodes between 28 Juni and 11 April":

```
A. long sweep          B. uniform rhythm (CHOSEN)
680 ──── 840vw ──── 1520      680 ─210vw→ 890
 n4 ~~~ empty curve ~~~ n8     n4 ~~S~~ n8
```

Option A keeps node 8 at 1520vw: zero retuning, but ~57% of the horizontal cruise (840 of 1470vw) scrolls past with nothing on it, puncturing the "uniform spacing" requirement the timeline was deliberately rescaled to achieve. Option B was chosen: node 8 moves to 890vw and the dot-9 anchor to 1040vw, so the 210vw-gap invariant holds end to end and the shipped "Uniform 210vw gaps" comments stay literally true. Cost: a full runway retune, which is formulaic (D2) rather than hand-tuned.

### D2 — Retune rule: absolute phase lengths in lvh are the invariant

The existing comments encode the principle "phases keep their scroll duration; fractions are derived." Apply it once more:

| Phase          | Shipped (lvh) | New (lvh) | Note                                                                  |
| -------------- | ------------- | --------- | --------------------------------------------------------------------- |
| intro shrink   | 66            | 66        | unchanged                                                             |
| horizontal     | 1317          | **753**   | 4 gaps × (1317⁄7) ≈ 188.14 lvh/gap; pan 840vw at the same ≈1.12 vw/vh |
| finale jog     | 104           | 104       | jog still 150vw, split 55/49 as shipped                               |
| descent        | 150           | 150       | unchanged                                                             |
| expansion      | 65            | 65        | unchanged                                                             |
| tail           | 11            | 11        | unchanged                                                             |
| **scrollable** | **1713**      | **1149**  | section = **1249lvh**                                                 |

Every fraction is then `target_lvh / 1149`:

| Constant          | Old              | New            | Derivation                                       |
| ----------------- | ---------------- | -------------- | ------------------------------------------------ |
| `INTRO_END`       | 0.0386           | **0.0574**     | 66/1149                                          |
| `FINALE_TURN`     | 0.8074           | **0.7128**     | 819/1149                                         |
| `FINALE_MID`      | 0.8392           | **0.7607**     | 874/1149                                         |
| `FINALE_CORNER`   | 0.8681           | **0.8033**     | 923/1149                                         |
| `VERT_END`        | 0.956            | **0.9339**     | 1073/1149                                        |
| `EXPANSION_START` | VERT_END + 0.004 | keep `+ 0.004` | beat shrinks ~6.9→4.6lvh; still a sub-tick frame |
| `EXPANSION_END`   | 0.994            | **0.9904**     | 1138/1149                                        |

Beats keep their shipped absolute lengths, fractions re-derived:

| Beat                                   | Absolute (lvh) | Old fraction | New fraction |
| -------------------------------------- | -------------- | ------------ | ------------ |
| `REVEAL_WINDOW`                        | ≈21.6          | 0.0126       | **0.0188**   |
| `STAGGER_DATE`                         | ≈4.3           | 0.0025       | **0.0037**   |
| `STAGGER_DESC`                         | ≈8.6           | 0.005        | **0.0075**   |
| post-pop line-draw gap                 | ≈42.9          | +0.025       | **+0.0373**  |
| finale line start gap                  | ≈10.3          | +0.006       | **+0.0089**  |
| dot-9 form delay after `FINALE_CORNER` | ≈65            | +0.038       | **+0.0566**  |

Rounding at 4 decimals is 0.115lvh of scroll at this runway — well below perception; the capture harness verifies landings from live measurements rather than constants.

### D3 — Pan keyframes move; verticals don't

`PAN_END_X = -1620` → **−990** (`-(1040 − 50)`). Keyframes: `FINALE_TURN (−840, 0)`, `FINALE_MID (−915, PAN_TURN_Y)`, `FINALE_CORNER (−990, PAN_TURN_Y)`, `VERT_END (−990, PAN_END_Y)`. `CONNECT_X`, `FINALE_ELBOW_T`, `FINALE_NODE_Y`, `PAN_TURN_Y`, `PAN_END_Y` formulas all unchanged — node 8 stays at 25lvh, the anchor at 180/188lvh, so the finale's _vertical_ geometry is identical. Track width: `1720vw` → **`1090vw`** (both the Tailwind class and the inline-style duplicate), preserving the shipped 50vw of slack past the anchor.

### D4 — Renumber connectors 1–5; `connect()` becomes sequence-indexed

Five `line-*` paths: line-1 (d1→d2), line-2 (d2→d3), line-3 (d3→d4), **line-4 (d4→d8) via `setSmoothIntoNode8`**, line-5 (d8→anchor) via `setFinale`. The points array compacts to `[dot1, dot2, dot3, dot4, dot8, dot9Anchor]`, so `connect(n)` now means "connect the n-th sequence element" — `connect(5)` is the dot-8 connection (`NODE8_CONTENT_AT = connect(5)`; `setupNodeAnimation(8, connect(5), NODE8_CONTENT_AT)`). The finale draw math re-indexes to `lens[4]`, `points[4]`, `points[5]`; `line8Start = connect(5) + 0.0089`; the pop wiring drops `setupNodeAnimation(5..7)`, their `lineDraw`s, and `ORIGIN_Y` entries 5–7. This is the one place an implementer can silently break everything by forgetting that index ≠ DOM id — the task list calls it out explicitly.

Alternative considered: keep DOM order via a `[1,2,3,4,8]` lookup table inside `connect()`. Rejected — two numbering schemes in one function is worse than one clearly documented sequence index.

### D5 — Reduced-motion cleanup is selector deletion only

Removing the markup drops the three beats from the reduced-motion story automatically; the CSS edits are deleting `#node-5/6/7` top rules, the `node5/6/7-pin` entries in the reflow reset list, and the `data-node5/6/7-*` entries in the force-visible list. Nine → six nodes is the only spec-visible change on this path.

### D6 — Harness mirrors get a mechanical sync

`apps/web/scripts/capture-scroll.mjs` keeps a stated copy of the choreography constants and iterates `dot-1..8`, `line-1..8` — both loops throw on the new layout. Updates: mirrored constants + pan table (−840/−915/−990); dot list `[1,2,3,4,8]` + anchor with the same sequence-indexed `connect()`; stop list drops the node-5/6/7 pairs, node-8 stops key off `connect(5)`, and the card-centering stop becomes `progressAtPanX(-890)`; line-clearance loop runs `1..5`; the dot-9-formation stop tracks the new `+0.0566` delay. The node-part loops (`data-node{n}-*`) already tolerate missing nodes and need nothing.

## Risks / Trade-offs

- **Fraction drift between component and harness** → both derive from the same table above in one pass; harness probes measure live geometry and will fail loudly (or capture visibly wrong frames) if they disagree.
- **`connect()` index/ID confusion (D4)** → explicit variable naming and a comment at the points array; the harness's `deriveStops` mirrors the same indexing so a mismatch surfaces immediately in captures.
- **Beat fractions rounded independently could shift a stagger off its dot** → every beat fraction is computed from its absolute lvh target, and the reveal window's start remains anchored to the measured `connect()` thresholds, not to the beats.
- **`<360px` guard on the new line-4** → the 4→8 gap is the same 210vw as the shipped 7→8 gap that guard already served, so its behavior is inherited rather than new; still verified in the 320px capture pass.
- **Shorter runway = faster overall story** (564lvh removed) → intended: three beats of content are gone; per-beat pacing is unchanged, so nothing feels rushed.

## Migration Plan

Single commit; no data or API surface. Rollback is `git revert`. Verification before commit:

1. `pnpm --filter web dev`; run `node apps/web/scripts/capture-scroll.mjs` — all probes (exclusivity, line clearance, node-9 hand-off, reduced-motion) green at 320/375/390/1440.
2. Manual pass: scrub forward and backward through the whole section at desktop and mobile widths; confirm dot-4's pop, the single S-curve into dot-8, node 8's card entering formed, and the finale landing dot-9 exactly in the expansion center.
3. Reduced-motion pass: six-node vertical story, intro heading on top, finale title after node 8.

## Open Questions

None unresolved. (Parked, unchanged from `timeline-fluid-flow-rescope`: whether node 8's side-staged content should pop at centering instead of off-screen — `NODE8_CONTENT_AT` remains the alias it already was.)

## Session Addenda (2026-09-08, user-directed)

Two follow-ups surfaced by the verification pass and folded into this change by the user. They supersede the corresponding statements above.

### D7 — Renumber the surviving nodes: node-8 → node-5, node-9 → node-6

The shipped non-goal "no renumbering of DOM ids" (see D4) is reversed by explicit user direction: after verification, the surviving nodes renumber sequentially so DOM id = sequence position again. `node-8`/`dot-8`/`data-node8-*` → `node-5`/`dot-5`/`data-node5-*`; `node-9`/`dot-9`/`data-node9-*` → `node-6`/`dot-6`/`data-node6-*` (including `dot-9-anchor` → `dot-6-anchor`, `node-9-label-bottom` → `node-6-label-bottom`, `data-node9-date-bottom` → `data-node6-date-bottom`). This dissolves the D4 hazard entirely: `connect(5)` is the dot-5 connection in both readings, `setSmoothIntoNode8` becomes `setSmoothIntoNode5`, `NODE8_CONTENT_AT` becomes `NODE5_CONTENT_AT`, and the points array is simply `[dot1..dot5, dot6Anchor]`. Harness loops, `ORIGIN_Y` keys, reduced-motion selectors, and stop names all switch to plain sequence numbers.

### D8 — Drop the finale's first turn below node-5's card (elbow retune)

The verification pass caught a strict desktop line-clearance failure: line-5's first-turn horizontal leg (at `FINALE_ELBOW_T = 0.25`, y ≈ 65.75lvh) passes through node-5's (11 April 2026) popped photo/description stack. The trim preserved the finale's relative geometry exactly — the crossing is a new fact about the _content_ (the working tree's real-photo swap made node-5's card tall: portrait photo + description spanning roughly 20–70lvh), not about the trim.

Fix chosen: two levers tuned together — the video card's height cap and `FINALE_ELBOW_T` — because the cap alone was the floor on how far up the turn could move. The card's video cap tightened `75lvh−100px` → **`55lvh−96px`** (family-consistent with node-2/3's `64lvh−96px`; on tall viewports the fixed `md:h-[420px]` governs, so the card is visually unchanged there), dropping the card's floor to ≈65–69lvh across the measured pinch heights (worst: 1440×690 desktop ≈69lvh, 390×660 mobile ≈65lvh). **`FINALE_ELBOW_T = 0.30`** then puts the first turn at `25 + (188−25)×0.30 = 73.9lvh` (desktop) / `25 + (180−25)×0.30 = 71.5lvh` (mobile) — ≈5lvh under the card floor at every measured viewport height (44–57px clearance, uniform because both cap and elbow scale in lvh), with ≈26lvh of runway still below the turn. `FINALE_TURN_Y`/`PAN_TURN_Y` re-derive from the same constant (formulas unchanged), so the camera's first turn still coincides with the line's — the stroke keeps reading as the route. Walk-back history: 0.45 (≈98.4lvh — cleared but rode the bottom edge) → 0.40 (≈90.2lvh — still too deep, and the card's `75lvh` cap was what kept the floor so low) → 0.30 + cap tighten (final). Alternatives considered: repositioning node-5's card horizontally (touches art direction; the card's authored position is the story content) and accepting the desktop crossing as the mobile exception already is (weakens the strict ≥768px invariant the harness exists to enforce).

The V–H–V shape itself is untouched (spec: "remains orthogonal"), the descent phase keeps its shipped ≈150lvh (D2 invariant), and the elbow constant is shared by exactly two call sites (`setFinale` and the `FINALE_TURN_Y` derivation), both updated by the single constant change. The change's earlier non-goal "no finale shape changes" is read narrowly (route shape, not elbow height) per this addendum.

### D9 — Finale camera takes an L-route (user-directed, 2026-09-08)

The shipped camera cut the jog diagonally: between `FINALE_TURN` and `FINALE_MID` it panned right (−840→−915vw) while descending to `PAN_TURN_Y`, then finished the jog, then descended. The user asked for right first, then down. The `FINALE_MID` waypoint is deleted from `PAN_KEYFRAMES`: the camera now holds cruise depth (y=0) across the entire 150vw jog — `FINALE_TURN` (pan −840vw) → `FINALE_CORNER` (pan −990vw, anchor column centered) — and only then descends to `VERT_END`. The line keeps its authored V–H–V; camera and stroke simply no longer share the mid-jog diagonal.

Consequences:

- `FINALE_TURN_Y`/`PAN_TURN_Y` are deleted (nothing turns down mid-jog); `FINALE_ELBOW_T` now feeds only `setFinale`'s elbow math.
- Line-5's draw keyframes re-anchor from `[turn, FINALE_MID, corner, vert]` to `[turn, corner, vert]`: the horizontal leg draws at exactly the camera's pan rate through the jog (tip rides the horizontal centerline at elbow depth), then the final leg draws across the descent window, landing centered on dot-6. The tip drifts ≈24lvh up over the descent (camera covers the full 138lvh drop while the stroke finishes its last 49lvh of path) — measured in-frame at every probe point; the landing is exact (expansion centering 0px error at all widths).
- Phase boundaries and every scroll length are unchanged (`FINALE_TURN` 0.7128, `FINALE_CORNER` 0.8033, `VERT_END` 0.9339 all kept) — only the path between them moved. The descent is fully vertical now (it was already); the jog is fully horizontal (was diagonal).
- Harness: `FINALE_MID` mirror deleted, stop list renamed (`12-jog-start`, `13-jog-mid`, `14-corner`), pan table mirrored; the jog-mid probe asserts y=0lvh mid-jog by capture.
