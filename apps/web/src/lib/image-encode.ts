import sharp from "sharp";
import type { Sharp } from "sharp";
import type { PhotoType } from "./photo-storage";

// Normalize before persistence: cap dimensions, apply orientation, and strip
// camera metadata. WebP is canonical for older browsers; AVIF is optional
// background work negotiated from the same immutable URL.
export const MAX_PHOTO_EDGE = 2048;

export const WEBP_QUALITY = 80;
export const AVIF_QUALITY = 55;
export const AVIF_EFFORT = 4;

// Decompression-bomb guard. sharp's default (268MP) would let a ≤10MB PNG
// expand to ~1GB of decoded pixels; 64MP still admits a real 48MP phone
// capture (8064×6048) while capping the pathological case. libvips is
// demand-driven, so a resize pipeline never materializes all of it — this is
// the cheap structural limit, not the only thing standing between us and OOM.
const INPUT_PIXEL_LIMIT = 64_000_000;

function input(bytes: Uint8Array): Sharp {
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

// Public images must not expose camera metadata such as GPS coordinates.
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

export interface CanonicalPhoto {
  type: "webp";
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
