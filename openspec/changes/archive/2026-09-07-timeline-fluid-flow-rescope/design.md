# Design: timeline-fluid-flow-rescope

## Context

The `timeline-fluid-flow` change (archived 2026-09-01) shipped a rewritten timeline choreography. A subsequent adversarial review of the uncommitted follow-up work found the promoted `scroll-motion` spec and the change's own task list describing behaviors that were consciously walked back during the final preview pass, plus a handful of genuine bugs. This change records the walk-backs in the spec and fixes the bugs. **No choreography is altered** — the timeline moves exactly as it does today; only documentation and defects are corrected.

## Goals & Non-Goals

**Goals:**

- The promoted `scroll-motion` spec describes the shipped timeline, not a walked-back plan.
- The reduced-motion story reads top-to-bottom with nothing floating mid-story or pushed off-screen.
- The finale behaves literally per the promoted "infinitesimal seed" requirement and stays visually stable across resizes.
- The dev server wires the timeline scrub on the very first load.
- The capture harness asserts the real, live invariants instead of a stale snapshot of deleted internals.

**Non-Goals:**

- Re-introducing pin-and-release or the rounded connector variant (both walked back; see Decisions).
- Changing node spacing, pan route, reveal beats, or finale timing.
- Node 8's content pop timing (parked explicitly; see Out of Scope).

## Decisions

### D1. Pin-and-release: dropped, not deferred

**Decision:** Remove the requirement entirely from the promoted spec. Nodes ride the track.

**Rationale:** The stand-still beat was walked back during the preview pass — what currently shows (content rides with the track from the pop onward) is the wanted final behavior, not a placeholder. Keeping the requirement in the spec while the tasks claim it done ([x] 5.1–5.4) leaves the spec failing every conformance check against the live site forever. A spec requirement that describes a product that does not exist and will not exist is documentation debt, not a roadmap.

**Alternatives considered:**

- _Keep the requirement, mark tasks open_ — rejected: the behavior is not coming back, so this only preserves the conformance gap the review flagged.
- _A new future change to re-add pinning_ — unnecessary until someone actually wants the beat back; the spec delta lives in git history (the archived `timeline-fluid-flow` change) if it is ever needed as a reference.

### D2. Connector style: single shipped variant

**Decision:** Spec keeps only what renders: fluid curves (the shipped elbow/route builder) on lines 1–7; line-8 stays orthogonal VHV. The "Rounded variant available for preview" scenario is removed.

**Rationale:** The two-variant constant (`CONNECTOR_STYLE: "smooth" | "rounded"`) was a preview affordance; the shipped builder is the wanted look. "Not sure, but what currently shows is what I want" — so the spec describes exactly that and stops promising a variant nobody will build.

### D3. Pacing numbers: re-scoped to the shipped geometry

**Decision:** The spacing/runway requirement is updated to the shipped numbers: 210vw story gaps, 1720vw track, 1813lvh runway (1713lvh scrollable), ≈1.12 vw/vh cruise (the verticals compressed to 3/4, the finale keeping its compact 150vw jog before the extended descent).

**Rationale:** The original plan's 150vw gaps / ≈1426vh / 1.26 were consciously replaced — the planned runway scrolled too long. The `lvh` pivot itself is untouched: it satisfies the existing "Pinned stages are sized to the chrome-hidden viewport" requirement, which this change does not touch.

**Alternatives considered:** keeping the planned numbers and opening a follow-up to "finish" them — rejected; the shipped pacing is the deliberate final state, not an incomplete one.

### D4. Reduced-motion: the story must read, not just exist

**Decision:** The reduced-motion requirement gains the concrete readability invariants that were already its intent: the intro card (`#title-layer-bottom`) reflows as the story's opening heading; the reflow reset also clears the standalone `translate` property.

**Rationale:** Two classes of defect made the promoted "readable vertical layout" requirement false in practice:

1. `#title-layer-bottom` is authored as an absolute overlay on the pinned stage; the reduced-motion reset never covered it, so "Mula-mula" painted centered mid-story (~node 5), floating over node content — a story whose opening heading appears in the middle is not "a readable vertical layout".
2. Tailwind v4 compiles `-translate-x-1/2` to the standalone `translate` CSS property. The reduced-motion reset set `transform: none !important`, which does not cancel `translate` — every centered label stayed shifted half its own width left, worst on the `whitespace-nowrap` finale title, which sat mostly off-screen at 390px. This is a spec-conformance bug against the already-promoted requirement, which is why it lands in this change rather than a future one.

### D5. Finale seed: literal sub-pixel circle

**Decision:** `#timeline-circle-expansion` is authored at `circle(0.001px at 50% 50%)`, and the expansion keyframes' first two values use the same seed.

**Rationale:** The promoted requirement says the closing circle "SHALL grow from an infinitesimal scale seed (sub-pixel, e.g. `0.001`) rather than appearing from `scale(0)`". The rewrite from `transform: scale()` to `clip-path: circle()` preserved the intent (a radius that grows continuously from effectively zero) but not the letter (`circle(0px)` instead of a sub-pixel seed). `0.001px` matches keyframe 0 exactly, keeps the authored state and keyframe 0 in agreement (no first-frame jump when `animate()` attaches), and satisfies the requirement's wording literally. The pre-JS authored state is therefore the closed seed: the topmost authored overlay is the intro card, so a user who arrives before the scrub module executes sees the intro state — the correct card — and never a finale leak.

**Alternatives considered:** authoring the expansion open as a pre-JS fallback (shows the finale title if a slow network reaches the section end before the bundle) — rejected in review: it inverts the wrongness (an early user sees the _finale_ at the section top, above the intro). The root cause of the dev first-load failure was the mid-load dependency optimization (see D6), not the authored state; fixing D6 removes the practical window where the question mattered.

### D6. Dev first-load: pre-bundle motion

**Decision:** `optimizeDeps: { include: ["motion"] }` in `apps/web/astro.config.mjs`.

**Rationale:** Astro component `<script>`s are outside Vite's initial dependency scan, so on the first dev load after a cold cache, `motion` is discovered mid-page-load: Vite re-optimizes, the in-flight import breaks, and the timeline script never runs — the reported "last node missing on first load, fine after reload" (reload hits the warm cache). Pre-bundling at server start eliminates the discovery race. Production builds are unaffected either way (Rollup resolves `motion` statically).

### D7. node-9 counter-pan: share the track's keyframe strings

**Decision:** `node9TransformAnim` animates `transform` with the same `trackTransformValues` array (vw/lvh strings) the track uses, instead of px-resolved copies (`k.x * innerWidth/100`, `k.y * vUnitPx`).

**Rationale:** The track's vw/lvh strings re-resolve when the document reflows, but the baked px values never do (and `onResize` never rebuilt them) — so after a real width change, dot-9 drifted off the expansion-circle center. Sharing the strings keeps the counter-pan exactly inverse to the track by construction, on every reflow, and deletes an init-time px-resolution pass. The `vUnit` lvh-detection the strings embed continues to honor the "Pinned stages are sized to the chrome-hidden viewport" requirement (height-only chrome-collapse resizes still no-op, since both animations re-resolve identically to unchanged geometry).

### D8. AVIF hydration: `data-srcset`, not `data-src`

**Decision:** The lazy AVIF `<source>` elements author `data-srcset`; the hydrator's existing `data-srcset → srcset` path picks them up. Applied to `TimelineScroll`, `StoryViewer`, and `ZoomParallax`.

**Rationale:** `<source>` inside `<picture>` participates in format selection via its `srcset` attribute; a `src` attribute on `<source>` is not part of the picture-selection algorithm, so setting it hydrates nothing — every supporting browser silently used the WebP `<img>` fallback. `EventTimes`/`HeroZoom`/`WelcomeGate` are unaffected (their sources are eager and already use `srcset`/`src` correctly at SSR). `StoryViewer`'s `isStaticWebp` guard (no AVIF sidecar for guest-submitted `/api/` photos) is untouched.

### D9. Capture harness: assert the live choreography

**Decision:** Rewrite `capture-scroll.mjs` to derive its stop list from the live measured dots + pan table, read the native scroll-driven animations' computed styles (no synthetic-frame shim), and assert the shipped invariants — including the two reduced-motion audits D4 adds and a node-9 hand-off probe (dot-9 within 2px of center at `VERT_END`).

**Rationale:** The old harness mirrored deleted internals — `#timeline-circle-expansion-fill`, 1200vw pans, and a frozen-WAAPI cancellation pass (hand-applying synthetic keyframe values) — so its "verified no-overlap" evidence was gathered from a frame that never renders. A harness that bails early or captures the wrong moments is worse than no harness: it launders stale claims.

### D10. Theming polarity: deliberately opposite the repo pattern, now recorded

**Decision:** Keep the timeline's inversion and record it in the promoted `scroll-motion` spec.

**Rationale:** The repo's documented pattern (`star-button`, `rsvp-section` specs) is dark values as fallback with `prefers-color-scheme: light` overrides — i.e. the page matches OS polarity. The timeline does the opposite: it authors its dark world (near-black canvas, white ink, white circle overlays) as fallback and swaps to a white canvas with black overlays under `prefers-color-scheme: dark`. Both scroll phases need each overlay to contrast its own canvas (the shrink circle reveals over the stage; the expansion circle fills over it), and the authored direction gives that in both themes; matching the page polarity instead would put the overlay fills against like-colored canvases at the swap points. The inversion shipped in the uncommitted work with no change covering it (original review #11); this change records it rather than reverts it, per maintainer confirmation.

**Alternatives considered:** rewriting the timeline to match the repo pattern (fallback dark, light overrides, overlay polarity following the canvas swap) — deferred; it would flip the visual identity of both circle moments for no functional gain.

## Risks / Trade-offs

- **Spec rewrite touches a promoted spec**: mitigated by keeping every other requirement in `scroll-motion` byte-identical; the delta is surgical (two removals, one re-scope, one wording fix, one addition inside the existing reduced-motion requirement).
- **Pre-JS slow-network window persists** (D5): on a truly slow network a user can still reach the section end before the bundle executes and see the seed state (intro card, no finale). Accepted: dev is fixed at the root (D6), production bundles are small, and the alternative (authored-open finale) inverted the wrongness at the section top.
- **`translate: none !important` on `.timeline-node *`** is deliberately broad: in reduced motion no node content should transform at all, so breadth is the safety property, not a hazard. Animated mode is untouched (the reset is media-query-scoped).

## Migration Plan

1. Ship the code fixes (2.x–5.x) with the spec delta in the same change; there is no window where the site behavior and the spec disagree.
2. Mark the tasks complete only with harness evidence (5.3, 6.x) — the same harness whose rewrite this change ships.
3. No rollout: everything is static/SSR output; nothing to migrate, no feature flag, no backfill.

## Open Questions

- Node 8's content pop timing (`NODE8_CONTENT_AT` is currently a no-op — the card pops while still ~130vw off-screen and slides in fully formed) is **parked**: whether to tie the pop to the centering moment (`progressAtPanX(-1520)`) or keep the current off-screen pop is a product-taste call deferred out of this change.
- Where a "timeline visual review" pass should record sign-off (per-width screenshots from the harness vs. a manual checklist) — deferred to the maintainer's workflow.
