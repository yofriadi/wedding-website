import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

let root: string;
let storage: typeof import("../src/lib/photo-storage");
let env: typeof import("@wedding-website/env/server").env;
let priorStorage: string;

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "ww-storage-"));
  process.env.DATABASE_URL = `file:${join(root, "unused.sqlite")}`;
  ({ env } = await import("@wedding-website/env/server"));
  priorStorage = env.PHOTO_STORAGE_DIR;
  Object.assign(env, { PHOTO_STORAGE_DIR: root });
  storage = await import("../src/lib/photo-storage");
});
test.afterAll(() => {
  if (env) Object.assign(env, { PHOTO_STORAGE_DIR: priorStorage });
  if (root) rmSync(root, { recursive: true, force: true });
});

test("only photo-scoped WebP/AVIF keys resolve within storage", () => {
  const key = "guest-photos/Storage00001/photo.webp";
  expect(storage.isValidPhotoKey(key)).toBe(true);
  expect(storage.avifVariantKey(key)).toBe("guest-photos/Storage00001/photo.avif");
  for (const invalid of [
    "../secret",
    "/etc/passwd",
    "guest-photos/../../secret",
    "submissions/Storage00001/0.webp",
    "guest-photos/Storage00001/thumb.webp",
    `${key}.part`,
    key.replace(".webp", ".png"),
  ]) {
    expect(storage.isValidPhotoKey(invalid)).toBe(false);
    expect(() => storage.resolvePhotoPath(invalid)).toThrow();
  }
});

test("collisions retry without overwriting or deleting another upload", async () => {
  const taken = "Storage00001";
  const dir = join(root, "guest-photos", taken);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "photo.webp"), "winner");
  let count = 0;
  const reserved = await storage.reservePhotoDirectory(() =>
    ++count < 3 ? taken : "Storage00002",
  );
  expect(count).toBe(3);
  await reserved.write(new Uint8Array([1, 2, 3]));
  await reserved.remove();
  await reserved.remove();
  expect(readFileSync(join(dir, "photo.webp"), "utf8")).toBe("winner");
  await expect(storage.reservePhotoDirectory(() => taken)).rejects.toThrow(
    /unique photo directory/,
  );
  expect(readFileSync(join(dir, "photo.webp"), "utf8")).toBe("winner");
});

test("readers never see partial canonical/variant bytes and reservations cannot rewrite", async () => {
  const reserved = await storage.reservePhotoDirectory(() => "Storage00003");
  const content = new Uint8Array(4 * 1024 * 1024).fill(42);
  const writing = reserved.write(content);
  const observed = await storage.readPhoto(reserved.key);
  if (observed) expect(observed.bytes.byteLength).toBe(content.byteLength);
  await writing;
  expect((await storage.readPhoto(reserved.key))?.bytes).toEqual(Buffer.from(content));
  await expect(reserved.write(new Uint8Array([9]))).rejects.toThrow();
  const variant = storage.avifVariantKey(reserved.key)!;
  const variantWrite = storage.writePhotoAtKey(variant, content);
  const during = await storage.readPhoto(variant);
  if (during) expect(during.bytes.byteLength).toBe(content.byteLength);
  await variantWrite;
  expect(readdirSync(join(root, "guest-photos", reserved.id)).sort()).toEqual([
    "photo.avif",
    "photo.webp",
  ]);
  await reserved.remove();
  await expect(storage.writePhotoAtKey(variant, content)).rejects.toThrow();
});

test("abandoned temporary files do not prevent retry and are never removed by another writer", async () => {
  const reserved = await storage.reservePhotoDirectory(() => "Storage00004");
  const temporary = storage.resolvePhotoPath(reserved.key) + ".old-attempt.part";
  writeFileSync(temporary, "another writer");
  await reserved.write(new Uint8Array([1]));
  expect(readFileSync(temporary, "utf8")).toBe("another writer");
  const variant = storage.avifVariantKey(reserved.key)!;
  const abandoned = storage.resolvePhotoPath(variant) + ".part";
  writeFileSync(abandoned, "interrupted AVIF");
  await storage.writePhotoAtKey(variant, new Uint8Array([2, 3]));
  expect((await storage.readPhoto(variant))?.bytes).toEqual(Buffer.from([2, 3]));
  expect(readFileSync(abandoned, "utf8")).toBe("interrupted AVIF");
  await reserved.remove();
});
