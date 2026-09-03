# Proposal: fix-site-motion-findings

## Why

A third motion-craft audit (following the archived `fix-scroll-motion-findings` and `fix-motion-craft-findings`) found the scroll set pieces and story viewer still solid, but surfaced a new tier of issues across the surfaces those audits did not cover — TimelineScroll's reduced-motion mode, the add-story flow, runtime-built guest tiles, the FAQ, the wish marquee, the venue map's vendor layer, and the RSVP confirm moment:

- **Reduced-motion guests lose two timeline story beats entirely**: "Mula-mula" is `display: none`'d and node 1's inline `visibility: hidden` is never cleared without the JS scrub (the `opacity: 1 !important` rule meant to reveal it is dead code), and the finale dot-9 never appears — the reduced-motion story starts at node 2 and ends with a floating label.
- **The add-story flow teleports**: its full-screen modal flips `opacity-0`/`pointer-events-none` classes with no transition anywhere — the sibling story-viewer modal animates, this one hard-cuts.
- **Runtime-built guest tiles are second-class citizens**: Astro-scoped styles can't reach DOM-API-built nodes, so guest tiles get zero fade-up entrance (the just-posted-your-story moment pops in silently), guest spinners never spin, and guest covers never hover-zoom.
- **Accessibility gaps**: the FAQ has no `prefers-reduced-motion` handling at all (springs, height travel, badge pop all run unconditionally); real wishes scroll by at 0.9 opacity with no way to pause and read them; Leaflet's own zoom animations ignore reduced motion (only the component's `setView`/`fitBounds` calls are gated).
- **Feel polish**: the welcome-gate gesture uses bare `ease-out` instead of an iOS-grade drawer curve; the story viewer's first slide hard-cuts in over the spinner; press scales in the flow snap (no transform transition); the site's only CTA has no press feedback; map hover lifts are ungated on touch; marquee state changes pop; QuranVerse holds ~30 `will-change` layers forever; five hand-typed easing curves drift outside the token set.
- **Earned delight missing**: the RSVP confirm — the site's single conversion moment — swaps its label with an instant text cut; map route polylines pop into existence with no spatial explanation; the map's placeholder vanishes in a same-frame swap.

## What Changes

- **TimelineScroll reduced-motion repairs** (`TimelineScroll.astro`): keep `#title-layer-bottom` visible; force `#node-1` `visibility: visible !important`; force `#dot-9` visible — all inside the existing reduced-motion media block. Animated path untouched.
- **AddStoryFlow modal motion** (`add-story-flow.ts`): animate root + panel via `motion` mirroring the StoryViewer contract — 200ms expo entrance (`translateY(16px) scale(0.95) → 1`), 120ms exit, reduced-motion fade-only; class rest-state restored on close-complete.
- **Globalize runtime-tile styles** (`index.astro`, `StoryViewer.astro`): move `.animate-fade-up` (+ keyframes + reduced-motion variant), `.android-spinner`, and the hover-gated `.zoom-cover` rules to `:global(...)` so DOM-API-built guest tiles match SSR tiles.
- **Welcome-gate drawer curve** (`WelcomeGate.astro`): commit and snap-back transitions use `cubic-bezier(0.32, 0.72, 0, 1)` (iOS-like drawer curve); durations unchanged (400/250ms).
- **FAQ reduced motion** (`WeddingFAQ.astro`): branch on `matchMedia` — keep color/opacity feedback, drop rotate/scaleX/pop/height-travel; state applies instantly.
- **Marquee pause + state smoothing** (`WishMarquee.astro`): pause-on-hover/focus in the `real` state only; 300ms opacity transition on the band's state flip; rebuilt rows resume from their live pixel offset instead of restarting.
- **Leaflet reduced-motion + hover gating** (`venue-map.ts`, `VenueMap.astro`): `zoomAnimation: !prefersReducedMotion()` + a vendor CSS override for `.leaflet-zoom-animated`; hover lifts gated behind `@media (hover: hover) and (pointer: fine)`; zoom controls added to the reduced-motion `transition: none` list.
- **Story viewer first-slide fade** (`StoryViewer.astro`): `opacity [0,1]` 150ms on load — no branch needed, opacity-only is reduced-motion-safe.
- **Press-transition consistency** (`AddStoryFlow.astro`, `StarButton.astro`): the flow's three controls gain `duration-160 ease-out` transform transitions; the CTA gains the house `scale(0.97)` / 160ms press contract.
- **QuranVerse will-change release** (`QuranVerse.astro`): `will-change: auto` in the terminal `.in-view` state.
- **Motion token consolidation** (`global.css` + consumers): name the four deliberate hand-typed curves (`--ease-out-strong`, `--ease-out-standard`, `--ease-out-zoom`, `--ease-blur-reveal`), delete the consumerless `--ease-in-out-strong`, point consumers at the tokens, rename number-ticker's `EASE_OUT` → `EASE_OUT_EXPO`. Zero value changes.
- **RSVP confirm celebration** (`RsvpSection.astro`): label crossfade (150ms out / 200ms in) + gentle `scale [1, 1.04, 1]` settle-pop on success; reduced-motion keeps the instant swap.
- **Route polyline draw-in** (`venue-map.ts`): origin→venue stroke draw (~500ms, component's strong ease-out) on selection, via WAAPI on the SVG paths; reduced-motion renders complete.
- **Map placeholder crossfade** (`VenueMap.astro`, `venue-map.ts`): 250ms opacity hand-off when Leaflet mounts; reduced-motion and fallback paths stay instant.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`scroll-motion`**: TimelineScroll's reduced-motion mode SHALL present the opening title ("Mula-mula"), node 1, and the finale dot — the current requirement's "full content access" is strengthened to name them. QuranVerse SHALL release `will-change` in the reveal's terminal state.
- **`interaction-motion`**: the story viewer's first slide SHALL fade in (no hard cut); runtime-built guest tiles SHALL render with the same entrance/spinner/hover behavior as SSR tiles (globalized styles); the FAQ SHALL honor reduced motion; the add-story flow modal SHALL animate open/close on the composite path with reduced-motion fade-only; press scales SHALL be transition-driven (160ms ease-out), including the StarButton CTA; the wish marquee SHALL pause on hover/focus in its real state and cross-fade its band-state changes; venue-map vendor zoom animation SHALL be gated under reduced motion and hover lifts pointer-class gated; the RSVP confirm SHALL play its label crossfade + settle-pop; route polylines SHALL draw in origin→venue; the map placeholder SHALL crossfade into the live map.
- **`welcome-gate`**: the commit/snap-back transitions SHALL use the iOS-like drawer curve `cubic-bezier(0.32, 0.72, 0, 1)` (durations unchanged).
- **`motion-tokens`**: the token set SHALL name the strong ease-out, standard decelerate, scroll-zoom, and blur-reveal curves; tokens with zero consumers SHALL NOT be kept.
- **`add-story-flow`**: the flow SHALL open and close with an animated modal transition (composite properties, ease-out both directions, exit faster than entrance, fade-only under reduced motion) instead of an instant swap.

## Impact

- **Code**: `apps/web/src/components/TimelineScroll.astro`, `StoryViewer.astro`, `AddStoryFlow.astro`, `WeddingFAQ.astro`, `WishMarquee.astro`, `VenueMap.astro`, `venue-map.ts`, `QuranVerse.astro`, `StarButton.astro`, `RsvpSection.astro`, `WelcomeGate.astro`, `number-ticker.ts`, `HeroZoom.astro`, `apps/web/src/scripts/add-story-flow.ts`, `apps/web/src/pages/index.astro`, `apps/web/src/styles/global.css`.
- **Dependencies**: none added; continues on `motion` v13 (`animate`) and platform APIs (`matchMedia`, WAAPI, `DOMMatrixReadOnly`).
- **Risk**: touches Playwright-covered surfaces (`welcome-gate.spec.ts`, `story-viewer.spec.ts`, `venue-map.spec.ts`, `rsvp.spec.ts`, `star-button.spec.ts`) — the map placeholder's 260ms staged removal may need a test wait adjusted; all default-path visuals stay pixel-parity except where explicitly listed (gate curve, first-slide fade, modal entrance/exit, press transitions, marquee resume, RSVP celebration, route draw-in, placeholder crossfade).
- **Verified unchanged by design**: all reduced-motion reflows, scrub mechanics, geometry caching, and easing/duration values from the two archived motion audits — this change only adds the missing pieces and fixes regressions of intent (TimelineScroll reduced-motion content, FAQ reduced motion).
