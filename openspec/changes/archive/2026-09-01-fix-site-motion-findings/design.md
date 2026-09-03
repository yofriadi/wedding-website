# Design: fix-site-motion-findings

Third audit pass. The previous two covered the scroll set pieces and the story viewer/loading layer; this one covers everything else. Decisions below are grouped by surface; each names the finding it resolves (F1–F13, A1–A3 from the audit table).

## D1 — TimelineScroll reduced-motion: repair in CSS only (F1)

The reduced-motion story reflows nodes into a vertical layout via `!important` rules inside the existing `@media (prefers-reduced-motion: reduce)` block. Three pieces of content are invisible there because only the animated JS path ever reveals them (and the script early-returns under reduced motion):

- `#title-layer-bottom` ("Mula-mula") sits in the `display: none !important` group meant for the connector SVG and circle layers.
- `#node-1` carries inline `visibility: hidden` (line 48); the scrub's `node1.style.visibility = …` is the only clearer. The existing `#node-1 { opacity: 1 !important }` rule is dead — opacity was never the hiding property.
- `#dot-9` carries inline `opacity: 0` (line 368); only the finale keyframes clear it. Its label (`data-node9-date-bottom`) is already force-revealed, so the reduced-motion finale currently shows text with no dot.

**Decision**: three edits inside the existing media block — remove `#title-layer-bottom` from the display-none group; extend `#node-1` with `visibility: visible !important`; add `#dot-9 { opacity: 1 !important; transform: none !important }`. The animated path is untouched (inline hidden states still govern it). **`#dot-9-anchor` stays hidden on both paths** — it is a measurement point for the finale pan, never meant to paint; the force-visible edit targets `#dot-9` only.

## D2 — AddStoryFlow modal: mirror the StoryViewer contract (F2)

The flow's root flips Tailwind `opacity-0`/`pointer-events-none` classes with no transition — the only teleporting modal in the product. **Decision**: animate via `motion`'s `animate()` in `add-story-flow.ts`, copying the StoryViewer value contract verbatim (`StoryViewer.astro:624-641, 684-700`): root fade 150ms in / 120ms out; panel `translateY(16px) scale(0.95) → identity` over 200ms, exit `→ translateY(12px) scale(0.95)` over 120ms, ease `[0.16, 1, 0.3, 1]`; reduced-motion fade-only. The Tailwind classes remain the SSR/rest state; `openFlow` removes only `pointer-events-none` and lets `animate()` drive inline opacity; `closeFlow`'s class restore happens in the fade's `.finished.then(onComplete)`, which also strips inline styles so the class rules govern again. `els.panel` (`[data-flow-panel]`) already exists — no markup change.

## D3 — Runtime-tile styles go `:global` (F3)

Astro-scoped styles can't match DOM-API-built nodes (no `data-astro-cid-*` attribute). Three leaks on guest tiles: `.animate-fade-up` (scoped in `index.astro`), `.android-spinner` + `rotate`/`dash` keyframes (scoped in `StoryViewer.astro`), `.zoom-cover` transition + hover rule (scoped in `StoryViewer.astro`). **Decision**: convert exactly those rules to `:global(...)`, keeping every declaration value byte-identical. Precedent already in-repo: `AddStoryFlow.astro:185-191` (`:global(#add-story-flow [data-photo-list] li)` for the same reason) and `WishMarquee.astro`'s `is:global` block. Runtime tiles intentionally carry **no** stagger delay — they arrive after load, where a delayed entrance would feel broken.

## D4 — Gate gesture: iOS drawer curve, durations unchanged (F4)

The gate's commit (400ms) and snap-back (250ms) use bare `ease-out` — too weak for a full-viewport physical surface. **Decision**: one script-local constant `GATE_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'` (the iOS-like drawer curve) used by all three transition assignments. Not a `global.css` token: the gate script is `is:inline` ES5 and the curve has exactly one consumer; a CSS-var bridge is overkill. Velocity-blind snap-back is accepted (fixed 250ms) — tuning that is a follow-up, not this change.

## D5 — FAQ reduced motion: branch, don't delete (F5)

The accordion's springs/height travel run unconditionally. **Decision**: one module-scope `reducedMotion` flag (StoryViewer precedent) branching `openItem`/`closeItem`: content opacity-fades 150ms with height snapped `auto`/`0px`; badge color tweens without the pop; icon/underline state applied via direct `style.transform` (state, not motion). Color tweens (title/number/icon ink) run in both modes — they carry state, not movement. Default path is byte-identical.

## D6 — Marquee: pause for content, never for texture (F6, F11)

The band is pointer-interaction-free by design (demo state has `pointer-events: none`), so WCAG 2.2.2's pause requirement does not strictly bind — but `data-state="real"` raises wishes to readable content at 0.9 opacity with no way to stop them. **Decision**: `animation-play-state: paused` on `.marquee-root[data-state="real"]:hover/:focus-within .marquee-content` only — demo texture never pauses (nothing to read), and pausing must not become a new affordance surface. Also: 300ms `ease` opacity transition on the band's state flip (instant under reduced motion), and `rebuild()` captures each row's live computed `transform` X so rebuilt rows resume from their pixel offset (`delay = -(offset/width × duration)`) instead of jumping to the fixed phase offsets. First build keeps the staggered phases.

## D7 — Leaflet: gate the vendor's motion too (F6b, F9)

The component gates its own `setView`/`fitBounds` calls, but Leaflet's zoom animation is a library-toggled CSS class (`leaflet.css:168`, `transition: transform 0.25s`) with zero reduced-motion handling. **Decision**: `zoomAnimation: !prefersReducedMotion()` at map construction (a real Leaflet option — if the local 2.0-alpha typings reject it, STOP and report rather than cast), plus a belt-and-braces `.venue-map .leaflet-zoom-anim .leaflet-zoom-animated { transition: none }` override inside the component's existing reduced-motion block. Never edit `node_modules`. Separately, the chip/zoom-control hover _lifts_ move behind `@media (hover: hover) and (pointer: fine)` (StoryViewer:249 precedent) — color-only hovers stay ungated (a tap flash is normal button feedback), and zoom controls join the reduced-motion `transition: none` list.

## D8 — First-slide fade, opacity-only (F7)

Slide elements start `opacity-0` and the load handler removes the class with no transition defined — a hard cut over the spinner, worst on slow networks. **Decision**: `animate(img, { opacity: [0, 1] }, { duration: 0.15 })` alongside the class removal. No reduced-motion branch: opacity fade IS the reduced-motion-safe form (same pattern as `showSpinner`).

## D9 — Press feedback: one contract everywhere (F8, F10)

The flow's "Choose photos"/Cancel/Share controls apply `active:scale-*` but transition only colors/opacity — the transform snaps. StarButton (the site's only CTA) has no press feedback at all. **Decision**: apply the house contract — `scale(0.97–0.98)` with a 160ms ease-out transform transition — to all four. Flow controls use Tailwind `transition-[colors,transform] duration-160 ease-out` (fallback: paired `transition-colors transition-transform`); StarButton gets plain CSS `transition: transform 160ms ease-out` + `.star-btn:active { transform: scale(0.97) }`, with `transition: none` added to its existing reduced-motion block. Plain `ease-out` (not a token curve) matches what Tailwind's utilities compile to on every other button.

## D10 — will-change is a reveal-scoped hint (F12)

QuranVerse's ~30 word spans hold compositor layers for the whole session. **Decision**: `will-change: auto` in the existing terminal rule (`.in-view .blur-reveal`). The reveal is one-shot (observer unobserves); the hint does its job during the transition and releases when `.in-view` lands. No JS — a `transitionend` listener per span is 30 listeners for zero practical gain.

## D11 — Name the curves; delete the dead token (F13)

Four deliberate curves live hand-typed outside the token set; `--ease-in-out-strong` has zero consumers; number-ticker's JS twin is named `EASE_OUT` while the other three are `EASE_OUT_EXPO`. **Decision**: add `--ease-out-strong (0.23,1,0.32,1)` (VenueMap controls), `--ease-out-standard (0,0,0.2,1)` (map ping), `--ease-out-zoom (0.33,1,0.68,1)` (HeroZoom), `--ease-blur-reveal (0.25,0.1,0.25,1)` (QuranVerse) to `@theme` with owning comments; delete `--ease-in-out-strong` (re-grep first; if a consumer appeared, keep and note); point consumers at the vars; rename the ticker constant. **Zero cubic-bezier value changes** — this is naming, not retiming. The gate's `GATE_EASE` (D4) stays local.

## D12 — RSVP confirm: crossfade + settle-pop (A1)

The conversion moment currently cuts the label. **Decision**: on success — exit old label (150ms, `translateY(0→-6px)` fade), swap text, enter (200ms expo, `translateY(6px→0)`), plus one `scale [1, 1.04, 1]` 300ms settle-pop on the pill (gentler than the FAQ badge's 1.08 — a settle, not a bounce). `confirmed` is set and `aria-disabled` applied BEFORE the animation so no double-submit window opens; `disabled = true` lands after. Reduced motion: the instant swap, unchanged. The WAAPI pop composes safely with D9's new CSS transform transition (WAAPI inline transforms win).

## D13 — Route draw-in, origin→venue (A2)

Polylines pop fully formed. **Decision**: WAAPI `strokeDashoffset len → 0` over 500ms on each rendered path (`Polyline.getElement()` → `SVGPathElement`), easing = the component's own `cubic-bezier(0.23, 1, 0.32, 1)`. Coordinates already run origin→venue (OSRM geometry), so the natural stroke start IS the origin pin. Cleanup in `.finished.then` restores the dash state so the airport connector's `dashArray: "8,8"` survives — executor must verify in DevTools whether Leaflet writes its dash via inline style (save/restore) or attribute (clear override) and pick accordingly; this is the one deliberately inspection-dependent step. Reduced motion: complete paths, no draw. Interrupted draws are safe — unselect/reselect removes layers through the existing `removeRouteLines`.

## D14 — Map placeholder crossfade (A3)

Mount hides the placeholder in the same frame the map appears. **Decision**: `[data-venue-map-placeholder]` gets `transition: opacity 250ms ease`; `initVenueMap()` adds `.is-unmounting` (opacity→0) and fades the container in via WAAPI, then `hidden` after 260ms. Fallback path (`showVenueMapFallback`) and reduced motion stay instant. The placeholder-hidden assertion in `venue-map.spec.ts` may need to wait for the class with a timeout — noted in tasks.

## Explicitly out of scope

- Welcome-gate velocity-weighted snap-back timing (D4 notes it as follow-up).
- FAQ `height: "auto"` layout animation for default users (accepted pragmatic accordion choice; the reduced-motion branch sidesteps it).
- Tile→viewer origin continuity (story modal scaling from the tapped tile) — a larger shared-element rework; noted as a future seam.
- `add-story-flow.ts:175` photo-remove buttons' bare `transition` — micro-case, acceptable.
- HeroZoom's ~67lvh dead tail and ZoomParallax's hard unpinned exit — creative pacing calls, not defects.
