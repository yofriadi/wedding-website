import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { env } from "@wedding-website/env/server";
import { generatePhotoId, PHOTO_ID_RE } from "./guest-photos";

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export type PhotoType = "jpeg" | "png" | "webp" | "avif";
const KEY_RE = /^guest-photos\/[A-Za-z0-9_-]{12}\/photo\.(?:webp|avif)$/;

export function isValidPhotoKey(key: string): boolean {
  return KEY_RE.test(key);
}

export function resolvePhotoPath(key: string): string {
  if (!isValidPhotoKey(key)) throw new Error("invalid photo key");
  const root = path.resolve(env.PHOTO_STORAGE_DIR);
  const resolved = path.resolve(root, key);
  if (!resolved.startsWith(root + path.sep)) throw new Error("photo key escapes storage root");
  return resolved;
}

export function canonicalPhotoKey(id: string): string {
  if (!PHOTO_ID_RE.test(id)) throw new Error("invalid photo ID");
  return `guest-photos/${id}/photo.webp`;
}

// The caller receives an ownership capability only after exclusive leaf creation.
// Colliding IDs can never authorize writes or cleanup in another upload's folder.
export interface PhotoReservation {
  readonly id: string;
  readonly key: string;
  write(bytes: Uint8Array): Promise<void>;
  remove(): Promise<void>;
}

export async function reservePhotoDirectory(
  generateId: () => string = generatePhotoId,
): Promise<PhotoReservation> {
  const parent = path.resolve(env.PHOTO_STORAGE_DIR, "guest-photos");
  await mkdir(parent, { recursive: true });
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = generateId();
    const key = canonicalPhotoKey(id);
    const filePath = resolvePhotoPath(key);
    const directory = path.dirname(filePath);
    try {
      await mkdir(directory); // Non-recursive: EEXIST is a collision, not ownership.
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
    let removed = false;
    let written = false;
    return {
      id,
      key,
      async write(bytes) {
        if (removed || written) throw new Error("photo reservation is no longer writable");
        written = true;
        await writeFileAtomic(filePath, bytes);
      },
      async remove() {
        if (removed) return;
        await rm(directory, { recursive: true, force: true });
        removed = true;
      },
    };
  }
  throw new Error("unable to reserve a unique photo directory");
}

// A sibling temporary file plus rename keeps immutable responses complete.
// Do not recreate directories here: only reservation owns directory creation.
async function writeFileAtomic(filePath: string, bytes: Uint8Array): Promise<void> {
  // A crashed write must not block a later variant retry or own its temp file.
  const temporary = `${filePath}.${randomUUID()}.part`;
  let owned = false;
  try {
    const handle = await open(temporary, "wx");
    owned = true;
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
    await rename(temporary, filePath);
  } catch (error) {
    if (owned) {
      try {
        await rm(temporary, { force: true });
      } catch (cleanupError) {
        console.error("[photos] partial-file cleanup failed:", cleanupError);
      }
    }
    throw error;
  }
}

export function avifVariantKey(key: string): string | null {
  return isValidPhotoKey(key) && key.endsWith(".webp") ? key.replace(/\.webp$/, ".avif") : null;
}

export function contentTypeForKey(key: string): string {
  return key.endsWith(".avif") ? "image/avif" : "image/webp";
}

export async function readPhoto(key: string): Promise<{ bytes: Buffer } | null> {
  const filePath = resolvePhotoPath(key);
  try {
    return { bytes: await readFile(filePath) };
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "EISDIR"].includes((error as NodeJS.ErrnoException).code ?? ""))
      return null;
    throw error;
  }
}

export async function photoExists(key: string): Promise<boolean> {
  try {
    return (await stat(resolvePhotoPath(key))).isFile();
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
    throw error;
  }
}

// Only derived variants may use the non-reservation write path.
export async function writePhotoAtKey(key: string, bytes: Uint8Array): Promise<void> {
  if (!isValidPhotoKey(key) || !key.endsWith(".avif")) throw new Error("invalid variant key");
  await writeFileAtomic(resolvePhotoPath(key), bytes);
}

// Content detection precedes decoder validation; MIME types/filenames are untrusted.
export function detectPhotoType(bytes: Uint8Array): PhotoType | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, i) => bytes[i] === value))
    return "png";
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (ascii(4, 8) === "ftyp") {
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    const end = Math.min(size, bytes.length, 256);
    if (["avif", "avis"].includes(ascii(8, 12))) return "avif";
    for (let offset = 16; offset + 4 <= end; offset += 4) {
      if (["avif", "avis"].includes(ascii(offset, offset + 4))) return "avif";
    }
  }
  return null;
}
