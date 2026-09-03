// Venue map runtime — all Leaflet calls live in this typed module.
//
// `astro check` does NOT type-check bundled `<script>` bodies inside .astro
// files (design D17), so VenueMap.astro's script is thin wiring only (the
// IntersectionObserver + delegation) and everything Leaflet-shaped is here,
// validated against the local leaflet.d.ts.
//
// Leaflet 2.0.0-alpha.1 notes (verified against the alpha source, design D1):
//   - ESM-only; no global `L`; factory functions removed → named imports +
//     constructors (`new Map(...)`, `new TileLayer(...)`, ...).
//   - `Map` is exported both as `Map` and `LeafletMap`; the `Map` name shadows
//     the DOM `Map` here, so the DOM map is referenced via `globalThis`.
//
// A11y notes (design D16, spec "Markers and popups are keyboard-accessible"):
//   - Marker `title` sets an accessible name for ANY icon incl. DivIcon.
//   - `keyboard: true` (default) sets tabIndex=0 + role=button.
//   - Leaflet 2.0's popup `_onKeyPress` opens on `code === 'Enter'` ONLY →
//     a custom keydown handler adds Space.
//   - Leaflet does NOT restore focus to the marker on popup close → tracked
//     here and restored on `popupclose`.

import {
  Control,
  DivIcon,
  DomEvent,
  LatLngBounds,
  Map,
  Marker,
  Polyline,
  TileLayer,
  type LatLngLiteral,
  type LatLngTuple,
  type Map as LeafletMap,
  type PopupEvent,
} from "leaflet";
import { VENUE_LAT, VENUE_LNG } from "../lib/venue";
import type { VenueRouteGeometry } from "./venue-map-routes";

/** Small data handed over from VenueMap.astro's frontmatter via the JSON tag. */
export interface VenueMapLocation {
  id: string;
  type: string;
  name: string;
  lat: number;
  lng: number;
  color: string;
  /** Route key for transit origins; null for POIs. */
  routeKey: string | null;
  /** Popup banner path; absent when the photo asset is missing at build time. */
  image?: string;
}

export interface VenueMapRouteMeta {
  distanceKm: string;
  durationLabel: string;
}

export interface VenueMapData {
  venue: {
    name: string;
    /** Short venue name shown large in the popup (MapCN rich-popup layout). */
    popupName: string;
    /** Category label, e.g. "Gedung Konvensi". */
    category: string;
    city: string;
    address: string;
    /** Google Maps place link behind the top-left directions control. */
    mapUrl: string;
    lat: number;
    lng: number;
    /** Banner path; absent when the photo asset is missing at build time. */
    image?: string;
  };
  locations: VenueMapLocation[];
  routes: Record<string, VenueMapRouteMeta>;
}

const CONTAINER_SELECTOR = "[data-venue-map-container]";
const JSON_TAG = "script[type='application/json'][data-venue-map]";
const PLACEHOLDER_SELECTOR = "[data-venue-map-placeholder]";
const FALLBACK_SELECTOR = "[data-venue-map-fallback]";

const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

const DARK_TILES = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const LIGHT_TILES = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

/** Zoom at which the venue cluster (46–62 m apart) separates to ~50+ px. */
const CLUSTER_ZOOM = 17;
/** Degrees tolerance when deciding whether setView would be a no-op. */
const CENTER_TOLERANCE = 0.0002;

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Escape a string for interpolation into popup HTML. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function directionsUrl(origin: { lat: number; lng: number }): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${VENUE_LAT},${VENUE_LNG}&travelmode=driving`;
}

function bannerHtml(src: string, name: string): string {
  // Popups use local WebP map assets; retain the AVIF path when callers supply
  // a modern-format source and fall back to the existing URL if necessary.
  const avifSrc = src.endsWith(".webp") ? src.replace(/\.webp$/, ".avif") : src;
  return `<div class="venue-map-popup-banner"><picture><source src="${avifSrc}" type="image/avif"><img src="${src}" alt="${escapeHtml(name)}" loading="lazy" decoding="async" onerror="this.parentElement?.remove()"></picture></div>`;
}

/** Maps Marker → its location record for event handlers. */
const locationByMarker = new globalThis.Map<Marker, VenueMapLocation>();

/** Marker whose popup is open, for focus restoration on close (D16). */
let popupOwner: Marker | null = null;

/**
 * Cluster marker awaiting its moveend popup open (D13). Guarded so a stale
 * callback cannot yank an older marker's popup back open over a newer one.
 */
let pendingClusterOpen: Marker | null = null;

interface MapRuntime {
  map: Map;
  markers: Marker[];
  destinationMarker: Marker;
  /** Currently rendered route polylines (null when no route is selected). */
  routeLines: Polyline[] | null;
  selectRoute: (routeKey: string) => void;
}

const runtimes = new globalThis.Map<HTMLElement, MapRuntime>();

// ---------------------------------------------------------------------------
// Popups
// ---------------------------------------------------------------------------

function popupFrame(banner: string, body: string, opts: { venue?: boolean } = {}): string {
  // tabindex="-1" keeps the D16 contract: the popup has no interactive content
  // of its own, so `popupopen` focuses the card itself — otherwise a screen
  // reader would never hear what the marker just revealed.
  return `<div class="venue-map-popup${opts.venue ? " venue-map-popup-venue" : ""}" tabindex="-1">${banner}<div class="venue-map-popup-body">${body}</div></div>`;
}

function labelLine(label: string): string {
  return `<p class="venue-map-popup-type">${escapeHtml(label)}</p>`;
}

function nameLine(name: string): string {
  return `<h3 class="venue-map-popup-name">${escapeHtml(name)}</h3>`;
}

/*
 * Rich popups are informational: banner + category + name (+ the route's
 * distance/duration on transit origins). They carry NO action — the single
 * Google Maps exit is the top-left directions control, which follows the
 * active route.
 */
function originPopupHtml(loc: VenueMapLocation, route: VenueMapRouteMeta): string {
  const banner = loc.image ? bannerHtml(loc.image, loc.name) : "";
  return popupFrame(
    banner,
    `<div>
      ${labelLine(loc.type)}
      ${nameLine(loc.name)}
    </div>
    <p class="venue-map-popup-meta">${escapeHtml(route.distanceKm)} &middot; ${escapeHtml(route.durationLabel)}</p>`,
  );
}

function poiPopupHtml(loc: VenueMapLocation): string {
  const banner = loc.image ? bannerHtml(loc.image, loc.name) : "";
  return popupFrame(
    banner,
    `<div>
      ${labelLine(loc.type)}
      ${nameLine(loc.name)}
    </div>`,
  );
}

function destinationPopupHtml(venue: VenueMapData["venue"]): string {
  const banner = venue.image ? bannerHtml(venue.image, venue.popupName) : "";
  return popupFrame(
    banner,
    `<div>
      ${labelLine(venue.category)}
      ${nameLine(venue.popupName)}
    </div>`,
    { venue: true },
  );
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

function buildOriginMarker(loc: VenueMapLocation, venue: VenueMapData["venue"]): Marker {
  if (loc.routeKey === "graha58") {
    // Venue entry — the red pulsing destination pin, NOT a route origin.
    return new Marker([loc.lat, loc.lng], {
      icon: new DivIcon({
        className: "venue-map-marker venue-map-marker-destination",
        html: `<div class="venue-map-marker-pin venue-map-marker-pin-destination">
            <span class="venue-map-marker-pulse" aria-hidden="true"></span>
            <span class="venue-map-marker-dot venue-map-marker-dot-destination"></span>
          </div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        popupAnchor: [0, -15],
      }),
      title: venue.name,
      keyboard: true,
      riseOnHover: true,
    });
  }
  // Transit origin: labeled pin in the route color. Inline style for the
  // fill — interpolated Tailwind classes are never generated by the
  // compiler (design D14).
  return new Marker([loc.lat, loc.lng], {
    icon: new DivIcon({
      className: "venue-map-marker",
      html: `<div class="venue-map-marker-pin">
          <span class="venue-map-marker-dot" style="background:${loc.color}"></span>
          <span class="venue-map-marker-label">${escapeHtml(loc.name)}</span>
        </div>`,
      iconSize: [26, 38],
      iconAnchor: [13, 19],
      popupAnchor: [0, -19],
    }),
    title: loc.name,
    keyboard: true,
    riseOnHover: true,
  });
}

function poiIcon(): DivIcon {
  return new DivIcon({
    className: "venue-map-marker",
    html: `<div class="venue-map-marker-pin venue-map-marker-poi">
        <span class="venue-map-marker-dot venue-map-marker-dot-poi"></span>
      </div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -9],
  });
}

// ---------------------------------------------------------------------------
// Route selection (design D18)
// ---------------------------------------------------------------------------

type RouteCoords = (LatLngLiteral | LatLngTuple)[];

function addRouteLines(
  map: LeafletMap,
  key: string,
  color: string,
  coords: RouteCoords,
): Polyline[] {
  // Airport access is not mapped as a routable road. Render only that first
  // pin-to-road chord as dashed; the remaining OSRM geometry stays solid.
  const hasConnector = key === "soemarmo" && coords.length > 2;
  const roadCoords = hasConnector ? coords.slice(1) : coords;

  const glow = new Polyline(roadCoords, {
    color,
    weight: 10,
    opacity: 0.24,
    lineJoin: "round",
  }).addTo(map);

  const core = new Polyline(roadCoords, {
    color,
    weight: 5,
    opacity: 1,
    lineJoin: "round",
  }).addTo(map);

  const lines = [glow, core];
  if (hasConnector) {
    lines.push(
      new Polyline([coords[0], coords[1]], {
        color,
        weight: 5,
        opacity: 1,
        lineJoin: "round",
        dashArray: "8,8",
      }).addTo(map),
    );
  }
  // Active route renders last/on top.
  glow.bringToFront();
  core.bringToFront();
  lines[2]?.bringToFront();

  // Draw-in (D13): each stroke sweeps from the origin pin toward the venue
  // over ~0.5s. Coordinates already run origin→venue (OSRM geometry), so the
  // natural stroke start IS the origin. WAAPI drives strokeDashoffset from the
  // path's total length to 0 with an inline strokeDasharray override; Leaflet
  // authors its own dashArray as an SVG ATTRIBUTE (not inline style), so
  // clearing the overrides on finish restores the dashed airport connector.
  // Reduced motion renders the complete path immediately.
  if (!prefersReducedMotion()) {
    for (const line of lines) {
      const path = line.getElement();
      if (!path) continue;
      const length = path.getTotalLength();
      if (!(length > 0)) continue;
      path.style.strokeDasharray = `${length}`;
      const draw = path.animate(
        { strokeDashoffset: [`${length}`, "0"] },
        { duration: 500, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "forwards" },
      );
      draw.finished
        .then(() => {
          // Un-selecting removes layers outright; a still-drawing path whose
          // element is gone just skips the restore.
          if (!path.isConnected) return;
          path.style.strokeDasharray = "";
          path.style.strokeDashoffset = "";
        })
        .catch(() => {
          // Animation cancelled (rapid re-selection): the layer is removed
          // anyway — nothing to restore.
        });
    }
  }
  return lines;
}

function removeRouteLines(map: LeafletMap, lines: Polyline[]): void {
  for (const line of lines) map.removeLayer(line);
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

class DirectionsControl extends Control {
  private anchor?: HTMLAnchorElement;

  constructor(opts: { position?: "topleft" }) {
    super({ position: opts.position ?? "topleft" });
  }

  protected onAdd(): HTMLElement {
    const anchor = document.createElement("a");
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.className = "venue-map-control-button venue-map-directions-control";
    anchor.textContent = "Open in Google Maps";
    DomEvent.disableClickPropagation(anchor);
    this.anchor = anchor;
    return anchor;
  }

  /** Active-route state: driving directions from that origin to the venue. */
  setOrigin(origin: VenueMapLocation): void {
    this.setLink(
      directionsUrl(origin),
      `Open route from ${origin.type} ${origin.name} in Google Maps`,
    );
  }

  /** Initial no-selection state: the venue's own Google Maps place page. */
  setVenue(venue: VenueMapData["venue"]): void {
    this.setLink(venue.mapUrl, `Open ${venue.name} in Google Maps`);
  }

  private setLink(href: string, label: string): void {
    if (!this.anchor) return;
    this.anchor.href = href;
    this.anchor.setAttribute("aria-label", label);
    this.anchor.setAttribute("title", label);
  }
}

interface RoutePlanningOption {
  key: string;
  /** Full chip label, e.g. "Terminal Tirtonadi" (type + name). */
  label: string;
  color: string;
  distanceKm: string;
  durationLabel: string;
}

class RoutePlanningControl extends Control {
  private buttons = new globalThis.Map<string, HTMLButtonElement>();
  private routeOptions: RoutePlanningOption[];
  private onSelect: (key: string) => void;

  constructor(opts: { options: RoutePlanningOption[]; onSelect: (key: string) => void }) {
    super({ position: "bottomleft" });
    this.routeOptions = opts.options;
    this.onSelect = opts.onSelect;
  }

  protected onAdd(): HTMLElement {
    const container = document.createElement("div");
    container.className = "venue-map-route-planner";
    container.setAttribute("role", "group");
    container.setAttribute("aria-label", "Route planning options");
    DomEvent.disableClickPropagation(container);
    DomEvent.disableScrollPropagation(container);

    for (const option of this.routeOptions) {
      const button = document.createElement("button");
      const duration = option.durationLabel.replace(" free-flow", "");
      const hasStats = duration !== "" && option.distanceKm !== "";
      button.type = "button";
      button.className = "venue-map-route-option";
      button.dataset.routeKey = option.key;
      button.setAttribute(
        "aria-label",
        hasStats ? `${option.label}: ${duration}, ${option.distanceKm}` : option.label,
      );
      // Hide the stats row when route meta is missing (defensive — every
      // origin chip normally has both a duration and a distance).
      const stats = hasStats
        ? `<span class="venue-map-route-stats">
          <span><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>${escapeHtml(duration)}</span>
          <span><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="6" cy="18" r="2"></circle><circle cx="18" cy="6" r="2"></circle><path d="M7.5 16.5 16.5 7.5"></path></svg>${escapeHtml(option.distanceKm)}</span>
        </span>`
        : "";
      button.innerHTML = `
        <span class="venue-map-route-name">
          <span class="venue-map-route-dot" style="background:${option.color}"></span>
          ${escapeHtml(option.label)}
        </span>
        ${stats}
      `;
      button.addEventListener("click", () => this.onSelect(option.key));
      this.buttons.set(option.key, button);
      container.appendChild(button);
    }

    return container;
  }

  setActive(routeKey: string | null): void {
    for (const [key, button] of this.buttons) {
      const active = key === routeKey;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    // The chips row scrolls horizontally; keep the active chip in view when
    // selection came from a marker or route-line click rather than the chip.
    if (routeKey === null) return;
    const activeButton = this.buttons.get(routeKey);
    const scroller = activeButton?.parentElement;
    if (!activeButton || !scroller) return;
    const target = activeButton.offsetLeft - (scroller.clientWidth - activeButton.offsetWidth) / 2;
    scroller.scrollTo({
      left: Math.max(0, target),
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function initVenueMap(section: HTMLElement, geometry: Record<string, VenueRouteGeometry>): void {
  const container = section.querySelector<HTMLElement>(CONTAINER_SELECTOR);
  const jsonTag = section.querySelector<HTMLScriptElement>(JSON_TAG);
  if (!container || !jsonTag) return;

  let data: VenueMapData;
  try {
    data = JSON.parse(jsonTag.textContent ?? "{}") as VenueMapData;
  } catch (err) {
    console.error("[venue-map] malformed data tag:", err);
    return;
  }

  const coarsePrimaryPointer = window.matchMedia("(pointer: coarse)").matches;
  const map = new Map(container, {
    zoomControl: false,
    attributionControl: true,
    scrollWheelZoom: false,
    // Gate the vendor's zoom animation too (D7), not just our setView calls —
    // zoom-control clicks and double-click zoom tween via Leaflet's own CSS.
    zoomAnimation: !prefersReducedMotion(),
    // Desktop remains draggable; touch-primary devices preserve one-finger
    // page scrolling while PinchZoom keeps touch-action: pan-x pan-y.
    dragging: !coarsePrimaryPointer,
  });
  map.attributionControl?.setPrefix(false);

  const zoomControl = new Control.Zoom({
    position: "topright",
    zoomInText:
      '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
    zoomOutText:
      '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
  });
  map.addControl(zoomControl);

  const darkTiles = new TileLayer(DARK_TILES, {
    attribution: ATTRIBUTION,
    subdomains: "abcd",
    maxZoom: 20,
  });
  const lightTiles = new TileLayer(LIGHT_TILES, {
    attribution: ATTRIBUTION,
    subdomains: "abcd",
    maxZoom: 20,
  });

  const deviceTheme = window.matchMedia("(prefers-color-scheme: dark)");
  const applyTheme = (dark: boolean) => {
    const next = dark ? darkTiles : lightTiles;
    const previous = dark ? lightTiles : darkTiles;
    if (map.hasLayer(previous)) map.removeLayer(previous);
    if (!map.hasLayer(next)) next.addTo(map);
    container.classList.toggle("theme-dark", dark);
    container.classList.toggle("theme-light", !dark);
  };
  applyTheme(deviceTheme.matches);
  deviceTheme.addEventListener("change", (event) => applyTheme(event.matches));

  // Locations are the map's single source of truth: the venue itself is the
  // first entry (routeKey "graha58") followed by the four transit origins.
  // POIs (routeKey null) stay separate — they are not route options.
  const venue = data.venue;
  type RouteOriginLocation = VenueMapLocation & { routeKey: string };
  const venueLocation: RouteOriginLocation = {
    id: "graha58",
    routeKey: "graha58",
    type: "Gedung Konvensi",
    name: venue.name,
    lat: venue.lat,
    lng: venue.lng,
    // The destination pin is styled pure-CSS (red); this color only feeds the
    // route chip dot for the venue row, which never renders a path.
    color: "#ef4444",
    image: venue.image,
  };
  const routeOrigins: RouteOriginLocation[] = data.locations.filter(
    (loc): loc is RouteOriginLocation => loc.routeKey !== null,
  );
  const mapLocations: RouteOriginLocation[] = [venueLocation, ...routeOrigins];
  const routeGeometry = new globalThis.Map(
    routeOrigins.map((loc) => [loc.routeKey, geometry[loc.routeKey].coordinates]),
  );

  // Markers (built from locations, so the venue pin is never route-colored).
  const markers: Marker[] = [];
  let destinationMarker!: Marker;
  for (const loc of mapLocations) {
    const marker = buildOriginMarker(loc, venue).addTo(map);
    locationByMarker.set(marker, loc);
    markers.push(marker);
    if (loc === venueLocation) destinationMarker = marker;
  }
  for (const loc of data.locations.filter((l) => l.routeKey === null)) {
    const marker = new Marker([loc.lat, loc.lng], {
      icon: poiIcon(),
      title: loc.name,
      keyboard: true,
      riseOnHover: true,
    }).addTo(map);
    locationByMarker.set(marker, loc);
    markers.push(marker);
  }

  // Initial view: zoomed to Graha 58 with no route selected — the venue
  // popup is opened at the end of init. FIRST view call, so no visible snap.
  map.setView([venue.lat, venue.lng], CLUSTER_ZOOM, { animate: false });

  const directions = new DirectionsControl({});
  map.addControl(directions);
  // No route selected initially: the control opens the venue's place page
  // until the first route selection hands it an origin.
  directions.setVenue(venue);

  let routePlanner: RoutePlanningControl | null = null;
  // null = no selection (initial state): NO route polyline is rendered.
  let selectedRouteKey: string | null = null;
  let selectedLines: Polyline[] | null = null;
  const selectRoute = (routeKey: string, fitRoute = true) => {
    const origin = mapLocations.find((loc) => loc.routeKey === routeKey);
    if (!origin) return;
    pendingClusterOpen = null;

    // Clicking the already-selected route (chip, marker, or polyline)
    // toggles back to the no-selection state.
    const unselecting = selectedRouteKey === routeKey;
    selectedRouteKey = unselecting ? null : routeKey;

    routePlanner?.setActive(selectedRouteKey);
    if (unselecting || origin === venueLocation) {
      directions.setVenue(venue);
    } else {
      directions.setOrigin(origin);
    }

    // Only the selected origin's path is shown; unselecting (or selecting
    // the venue itself) hides all route paths again.
    if (selectedLines) {
      removeRouteLines(map, selectedLines);
      selectedLines = null;
    }
    if (origin !== venueLocation && selectedRouteKey !== null) {
      const coords = routeGeometry.get(selectedRouteKey);
      if (coords) {
        selectedLines = addRouteLines(map, selectedRouteKey, origin.color, coords);
        selectedLines[1]?.on("click", () => selectRoute(selectedRouteKey as string));
      }
    }

    if (!fitRoute) return;
    // Leaflet silently swallows setView/fitBounds while a zoom animation is
    // in flight (`_tryAnimatedZoom` returns early WITHOUT re-targeting), and
    // even a non-animated setView gets clobbered when the stale animation's
    // 250ms end-timer fires. Force-complete the animation first so rapid
    // taps always land on the new view. Toggling OFF deliberately keeps the
    // current view — the visitor stays where they are; only the path hides.
    if (!unselecting && origin !== venueLocation) {
      const coords = routeGeometry.get(selectedRouteKey as string);
      if (coords) {
        map.stop();
        map._onZoomTransitionEnd();
        map.fitBounds(new LatLngBounds(coords), {
          padding: [40, 40],
          animate: !prefersReducedMotion(),
        });
      }
    }
  };

  routePlanner = new RoutePlanningControl({
    // Only the four transit origins are route options — the venue itself is
    // the destination, not a route, so it never gets a chip.
    options: routeOrigins.map((origin) => ({
      key: origin.routeKey,
      label: `${origin.type} ${origin.name}`,
      color: origin.color,
      distanceKm: data.routes[origin.routeKey]?.distanceKm ?? "",
      durationLabel: data.routes[origin.routeKey]?.durationLabel ?? "",
    })),
    onSelect: (key) => selectRoute(key),
  });
  map.addControl(routePlanner);

  // Deliberately NO initial selectRoute: no route path renders until the
  // visitor picks one.

  // Popup content is built lazily inside the click handler (D6) — six eager
  // popups would fetch all six banner images immediately.
  destinationMarker.bindPopup(() => destinationPopupHtml(venue), {
    maxWidth: 320,
    closeButton: false,
  });

  // A cluster zoom opens its popup on `moveend`; if the visitor clicks another
  // marker or a route chip before that fires, the stale callback would yank the
  // old marker's popup back open over the new one. Guard by identity; every
  // competing interaction clears `pendingClusterOpen`.
  const scheduleClusterPopup = (marker: Marker) => {
    pendingClusterOpen = marker;
    map.once("moveend", () => {
      if (pendingClusterOpen !== marker) return;
      pendingClusterOpen = null;
      marker.openPopup();
    });
  };

  for (const marker of markers) {
    const loc = locationByMarker.get(marker);
    if (!loc) continue;
    // The venue marker is a location now, but it owns its popup and its
    // cluster interaction separately — skip it here.
    if (marker === destinationMarker) continue;
    const isOrigin = loc.routeKey !== null;

    marker.bindPopup(
      () => {
        if (isOrigin) {
          const route = data.routes[loc.routeKey as string];
          return route ? originPopupHtml(loc, route) : poiPopupHtml(loc);
        }
        return poiPopupHtml(loc);
      },
      { maxWidth: 320, closeButton: false },
    );

    marker.on("click", () => {
      // Runs before the cluster handler below: cancel any stale cluster-popup
      // callback before it can be re-armed for this marker.
      pendingClusterOpen = null;
      // Toggles: re-clicking the selected origin clears the selection.
      if (isOrigin && loc.routeKey) selectRoute(loc.routeKey);
    });

    if (isOrigin) continue;

    // Venue-cluster POIs: zoom to >=17 on click so the 46–62 m-apart markers
    // separate (D8/D13). Destination marker shares the interaction below.
    marker.on("click", () => {
      const target = marker.getLatLng();
      const atTarget =
        map.getZoom() >= CLUSTER_ZOOM && map.getCenter().equals(target, CENTER_TOLERANCE);
      if (atTarget) {
        // setView would be a no-op → moveend never fires → open immediately.
        marker.openPopup();
        return;
      }
      map.stop();
      map._onZoomTransitionEnd();
      map.setView(target, CLUSTER_ZOOM, { animate: !prefersReducedMotion() });
      scheduleClusterPopup(marker);
    });
  }

  // Destination marker joins the cluster interaction.
  destinationMarker.on("click", () => {
    pendingClusterOpen = null;
    const target = destinationMarker.getLatLng();
    const atTarget =
      map.getZoom() >= CLUSTER_ZOOM && map.getCenter().equals(target, CENTER_TOLERANCE);
    if (atTarget) {
      destinationMarker.openPopup();
      return;
    }
    map.stop();
    map._onZoomTransitionEnd();
    map.setView(target, CLUSTER_ZOOM, { animate: !prefersReducedMotion() });
    scheduleClusterPopup(destinationMarker);
  });

  // Leaflet exposes no zoom in DOM; keep a tiny test/debug hook.
  const syncZoomState = () => {
    container.dataset.venueMapZoom = String(map.getZoom());
  };
  map.on("zoomend", syncZoomState);
  syncZoomState();

  // ---- A11y (D16) -------------------------------------------------------

  // `markers` already includes the destination marker (it is a location now).
  const focusables = markers;
  for (const marker of focusables) {
    const el = marker.getElement();
    if (!el) continue;
    // Leaflet 2.0 opens popups on Enter only — Space needs a custom handler.
    el.addEventListener("keydown", (event) => {
      if (event.code !== "Space") return;
      event.preventDefault();
      marker.fire("click", { originalEvent: event });
    });
  }

  // Focus the opened popup: it has no link/button anymore, so the query lands
  // on the card's own tabindex="-1". Closing returns focus to the marker below.
  map.on("popupopen", (event: PopupEvent) => {
    const popup = event.popup;
    const wrapper = popup.getElement();
    if (wrapper) {
      const focusable = wrapper.querySelector<HTMLElement>("a, button, [tabindex]");
      // preventScroll: the lazy observer fires up to 150% before the section,
      // so an init-opened popup must not yank the page scroll position.
      focusable?.focus({ preventScroll: true });
    }
  });

  // Focus return on close (D16): Leaflet's close button does not restore it.
  map.on("popupclose", () => {
    const owner = popupOwner;
    popupOwner = null;
    if (owner) owner.getElement()?.focus();
  });

  // Background clicks dismiss the popup (Leaflet closePopupOnClick) and are a
  // competing interaction too — a pending cluster callback must not resurrect
  // the popup the visitor just dismissed. Marker clicks do not reach this
  // handler (Leaflet does not emit map click for marker DOM clicks).
  map.on("click", () => {
    pendingClusterOpen = null;
  });

  // Leaflet arms its own Escape-to-close only while the map container itself
  // has focus. Close on Escape no matter where focus sits inside the page.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") map.closePopup();
  });

  const trackOwner = (marker: Marker) => {
    marker.on("popupopen", () => {
      popupOwner = marker;
    });
  };
  for (const marker of markers) trackOwner(marker);

  runtimes.set(container, {
    map,
    markers,
    destinationMarker,
    get routeLines() {
      return selectedLines;
    },
    selectRoute,
  });

  // Initial state per the couple: zoomed to Graha 58 with its popup already
  // open. autoPan nudges the center so the whole card is visible.
  destinationMarker.openPopup();

  const placeholder = section.querySelector<HTMLElement>(PLACEHOLDER_SELECTOR);
  if (placeholder) {
    if (prefersReducedMotion()) {
      placeholder.classList.add("hidden");
    } else {
      // Crossfade hand-off (D14): fade the container in beneath the dimming
      // placeholder, then drop the placeholder once its 250ms transition ends.
      container.animate({ opacity: [0, 1] }, { duration: 250, easing: "ease" });
      placeholder.classList.add("is-unmounting");
      window.setTimeout(() => {
        placeholder.classList.add("hidden");
        placeholder.classList.remove("is-unmounting");
        container.style.removeProperty("opacity");
      }, 260);
    }
  }
}

/**
 * Injects Leaflet's stylesheet at first mount.
 *
 * The CSS text arrives as a string via `leaflet.css?inline` (see
 * mountVenueMap) and becomes a <style> element — nothing Leaflet-shaped
 * reaches <head> until the section actually mounts.
 */
let leafletCssElement: HTMLStyleElement | null = null;
function injectLeafletCss(css: string): void {
  if (leafletCssElement) return;
  const style = document.createElement("style");
  style.dataset.venueMapLeaflet = "";
  style.textContent = css;
  document.head.appendChild(style);
  leafletCssElement = style;
}

/**
 * Lazy entry point called by VenueMap.astro's thin wiring script once the
 * section nears the viewport.
 */
export async function mountVenueMap(section: HTMLElement): Promise<void> {
  const container = section.querySelector<HTMLElement>(CONTAINER_SELECTOR);
  if (!container) return;
  if (runtimes.has(container)) return;

  const [routes, leafletCss] = await Promise.all([
    // Geometry chunk first — it is a separate async chunk from Leaflet's
    // runtime, so this import blocks on nothing map-shaped.
    import("./venue-map-routes"),
    // `?inline` returns Leaflet's stylesheet as a STRING inside this lazy
    // chunk instead of letting Vite hoist it into <head>. A plain (static OR
    // dynamic) CSS import gets emitted as a blocking <link> on every page
    // carrying the script — 14KB of Leaflet CSS for every homepage visitor,
    // which defeats the "no map resources on initial page load" scenario.
    import("leaflet/dist/leaflet.css?inline"),
  ]);
  injectLeafletCss(leafletCss.default);
  initVenueMap(section, routes.ROUTE_GEOMETRY);
}

/** Swaps the placeholder for the static fallback (Leaflet import failure). */
export function showVenueMapFallback(section: HTMLElement): void {
  const placeholder = section.querySelector<HTMLElement>(PLACEHOLDER_SELECTOR);
  const fallback = section.querySelector<HTMLElement>(FALLBACK_SELECTOR);
  // `hidden` is a Tailwind class rule — clear the class, not inline display.
  placeholder?.classList.add("hidden");
  fallback?.classList.remove("hidden");
}
