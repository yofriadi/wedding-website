/**
 * Candidate-set derivation for build-time-generated media variants
 * (`responsive-media`: "Image variants are generated at build time").
 *
 * This module is the single source of truth for MARKUP. Its twin is
 * `apps/web/scripts/generate-media-variants.mjs`, which encodes the same two
 * rules at generation time — keep them in sync, because markup that names a
 * file the generator skipped is a guest-facing 404. The generator's
 * `guardMarkupCoverage()` reads base names back out of the components and fails
 * the build on a base it does not cover, which is what makes the drift
 * detectable without build-time HTML under `output: "server"`.
 *
 * The two rules:
 *
 * 1. **Never upscale, and never re-emit a width the master already fills.** A
 *    generated width is offered only when it is strictly below the master's
 *    intrinsic width. Emitting a file at exactly the intrinsic width would
 *    declare the same `w` descriptor twice, which the HTML Standard forbids
 *    within one element's candidate list.
 *
 * 2. **The master is always the top candidate, declared at its intrinsic
 *    width.** Without it, the narrow masters (`square-mid-left` 473,
 *    `event-resepsi` 584, `awal-perkenalan` 591) would offer a single 390w
 *    candidate — violating the two-resolution requirement and *reducing* what
 *    `event-resepsi` ships today. This follows the repository's existing hero
 *    idiom, where `/wedding_photo.avif 768w` sits between the `-640` and
 *    `-1024` derivatives.
 */

/** Width ladder the generator emits, ascending. */
export const VARIANT_WIDTHS = [390, 768, 1280] as const;

/** Generated assets live here: gitignored, and never committed (private media). */
export const GENERATED_DIR = "/generated";

export type ImageFormat = "avif" | "webp";

/**
 * Normalize a markup path or config value to a bare base name.
 *
 * Exported, and applied inside `variantSrcset`/`placeholderSrc` too, so the
 * components that derive a base from a path cannot diverge. `EventTimes` stores
 * `"/event-akad"` with no extension while `ZoomParallax` stores
 * `"/square-top-right.webp"` with one; a `baseOf` that strips only the leading
 * slash turns the latter into `"square-top-right.webp"` and emits
 * `/generated/square-top-right.webp-w390.avif` — a guest-facing 404 that the
 * generator's cross-check CANNOT see, because the malformed name is built at
 * render time rather than written in source. Normalizing here makes that class
 * of bug unreachable instead of guarded.
 *
 * Idempotent, so the helpers accept either a path or an already-bare base — with
 * one exception the generator forbids: a base whose *name* ends in `.avif`/`.webp`
 * (master `x.webp.webp`). `guardInputSet()` rejects any base outside
 * `[a-z0-9_-]+`, so that input cannot reach here.
 *
 * Case-sensitive, and only `avif`/`webp`, to match the generator's
 * `MARKUP_BASE_PATTERNS` exactly. A case-insensitive strip would let markup spell
 * `"/Photo.WEBP"` and render correctly while the cross-check — deliberately
 * case-sensitive, because on APFS/NTFS an `i` flag turns prose into a build
 * failure — never discovers the reference. `jpe?g` is excluded for the same
 * reason: `FORMATS` is avif+webp, so a JPEG-only master can never be generated
 * and accepting the spelling would imply coverage that does not exist.
 */
export function baseOf(src: string): string {
  return src.replace(/^\//, "").replace(/\.(?:avif|webp)$/, "");
}

/**
 * The master file URL for one format — the `src` an `<img>` or `<source>` falls
 * back to, and the top candidate `variantSrcset` appends.
 *
 * Exported so a component's `src` and its `srcset` cannot diverge. Building the
 * URL by concatenation (``${image}.webp``) works only while the config stores an
 * extensionless path; normalising that config to `"/event-akad.webp"` — the
 * obvious tidy-up, since the neighbouring component stores exactly that — would
 * silently produce `/event-akad.webp.webp` while the `srcset` beside it stayed
 * correct, because `variantSrcset` normalises and string concatenation does not.
 */
export function masterSrc(base: string, format: ImageFormat): string {
  return `/${baseOf(base)}.${format}`;
}

/**
 * The `srcset` value for one format of one master.
 *
 * @param base master filename without extension, e.g. `"keluarga-acik"`; a path
 *   with a leading slash and/or a photo extension is normalized by `baseOf`
 * @param format `"avif"` or `"webp"` — variants are generated per format from
 *   the same-format master, so a `srcset` never mixes them
 * @param intrinsicWidth the master's real pixel width; MUST equal the `width`
 *   attribute the markup declares, or rule 1 skips a width that exists (404) or
 *   offers one that was never generated
 */
export function variantSrcset(base: string, format: ImageFormat, intrinsicWidth: number): string {
  const name = baseOf(base);
  const candidates = VARIANT_WIDTHS.filter((width) => width < intrinsicWidth).map(
    (width) => `${GENERATED_DIR}/${name}-w${width}.${format} ${width}w`,
  );
  candidates.push(`/${name}.${format} ${intrinsicWidth}w`);
  return candidates.join(", ");
}

/** The blurred low-fidelity placeholder for one format of one master. */
export function placeholderSrc(base: string, format: ImageFormat): string {
  return `${GENERATED_DIR}/${baseOf(base)}-lqip.${format}`;
}
