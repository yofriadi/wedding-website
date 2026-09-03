# Proposal: timeline-fluid-flow

## Why

The timeline's connector lines are hard 90° elbows — mechanical against the soft serif/rounded aesthetic of the page. Nodes sit 100–125vw apart, so once a node's content pops it almost immediately sweeps off-screen; there is no room for a reading beat. Content starts fading in _before_ the line reaches the dot (the reveal window opens 0.01 progress early), which reads as the content anticipating the line instead of being caused by it. And every node behaves identically (pop, then ride left with the track), so the rhythm becomes monotonous.

## What Changes

- **Fluid connector curves**: lines 1–7 render as curves instead of 90° elbows. Two variants are implemented behind a single style constant so both can be previewed: `smooth` (S-curves that leave/arrive at each dot horizontally) and `rounded` (the legacy H–V–H routing with arc-rounded corners). **line-8 (dot-8 → dot-9 finale drop) stays exactly as-is** — hard 90°, VHV.
- **Wider node spacing, same pacing**: consecutive node gaps become uniform ~150vw (up from 100–125vw) so there is room for content to move while the line draws; the runway grows additively (1200vh → ~1426vh) so the horizontal pan speed _and_ every other phase's scroll duration (intro, finale pan, expansion) are preserved exactly.
- **Pop only on connection**: a node's photo/date/description stay fully hidden until the connector line reaches its dot — the reveal window starts exactly at the connect threshold, never before. The reveal becomes a _pop_ (fast fade-in + scale overshoot that settles back to 1), staggered photo → date → description, still fully scroll-scrubbed in both directions.
- **Pin-and-release ("stand still") beat**: for a designated subset of nodes, the content pops trailing its dot (right edge at the dot, clamped on narrow screens) and then holds its on-screen position while the dot travels left across the card's full width — a perceptible beat (~29–30vw of dot travel ≈ 23vh of scroll). The pin releases at the first of: (a) the dot reaching the **left edge of the pinned content**, or (b) the dot reaching **20% of viewport width** (on desktop these coincide at ~20vw by construction); the content then moves with the track and exits the viewport.
- **Rhythm variation**: only a subset of nodes pins (proposal: nodes 3, 5, 7 pin; 2, 4, 6, 8 ride as today; node 9 finale excluded), so not every node repeats the same beat.
- **No-overlap invariant**: gaps, pin duration, and exit travel are sized so a node's content has fully exited before the next node's content pops, at mobile (~390px) and desktop (~1440px) reference widths.

## Non-goals

- **Intro and finale choreography** — circle shrink, title fade, line-8's staged draw, the vertical pan to dot-9, and the closing expansion are unchanged in shape (their progress timings are re-derived from the new geometry).
- **Node 8's side layout** — content sitting ~50vw right of its dot with the slide-in stays special; it rides, it does not pin.
- **Content** — copy, photos, dates, node order, and the reduced-motion vertical story are untouched.
- **Picking the final curve style** — both variants ship behind the constant; the default is chosen after preview.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `scroll-motion`: TimelineScroll connector shape, node spacing/runway, reveal timing and style, and the new pin-and-release behavior; two existing requirements need wording updates (reveal style, runway height reference).

## Impact

- **Code**: `apps/web/src/components/TimelineScroll.astro` only — markup (pin wrapper elements), CSS (node x positions, track width, section height), and script (curve builders, derived connect thresholds, pop keyframes, pin counter-translation, re-timed line draws). No API, DB, or dependency changes.
- **Specs**: MODIFIED delta on `scroll-motion` (5 ADDED requirements, 2 MODIFIED requirements).
- **Risk**: the choreography is geometry-coupled — connect thresholds are _derived_ from measured dot positions at init (they are viewport-invariant), while the viewport-dependent pin values (drift, anchor offset) are computed arithmetically in the scrub callback from a layout object refreshed on resize, since baked keyframes cannot see resizes. On narrow viewports the 20vw cap (not the content-edge rule) is what releases the pin, because the content is wider than half the viewport. Both curve variants need a visual preview pass to pick the default.
- **Performance**: unchanged discipline — path geometry is still recomputed only on init/resize/settle, never per scroll frame; pin/pop are transform+opacity scrubs.
