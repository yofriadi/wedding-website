# Design: venue-map-routes

## Context

The wedding is at **Graha 58 Gedung Serbaguna UMS**, Jl. Dr. Wahidin, Purwosari, Kec. Laweyan, Kota Surakarta, Jawa Tengah 57142 (`-7.5682749, 110.8053926`). The homepage's Event Details section is now owned by the **landed `rsvp-live-count` change**: `index.astro:230` renders `<div id="rsvp-section">` wrapping `RsvpSection.astro`, which displays the venue name/city from `apps/web/src/lib/venue.ts` (`VENUE_NAME` / `VENUE_CITY`) and the RSVP UI. The old "The Grand Estate / San Francisco, California" placeholder and "RSVP Coming Soon" button are gone from the codebase. What is still missing is any map or directions guidance — this change adds it.

The site is built with Astro + Tailwind CSS (dark palette: `bg-neutral-950` background, light text). No existing map component or mapping library is present. The `mapcn` library (`https://www.mapcn.dev`) provides shadcn-style map components (`Map`, `MapMarker`, `MapRoute`, `MarkerPopup`) — built on **MapLibre GL**, per its own docs — and is React-only. Since the project is Astro-first with no React integration, `mapcn`'s components would require adding React as an island framework. The design decision below resolves this.

## Goals / Non-Goals

**Goals:**

- Replace the static Event Details block with a real, interactive venue map
- Show four driving routes from transit hubs to Graha 58
- Rich-popup markers for all 5 named locations (3 transit + 2 POI)
- Visually consistent with the dark site aesthetic
- No runtime routing-API calls (routes are static) — map tiles are still a runtime CDN fetch (CartoDB), and that tradeoff is stated honestly in D2
- Lazy-mounted (does not block initial page load)
- Honors `prefers-reduced-motion` (pulse ring off; animated zooms become instant)
- Keyboard-accessible markers and popups (a11y, per repo convention in `rsvp-live-count`)

**Non-Goals:**

- Live traffic, real-time routing, or turn-by-turn directions
- Google Maps embed or iframe
- Public transit or walking routes
- RSVP functionality
- Any invite/cookie/session integration

## Decisions

### D1 — Map rendering: Leaflet directly, not mapcn React components

`mapcn` is a React component library **built on MapLibre GL** (its own homepage: "Built on MapLibre") — not on Leaflet as an earlier draft of this design claimed. The project is Astro-first with no React integration configured, and adding React just for this map is disproportionate. Instead, use **Leaflet 2.0 directly** with markup and styling that matches `mapcn`'s component patterns (route polylines, popup markers, dark tile layer). Leaflet is DOM-based (a good fit for a handful of markers) and keeps the bundle small.

> Note: D3's route-geometry approach was originally cross-referenced against the `mapcn` Route Planning example, which happens to use the same public OSRM demo API — that API choice is independent of the rendering library.

**Dependencies added:**

- `leaflet` (runtime) — **pinned to `2.0.0-alpha.1` exactly** (no `^`/`~`): the 2.0 line is alpha, and any later 2.0 alpha/beta may break the API this plan codes against; `pnpm-workspace.yaml` has `minimumReleaseAge: 0`, so the exact pin is the only guard. Leaflet 2.0 is **ESM-only, no global `L` in the core package, and factory functions are gone** — all map code uses named imports and constructors: `import { Map, TileLayer, Polyline, Marker, DivIcon, Control } from "leaflet"`, then `new Map(el, opts)`, `new TileLayer(url, opts)`, `new Polyline(latlngs, opts)`, `new Marker(latlng, { icon: new DivIcon({...}) })`. The legacy global build (`leaflet-global.js`) is NOT used. Alpha risk is accepted per project decision; the blast radius is one lazy-loaded section with a static fallback (D7), and pinning exact + the Playwright suite (task 5.11) is the containment.
- **No `@types/leaflet`**: there are no 2.0 type definitions (`@types/leaflet` latest is 1.9.22, for the 1.x API; the 2.0.0-alpha.1 package ships no `.d.ts` and no `types` field). The extracted `.ts` module (D17) declares a minimal local `.d.ts` for the ~10 named imports it uses, or falls back to `// @ts-expect-error` on the import with a comment pointing at this decision. Task 5.12's type-check expectations are scoped accordingly.

**No React, no `@mapcn/*` packages.**

### D2 — Tile layers follow the device color scheme

Use CartoDB Dark Matter (`https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png`) when `prefers-color-scheme: dark` matches and CartoDB Positron (`https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png`) for light devices. There is no manual theme toggle. A `matchMedia("(prefers-color-scheme: dark)")` listener swaps layers if the device preference changes, and the map container's `.theme-dark` / `.theme-light` class keeps popup/control styling synchronized. Required OpenStreetMap + CARTO attribution remains, but Leaflet's own prefix is disabled so the Ukraine flag/Leaflet branding disappear; attribution is styled as subtle inline text without a white boxed container.

**Honesty note on "no runtime dependencies"**: the goal is specifically "no runtime _routing-API_ calls". Tile images are inherently a runtime CDN fetch; if CartoDB is unreachable, marker/route overlays remain useful on the neutral map container.

### D3 — Route geometry: pre-computed static GeoJSON

The four route polylines are fetched once from the public OSRM routing API and embedded as static coordinate arrays in the component. This eliminates a runtime routing-API dependency. (The public OSRM demo API is the same one the `mapcn` Route Planning example uses — chosen for zero-auth and GeoJSON output, independent of the rendering library.)

**Route geometry source vs. guest-facing labels:** OSRM supplies only the baked road geometry. The interface uses manually curated, typical-trip estimates requested by the couple:

| Route | Origin (marker pin)                            | Guest-facing distance | Typical drive time |
| ----- | ---------------------------------------------- | --------------------- | ------------------ |
| 1     | Terminal Tirtonadi `-7.5517387, 110.8184343`   | 3.3 km                | 14 min             |
| 2     | Stasiun Purwosari `-7.5616918, 110.7965074`    | 1.9 km                | 8 min              |
| 3     | Stasiun Solo Balapan `-7.5572285, 110.8209388` | 3.0 km                | 13 min             |
| 4     | Bandara Adi Soemarmo `-7.5162608, 110.7560184` | 11 km                 | 29 min             |

All four routes terminate at Graha 58. **OSRM snaps BOTH endpoints to the nearest routable road point, never the exact pins** — the destination snaps ~10 m off (`[110.805441, -7.568194]`) and the airport origin snaps 422.8 m off. Each baked array therefore gets (a) the exact origin marker coordinate PREPENDED as its first point and (b) `[VENUE_LAT, VENUE_LNG]` from the shared venue module APPENDED as its final point, so every polyline visually connects pin→pin without duplicating the canonical destination literals.

The full coordinate arrays (verified point counts at snapshot time: **79 Tirtonadi, 72 Purwosari, 130 Solo Balapan, 345 Adi Soemarmo** — before the prepend/append above) are stored in `venue-map-routes.ts`, with the fetch date recorded in a comment. **Coordinate order: arrays are stored as `[lat, lng]` (Leaflet `LatLng` order), converted from OSRM's GeoJSON `[lng, lat]` at bake time** — passing raw OSRM order into `new Polyline(...)` would render every route ~110° off in the ocean (see D8). Only the airport pin→road connector is dashed; the remaining airport route geometry is a separate solid polyline.

### D4 — Map viewport: venue-zoomed initial state, per the couple

The couple asked for the initial view to be zoomed in on Graha 58 with its popup already open, NO route selected, and NO route path rendered. The map therefore initializes with `setView(venue, 17, { animate: false })` as the FIRST view call (no visible snap) and opens the destination popup at the end of init (autoPan nudges the center so the whole card is visible). No polyline is added until a selection; selecting a route fits that route's bounds, and toggling it off hides the path WITHOUT moving the view. The earlier bounds-derived overview was rejected by the couple.

**Zoom-animation trap (pinned, verified against the alpha source)**: Leaflet silently swallows `setView`/`fitBounds` while a zoom animation is in flight — `Map._tryAnimatedZoom` returns `true` early WITHOUT re-targeting — and even a non-animated `setView` is clobbered when the stale animation's 250 ms end-timer fires. Before every programmatic view change (route select/unselect, cluster zoom) the code calls `map.stop()` + `map._onZoomTransitionEnd()` to force-complete the in-flight animation, so rapid select → unselect taps always land on the new view.

### D5 — Marker design

All markers are custom Leaflet `DivIcon` instances (no external image dependencies), styled to match the site palette:

- **Destination (Graha 58)**: Red pin, slightly larger, with a pulsing ring animation to draw attention. The pulse ring is disabled under `prefers-reduced-motion` (a static ring remains) — motion is opt-in per the repo's `scroll-motion`/`interaction-motion` contract.
- **Transit origins (Tirtonadi, Purwosari, Solo Balapan, Adi Soemarmo)**: Colored circle markers matching their route color (green, blue, cyan, purple respectively), with a small label below.
- **POIs (Selat Solo, SMK Murni)**: Amber/yellow circle markers, smaller than transit markers.

### D6 — Rich popup content

Each popup follows the `mapcn` Rich Popups pattern, adapted to Leaflet's popup API:

```
┌─────────────────────────────┐
│ [Image banner 300×120]      │
│ CATEGORY LABEL (uppercase)  │
│ Location Name (bold)        │
│ distance · duration (origin)│
└─────────────────────────────┘
```

- **Image**: Local WebP image from `apps/web/public/map/`, lazy-loaded (`loading="lazy"`), with `alt` text (location name) and rendered full-bleed at 110px high on the 200px-wide card — the asset files are ~800px-wide WebP (≤50KB) and object-fit crops to the banner height. Three assets have landed (`graha-58`, `selat-solo`, `smk-murni`, photos linked by the couple via Google Maps); the remaining four are still TBD.
- **Category**: Terminal / Stasiun / Bandara / Gedung Konvensi (venue) / Restoran / Sekolah.
- **Name**: Short name only (Tirtonadi / Purwosari / Solo Balapan / Adi Soemarmo / Selat Solo Tenda Biru / SMK Murni 1 Surakarta).
- **No action button (removed per the couple)**: popups carry banner, category, name, and — on transit origins only — the distance/duration line. Nothing inside a popup is interactive, so the map has exactly one Google Maps exit: the top-left directions control (venue place page while nothing is selected, driving directions from the active origin afterwards). The couple-supplied POI place links are therefore not rendered; they are recorded here for reference — Selat Solo Tenda Biru `https://maps.app.goo.gl/txpFwuYHESzytYMP6`, SMK Murni 1 Surakarta `https://maps.app.goo.gl/m6gADY7g4eus12KK8`. Popups close on outside clicks (Leaflet's default `closePopupOnClick`); a background click also cancels any pending cluster-popup callback so a just-dismissed popup cannot resurrect on `moveend`. Because no popup child is focusable, the card itself takes `tabindex="-1"` and receives focus on open, so a keyboard/screen-reader visitor still hears what the marker revealed (D16); closing returns focus to the marker.
- **Popup DOM is built lazily on marker click**, not at map init — seven eager popups would fetch all seven banner images immediately, defeating the lazy-init goal on metered connections. Each marker's popup content is constructed inside its `click` handler (Leaflet `bindPopup` with a function), so images load only when a popup actually opens.
- **Missing-image fallback**: if a photo asset under `/map/` is absent, the popup renders without the banner (text-only) rather than a broken image — enforced by an `onerror` handler on the `<img>` that removes the banner element.

Popup styling overrides Leaflet's fixed default theme: dark devices use `bg-neutral-900` with light text, while light devices use a light surface with dark text. **These selectors MUST be in a global style block (`<style is:global>` or `:global(...)`)** — Astro scopes component `<style>` blocks by attaching a hash attribute to template elements, but Leaflet builds popup/divIcon DOM at runtime without the hash, so scoped rules silently match nothing. The same applies to the D5 pulse-ring keyframes and divIcon/control styles.

### D7 — Lazy initialization via IntersectionObserver, with failure fallback

The map section is not visible at initial page load (it sits below the timeline and story rail). Leaflet and the map tiles are loaded only when the section approaches the viewport, using an `IntersectionObserver`. **The `rootMargin` is `"150% 0px"` — deliberately matching the existing section preloader convention in `index.astro` (`data-progressive-section`, lines ~410–451)** — so Leaflet and tiles start loading at the same scroll distance as surrounding imagery hydrates, rather than later (an earlier draft used 200px, which would have started the map noticeably after every neighboring image on a fast scroll).

The section does NOT carry `data-progressive-section`: that attribute drives the `img[data-src] → src` swap for scroll-driven reveal sections, and this section has no `data-src` images — adding the attribute would be noise and imply image handling that doesn't exist here.

**Script init pattern (pinned)**: the component uses the same `readyState`/`DOMContentLoaded` branch as `ZoomParallax` / `QuranVerse` / `TimelineScroll` — this repo has no `<ClientRouter />`, so `astro:page-load` never fires and must NOT be relied upon (documented trap in `openspec/changes/archive/2026-08-17-fix-scroll-motion-findings/design.md` and the `scroll-motion` spec).

**Failure fallback**: if the lazy map module fails — offline or chunk 404 — the placeholder swaps from loading copy to a static fallback with non-duplicating directions copy, address, and a plain "Open in Google Maps" link. If only the tile CDN is unreachable, overlays still render on the neutral map container — a soft degradation, per D2.

**Init sequencing**: `leaflet/dist/leaflet.css?inline` resolves in the same lazy flow before `new Map(...)` is called, then its text is injected into `<head>` so Leaflet CSS is not loaded eagerly but tiles/attribution never render unstyled.

### D8 — Data model

All location and route data is a static TypeScript constant in the component file. **Route coordinate arrays are stored in Leaflet `[lat, lng]` order** (converted from OSRM GeoJSON `[lng, lat]` at bake time — see D3), so `new Polyline(...)` receives them directly without a runtime transform. Venue name/city come from the shared `apps/web/src/lib/venue.ts` (see D15):

```typescript
import { VENUE_NAME, VENUE_CITY, VENUE_LAT, VENUE_LNG } from "../lib/venue";
// Popup banner photos may not all be delivered by the couple at build time.
// Mirror the repo's existing missing-asset pattern (`teaserAssetExists()` in
// index.astro:133 / `gateBgAssetExists()` in WelcomeGate.astro:15): the component
// frontmatter filters each location's `image` out when the file is absent from
// public/, so the popup renders text-only instead of a broken image. This is the
// server-side/build-time half of the fallback; the runtime `onerror` removal in
// D6 is the belt-and-braces half for post-build deletions.
const LOCATIONS = [
  { id: "tirtonadi", type: "Terminal", name: "Tirtonadi", lat: -7.5517387, lng: 110.8184343, color: "#10b981", routeKey: "tirtonadi" },
  { id: "purwosari", type: "Stasiun", name: "Purwosari", lat: -7.5616918, lng: 110.7965074, color: "#3b82f6", routeKey: "purwosari" },
  { id: "balapan", type: "Stasiun", name: "Solo Balapan", lat: -7.5572285, lng: 110.8209388, color: "#06b6d4", routeKey: "balapan" },
  { id: "soemarmo", type: "Bandara", name: "Adi Soemarmo", lat: -7.5162608, lng: 110.7560184, color: "#8b5cf6", routeKey: "soemarmo" },
  { id: "selat-solo", type: "Restoran", name: "Selat Solo Tenda Biru", lat: -7.5686559, lng: 110.8052207, color: "#f59e0b", routeKey: null, mapUrl: "https://maps.app.goo.gl/txpFwuYHESzytYMP6", note: "verified via the shared Google Maps link — 46 m from the venue, same street (Jl. Dr. Wahidin branch)" },
  { id: "smk-murni", type: "Sekolah", name: "SMK Murni 1 Surakarta", lat: -7.568661, lng: 110.805799, color: "#f59e0b", routeKey: null, mapUrl: "https://maps.app.goo.gl/m6gADY7g4eus12KK8", note: "verified via the shared Google Maps link — 62 m from the venue" },
];

const ROUTES: Record<string, { coordinates: [number, number][]; distanceKm: string; durationLabel: string }> = {
  tirtonadi: { coordinates: [...], distanceKm: "3.3 km", durationLabel: "14 min" },
  purwosari: { coordinates: [...], distanceKm: "1.9 km", durationLabel: "8 min" },
  balapan: { coordinates: [...], distanceKm: "3.0 km", durationLabel: "13 min" },
  soemarmo: { coordinates: [...], distanceKm: "11 km", durationLabel: "29 min" },
};
```

**POI proximity note**: `selat-solo` and `smk-murni` sit 46 m and 62 m from the venue respectively (the restaurant is literally next door on Jl. Dr. Wahidin — that is why the couple picked it). At the bounds-fitted zoom these markers are 1–3 px apart and unreadable as separate dots. Resolution: the three venue-cluster markers (Graha 58, Selat Solo, SMK Murni) use **slight visual offsets at low zoom plus `riseOnHover`/z-index ordering**, and clicking any cluster marker **zooms the map to ≥17** (where the three positions are ~50+ px apart) with the popup opening after the zoom settles. This is an explicit interaction, not silent overlap.

### D9 — Section placement and edge-to-edge layout

`VenueMap.astro` remains immediately above `<div id="rsvp-section">`, but the map itself escapes the copy column and section horizontal padding: it is edge-to-edge at the viewport width. Heading/copy stay constrained. The map uses a more vertical `h-[560px] md:h-[720px]` surface, with no rounded clipping.

### D10 — Coordination with the landed `rsvp-live-count` (ownership only, no merge order)

- **Ownership**: `rsvp-live-count` owns the Event Details / RSVP section (`index.astro:230` `<div id="rsvp-section">`), the venue-name line (`VENUE_NAME`/`VENUE_CITY` from `lib/venue.ts`), and the RSVP UI. `venue-map-routes` inserts its map section immediately ABOVE that div and renders NO venue-name line of its own — the single venue-name instance on the page is owned by `rsvp-live-count`. There is no inversion branch: the plan does NOT describe landing first, because that is no longer possible.
- **Interaction config**: disable the default top-left zoom placement and mount `new Control.Zoom({ position: "topright" })`; wheel zoom stays disabled. Desktop dragging is enabled. Coarse/touch-primary devices keep dragging disabled so one-finger vertical page scroll passes through. Route-planning options remain the touch overview escape by fitting the selected route.

### D11 — Frontmatter → client data hand-off, and lazy-loaded geometry

The component has two data domains with different delivery requirements:

- **Small data** (6 location records + venue pin + per-route distance/duration strings, ~1 KB): lives in the frontmatter (where the `existsSync` image filter runs), serialized into an inline `<script type="application/json" data-venue-map>` tag — the repo's established pattern (`StoryViewer.astro:28` JSON-tag, `TextShimmer.astro:24` data-attribute). The bundled client script parses this tag at init. `define:vars` is rejected: it forces `is:inline`, which the plan prohibits for the main script.
- **Bulky geometry** (~630 coordinate pairs ≈ 12–18 KB): lives in a separate `apps/web/src/components/venue-map-routes.ts` module and is imported with `await import()` INSIDE the IntersectionObserver lazy branch (alongside `import("leaflet")`). Shipping it in the component's bundled script or in the HTML would push 12–18 KB to every visitor including those who never scroll to the map — directly contradicting the spec's "no map resources loaded on initial page load" scenario.

### D12 — No-JS fallback, venue-name invariant, and non-duplicating placeholder copy

- **No-JS**: the "Map loading…" placeholder is terminal without JavaScript (the IntersectionObserver never runs). The component includes a `<noscript><style>` block (repo idiom: `WelcomeGate.astro:72`) that hides the spinner copy and reveals the static fallback ("Directions to the venue" + Google Maps link) — the spec's no-permanent-spinner guarantee therefore covers JS-disabled visitors, not just failed imports.
- **Venue-name invariant, scoped**: the single-venue-name rule (D10) applies to the _visible_ venue-name line owned by `rsvp-live-count`. The map section's own placeholder/fallback deliberately uses NON-duplicating copy — "Directions to the venue" and a Google Maps link — instead of repeating "Graha 58 Gedung Serbaguna UMS / Surakarta", so the invariant holds even while the placeholder is visible or after a Leaflet failure. Task 5.7 is worded against duplicate visible venue-name blocks, not against any occurrence of the address.

### D13 — Route-planning controls and cluster-open edge cases

- **Route planning as overview escape**: the bottom-left route option chips remain visible in their horizontally scrollable row, and selecting one renders that route's path and fits origin route + destination; toggling the active route off hides the path without moving the view. Top-right `+ / −` controls support manual zoom; the previous transient "Show all routes" button stays removed.
- **Cluster open when already at target**: the popup opens after `moveend`, but if the map is already at zoom 17 centered on the tapped cluster marker, `setView` is a no-op and `moveend` never fires. Check whether a move is needed; open immediately when already at target.
- **Reduced-motion zooms**: cluster zoom and route-option fitBounds pass `animate: false` when reduced motion is active.

### D14 — Runtime-built DOM styling constraints

Two Astro/Tailwind traps in the same runtime-built DOM, pinned together:

- **Global selectors** (already in D6): popup/divIcon/pulse styles must be `<style is:global>` / `:global()` because Leaflet builds the DOM at runtime without Astro's scope hash.
- **No interpolated Tailwind classes for data-driven colors**: `LOCATIONS[].color` is a hex string consumed at runtime; a class like `bg-${color}` is never generated by the Tailwind compiler, so marker fills MUST be set as inline `style="background:${color}"` in the divIcon HTML. Structural classes (`size-5`, `rounded-full`, `border-white`) that are literal strings in the component are fine.

### D15 — Venue constants centralized in `lib/venue.ts`

`apps/web/src/lib/venue.ts` already exists (created by `rsvp-live-count`) with `VENUE_NAME = "Graha 58 Gedung Serbaguna UMS"` and `VENUE_CITY`, and its header comment explicitly names this change as a consumer ("venue-map-routes imports the same constants when it lands so the name can never drift between sections"). Two rules follow:

- This change **extends** `lib/venue.ts` with `VENUE_LAT` / `VENUE_LNG` (the exact venue coordinate) so the appended route endpoint (task 2.2) and the Google Maps `destination=` URL (task 3.5) stop being triplicated literals.
- The destination **marker title** (accessible name) uses the **canonical `VENUE_NAME`** ("Graha 58 Gedung Serbaguna UMS") so it cannot drift from the RSVP section's venue line, while the destination **popup** shows the short "Graha 58" enlarged (MapCN rich-popup layout, category "Gedung Konvensi") per the couple's content spec.

### D16 — A11y implementation notes (verified against the Leaflet 2.0.0-alpha.1 source)

The spec's keyboard requirement lists behaviors Leaflet 2.0 does NOT give for free; each needs explicit code, pinned here so task 5.14 is verifiable (all three verified in the alpha source):

- **Space to open**: 2.0's popup `_onKeyPress` checks `e.originalEvent.code === 'Enter'` only. Space requires a custom `keydown` handler on the marker element.
- **Focus return on close**: the close button does not restore focus to the marker — the component must track the triggering marker and call `.focus()` on popup close.
- **Accessible name on a DivIcon**: 2.0's `_initIcon` assigns `icon.title = options.title` for ANY icon (including DivIcon) and only gates `alt` on `tagName === 'IMG'`. So the Marker `title` option now works for DivIcons — pass `title` at the Marker level (it also sets the hover tooltip), no need for manual `aria-label` in the icon HTML. (`keyboard: true` also sets `tabIndex='0'` + `role='button'` automatically.)

### D17 — Type-checking scope: `astro check` does not cover bundled `<script>` bodies

Task 5.12's `pnpm check-types` runs `astro check`, which does NOT type-check bundled `<script>` bodies inside `.astro` files — and all the Leaflet calls live there. To get real type coverage for the map logic, the init/marker/polyline code lives in `venue-map-routes.ts` (or a sibling `.ts` module) rather than inline in the `<script>` body; the script body then only wires the observer and delegates. With Leaflet 2.0 there are no official types (D1), so the module declares a minimal local `.d.ts` for the ~10 named imports it uses — that local declaration file IS what `astro check` validates, which keeps 5.12 meaningful.

### D18 — MapCN route planning + compact Google Maps control

- **Toggleable single route, hidden until picked**: initialize with NO route selected and NO route path rendered — the map opens zoomed to Graha 58 (zoom 17) with the venue popup already open and the directions control pointing at the venue's Google Maps place page. Four option chips sit in the bottom-left row: "Terminal Tirtonadi", "Stasiun Purwosari", "Stasiun Solo Balapan", "Bandara Adi Soemarmo". The venue itself is the destination, not a route option — it gets no chip (it is still modeled internally as a `routeKey: "graha58"` location so its marker shares the origin-marker construction path). Selecting a chip, transit marker, or route polyline renders ONLY that route's path in its own color; selecting the already-active one again toggles back to the no-selection state — the path disappears and the view STAYS where the visitor left it (no zoom/pan back). Map-background clicks do not change selection.
- **Rendering**: only the selected route renders (core + glow underlay; the airport also gets its dashed access connector) in its own color at full opacity/weight. Nothing renders when no route is selected. The route chips sit in ONE bottom-left horizontally scrollable row (`overflow-x: auto`, chips are `flex: none` so they size to their content) that spans the FULL map width edge to edge (Leaflet's bottom-left corner is stretched with `right: 0` and its default 10px control margins are overridden) while the CARDS keep a small inset from the screen edges (`padding-inline: 10px` inside the scroll area, so the inset also applies when scrolled to either end); the strip itself is `pointer-events: none` (only the chips are interactive) so the empty part passes map/page gestures through, its scrollbar is hidden, it is lifted above the flush-bottom attribution strip, and selecting a route scrolls its active chip into view.
- **Google Maps control**: the map's only Google Maps exit; the top-left compact pill reads exactly "Open in Google Maps" for every state; it points at the venue's place page while no route is selected and tracks the active origin after a selection. Its surface follows the active device theme — a translucent-white card with dark ink (the same treatment as the zoom circles and route chips it sits beside) on the light map, black background with white text and border on the dark map — and both are stated explicitly so Leaflet's default blue anchor color cannot leak through.

### D19 — Device-following theme and attribution

No manual theme toggle is rendered. Initial theme is derived from `prefers-color-scheme`; a media-query listener updates tiles and popup/control theme when the OS preference changes. Leaflet's default attribution control stays enabled for legal provider credits, but `attributionControl.setPrefix(false)` removes the Leaflet prefix/Ukraine flag. CSS removes the attribution box/background and presents OSM/CARTO credits as unobtrusive inline text.
