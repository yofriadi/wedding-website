# Proposal: venue-map-routes

## Why

The homepage's Event Details / RSVP section is owned by the already-landed `rsvp-live-count` change (`index.astro:230` `<div id="rsvp-section">` rendering `RsvpSection.astro`, with venue copy from `lib/venue.ts`). What is still missing is any map or directions guidance: guests arriving from out of town (via airport, train station, or bus terminal) and local guests need a clear, interactive reference for how to reach the venue (**Graha 58 Gedung Serbaguna UMS**, Jl. Dr. Wahidin, Purwosari, Surakarta) and what points of interest surround it.

This change adds an interactive map section (Leaflet 2.0 — styled after the `mapcn` shadcn-style component patterns; `mapcn` itself is React + MapLibre, so it is not adopted — see design D1) immediately above the RSVP section. It renders four driving routes from key transit hubs to Graha 58, and rich-popup markers for both the transit origins and nearby points of interest (a restaurant and a landmark school). The map is a self-contained, invite-agnostic section: no cookies, no API, no session logic.

## What Changes

- **Interactive venue map section**: A new `VenueMap.astro` component is inserted into the homepage immediately above the `rsvp-live-count` Event Details section (`index.astro:230`). It renders an edge-to-edge, taller Leaflet 2.0 map whose CartoDB tiles and popup styling follow the visitor's device color scheme (Dark Matter for dark, Positron for light).
- **Four driving routes to Graha 58** (all rendered as polylines on the map):
  - **Terminal Tirtonadi → Graha 58** — guest-facing estimate: **3.3 km / 14 min** — via Jl. A. Yani / Jl. MT Haryono / Jl. Dr. Moewardi
  - **Stasiun Purwosari → Graha 58** — guest-facing estimate: **1.9 km / 8 min** — via Jl. Slamet Riyadi
  - **Stasiun Solo Balapan → Graha 58** — guest-facing estimate: **3.0 km / 13 min** — via Jl. Wolter Monginsidi / Jl. A. Yani
  - **Bandara Adi Soemarmo → Graha 58** — guest-facing estimate: **11 km / 29 min** — via Jl. Raya Solo / Jl. A. Yani
    Each route is drawn as a Leaflet polyline (the `MapRoute` pattern from `mapcn`) with a distinct color and a labeled origin marker. The shared destination (Graha 58) has a prominent destination pin.
- **Rich-popup markers on all origins and POIs** (the `mapcn` Rich Popups pattern adapted to Leaflet popups):
  - **Terminal Tirtonadi** — type: Terminal, name: Tirtonadi, image: local photo
  - **Stasiun Purwosari** — type: Stasiun, name: Purwosari, image: local photo
  - **Stasiun Solo Balapan** — type: Stasiun, name: Solo Balapan, image: local photo
  - **Bandara Adi Soemarmo** — type: Bandara, name: Adi Soemarmo, image: local photo
  - **Selat Solo Tenda Biru** — type: Restoran, name: Selat Solo Tenda Biru, image: local photo
  - **SMK Murni 1 Surakarta** — type: Sekolah, name: SMK Murni 1 Surakarta, image: local photo
    Each popup follows the Rich Popups pattern on a thin 200px card: full-bleed photo banner at top, category label, name, and — on transit origins (Tirtonadi, Purwosari, Solo Balapan, Adi Soemarmo) — a distance/duration line. Popups are informational: no "Open in Google Maps" button inside them (removed per the couple), so the compact top-left control is the map's only Google Maps exit — the venue's place page while nothing is selected, driving directions from the active origin afterwards. The destination popup shows category "Gedung Konvensi" with "Graha 58" enlarged; POI popups (Selat Solo, SMK Murni) carry no distance/duration. Popups close by clicking outside.
- **MapCN-style route planning control (bottom-left)**: Four chips sit in a single horizontally scrollable row — "Terminal Tirtonadi", "Stasiun Purwosari", "Stasiun Solo Balapan", "Bandara Adi Soemarmo", each with typical drive time + distance (the venue is the destination, not a route option, so it gets no chip). Initially nothing is selected and NO route path renders: the map opens zoomed to Graha 58 with its popup already open. Selecting a chip, transit marker, or route polyline renders ONLY that route's path in its own color; selecting the active one again hides the path and leaves the view where the visitor put it.
- **Map controls**: Leaflet `+ / −` zoom controls render at the top-right. The compact top-left "Open in Google Maps" control is themed with the map (translucent-white card + dark ink on the light map, strict black background + white text/border on the dark map), points at the venue's place page while nothing is selected, and follows the active origin route after a selection. Popups have no X close button — outside clicks and Escape dismiss them — and no action button either.
- **Device-following map theme**: The map automatically uses CartoDB Dark Matter for `prefers-color-scheme: dark` and Positron for light, updates if the device preference changes, and has no manual theme toggle.
- **Route geometry baked at build time**: The four route polylines are pre-computed (via OSRM public routing API) and embedded as static GeoJSON coordinate arrays in the component. No runtime routing API calls. This eliminates an external runtime dependency and a potential failure point.
- **Section copy**: The map section renders NO venue-name line of its own — exactly one venue-name block exists on the page, owned by the landed `rsvp-live-count` section (the map's own placeholder/fallback uses non-duplicating copy like "Directions to the venue"). The RSVP section (venue line, RSVP UI, "Formal Invitation to Follow" footer) is untouched by this change.

## Non-goals

- **Live routing** — route geometry is pre-computed and static; no runtime OSRM calls.
- **Public transit or walking routes** — driving only.
- **RSVP functionality** — owned by the landed `rsvp-live-count` change; this change does not touch the RSVP block.
- **Google Maps embed** — the map is a self-hosted Leaflet map, not an iframe embed. (`mapcn` itself is not adopted — see design D1.)
- **Additional POIs** — only the five named locations; the couple can add more later by editing the data array.
- **Invite-gating** — the map section is visible to all visitors (public + invitees); it contains no guest-specific data.
- **Venue photos gallery** — the popup images are small banner images (~300×200); a full venue gallery is out of scope.
- **Site-wide light theme** — only the map follows the device color scheme; the rest of the site remains unchanged.

## Capabilities

### New Capabilities

- `venue-map`: The interactive map section rendering driving routes and rich-popup markers for transit origins and points of interest around Graha 58 Gedung Serbaguna UMS.

### Modified Capabilities

None — no existing spec covers the Event Details section.

## Impact

- **Code**: New `apps/web/src/components/VenueMap.astro` and `apps/web/src/components/venue-map-routes.ts`; extended `apps/web/src/lib/venue.ts` (`VENUE_LAT`/`VENUE_LNG`); modified `apps/web/src/pages/index.astro` (insert map section above the RSVP section); new static image assets in `apps/web/public/map/` (6 location photos + venue photo); new dependency `leaflet` **pinned to `2.0.0-alpha.1` exactly** (no `@types/leaflet` — no 2.0 types exist; a minimal local `.d.ts` is declared in the map module) — no React, no `mapcn` packages.
- **Specs**: New spec `venue-map` under `openspec/specs/venue-map/`.
- **Risk**: route coordinates are static and must be manually re-snapshotted if the venue or road network changes. **Leaflet 2.0 is an alpha release** — the API may shift before final; containment is the exact version pin, the single lazy-loaded section's blast radius, the static fallback, and the Playwright suite. Integration risk is low: `rsvp-live-count` has already landed, so there is no merge-order question — only a boundary (map above the RSVP section, one venue-name line).
- **Performance**: The map is client-rendered only after scroll (IntersectionObserver lazy-mount) to avoid blocking initial page load. Map tiles are fetched from CartoDB (`basemaps.cartocdn.com`, free tier, no API key) with required OSM + CARTO attribution — Dark Matter or Positron according to the visitor's device color scheme.
- **Coordination with `rsvp-live-count` (landed)**: `rsvp-live-count` has already shipped — `RsvpSection.astro` owns the Event Details section, the venue-name line (`lib/venue.ts`), and the RSVP UI; "The Grand Estate" is gone. This change therefore only inserts the map section immediately above `<div id="rsvp-section">` (`index.astro:230`) and renders no venue-name line of its own — exactly one venue-name block exists on the page, owned by `rsvp-live-count`. The venue constants (`VENUE_NAME`/`VENUE_CITY`, extended with `VENUE_LAT`/`VENUE_LNG`) are imported from the shared `lib/venue.ts` so the name can never drift between sections.
