# venue-map Specification

## Purpose

Behavioral requirements for the interactive venue map section on the homepage: four driving routes from transit hubs to Graha 58 Gedung Serbaguna UMS, rich-popup markers for transit origins and points of interest, and lazy initialization that does not block initial page load.

## ADDED Requirements

### Requirement: Map section is inserted above the landed RSVP section

The homepage SHALL render an interactive map section immediately above the already-landed `rsvp-live-count` RSVP/Event-Details section (`index.astro`'s `<div id="rsvp-section">`, which owns the single venue-name line), containing a Leaflet-powered map with route polylines and popup markers.

#### Scenario: Section renders in the page

- **WHEN** the homepage HTML is delivered
- **THEN** the venue map section markup is present (map container, section heading, and non-duplicating placeholder copy such as "Directions to the venue"), positioned immediately above the RSVP/Event-Details section that owns the single venue-name line; the map section itself renders no duplicate venue-name block

---

### Requirement: Route planning keeps exactly one route active

The map SHALL offer four pre-computed driving route options, but render NO route polyline until the visitor selects one. Initially the map opens zoomed to Graha 58 with the venue popup already open and zero route paths on the canvas. Four route-planning chips — "Terminal Tirtonadi", "Stasiun Purwosari", "Stasiun Solo Balapan", "Bandara Adi Soemarmo", each with typical drive time and distance — sit in a single bottom-left horizontally scrollable row. The venue itself is the destination, not a route option, so it gets NO chip. Selecting a chip, transit marker, or route polyline renders ONLY that route's path in its own color; selecting the already-active chip/marker/polyline SHALL toggle back to the no-selection state — the path disappears, the directions control returns to the venue's place page, and the map view STAYS where the visitor left it (no zoom/pan back to the venue). No runtime routing API request is made.

#### Scenario: Initial active route

- **WHEN** the map initializes
- **THEN** no route chip is active, NO route path is rendered, the view is zoomed to Graha 58, the venue popup is already open, and the baked geometry's endpoints still equal their exact origin and destination pins

#### Scenario: Route option changes active route

- **WHEN** a visitor selects the Purwosari or Adi Soemarmo route-planning button (or its transit marker)
- **THEN** that route's path renders in its own color, its geometry is fit into view with the venue, and the Google Maps directions link follows that origin

#### Scenario: Route coordinates are static

- **WHEN** the map initializes
- **THEN** no network request is made to any routing API; route geometry is embedded in the component source

---

### Requirement: Graha 58 destination marker is visually distinct

The map SHALL render a prominent destination marker at Graha 58 Gedung Serbaguna UMS that is visually larger and more attention-grabbing than origin or POI markers.

#### Scenario: Destination marker present

- **WHEN** the map is initialized
- **THEN** a red marker is visible at the Graha 58 coordinate, larger than all other markers

#### Scenario: Destination popup opens on click

- **WHEN** a visitor clicks or taps the Graha 58 destination marker
- **THEN** a MapCN-style rich popup opens with a photo banner (when `graha-58.webp` exists), the category label "Gedung Konvensi", the short venue name "Graha 58" enlarged relative to other popup names — and no action button, since the top-left control is the map's only Google Maps exit. The marker's accessible title keeps the canonical `VENUE_NAME` from `lib/venue.ts`

---

### Requirement: Transit origin markers have rich popups

Each transit origin (Terminal Tirtonadi, Stasiun Purwosari, Stasiun Solo Balapan, Bandara Adi Soemarmo) SHALL have a clickable/tappable marker that opens a rich popup containing a category label, a short name, and the curated distance/duration line. Popups are informational: they carry no "Open in Google Maps" action — directions from that origin open through the route-planning chip and the top-left control. An image banner is included when its photo asset exists in `public/map/`; when a photo is absent the popup renders text-only (no broken-image banner) — the asset-existence filter follows the repo's `teaserAssetExists()` pattern.

#### Scenario: Tirtonadi popup content

- **WHEN** a visitor clicks the Tirtonadi origin marker
- **THEN** a popup opens containing: the category label "Terminal", the name "Tirtonadi", and — when the `tirtonadi.webp` asset exists — an image banner

#### Scenario: Purwosari popup content

- **WHEN** a visitor clicks the Purwosari origin marker
- **THEN** a popup opens containing: the category label "Stasiun", the name "Purwosari", and — when the `purwosari.webp` asset exists — an image banner

#### Scenario: Adi Soemarmo popup content

- **WHEN** a visitor clicks the Adi Soemarmo origin marker
- **THEN** a popup opens containing: the category label "Bandara", the name "Adi Soemarmo", and — when the `soemarmo.webp` asset exists — an image banner

#### Scenario: Popup image is local and lazy-loaded

- **WHEN** any rich popup with an image banner opens
- **THEN** the image banner is served from a local path under `/map/` (not an external URL), has `loading="lazy"`, has an `alt` text naming the location, and is removed from the popup DOM if the request fails (`onerror`)

---

### Requirement: POI markers have rich popups

Two points of interest near the venue (Selat Solo Tenda Biru, SMK Murni 1 Surakarta) SHALL each have a clickable/tappable marker that opens a MapCN-style rich popup with a category label, a name, and an image banner when its photo asset exists. POI popups are informational: no "Open in Google Maps" action, no driving directions, no distance/duration line.

#### Scenario: Selat Solo popup content

- **WHEN** a visitor clicks the Selat Solo Tenda Biru marker
- **THEN** a popup opens containing: the category label "Restoran", the name "Selat Solo Tenda Biru", and — when the photo asset exists — an image banner

#### Scenario: SMK Murni popup content

- **WHEN** a visitor clicks the SMK Murni 1 Surakarta marker
- **THEN** a popup opens containing: the category label "Sekolah", the name "SMK Murni 1 Surakarta", and — when the photo asset exists — an image banner

---

### Requirement: Map theme follows the device color scheme

The map SHALL automatically use CartoDB Dark Matter for dark device preferences and CartoDB Positron for light device preferences. It SHALL not render a manual theme toggle, SHALL update if the device preference changes, and SHALL keep popup styling aligned with the active scheme.

#### Scenario: Light device preference

- **WHEN** `prefers-color-scheme: light` is active at map initialization
- **THEN** Positron tiles and light popup surfaces are used, with no manual theme button

#### Scenario: Dark device preference

- **WHEN** `prefers-color-scheme: dark` is active or later becomes active
- **THEN** Dark Matter tiles and dark popup surfaces are used

#### Scenario: Attribution is legally present but visually minimal

- **WHEN** the map is visible
- **THEN** OpenStreetMap and CARTO credits remain available as subtle inline attribution, while Leaflet's prefix/Ukraine flag and the default boxed attribution container are absent

---

### Requirement: Map is lazy-initialized via IntersectionObserver

Leaflet and map tiles SHALL NOT be loaded until the map section is near the viewport, to avoid blocking initial page load.

#### Scenario: No map resources loaded on initial page load

- **WHEN** a visitor loads the homepage and has not scrolled to the map section
- **THEN** no Leaflet JavaScript or map tile requests are made

#### Scenario: Map initializes before entering viewport

- **WHEN** a visitor scrolls toward the map section and the section approaches within ~1.5 viewport-heights of the viewport (matching the `150% 0px` rootMargin convention of the existing section preloader)
- **THEN** the map initializes and tiles begin loading before the section is fully visible

---

### Requirement: Popup styling follows the active device theme

Map popups SHALL use dark surfaces with light text when the device prefers dark and light surfaces with dark text when the device prefers light, overriding Leaflet's fixed default popup theme.

#### Scenario: Popup theme matches device preference

- **WHEN** any marker popup opens
- **THEN** its surface and text match the active device-following map theme without a manual toggle

#### Scenario: Popup carries no Google Maps action

- **WHEN** any marker popup opens
- **THEN** the card holds no link or button — its content is informational, and Google Maps is reached from the top-left control

---

### Requirement: Map load failure degrades to a static fallback

If the Leaflet bundle fails to load (offline, chunk 404), the map section SHALL render a static fallback with non-duplicating directions copy, the address, and an "Open in Google Maps" link instead of a permanent loading placeholder. That static link SHALL follow the section's own device theme (white pill with dark ink on the light surface, black pill with white text on the dark one). If only the tile CDN is unreachable, map overlays remain usable on the neutral container background.

#### Scenario: Leaflet import fails

- **WHEN** the dynamic Leaflet import rejects
- **THEN** the placeholder swaps to the non-duplicating static fallback (directions copy, address, Google Maps link) and no retry loop runs

#### Scenario: Tile CDN unreachable

- **WHEN** the Leaflet bundle loads but tile requests fail
- **THEN** route polylines and markers still render on the neutral container background, and the section remains usable

---

### Requirement: Curated route distance and duration labels are shown

Each transit origin marker and route-planning option SHALL display the couple-provided guest estimate for road distance and typical drive time.

#### Scenario: Distance and duration in Tirtonadi popup

- **WHEN** the Tirtonadi popup is open
- **THEN** it shows "3.3 km" and "14 min" alongside the other content

#### Scenario: Distance and duration in Purwosari popup

- **WHEN** the Purwosari popup is open
- **THEN** it shows "1.9 km" and "8 min" alongside the other content

#### Scenario: Distance and duration in Adi Soemarmo popup

- **WHEN** the Adi Soemarmo popup is open
- **THEN** it shows "11 km" and "29 min" alongside the other content

---

### Requirement: Venue-cluster markers remain legible at bounds-fitted zoom

The Graha 58, Selat Solo, and SMK Murni markers sit 46–62 m apart and overlap at the bounds-fitted zoom. The map SHALL provide a deliberate interaction to resolve them: clicking any venue-cluster marker zooms the map to ≥17 (where the three positions separate to ~50+ px) and opens the marker's popup after the zoom settles.

#### Scenario: Cluster click zooms in

- **WHEN** a visitor clicks the Graha 58, Selat Solo, or SMK Murni marker while the map is at the bounds-fitted zoom
- **THEN** the map animates to zoom ≥17 centered on the clicked marker and its popup opens after the zoom settles; if the map is already at the target zoom and center (e.g. a second tap), the popup opens immediately without waiting for a move event

---

### Requirement: Motion honors prefers-reduced-motion

The destination marker's pulse-ring animation SHALL be disabled when the user prefers reduced motion; the marker remains fully visible and clickable without animation. Cluster zoom and route-option fit transitions SHALL complete instantly (`animate: false`) under reduced motion.

#### Scenario: Reduced-motion visitor sees static destination marker

- **WHEN** `prefers-reduced-motion: reduce` is active and the map renders
- **THEN** the Graha 58 destination marker shows no pulse/ping animation, cluster zoom and route-option fit transitions are instant, and all markers/popups remain fully functional

---

### Requirement: Map interaction is streamlined

The map SHALL place Leaflet's `+ / −` zoom control at the top-right rather than its default top-left position, restyled as two detached 36px circles with a 6px gap (no joined bar, matching the MapCN card styling of the other controls). Desktop visitors SHALL be able to drag the map. Touch-primary devices SHALL preserve one-finger page-scroll pass-through, and route-planning buttons SHALL provide the route-overview escape by fitting the selected origin + destination.

#### Scenario: Desktop drag and zoom controls

- **WHEN** a desktop visitor uses the map
- **THEN** the map pans by dragging and one accessible `+ / −` zoom control is visible at the top-right

#### Scenario: Touch route overview

- **WHEN** a touch visitor selects any route-planning option after cluster zoom
- **THEN** the map fits that route's origin and destination, instantly under reduced motion

---

### Requirement: Static fallback for no-JS visitors

With JavaScript disabled, the map section SHALL render its static fallback (non-duplicating directions copy and a plain static Google Maps venue link) instead of the permanent "Map loading…" spinner — the lazy-init observer never runs without JS. The dynamic top-left "Open in Google Maps" control is JS-built and therefore absent without JS; the fallback's static venue link is the only venue-Google-Maps path for no-JS visitors.

#### Scenario: No-JS visitor reaches the map section

- **WHEN** a visitor with JavaScript disabled scrolls to the map section
- **THEN** the static fallback (directions copy + static Google Maps venue link) is visible, the "Map loading…" spinner copy is hidden (e.g. via a `<noscript><style>` rule), and the dynamic top-left control is absent

---

### Requirement: Markers, popups, and route planning are keyboard-accessible

All markers SHALL be keyboard-focusable with an accessible name. Enter and Space SHALL open marker popups and closing a popup SHALL return focus to its marker. Each route-planning button and the compact "Open in Google Maps" control SHALL also be keyboard-focusable with accessible names.

#### Scenario: Keyboard user opens a popup

- **WHEN** a keyboard user tabs to a marker and presses Enter or Space
- **THEN** its popup opens, focus moves into the popup, and closing returns focus to the marker

#### Scenario: Keyboard user changes the active route

- **WHEN** a keyboard user activates a route-planning option
- **THEN** it becomes the only active route and the Google Maps link updates

### Requirement: Compact Google Maps control follows the active route

The top-left control is the map's only Google Maps exit and SHALL always read exactly "Open in Google Maps". While no route is selected (the initial state and after a toggle-off) it SHALL link to the venue's Google Maps place page; once a route is selected it SHALL link to Google Maps driving directions from the active route origin to Graha 58. Its surface SHALL follow the active device theme — a translucent-white card with dark ink on the light map (the same treatment as the zoom circles and route chips), the black pill with white text and border on the dark map — and every surface is stated explicitly so Leaflet's default blue link styling cannot leak through.

#### Scenario: Control follows active origin

- **WHEN** the active route changes from one origin to another
- **THEN** the button label remains "Open in Google Maps" while its origin query changes to the active route

#### Scenario: Selecting the active route again toggles it off

- **WHEN** a visitor selects the currently active route's chip, transit marker, or route polyline
- **THEN** the selection clears (no chip active, the route path is hidden), the view STAYS where the visitor left it, and the directions control returns to the venue's Google Maps place page
