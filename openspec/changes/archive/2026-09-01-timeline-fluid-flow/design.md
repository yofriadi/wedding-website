# Design: timeline-fluid-flow

## Context

Current TimelineScroll geometry and choreography (the baseline every number below is derived from):

- Runway: section `1200vh`/`1200svh`, sticky stage `100vh` → scrollable distance **1100vh**.
- Track: `1100vw` wide; node x positions `50 / 150 / 275 / 379 / 488 / 597 / 706 / 815` vw; `dot-9-anchor` at `965vw`; gaps are uneven (100, 125, 104, 109, 109, 109, 109, 150).
- Pan keyframes: `0vw` held to progress `0.06`, `-915vw` at `0.72` (with a node-8 centering step `-815@0.66`), then a vertical `-83vh` pan `0.72→0.94`, hold to `1`. Horizontal pan speed = `915vw / 726vh` ≈ **1.26 vw per vh scrolled**.
- Phase scroll durations: intro circle shrink `0→0.06` = 66vh; horizontal `0.06→0.72` = 726vh; vertical finale `0.72→0.94` = 242vh; expansion `0.94→1` = 66vh.
- Connect thresholds are hand-tuned constants (`0.12, 0.20, …, 0.62, 0.94`); at those moments the connecting dot sits at viewport-x ≈ 68/84/79/78/78/64/50vw. The code numbers `line-N` as connecting dot-N → dot-(N+1), and line-N's draw completes at `connect(N+1)` (e.g. `line1Anim` completes at `0.12` = connect(2)).
- Connectors: `setElbow` (H→V→H) and `setVHV` build hard 90° paths; `pathLength="1"` + scrubbed `pathLength` keyframes draw them. Geometry is recomputed only on init/resize/settle (spec requirement; preserved).
- Reveals: window `[connectAt − 0.01, connectAt + 0.02]` — content starts fading in _before_ the line arrives. Hidden states exist in three places that must stay in sync: markup inline styles (`opacity: 0; transform: translateY(18px)` etc., the pre-JS first paint), `setHidden()` in the script, and keyframe 0 of each reveal animation. All reveals use the manual pause-and-scrub pattern (motion v13 desyncs JS-only tracks from WAAPI timeline tracks — see the code comment at `scrubWithScroll`).
- Content blocks are absolutely positioned _direct children_ of their node, anchored to the node box via `top/bottom: calc(100% + Npx)` — the node box is the dot (the only in-flow child). This matters for D5.
- The resize handler (`resizeTimeout` → `updatePaths()`) only recomputes path geometry; every `animate()` keyframe is baked once inside `initRaf`. Anything viewport-dependent that lives in keyframes therefore does **not** update on resize today.
- Node-8 is special: its content sits `left-[50vw]` (50vw right of its dot) and pops while sliding into view; legacy pans dot-8 to 0vw so the content centers at 50vw.

## Goals / Non-Goals

**Goals:** fluid connectors (two previewable variants, finale segment exempt); uniform wider gaps; reveals that start exactly on connection as a staggered scale-pop; a perceptible pin-and-release "stand still" beat on a subset of nodes; guaranteed no overlap between consecutive nodes' content; pan speed **and** every non-horizontal phase's scroll duration preserved; intro, finale, and reduced-motion story unchanged.

**Non-Goals:** choosing the default curve style (preview decides); node-8's side layout; copy/photo changes; any API/DB work.

## Decisions

### D1 — Two curve builders behind one style constant

Add two path builders next to the existing `setElbow`/`setVHV` in `updatePaths()`:

- `setSmooth(line, a, b)` — cubic S-curve: `M a.x a.y C midX a.y, midX b.y, b.x b.y` with `midX = (a.x + b.x) / 2`. Horizontal tangents at both endpoints, so the line visually flows _out of_ one dot and _into_ the next. The control-point x position is the tension knob.
- `setRounded(line, a, b, t)` — keeps the legacy H→V→H routing (same per-segment `t` bend points as today) but replaces each 90° corner with a quadratic arc. Radius `r = min(0.5 × |Δy|, 0.25 × |Δx|)` — keyed to the **vertical** leg (~90–200px) so the rounding is perceptible; a fixed ~48px radius on a ~2000px horizontal leg would read as the current sharp corner.

A module-level `CONNECTOR_STYLE: "smooth" | "rounded"` picks the builder for lines 1–7. **line-8 always uses `setVHV`** — the finale drop stays hard 90° per the request. Default is `smooth` until the preview pass picks one.

`pathLength="1"` normalization and the scrubbed draw are shape-agnostic, so line draw mechanics are untouched. Everything stays inside `updatePaths()` — still no per-scroll-frame geometry work.

### D2 — New layout geometry, with an additive runway budget

**Node layout (markup/CSS literals, updated to match):** nodes at `50, 200, 350, 500, 650, 800, 950, 1100` vw (uniform 150vw gaps); `dot-9-anchor` at `1250vw` (keeps the 150vw finale tail); track width `1400vw` (both the `w-[1100vw]` class and the inline `style="width: 1100vw"`); final pan `−1200vw` centers dot-9 at 50vw exactly as `−915vw` does today.

**Runway — additive, not fraction-preserving.** Keeping today's progress _fractions_ on a longer runway would silently stretch every non-horizontal beat (intro 66→87vh, finale pan 242→319vh, expansion 66→87vh). Instead, preserve each phase's legacy **scroll duration** and grow only the horizontal phase:

| Phase               | Legacy                    | New                                              |
| ------------------- | ------------------------- | ------------------------------------------------ |
| Intro circle shrink | 66vh (0→0.06)             | 66vh → progress `0→0.0498`                       |
| Horizontal pan      | 726vh, 915vw (1.26 vw/vh) | **952vh**, 1200vw (1.26 vw/vh) → `0.0498→0.7678` |
| Vertical finale pan | 242vh (0.72→0.94)         | 242vh → `0.7678→0.9502`                          |
| Closing expansion   | 66vh (0.94→1)             | 66vh → `0.9502→1`                                |

Scrollable = `66 + 952 + 242 + 66 = 1326vh` → **section height ≈ 1426vh** (svh + vh pair, CSS literal with this derivation recorded in a comment — the height is not computed at runtime). Horizontal cruise: `1200vw / 0.718 progress` ≈ 1671 vw per unit progress.

Pan keyframes keep today's structure with derived numbers and a **constant cruise slope**: hold to `0.0498`; `−1200vw` at `0.7678`; vertical `−83vh` `0.7678→0.9502` (JS `vUnit` detection kept); hold to `1`. Node-8's content-centering moment (`−1100vw`, ≈`0.708`) is **colinear** with the cruise — no slope kink (the legacy `−815@0.66` step is dropped; constant pan speed is a spec requirement).

### D3 — Thresholds derived from measured geometry; line rule is `connect(N+1)`

`updatePaths()` already measures every dot's center relative to the track. Derive `nodeX(N)` (in vw) from those measured points — markup/CSS stays the single source of truth, no mirrored JS position table. The pan keyframes live in one JS constant array used both for `animate()` and for the inverse mapping `panVw(progress)`.

`connect(N) = progress at which panVw = −(nodeX(N) − CONNECT_X)`, with **`CONNECT_X = 50vw`** (uniform connect position; see D5 for why 50). Worked values: `0.1396, 0.2293, 0.3190, 0.4088, 0.4985, 0.5882, 0.6779` for nodes 2–8 (uniform Δ`0.0897`). All inputs are vw-only, so thresholds are **viewport-invariant** — baking them into `animate()` keyframes at init is safe and they do not need resize recomputation (only path geometry and the D5 layout object do).

**Line draw windows (corrected indexing):** line-N connects dot-N → dot-(N+1); it completes at **`connect(N+1)`** and starts ≈ **`connect(N) + 0.02`** (a beat after the previous node's pop ends at `+0.010`). Line-1 starts at intro end (`0.0498`) and completes at `connect(2) = 0.1396`. Each dot enters the viewport before its line completes, so the line visibly chases the incoming dot.

**line-8 stays staged** (it is exempt from the line-N rule): starts ≈ `connect(8) + ε` (≈`0.683`), with its legacy staged fractions (`pathLength ≈0.22 / 0.54 / 1`) mapped across `[start, 0.7678 horizontal-end, 0.9502 vertical-end]` so the drop still draws during the vertical pan.

**Node-8 content pop** is re-timed to its centering moment (pan `−1100vw`, ≈`0.708`) — its side-staged content would otherwise pop half off-screen (at connect, the content is centered at 100vw; on mobile it would be 23vw clipped). This matches the legacy slide-in beat. **Node-9's reveal stays at vertical-end (`0.9502`)**, the legacy `0.94` equivalent.

### D4 — Pop-on-connect reveal

- Window becomes **`[connect, connect + 0.010]`** — the `−0.01` anticipation is removed. `0.010` progress ≈ **13vh of scroll ≈ 16.7vw of pan**. The shorter window (legacy equivalent was ~33vh) makes the pop genuinely pop-like _and_ keeps the pop's pan footprint (16.7vw) well inside the pin drift budget (29–30vw, D5) — otherwise the release would fire mid-pop.
- New keyframes per part: opacity `0→1` in the first ~40% of the window; scale `0.6 → 1.06 → 1` with `EASE_OUT_EXPO`. `transform-origin` points at the dot: y per placement (above-dot blocks → `bottom`, below-dot → `top`), x at the dot's horizontal position within the block (computed per node in the layout object — matters for the offset pinned layout in D5).
- Stagger preserved from today: photo leads, date +~0.002 progress, description +~0.004 (same relative order, compressed into the shorter window).
- The dot's own pop (scale `0.6→1.35→1`) is unchanged.
- **All three hidden-state sites switch to the scale shape**: markup inline styles (`opacity: 0; transform: scale(0.6)` + per-block `transform-origin`), `setHidden()`, and keyframe 0 — otherwise the first painted frame and the reveal's start frame disagree and the pop jumps at the window boundary.
- All parts still run through the pause-and-scrub mechanism — partial scroll gives partial pops, backward scroll reverses them (existing reversibility requirement preserved).

### D5 — Pin-and-release: content trails the dot, dot traverses its width

**Which nodes:** 3, 5, 7 pin; 2, 4, 6, 8 ride the track as today; node 9 (finale) never pins. Strict alternation gives rhythm without monotony; node 2 rides so the guest learns the base motion first; node 8's side layout is its own beat. Ride nodes keep today's centered-under-dot layout.

**Trailing-anchor geometry (the key to a perceptible hold):** pinned content pops positioned so its **right edge sits at the dot** — the dot leads, the card trails behind it — with a clamp keeping the left edge ≥ ~4vw on narrow screens. With center anchoring, "release when the dot reaches the content's left edge" caps the drift at `W/2` (14.6vw desktop ≈ 11.6vh — one wheel notch, imperceptible, and shorter than the pop window itself). Trailing anchoring lets the dot traverse the **full** content width:

- Desktop (1440px, W = 420px ≈ 29.2vw): content spans `[20.8, 50]vw`; the dot drifts `50 → 20.8vw` (drift = W = 29.2vw ≈ **23vh of scroll**) and the edge rule fires at 20.8vw — the user's "left edge of the image" and "around 20% viewport width" coincide by construction.
- Mobile (390px, W = 320px ≈ 82vw): right-edge anchoring would clip left, so the clamp pulls the content to span `[4, 86]vw`; the **20vw cap** fires first (drift = 30vw ≈ 24vh). Same hold feel, no clipping (legacy popped content centered at 68–84vw, which clipped on phones — this is strictly better).
- Very narrow (≤340px): the card is effectively full-bleed; accepted (legacy is worse there).

**Release rule (unchanged semantics):** release at the first of (a) the dot reaching the pinned content's left edge, or (b) the dot reaching 20% viewport width. After release the content rides the track out of the viewport.

**`contentWidth` source:** the pin wrapper is `absolute inset-0`, so its box _is_ the 20px dot box (children overflow) — measuring the wrapper would yield ~20px and kill the pin. Measure the widest content **child** (photo card `w-[320px] md:w-105`, desc `w-[320px]`) via each child's **`offsetWidth`** — NOT `getBoundingClientRect().width`, which includes transforms and would return 0.6× under the `scale(0.6)` hidden state at init (and arbitrary values for mid-reveal nodes on resize). Take the max across children.

**Mechanics (resize-safe):** each pinned node's content blocks move into a wrapper `data-nodeN-pin` with `class="absolute inset-0 will-change-transform"`; dots stay direct children (they ride the track). The wrapper's transform is computed **arithmetically in the scrub callback**, not baked into keyframes:

```
translateX(progress) = anchorOffset + clamp(panVw(connect) − panVw(progress), 0, drift)
```

(`panVw` is negative and decreasing, so `panVw(connect) − panVw(progress)` grows positive after connect — the counter-translation that cancels the track's motion. The operands must be in this order; reversed, the clamp pins the value at 0 and the pin never engages.)

`anchorOffset` (the trailing-anchor shift incl. the 4vw clamp) and `drift` live in a mutable layout object refreshed by `updatePaths()` on init/resize/settle — this is what makes "recompute on resize" real, since `animate()` keyframes baked at init cannot see new viewport sizes (D3 thresholds are viewport-invariant and stay keyframe-baked). The pin transform composes with the inner blocks' pop transforms (parent/child), so pop and pin never fight over the same property. Transform-only writes on a `will-change` layer — no per-frame layout work.

**Tuning knob (documented, needs product sign-off):** the hold length is bounded by the edge rule (drift = full content width, ≈29vw desktop) regardless of `CONNECT_X`, because the trailing anchor shifts with it. A longer hold requires switching the release rule to **cap-only** (dropping the edge rule) with a higher `CONNECT_X` (e.g. 65vw → drift = 45vw ≈ 36vh). That changes the user's edge-first rule, so it is not the default.

### D6 — No-overlap invariant (re-derived for trailing anchoring)

Fully-exited before the next pop ⟺ `drift + contentRightEdge < gap` (release drift, then the right edge travels its viewport-x to clear the left edge).

- Mobile (390px): `30 + 86 = 116vw < 150` ✓ (margin 34vw ≈ 27vh of scroll)
- Desktop: `29.2 + 50 = 79.2vw < 150` ✓ (margin ≈ 71vw of pan ≈ 56vh of scroll, converted at the 1.26 vw/vh pan speed)

Ride nodes satisfy it trivially (`CONNECT_X + W/2 < 150`). This invariant is _why_ the gaps had to grow; re-verify if card widths change.

### D7 — Reduced motion and fallbacks stay intact

- The reduced-motion CSS flattens the pin wrappers with rules **scoped to the wrappers** (`[data-node3-pin]`, `[data-node5-pin]`, `[data-node7-pin]` and their children) — it must NOT generalize the existing `#node-1 > div > div, #node-9 > div > div` rule, which carries `width`/`margin`/`text-align` overrides that would change unwrapped nodes' reduced-motion layout.
- The script still early-returns under `prefers-reduced-motion` — no curve, pop, or pin bindings are created at all.
- The `svh`-with-`vh`-fallback pattern extends to the new section height; the vertical finale pan keeps the JS `vUnit` detection.

## Risks / Trade-offs

- **Mobile pin is cap-driven** — with W≈82vw the edge rule is unreachable before the 20vw cap. The "dot reaches the content's left edge" moment is a desktop-first read; on phones the dot stops inside the card's span at release. Accepted per the user's "or around 20%".
- **The hold is ~23–24vh of scroll** — a real beat (≈2–3 wheel notches), bounded by the user's edge-first rule. A longer hold needs the D5 tuning knob (cap-only release), which changes release semantics — flagged for the user, not spec'd.
- **Two shipped curve variants** cost one preview pass; `smooth` stays the default until chosen. Both builders are ~15 lines, so the loser is cheap to delete later.
- **The runway grows to ~1426vh** but every phase's scroll density is preserved — pacing feels identical; only the horizontal phase gained room.
- **Curve/photo collisions** — at some viewport ratios an S-curve may pass near a pinned card. Verify visually at 320/390/768/1440px; nudge node vertical positions if a curve strikes a card.
- **Choreography regressions are the main risk** — mitigated by derived thresholds (D3) and scrub-callback pin math (D5), but the first implementation still needs a full slow-scrub pass, forward and backward.
