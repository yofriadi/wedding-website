import { expect, test } from "@playwright/test";
import { selectTrailImages } from "../src/lib/photo-trail";
import type { GuestPhoto, GuestPhotosPayload } from "../src/lib/guest-photos";

const photo = (photoUrl: string, createdAt = 1): GuestPhoto => ({
  id: photoUrl,
  photoUrl,
  createdAt,
});
const payload = (photos: GuestPhoto[]): GuestPhotosPayload => ({
  mineId: null,
  inviteValid: false,
  photos,
});

test("an empty gallery yields no images at all — no starter fallback", () => {
  expect(selectTrailImages(null)).toEqual([]);
  expect(selectTrailImages(payload([]))).toEqual([]);
});

test("a small gallery passes through once, without padding or repeats", () => {
  expect(selectTrailImages(payload([photo("/one.webp")]))).toEqual(["/one.webp"]);
  expect(selectTrailImages(payload([photo("/newer.webp", 2), photo("/older.webp", 1)]))).toEqual([
    "/newer.webp",
    "/older.webp",
  ]);
});

test("the caller's photo stays in the pool once, with defensive URL deduplication", () => {
  const data = payload([photo("/mine.webp"), photo("/mine.webp"), photo(""), photo("/other.webp")]);
  data.inviteValid = true;
  data.mineId = "/mine.webp";
  const before = structuredClone(data);
  Object.freeze(data.photos);
  expect(selectTrailImages(data)).toEqual(["/mine.webp", "/other.webp"]);
  expect(data).toEqual(before);
});

test("the full guest collection is preserved beyond the 18 display positions", () => {
  const photos = Array.from({ length: 22 }, (_, index) => photo(`/guest-${index}.webp`));
  expect(selectTrailImages(payload(photos))).toEqual(photos.map((entry) => entry.photoUrl));
});
