// Minimal ambient declarations for `leaflet` 2.0.0-alpha.1.
//
// No `@types/leaflet` exists for the 2.0 line (@types/leaflet latest is 1.9.22,
// written against the 1.x API; the 2.0.0-alpha.1 package ships no `.d.ts` and
// no `types` field — design D1/D17). This file declares ONLY the named imports
// the venue map uses, verified against the alpha source:
//   - constructors are `new Map(...)`, `new TileLayer(...)`, `new Polyline(...)`,
//     `new Marker(...)`, `new DivIcon(...)` (factory functions are gone)
//   - `Marker._initIcon` assigns `title` for ANY icon incl. DivIcon; only `alt`
//     is gated to `<img>` (design D16)
//   - `keyboard: true` sets `tabIndex='0'` + `role='button'`
//   - Popup's built-in `_onKeyPress` handles `code === 'Enter'` ONLY
//   - 2.0 fires `keypress`/`keydown`/`keyup` DOM events on the container
//
// Keep this file in sync with what venue-map.ts actually uses.

declare module "leaflet" {
  export interface LatLngLiteral {
    lat: number;
    lng: number;
  }

  export type LatLngTuple = [number, number];

  export class LatLng {
    constructor(latlng: LatLngLiteral | LatLngTuple);
    lat: number;
    lng: number;
    equals(other: LatLng | LatLngLiteral, maxMargin?: number): boolean;
  }

  export class LatLngBounds {
    constructor(latlngs: (LatLng | LatLngLiteral | LatLngTuple)[]);
    getCenter(): LatLng;
  }

  export interface MapOptions {
    zoomControl?: boolean;
    attributionControl?: boolean;
    scrollWheelZoom?: boolean | "center";
    dragging?: boolean;
    pinchZoom?: boolean;
    doubleClickZoom?: boolean | "center";
    zoomSnap?: number;
    zoomDelta?: number;
    closePopupOnClick?: boolean;
    /** Long-press-drag panning (Leaflet 2.0 replaces 1.x `tap` with `tapHold`). */
    tapHold?: boolean;
    zoomAnimation?: boolean;
  }

  export interface FitBoundsOptions {
    padding?: number | [number, number];
    paddingTopLeft?: [number, number];
    paddingBottomRight?: [number, number];
    animate?: boolean;
  }

  export interface ZoomPanOptions {
    animate?: boolean;
    duration?: number;
  }

  export type LeafletEvent = { originalEvent?: UIEvent; type?: string; target?: unknown };

  export interface LeafletMouseEvent extends LeafletEvent {
    latlng: LatLng;
    containerPoint?: { x: number; y: number };
    originalEvent: MouseEvent;
  }

  export interface PopupEvent extends LeafletEvent {
    popup: Popup;
  }

  export class Evented {
    on(type: string, fn: (event: never) => void, context?: unknown): this;
    on(eventMap: Record<string, (event: never) => void>, context?: unknown): this;
    once(type: string, fn: (event: never) => void, context?: unknown): this;
    off(type?: string, fn?: (event: never) => void, context?: unknown): this;
    fire(type: string, data?: unknown, propagate?: boolean): this;
    listens(type: string, propagate?: boolean): boolean;
  }

  // The `on`/`once`/`off` overloads above accept a callback with `never` so
  // call sites can narrow the event type themselves; these helper aliases keep
  // the map-control code readable without widening the declarations.
  export type MapEventHandler<T> = (event: T) => void;

  export class Layer extends Evented {
    addTo(mapOrGroup: Map | LayerGroup): this;
    remove(): this;
    getPane(name?: string): HTMLElement | null;
    bindPopup(
      content: string | HTMLElement | ((layer: Layer) => string | HTMLElement),
      options?: PopupOptions,
    ): this;
    unbindPopup(): this;
    openPopup(latlng?: LatLng | LatLngLiteral): this;
    closePopup(): this;
    togglePopup(): this;
    isPopupOpen(): boolean;
    getPopup(): Popup | undefined;
    on(type: string, fn: (event: never) => void, context?: unknown): this;
    once(type: string, fn: (event: never) => void, context?: unknown): this;
    off(type?: string, fn?: (event: never) => void, context?: unknown): this;
  }

  export interface TileLayerOptions {
    attribution?: string;
    subdomains?: string | string[];
    maxZoom?: number;
    minZoom?: number;
    detectRetina?: boolean;
    [key: string]: unknown;
  }

  export class TileLayer extends Layer {
    constructor(urlTemplate: string, options?: TileLayerOptions);
  }

  export interface PolylineOptions {
    color?: string;
    weight?: number;
    opacity?: number;
    lineJoin?: string;
    dashArray?: string;
    [key: string]: unknown;
  }

  export class Polyline extends Layer {
    constructor(latlngs: (LatLng | LatLngLiteral | LatLngTuple)[], options?: PolylineOptions);
    setStyle(style: PolylineOptions): this;
    getLatLngs(): (LatLng | LatLngLiteral | LatLngTuple)[];
    bringToFront(): this;
    /** The rendered <path> (SVG renderer); null on Canvas. */
    getElement(): SVGPathElement | null;
  }

  export interface DivIconOptions {
    className?: string;
    html?: string | HTMLElement;
    iconSize?: [number, number];
    iconAnchor?: [number, number];
    popupAnchor?: [number, number];
  }

  export class DivIcon {
    constructor(options?: DivIconOptions);
  }

  export interface PopupOptions {
    maxWidth?: number;
    minWidth?: number;
    autoPan?: boolean;
    closeButton?: boolean;
    [key: string]: unknown;
  }

  export class Popup extends Layer {
    constructor(options?: PopupOptions, source?: Layer);
    setLatLng(latlng: LatLng | LatLngLiteral): this;
    getLatLng(): LatLng;
    setContent(content: string | HTMLElement): this;
    openOn(map: Map): this;
    close(): this;
    getElement(): HTMLElement | null;
  }

  export interface MarkerOptions {
    icon?: DivIcon;
    title?: string;
    alt?: string;
    keyboard?: boolean;
    riseOnHover?: boolean;
    autoPanOnFocus?: boolean;
    interactive?: boolean;
    [key: string]: unknown;
  }

  export class Marker extends Layer {
    constructor(latlng: LatLng | LatLngLiteral | LatLngTuple, options?: MarkerOptions);
    getLatLng(): LatLng;
    setLatLng(latlng: LatLng | LatLngLiteral): this;
    getElement(): HTMLElement | null;
    on(type: string, fn: (event: never) => void, context?: unknown): this;
    once(type: string, fn: (event: never) => void, context?: unknown): this;
    off(type?: string, fn?: (event: never) => void, context?: unknown): this;
  }

  export class LayerGroup extends Layer {}
  export class FeatureGroup extends LayerGroup {}

  export interface ControlOptions {
    position?: "topleft" | "topright" | "bottomleft" | "bottomright";
  }

  export class Control extends Class {
    protected options: Record<string, unknown>;
    constructor(options?: ControlOptions);
    getPosition(): string;
    setPosition(position: string): this;
    addTo(map: Map): this;
    remove(): this;
    protected onAdd(map: Map): HTMLElement;
    protected onRemove?(map: Map): void;
  }

  export interface ZoomControlOptions extends ControlOptions {
    zoomInText?: string;
    zoomInTitle?: string;
    zoomOutText?: string;
    zoomOutTitle?: string;
  }

  export namespace Control {
    export class Zoom extends Control {
      constructor(options?: ZoomControlOptions);
    }
  }
  export interface AttributionControl {
    setPrefix(prefix: string | false): this;
  }

  export class Map extends Evented {
    constructor(el: HTMLElement | string, options?: MapOptions);
    attributionControl?: AttributionControl;
    fitBounds(bounds: LatLngBounds, options?: FitBoundsOptions): this;
    setView(
      center: LatLng | LatLngLiteral | LatLngTuple,
      zoom?: number,
      options?: ZoomPanOptions,
    ): this;
    getCenter(): LatLng;
    /** Stops any currently running pan/zoom animation. */
    stop(): this;
    /**
     * Internal animation-end hook. Public view calls (setView/fitBounds) are
     * silently swallowed while a zoom animation is in flight
     * (`_tryAnimatedZoom` returns early), and even a non-animated setView is
     * clobbered when the stale animation's 250ms end-timer fires. Calling
     * this force-completes the in-flight animation so the next view call
     * always applies. No-op when no animation is in flight.
     */
    _onZoomTransitionEnd(): void;
    /** Closes the currently open popup, if any. */
    closePopup(): this;
    getZoom(): number;
    getBounds(): LatLngBounds;
    getSize(): { x: number; y: number };
    addLayer(layer: Layer): this;
    removeLayer(layer: Layer): this;
    hasLayer(layer: Layer): boolean;
    addControl(control: Control): this;
    removeControl(control: Control): this;
    invalidateSize(options?: { animate?: boolean } | boolean): this;
    whenReady(callback: (event: LeafletEvent) => void, context?: unknown): this;
    remove(): this;
    getContainer(): HTMLElement | null;
    on(type: string, fn: (event: never) => void, context?: unknown): this;
    once(type: string, fn: (event: never) => void, context?: unknown): this;
    off(type?: string, fn?: (event: never) => void, context?: unknown): this;
  }

  export class Class {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]);
  }

  export interface BrowserFlags {
    touch: boolean;
    touchNative: boolean;
    pointer: boolean;
    retina: boolean;
    mobile: boolean;
  }

  /** Stops click/mousedown events from bubbling to the map container. */
  export const DomEvent: {
    disableClickPropagation(el: HTMLElement): void;
    disableScrollPropagation(el: HTMLElement): void;
    preventDefault(e: Event): void;
    stop(e: Event): void;
  };

  export const Browser: BrowserFlags;
}
