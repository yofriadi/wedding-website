import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@wedding-website/env/server";

// Guest photo storage (guest-submissions D4): files land in a local content
// directory OUTSIDE the web root, at server-generated keys
// submissions/<submission-id>/<position>.<ext>. Client filenames are never
// trusted; the key shape is validated everywhere a key is consumed so path
// traversal is structurally refused, and keys embed NO invite ids or names.

export const MAX_PHOTOS_PER_SUBMISSION = 3;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10MB

// Positions are 0–2 (≤3 photos per submission).
export const PHOTO_POSITION_MIN = 0;
export const PHOTO_POSITION_MAX = 2;

const EXT_BY_TYPE: Record<PhotoType, string> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
  avif: "avif",
};

export type PhotoType = "jpeg" | "png" | "webp" | "avif";

export function photoExt(type: PhotoType): string {
  return EXT_BY_TYPE[type];
}

// Key shape: submissions/<submission-id>/<position>.<ext> for the canonical
// photo, submissions/<submission-id>/<position>.avif for its optional AVIF
// variant, and submissions/<submission-id>/thumb.{webp,avif} for the
// per-submission cover thumbnail. Anchored, no directories above the
// submissions root, no "..", no absolute paths. Used both when generating keys
// (upload) and when consuming them (photo route), so a traversal attempt is
// rejected before any filesystem touch.
const KEY_RE =
  /^submissions\/[A-Za-z0-9_-]{12}\/(?:[0-2]\.(?:jpg|png|webp|avif)|thumb\.(?:webp|avif))$/;

export function isValidPhotoKey(key: string): boolean {
  return KEY_RE.test(key);
}

// Defense in depth: resolve the key under the storage root and confirm it
// stays inside (symlinks aside, the anchored regex already refuses traversal;
// this guards a mis-configured storage root and any future key-shape change).
export function resolvePhotoPath(key: string): string {
  if (!isValidPhotoKey(key)) {
    throw new Error("invalid photo key");
  }
  const root = path.resolve(env.PHOTO_STORAGE_DIR);
  const resolved = path.resolve(root, key);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("photo key escapes storage root");
  }
  return resolved;
}

// Magic-byte detection (D4: verified by content, not Content-Type alone).
// Returns the detected type, or null for unknown/disallowed content.
export function detectPhotoType(bytes: Uint8Array): PhotoType | null {
  if (bytes.length < 12) return null;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }

  // RIFF container: WEBP iff bytes 8–11 are "WEBP"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }

  // ISOBMFF container: ftyp box at offset 4; AV1 brand contains "av0"/"avi"
  // (avif, avis, maf1, msf1…). Checking bytes 8–11 for the major brand
  // covers all AVIF brands in practice.
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const b8 = String.fromCharCode(bytes[8] ?? 0);
    const b9 = String.fromCharCode(bytes[9] ?? 0);
    const b10 = String.fromCharCode(bytes[10] ?? 0);
    const b11 = String.fromCharCode(bytes[11] ?? 0);
    const brand = b8 + b9 + b10 + b11;
    if (brand.startsWith("av") || brand.startsWith("ma") || brand.startsWith("ms")) {
      return "avif";
    }
  }

  return null;
}

const CONTENT_TYPE_BY_TYPE: Record<PhotoType, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

export function photoContentType(type: PhotoType): string {
  return CONTENT_TYPE_BY_TYPE[type];
}

// Thumbnail content type is always webp (sharp renders thumbs to webp).
export const THUMBNAIL_CONTENT_TYPE = "image/webp";

// Storage layout: each submission dir holds position-named originals plus a
// per-submission cover thumbnail (L6 mitigation: the rail serves the thumb,
// not a 10MB original). Thumb key: submissions/<id>/thumb.webp.
export function thumbnailKey(submissionId: string): string {
  return `submissions/${submissionId}/thumb.webp`;
}

// AVIF variant of a canonical key (photo-normalization): the same basename
// with an .avif extension — 0.webp → 0.avif, thumb.webp → thumb.avif. Returns
// null when there is nothing to derive: an invalid key, or a key that is
// ALREADY avif (a pass-through upload is its own best variant).
export function avifVariantKey(key: string): string | null {
  if (!isValidPhotoKey(key) || key.endsWith(".avif")) {
    return null;
  }
  return key.replace(/\.(?:jpg|png|webp)$/, ".avif");
}

// Content type for a key, derived from its extension. The photo route serves
// whichever file it actually picked (canonical or AVIF variant), so the type
// must come from the served key, not the requested one.
export function contentTypeForKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase();
  return ext === "jpg"
    ? "image/jpeg"
    : ext === "png"
      ? "image/png"
      : ext === "avif"
        ? "image/avif"
        : "image/webp";
}

export interface StoredPhoto {
  key: string;
  position: number;
  type: PhotoType;
}

// Atomic write: a temp file in the SAME directory (rename() across filesystems
// fails with EXDEV), then rename() into place — atomic on POSIX, so a reader
// sees either the old file or the complete new one, never a partial body.
//
// This matters because photo responses are cached `immutable` for a year, and
// because a variant is written WHILE its canonical key is already published:
// a reader that caught a half-written AVIF would poison a browser cache with a
// truncated image for a year. A crash can leave a stale `.part` behind; the
// next write truncates it, backups exclude it, and it is never a valid key.
async function writeFileAtomic(filePath: string, bytes: Uint8Array): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.part`;
  try {
    await writeFile(tempPath, bytes);
    await rename(tempPath, filePath);
  } catch (err) {
    await rm(tempPath, { force: true }); // never leave a torn temp behind
    throw err;
  }
}

// Write one photo at its server-generated key. The submission directory is
// created on demand (uploads and restores share the path).
export async function writePhoto(
  submissionId: string,
  position: number,
  type: PhotoType,
  bytes: Uint8Array,
): Promise<string> {
  const key = `submissions/${submissionId}/${position}.${EXT_BY_TYPE[type]}`;
  await writeFileAtomic(resolvePhotoPath(key), bytes);
  return key;
}

// Buffered write (L6b: formData() buffers in memory before files are
// accessible; "write to disk after buffering" is the v1 contract).
export async function writeThumbnail(submissionId: string, bytes: Uint8Array): Promise<string> {
  const key = thumbnailKey(submissionId);
  await writeFileAtomic(resolvePhotoPath(key), bytes);
  return key;
}

// Remove the entire submission directory (uploads claim the row first; any
// non-201 path must delete BOTH the claimed row AND the whole generated dir).
export async function removeSubmissionDir(submissionId: string): Promise<void> {
  const dir = path.resolve(env.PHOTO_STORAGE_DIR, "submissions", submissionId);
  const root = path.resolve(env.PHOTO_STORAGE_DIR);
  if (dir === root || !dir.startsWith(root + path.sep)) {
    // Submission ids are server-generated, but refuse anything unexpected.
    return;
  }
  await rm(dir, { recursive: true, force: true });
}

// Read a photo back (photo route). Returns null when the file is missing.
export async function readPhoto(
  key: string,
): Promise<{ bytes: Buffer; stat: { mtime: Date } } | null> {
  const filePath = resolvePhotoPath(key);
  try {
    const bytes = await readFile(filePath);
    return { bytes, stat: { mtime: new Date() } };
  } catch {
    return null;
  }
}

// Existence check for the AVIF negotiation: the photo route asks "has the
// variant landed yet?" on every request, so this must be a cheap stat that
// treats a missing file (and a directory, however it got there) as absent.
export async function photoExists(key: string): Promise<boolean> {
  try {
    return (await stat(resolvePhotoPath(key))).isFile();
  } catch {
    return false;
  }
}

// Write at an explicit, already-validated key (AVIF variants). Uploads keep
// writePhoto/writeThumbnail, which derive the key from the submission id; the
// variant queue derives it from an existing canonical key instead. Atomic for
// the reason above — this is the write that races a live, published key.
export async function writePhotoAtKey(key: string, bytes: Uint8Array): Promise<string> {
  await writeFileAtomic(resolvePhotoPath(key), bytes);
  return key;
}
