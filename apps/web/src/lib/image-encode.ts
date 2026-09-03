import sharp from "sharp";
import type { PhotoType } from "./photo-storage";

// Photo normalization (photo-normalization change): every guest upload is
// re-encoded ON THE SERVER into one canonical file before it is written, so
// what the story viewer serves is bounded in both dimensions and bytes.
// Before this, uploads were stored verbatim — the committed fixtures were
// 3824×2484 PNGs of 2.4–3.0MB each, ~8MB per submission, all of it loaded
// into a full-screen <img> on a phone at the venue.
//
// WHY WEBP IS CANONICAL AND AVIF IS A SIBLING
// AVIF is ~35% smaller than WebP at equal quality, but it costs ~4× the CPU to
// encode, and that work would land INSIDE the guest's POST — three photos
// would turn "Sharing…" into a 6–12s wait on a 1–2 vCPU VM. So the request
// path does the cheap, universally-supported encode (WebP: every browser since
// 2020, iOS 14+), and lib/avif-queue.ts adds an AVIF sibling AFTER the 201 has
// been sent. The photo route then serves AVIF or WebP from the SAME URL based
// on the request's Accept header — no client change, no payload change, and a
// browser that can't decode AVIF (iOS ≤ 15) never sees one.
//
// Measured on an M1 Pro with a photo-realistic 3000×2000 fixture (1.14MB JPEG
// in — the same generator tests/photo-pipeline.spec.ts uses):
//   canonical WebP q80 e4 @≤2048px   362KB    ~0.39s   (in-request; ×3 ≈ 1.2s)
//   AVIF q55 e4 from the canonical   246KB    ~1.22s   (background, −32% vs WebP)
//   thumbnail WebP 224×400 q80        25KB    ~0.04s   (in-request)
//   thumbnail AVIF q55 e4             20KB    ~0.16s   (background)
//   a 2.02MB 1000×700 PNG upload  →   62KB WebP (33× smaller, ~0.07s)
// The same fixture with NO resolution cap encodes to 523KB — the cap is worth
// more than the codec choice, which is why it comes first in the pipeline.

// 2× DPR for a full-screen story on the tallest phones: the viewer panel is
// `max-w-lg` but `w-full h-full` on mobile (~440×956 CSS px → ~880×1912 at
// DPR 2). Capping the long edge is the bigger lever — see the numbers above.
export const MAX_PHOTO_EDGE = 2048;

export const WEBP_QUALITY = 80;
export const AVIF_QUALITY = 55;
export const AVIF_EFFORT = 4;

// 2× the 112px rail tile (unchanged from the pre-normalization thumb).
export const THUMBNAIL_WIDTH = 224;
export const THUMBNAIL_HEIGHT = 400;
export const THUMBNAIL_QUALITY = 80;

// Decompression-bomb guard. sharp's default (268MP) would let a ≤10MB PNG
// expand to ~1GB of decoded pixels; 64MP still admits a real 48MP phone
// capture (8064×6048) while capping the pathological case. libvips is
// demand-driven, so a resize pipeline never materializes all of it — this is
// the cheap structural limit, not the only thing standing between us and OOM.
const INPUT_PIXEL_LIMIT = 64_000_000;

function input(bytes: Uint8Array): sharp.Sharp {
  // Buffer.from copies: sharp wants a Buffer, and the multipart layer hands
  // back a Uint8Array view we must not alias past the request's lifetime.
  return sharp(Buffer.from(bytes), { failOn: "none", limitInputPixels: INPUT_PIXEL_LIMIT });
}

export interface ImageProbe {
  width: number;
  height: number;
  /** EXIF orientation (1–8); undefined when the file carries none. */
  orientation: number | undefined;
  /** True when the file carries EXIF/XMP/IPTC — GPS above all. */
  hasMetadata: boolean;
}

/**
 * Decode-only probe. Throws when the bytes are undecodable — callers decide
 * what that means (upload: a 400, since magic bytes already passed).
 */
export async function probeImage(bytes: Uint8Array): Promise<ImageProbe> {
  const meta = await input(bytes).metadata();
  if (!meta.width || !meta.height) {
    throw new Error("image has no dimensions");
  }
  const hasMetadata = Boolean(
    (meta.exif && meta.exif.length > 0) ||
    (meta.xmp && meta.xmp.length > 0) ||
    (meta.iptc && meta.iptc.length > 0),
  );
  return { width: meta.width, height: meta.height, orientation: meta.orientation, hasMetadata };
}

// Metadata-free is a PRIVACY property, not just a size one. The wall is public
// (public-wall D3), so a stored original would publish whatever the guest's
// camera embedded — GPS coordinates above all. sharp strips EXIF/XMP/IPTC on
// output unless withMetadata() is asked for, and .rotate() consumes the EXIF
// orientation instead of leaving it in the file.
/** The canonical, universally-servable file: rotated, capped, metadata-free WebP. */
export async function encodeCanonicalWebp(bytes: Uint8Array): Promise<Buffer> {
  return input(bytes)
    .rotate() // applies EXIF orientation, then drops all metadata
    .resize({
      width: MAX_PHOTO_EDGE,
      height: MAX_PHOTO_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY, effort: 4, smartSubsample: true })
    .toBuffer();
}

/**
 * AVIF variant. Encoded FROM THE CANONICAL FILE, not the upload: the original
 * is never stored, and transcoding the already-capped, already-rotated
 * canonical keeps the variant pixel-identical in geometry, caps the memory a
 * background job can hold (278KB, not 10MB), and makes an on-demand backfill
 * for pre-existing rows use the exact same code path. The cost is one extra
 * lossy generation (WebP q80 → AVIF q55), which at these qualities is not
 * visible on a phone screen.
 */
export async function encodeAvifVariant(canonical: Uint8Array): Promise<Buffer> {
  return input(canonical).avif({ quality: AVIF_QUALITY, effort: AVIF_EFFORT }).toBuffer();
}

/** Rail-sized cover thumbnail (L6: tiles serve this, never a full photo). */
export async function encodeThumbnail(canonical: Uint8Array): Promise<Buffer> {
  return input(canonical)
    .resize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, { fit: "cover" })
    .webp({ quality: THUMBNAIL_QUALITY })
    .toBuffer();
}

export interface CanonicalPhoto {
  /** What to store: normally "webp"; the upload's own type on the pass-through. */
  type: PhotoType;
  bytes: Buffer;
  /** False when the upload was already the best file we could produce. */
  reEncoded: boolean;
}

/**
 * Produce the canonical file for one upload.
 *
 * The canonical is what EVERY browser receives when it does not ask for AVIF,
 * so it must be decodable unconditionally. That is why it is always WebP and
 * never AVIF: iOS ≤ 15.8 has no AVIF decoder at all, and on iOS every browser
 * is WebKit — including the WhatsApp in-app browser most guests will use.
 *
 * Pass-through rule: a WEBP upload that is inside the dimension cap, correctly
 * oriented, carrying NO metadata to strip, and no larger than our re-encode is
 * stored as-is. Without it a small WebP could come out BIGGER than it went in —
 * normalizing must never be a regression. The metadata condition is what keeps
 * that safe: a pass-through must not smuggle GPS into a public wall.
 *
 * JPEG, PNG and AVIF uploads are ALWAYS re-encoded, even when the result is
 * larger. For JPEG/PNG that is the only way their EXIF is provably gone; for
 * AVIF it is the canonical rule above — an AVIF upload becomes a WebP canonical
 * plus a queued AVIF variant, costing one extra lossy generation in exchange
 * for a file that cannot break on an old phone. AVIF uploads are rare (the
 * picker overwhelmingly yields JPEG/PNG), which is why that trade is taken
 * unconditionally instead of special-casing an AVIF canonical with a WebP
 * fallback beside it.
 *
 * Throws when the bytes are undecodable despite valid magic bytes (truncated
 * or corrupt file) — the upload route maps that to `invalid_photo_type`.
 */
export async function canonicalizePhoto(
  bytes: Uint8Array,
  type: PhotoType,
): Promise<CanonicalPhoto> {
  const webp = await encodeCanonicalWebp(bytes);

  if (type === "webp") {
    const probe = await probeImage(bytes);
    const withinCap = probe.width <= MAX_PHOTO_EDGE && probe.height <= MAX_PHOTO_EDGE;
    const oriented = probe.orientation === undefined || probe.orientation === 1;
    if (withinCap && oriented && !probe.hasMetadata && bytes.byteLength <= webp.byteLength) {
      return { type, bytes: Buffer.from(bytes), reEncoded: false };
    }
  }

  return { type: "webp", bytes: webp, reEncoded: true };
}
