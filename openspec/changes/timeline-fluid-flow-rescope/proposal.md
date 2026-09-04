# Proposal: timeline-fluid-flow-rescope

## Why

The `timeline-fluid-flow` change shipped with several behaviors that the final preview pass walked back or reshaped, but the promoted `scroll-motion` spec and the change's own tasks still describe the walked-back plan. The review pass flagged four conformance gaps between what the spec/tasks claim and what the timeline now does. This change re-scopes the documentation to the shipped choreography — no behavior changes, only spec, task, and wording corrections plus three small bug fixes surfaced by the review.

## What Changes

- **Pin-and-release removed from the spec.** The stand-still beat was walked back: nodes ride the track today and that is the intended final behavior. The promoted requirement "Pinned nodes stand still after connecting, then release and exit" (and its five scenarios) no longer describes the product. It is re-scoped out: the requirement is dropped and replaced by the shipped "content rides with the track" behavior under the existing spacing/no-overlap requirements. Task 5.1–5.4 checkboxes in the archived `timeline-fluid-flow` tasks are historical record and stay as-is; the promoted spec is the conformance source.
- **Connector style is fixed to `smooth`; the `rounded` variant is dropped.** The shipped default (`setSmooth` — one cubic Bézier S-curve per connector, horizontal tangents at each dot) is what the site shows and what is wanted. The "Rounded variant available for preview" scenario is removed; the spec keeps only what renders: fluid curves on lines 1–7, line-8 stays orthogonal VHV.
- **Pacing numbers re-scoped to the shipped geometry.** The 150vw gaps / ≈1426vh runway / 1.26 vw-per-vh cruise of the original plan were replaced during implementation by 210vw story gaps, a 1720vw track, a 1813lvh runway (1713lvh scrollable), and a ≈1.12 vw/vh cruise with a compressed finale. The spec's requirement wording is updated to the shipped numbers so the spec describes the actual section rather than a plan that was consciously shortened because the original runway scrolled too long.
- **Timeline theming is recorded (scope admission).** The timeline's color-scheme theming shipped in the uncommitted work with no change covering it. It is now recorded: the timeline deliberately inverts the repo's documented theming pattern (which uses dark values as fallback with `prefers-color-scheme: light` overrides — see `star-button`, `rsvp-section`). The timeline authors its dark world (near-black canvas, white ink/circle overlays) as fallback and swaps to a white canvas with black overlays under `prefers-color-scheme: dark` — i.e. the section always renders the opposite of the page's OS polarity, because each scroll phase's canvas contrasts its own overlays rather than matching the page. This inversion is a deliberate product decision (confirmed with the maintainer in review) and is now captured as a `scroll-motion` spec requirement alongside the rationale.
- **Reduced-motion story fixes (correctness):**
  - `#title-layer-bottom` (the "Mula-mula" intro card) reflows as the story's opening heading instead of painting centered mid-story over node content (it was authored as an absolute overlay on the pinned stage and was never part of the reflow reset).
  - The reflow reset now also clears Tailwind v4's standalone `translate` property (which `transform: none` cannot cancel), fixing every centered label — worst case the nowrap finale title — being shifted half its own width off the left edge.
- **Finale seed + pre-JS state (correctness):** the closing expansion overlay is authored at a sub-pixel seed (`circle(0.001px)`), matching keyframe 0 exactly and satisfying the promoted "grows from an infinitesimal seed" requirement literally; the pre-JS state therefore shows the intro card (the topmost authored overlay), never a finale leak.
- **node-9 resize desync (correctness):** node-9's counter-pan now reuses the same vw/lvh keyframe strings as the track instead of px-resolved copies, so a real layout resize re-resolves both identically and dot-9 stays pinned to the expansion-circle center.
- **AVIF sources are hydrated via `data-srcset` (correctness):** `<source>` inside `<picture>` selects via `srcset`, never `src`; the lazy-progressive hydration was setting `source.src`, which browsers ignore, so the AVIF variants were inert. `TimelineScroll`, `StoryViewer`, and `ZoomParallax` now author `data-srcset` on their `<source>` elements and the hydrator's existing `data-srcset` path handles them.
- **Capture harness rewritten to the live choreography (tooling):** `scripts/capture-scroll.mjs` no longer mirrors deleted internals (`#timeline-circle-expansion-fill`, 1200vw pans, frozen-WAAPI cancellation with a hand-built synthetic frame). It derives connect stops from the live measured dots, reads the native scroll-driven animations' computed styles, and asserts the shipped invariants: exclusivity, line clearance, the node-9 hand-off, and the reduced-motion story (intro heading in flow on top, finale title visible/centered/after node 8).
- **Dev-server first-load fix (tooling):** `optimizeDeps.include: ["motion"]` in `apps/web/astro.config.mjs` pre-bundles motion at server start. Astro component scripts are outside Vite's initial dep scan, so without this the first dev load discovered motion mid-page-load, re-optimized (a cold-cache race), and left the timeline unwired until a manual reload — the reported "last node missing on first load, shows after reload".

## Ride-alongs acknowledged (not part of this change, present in the working tree)

The working diff contains three ride-alongs that belong to other workstreams and are intentionally untouched by this change:

- `package.json` / `pnpm-lock.yaml`: `packageManager` pnpm 11.21.0 → 11.24.0 (tooling self-update, unrelated to the timeline).
- `.gitignore`: the new `/var/` line covers the guest-submissions D4 photo-storage dev fallback (`./var/photos`), a different change.

## Non-goals

- **No choreography changes.** The timeline's pan route, node spacing, reveal beats, and finale timing are exactly as shipped; only their documentation is corrected.
- **The archived `timeline-fluid-flow` change directory** is a historical record and is not edited.
- **Node 8's content pop timing** (`NODE8_CONTENT_AT` currently a no-op that pops the card while off-screen) is explicitly parked for a future decision; this change does not alter it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `scroll-motion`: drop the pin-and-release requirement and the rounded-variant scenario; re-scope the spacing/runway requirement to the shipped 210vw/1813lvh geometry; correct the finale-seed wording to the literal sub-pixel circle seed; add the reduced-motion intro-card reflow and `translate` reset to the existing reduced-motion requirement.

## Impact

- **Code**: `apps/web/src/components/TimelineScroll.astro` (reduced-motion CSS, finale seed, node-9 keyframes), `apps/web/src/components/StoryViewer.astro` + `apps/web/src/components/ZoomParallax.astro` (`data-srcset`), `apps/web/astro.config.mjs` (optimizeDeps), `apps/web/scripts/capture-scroll.mjs` (rewrite).
- **Specs**: MODIFIED delta on `scroll-motion`.
- **Risk**: low — every behavior change is a fix toward an already-promoted invariant (reduced-motion readability, finale visibility, resize stability, image format selection); the rescope itself is documentation-only.
- **Performance**: unchanged; the `translate: none` reset is reduced-motion-only and the node-9 change removes a px-resolution pass at init.
