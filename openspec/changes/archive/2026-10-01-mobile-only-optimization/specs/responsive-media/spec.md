# responsive-media Delta Specification

## MODIFIED Requirements

### Requirement: Every raster image declares device-matched candidates

Every `<img>` in **server-rendered markup** that the site delivers for photographic or illustrated content SHALL carry a candidate set offering at least two resolutions and a `sizes` attribute describing the rendered width, so the browser selects bytes matched to the device rather than downloading a desktop-sized asset on a phone. Images injected into the DOM at runtime by a third-party widget — Leaflet tile `<img>`s, and the popup banner `venue-map.ts:123` builds as an HTML string — are outside this requirement's scope and are tracked as a named follow-up rather than silently exempted.

Where an image's presentation size is set by a **CSS transform** rather than by layout, `sizes` SHALL account for the transform rather than being derived from the layout box alone — transforms are invisible to candidate selection, so a layout-derived `sizes` would serve an image presented at several times its layout size from its smallest candidate. The hero follows this with `sizes="min(280vw, 768px)"` against a `scale(2.8)` transform, clamped from `1536px` to match the mobile rail.

Accounting for the transform does **not** mean claiming the full geometric presentation width. Where an image is perceptually unimportant at its scaled size — fast-moving, peripheral, largely clipped by an `overflow-hidden` container — `sizes` MAY deliberately claim less than geometry would justify, provided the reasoning is recorded in `design.md` and the claim is not later "corrected" upward on geometric grounds alone. The collage exercises this: its centre slot, which ends the sequence covering the stage, claims `min(100vw, 1280px)`, while the nine surrounding slots claim `min(33vw, 390px)` despite being scaled 4–9×. Per-slot values keyed on an existing markup flag are preferred over one global cap when the slots differ this much.

Format negotiation SHALL offer AVIF with a WebP fallback through `<picture>` where the engine supports it, as the existing markup already does. Decorative images under 2 KB, and assets that exist at a single resolution, MAY ship a plain `src`. The ten ZoomParallax collage images are tier-managed under `media-tiering` and are exempt from the live-`srcset` form of this requirement: they carry their full-resolution candidate set deferred until promoted, plus a `sizes` attribute and a live low-fidelity `src`.

No upper bound is placed on the candidate set beyond the no-upscale rule. The browser selects by `sizes` and simply never requests the wider candidates; they cost repository bytes, not guest bytes. The candidate ladder `VARIANT_WIDTHS = [390, 768, 1280]` is retained so that high-DPI mobile devices (Pixel 7 at DPR 2.625, iPhone Pro at DPR 3) select the 1280w resolution variant for wide presentation slots rather than falling through to multi-megabyte masters.

The fallback image source for the hero (`HERO_FALLBACK_SRC`) SHALL reference `/wedding_photo.webp` (the 768w master), replacing the obsolete 1024w reference, with declared intrinsic dimensions `width="768"` and `height="1376"`.

#### Scenario: Phone does not pay for desktop pixels

- **WHEN** a guest loads the page on a 390 CSS px viewport at device pixel ratio 2
- **THEN** the family portrait downloads a candidate at or below 780 px wide, not the 2048 px master

#### Scenario: High-DPI mobile viewport selects 1280w candidate

- **WHEN** a guest loads the page on a high-DPI mobile viewport (such as Pixel 7 at 412 CSS px @ DPR 2.625 or iPhone Pro at 393 CSS px @ DPR 3)
- **THEN** wide presentation slots select the `-w1280` variant rather than the unoptimized 1920px or 2048px master

#### Scenario: Collage images carry candidate sets

- **WHEN** the ZoomParallax collage markup is inspected in the delivered document
- **THEN** each of the ten collage images carries a `sizes` attribute and, within its `<picture>`, either a live `srcset` or a deferred `data-src`/`data-srcset` candidate set, per its tier
