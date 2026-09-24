/**
 * HeroZoom media URLs, shared between the component's `<picture>` and the
 * document-head preload in `pages/index.astro`.
 *
 * They live in one module because the hint MUST mirror the `<img>`: a bare
 * `<link rel="preload" as="image" href=…>` cannot express a `srcset` selection
 * or negotiate a format, so it would fetch a candidate the `<picture>` then
 * discards — a double fetch of the page's largest asset on exactly the
 * throttled link `responsive-media` exists to protect (design D7).
 *
 * `HERO_SIZES` claims 280vw, not the layout box: the hero stage starts at
 * `transform: scale(2.8)` and zooms out on scroll, and transforms are invisible
 * to candidate selection, so a layout-derived `sizes` would serve a
 * full-viewport image from a phone-sized candidate. At a 390 CSS px viewport
 * `min(280vw, 1536px)` resolves to 1092 px; at DPR 2 the engine wants 2184
 * device px, no candidate reaches it, and it therefore takes the largest —
 * 1536w. That is the candidate the head preload targets, not `-390`.
 */

/** Shared `sizes` for both `<source>`s and the `<img>`. */
export const HERO_SIZES = "min(280vw, 1536px)";

/**
 * Candidate ladders, ascending, with the master file included at its intrinsic
 * 768w. The repository names the master without a width suffix
 * (`/wedding_photo.avif`) while its derivatives carry one — the same
 * "master is the top-or-middle candidate at its intrinsic width" convention
 * `responsive-media`'s generation rules require.
 */
export const HERO_SRCSET_AVIF =
  "/wedding_photo-390.avif 390w, /wedding_photo-640.avif 640w, /wedding_photo.avif 768w, /wedding_photo-1024.avif 1024w, /wedding_photo-1536.avif 1536w";

export const HERO_SRCSET_WEBP =
  "/wedding_photo-390.webp 390w, /wedding_photo-640.webp 640w, /wedding_photo.webp 768w, /wedding_photo-1024.webp 1024w, /wedding_photo-1536.webp 1536w";

/** `src` fallback for engines without `srcset`. */
export const HERO_FALLBACK_SRC = "/wedding_photo-1024.webp";

/** The blurred layer is a single-resolution asset (no candidate set). */
export const HERO_BLUR_AVIF = "/wedding_photo_blur.avif";
export const HERO_BLUR_WEBP = "/wedding_photo_blur.webp";
