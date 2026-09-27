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
 * `HERO_SIZES` claims `min(280vw, 768px)`, not the layout box: the hero stage starts
 * at `transform: scale(2.8)` and zooms out on scroll, and transforms are invisible
 * to candidate selection. For mobile-only optimization, `sizes` is clamped to 768px.
 * Underclaim Rationale: At 390 CSS px, `min(280vw, 768px)` claims 768px against a 1092px
 * scaled presentation under `scale(2.8)`. DPR-1 devices select the 768w master, while
 * Retina DPR-2 devices select the 1536w candidate.
 */

/** Shared `sizes` for both `<source>`s and the `<img>`. */
export const HERO_SIZES = "min(280vw, 768px)";

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
export const HERO_FALLBACK_SRC = "/wedding_photo.webp";

/** The blurred layer is a single-resolution asset (no candidate set). */
export const HERO_BLUR_AVIF = "/wedding_photo_blur.avif";
export const HERO_BLUR_WEBP = "/wedding_photo_blur.webp";
