# Tasks: venue-map-routes

## 1. Dependencies and setup

- [x] 1.1 Add `leaflet` **pinned to `2.0.0-alpha.1` exactly** (no `^`/`~`) to `apps/web/package.json` dependencies; run `pnpm install`. Do NOT add `@types/leaflet` — no 2.0 type definitions exist (`@types/leaflet` latest is 1.9.22 for the 1.x API; the 2.0.0-alpha.1 package ships no `.d.ts`). Leaflet 2.0 is **ESM-only, no global `L` in the core package, factory functions removed** — all map code uses named imports + constructors (`Map`, `TileLayer`, `Polyline`, `Marker`, `DivIcon`, `Control`); the legacy global build is not used.
- [x] 1.2 Create `apps/web/public/map/` directory and add local WebP images for: `tirtonadi.webp`, `purwosari.webp`, `balapan.webp`, `soemarmo.webp`, `selat-solo.webp`, `smk-murni.webp`, `graha-58.webp` (each ~300×200px source, compressed to ≤50KB; source photos TBD by couple). **Assets that are absent at build time are handled gracefully** (see 3.1's existence filter) — the popups render text-only rather than broken images, so this task can land before all seven photos exist.
- [x] 1.3 Extend `apps/web/src/lib/venue.ts` (owned by the landed `rsvp-live-count`; its header comment explicitly names this change as a consumer) with `VENUE_LAT = -7.5682749` and `VENUE_LNG = 110.8053926` so the appended route endpoint (2.2) and the Google Maps `destination=` URL (3.5) stop being triplicated literals — the venue coordinate then has exactly one source of truth

## 2. Route geometry module (lazy-loaded)

- [x] 2.1 Fetch the four route coordinate arrays from OSRM (use **HTTPS** — the demo server supports it; avoids mixed-content habits and MITM'd route data):
  - `GET https://router.project-osrm.org/route/v1/driving/110.8184343,-7.5517387;110.8053926,-7.5682749?overview=full&geometries=geojson` → Tirtonadi route (79 points)
  - `GET https://router.project-osrm.org/route/v1/driving/110.7965074,-7.5616918;110.8053926,-7.5682749?overview=full&geometries=geojson` → Purwosari route (72 points)
  - `GET https://router.project-osrm.org/route/v1/driving/110.8209388,-7.5572285;110.8053926,-7.5682749?overview=full&geometries=geojson` → Solo Balapan route (130 points)
  - `GET https://router.project-osrm.org/route/v1/driving/110.7560184,-7.5162608;110.8053926,-7.5682749?overview=full&geometries=geojson` → Adi Soemarmo route (345 points)
- [x] 2.2 Store the arrays in a **separate module `apps/web/src/components/venue-map-routes.ts`** (NOT inside `VenueMap.astro`) — ~630 coordinate pairs is 12–18 KB, and the component's bundled script + HTML ship to every homepage visitor; the module is `await import()`-ed inside the IntersectionObserver lazy branch so only scrollers pay for it (this is what keeps the spec's "no map resources loaded on initial page load" honest). Store as `[number, number][]` in **Leaflet `[lat, lng]` order** — convert from OSRM's GeoJSON `[lng, lat]` at bake time (raw OSRM order into `new Polyline(...)` renders every route ~110° off in the ocean; see design D3/D8). Note the point counts and the OSRM fetch date in a comment. **Endpoint fixups (OSRM snaps both endpoints to the road network, never the exact pins):** prepend each route's exact origin marker coordinate as the array's first point and append the exact venue coordinate (imported as `VENUE_LAT`/`VENUE_LNG` from `../lib/venue` — see 1.3) as its final point — the Adi Soemarmo origin alone snaps 422.8 m away to "Jalan Padang Golf", which would otherwise leave the longest polyline visibly dangling from its marker. These two fixups are what make the spec's "Route endpoints are the exact pins" scenario pass. **Visual note**: the prepended Adi Soemarmo stub is a straight ~422 m chord from the terminal pin across the apron to the access road (visible as an unnaturally straight lead-in at fitted zoom); render the first segment of that route with a dashed `dashArray` so it reads as an access-road connector, not road geometry.
  - **Typed module note (design D17/D1)**: since no `@types/leaflet` exists for 2.0, maintain a minimal local `.d.ts` for the named imports actually used (`Map`, `TileLayer`, `Polyline`, `Marker`, `DivIcon`, `Control`, `DomEvent`, `LatLngBounds`, popup/event types) — that declaration file is what `astro check` validates in 5.12

## 3. VenueMap.astro component

- [x] 3.1 Create `apps/web/src/components/VenueMap.astro` with:
  - Venue name/city/coordinate imported from `../lib/venue`; small frontmatter data includes six locations and guest-facing route estimates: Tirtonadi `3.3 km / 14 min`, Purwosari `1.9 km / 8 min`, Solo Balapan `3.0 km / 13 min`, Adi Soemarmo `11 km / 29 min`.
  - **Missing-photo existence filter in the component frontmatter**: mirror `teaserAssetExists()` (`index.astro:148`) / `gateBgAssetExists()` (`WelcomeGate.astro:15`) — check `public/map/<id>.webp` presence server-side and drop the `image` field when absent, so popups render text-only for undelivered photos instead of broken banners (this is the build-time half; the runtime `onerror` removal in 3.5 is the other half)
  - **Frontmatter → client hand-off (pinned, design D11)**: serialize the filtered `LOCATIONS`/route-strings/venue into an inline `<script type="application/json" data-venue-map>` tag — the repo's established pattern (`StoryViewer.astro:28` JSON-tag). The bundled client script parses this tag at init. Do NOT use `define:vars` (it forces `is:inline`, which 3.2 prohibits for the main script).
  - Astro markup: section wrapper (`id="venue-map"`, no `data-progressive-section`), constrained heading/copy, and an edge-to-edge map container (`h-[560px] md:h-[720px] w-full overflow-hidden`) with no rounded clipping
  - Placeholder + fallback states use non-duplicating copy and a Google Maps link; no-JS behavior remains unchanged
- [x] 3.2 Client script + map init: retain lazy loading, disable wheel zoom, keep desktop dragging/touch page-scroll behavior, and mount Leaflet `+ / −` controls at the top-right via `Control.Zoom`. Initial view: `setView(venue, 17, { animate: false })` with the venue popup opened at the end of init, NO route selected, and NO route polyline rendered (couple's request). The venue itself is modeled as a `routeKey: "graha58"` location so its marker shares the origin-marker construction path, but it gets NO route chip (destination, not a route) and never renders a path. Force-complete any in-flight zoom animation (`map.stop()` + `map._onZoomTransitionEnd()`) before programmatic view changes so rapid select taps land correctly (Leaflet swallows setView during zoom animations).
  - Create Dark Matter + Positron layers and select the initial layer from `prefers-color-scheme`; listen for device scheme changes. No manual theme toggle.
  - Keep required OSM/CARTO attribution but call `map.attributionControl.setPrefix(false)` and style credits without the default box/flag.

- [x] 3.3 Route polylines:
  - For each entry in `ROUTES`, `new Polyline(coordinates, { color, weight: 4, opacity: 0.85, lineJoin: "round" })` added to the map — **marker/polyline fills are inline `style="background:${color}"`, never interpolated Tailwind classes** (`bg-${color}` is never compiled; design D14). Structural literal classes (`size-5`, `rounded-full`) are fine
  - Colors: Tirtonadi `#10b981` (green), Purwosari `#3b82f6` (blue), Solo Balapan `#06b6d4` (cyan), Adi Soemarmo `#8b5cf6` (purple)
  - A subtle glow effect: add a second, wider, lower-opacity polyline underneath each route (`weight: 8, opacity: 0.2`)
  - Adi Soemarmo route only: the first segment (terminal pin → Jalan Padang Golf, the 422 m prepend) is drawn with `dashArray` so the straight access-road chord reads as a connector, not road geometry

- [x] 3.4 Destination marker (Graha 58):
  - `new DivIcon(...)` with a custom HTML element: red circle (`bg-red-500`), `size-6`, white border, plus a CSS pulse ring animation (Tailwind `animate-ping` on an absolutely positioned sibling, or a custom keyframe). **Wrap the pulse-ring rule in `@media (prefers-reduced-motion: no-preference)`** (or set `animation: none` under `reduce`) — the repo's motion contract (scroll-motion / interaction-motion specs) treats reduced-motion handling as non-optional
  - Popup content (MapCN rich layout, 200px card with full-bleed photo): category "Gedung Konvensi", short name "Graha 58" enlarged, image `/map/graha-58.webp`, no action button (the couple-supplied place link `https://maps.app.goo.gl/VAeWL7EqazFi3Nh66` is the top-left control's target). The marker's accessible **title** keeps the canonical `VENUE_NAME` from `lib/venue.ts`

- [x] 3.5 Transit origin markers (Tirtonadi, Purwosari, Solo Balapan, Adi Soemarmo):
  - `new DivIcon(...)` per origin: colored circle (`size-5`, white border, route color) + small text label below (`MarkerLabel` equivalent: a `<div>` positioned below the dot)
  - Rich popup per origin, built lazily on marker click: optional local image, category/name, curated distance + typical-duration line; no action button — directions open from the top-left control.
  - Google Maps directions URL: `https://www.google.com/maps/dir/?api=1&origin={lat},{lng}&destination=${VENUE_LAT},${VENUE_LNG}&travelmode=driving` (from `lib/venue.ts`, not a literal) — rendered with `target="_blank" rel="noopener noreferrer"`

- [x] 3.6 POI markers (Selat Solo Tenda Biru, SMK Murni 1 Surakarta):
  - `new DivIcon(...)`: amber circle (`bg-amber-400`), `size-4`, white border
  - Rich popup per POI (also lazy-on-click with `onerror` image removal): image banner, category label ("Restoran" / "Sekolah"), name — no action button, no distance/duration, no directions link (the couple-supplied place links are recorded in design.md D6)
  - **Venue-cluster legibility**: Graha 58 + both POIs sit 46–62 m apart and overlap at bounds-fitted zoom. Implement the D8/D13 interaction: clicking any of the three cluster markers checks whether a move will actually occur (`map.getZoom() < 17 || !map.getCenter().equals(latlng, tolerance)`); if yes, `map.setView(markerLatLng, 17, { animate: !prefersReducedMotion })` and open the popup in `map.once("moveend", …)`; **if already at the target zoom/center, open the popup immediately** — otherwise `setView` is a no-op, `moveend` never fires, and a second tap would never open the popup

- [x] 3.7 Device-following popup theme override — **MUST be global styles**:
  - Add a `<style is:global>` block targeting Leaflet popup DOM. Dark preference uses a neutral-900 surface/light text; light preference uses a light surface/dark text. A scoped `<style>` silently misses Leaflet-created DOM.
  - Close-button color follows the active theme.
- [x] 3.8 Marker + popup a11y (verified against the Leaflet 2.0.0-alpha.1 source — design D16; required by the spec's keyboard requirement and checked in 5.14):
  - **Accessible name**: pass `title: "{name}"` as a **Marker option** — 2.0's `_initIcon` assigns `icon.title = options.title` for ANY icon including DivIcons (only `alt` is gated on `tagName === 'IMG'`). `keyboard: true` (default) already sets `tabIndex='0'` + `role='button'` — no manual attributes needed
  - **Space to open**: 2.0's popup `_onKeyPress` checks `e.originalEvent.code === 'Enter'` only — add a custom `keydown` handler on the marker element so Space also opens the popup
  - **Focus return on close**: Leaflet does not restore focus — track the triggering marker and call `.focus()` on `popupclose` (popups render with `closeButton: false` per the couple: outside clicks and Escape dismiss them)
- [x] 3.9 MapCN-style route planning control + Google Maps button:
  - Bottom-left: four origin chips in ONE horizontally scrollable, full-map-width (edge-to-edge) row sized to their content with a 10px card inset from the screen edges (typical drive time + distance; the venue gets no chip); the strip is pointer-events:none except on chips so the empty area passes gestures through; nothing selected initially, and selecting the active chip/marker/polyline again toggles the selection off (hides the path, keeps the view).
  - Top-left: compact button whose URL points at the venue place page when nothing is selected and follows the active origin after selection; themed with the map: translucent-white card + dark ink on the light map, black background + white text/border on the dark map.
- [x] 3.10 Device-following theme: no manual control; select Dark Matter/Positron from `prefers-color-scheme`, update on change, and keep popup/control CSS synchronized.

## 4. Integration into homepage

- [x] 4.1 In `apps/web/src/pages/index.astro` — `rsvp-live-count` has **already landed** (its tasks are complete; `RsvpSection.astro` and `lib/venue.ts` exist; "The Grand Estate" is gone):
  - Import `VenueMap` component
  - Insert `<VenueMap />` as its own section immediately ABOVE `<div id="rsvp-section">` (`index.astro:230`) — the RSVP section, its venue-name line, and the RSVP UI are NOT touched
  - `VenueMap.astro` renders NO venue-name line of its own — exactly one visible venue-name block exists on the page, owned by the RSVP section
  - There is no inversion branch: the plan does not describe landing first, because `rsvp-live-count` has already shipped

## 5. Verification

- [x] 5.1 Visual check: all 7 markers render at correct positions; 4 route polylines connect origins to Graha 58; routes are visually distinct by color
- [x] 5.2 Popup check: click each marker → popup opens with correct image, category, name, distance/duration (transit only), and directions link (transit only)
- [x] 5.3 Theme check: emulate light device preference → Positron + light popup theme; emulate dark → Dark Matter + dark popups; no manual theme toggle
- [x] 5.4 Lazy-load check: no Leaflet/tile requests until near viewport
- [x] 5.5 No runtime OSRM/Google Maps navigation requests
- [x] 5.6 Interaction/layout check: top-right +/- controls; desktop drag; touch page-scroll pass-through; edge-to-edge map at `560px/720px`; 140px route planner; theme-aware Google Maps controls
- [x] 5.7 Exactly one visible venue-name block
- [x] 5.8 Chunk-failure fallback
- [x] 5.9 Cluster zoom/open behavior
- [x] 5.10 Reduced motion disables destination pulse and map transition animation
- [x] 5.11 Playwright lazy-load/no-OSRM/reduced-motion coverage
- [x] 5.12 Typecheck, lint/format, build + production smoke test
- [x] 5.13 No-JS fallback
- [x] 5.14 A11y: markers, popups, route options, and Google Maps link
- [x] 5.15 Touch-capable Playwright project
- [x] 5.16 Route-planning check: no route selected AND no route path rendered at init (venue zoom + popup open); selecting an option/marker/polyline renders ONLY that route in its own color; selecting the active route again hides the path and keeps the view (no zoom back); Google Maps button label stays compact while its link points at the venue place page when unselected and follows the active origin after selection; theme and attribution match new MapCN direction
