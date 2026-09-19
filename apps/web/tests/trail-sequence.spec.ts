import { expect, test } from "@playwright/test";
import { shuffleTrail, TrailSequence } from "../src/lib/trail-sequence";

const photos = Array.from({ length: 60 }, (_, index) => `/guest-${index}.webp`);
const none = new Set<string>();

function seededRandom(seed = 12345) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };
}

test("shuffling returns a permutation without changing the input", () => {
  const original = [...photos];
  const shuffled = shuffleTrail(photos, seededRandom());
  expect(shuffled).not.toEqual(photos);
  expect([...shuffled].sort()).toEqual([...photos].sort());
  expect(photos).toEqual(original);
});

test("every guest gets a turn in each shuffled pass, including photos beyond 18", () => {
  const sequence = new TrailSequence(seededRandom());
  sequence.update(photos);
  const first = photos.map(() => sequence.next(none));
  const second = photos.map(() => sequence.next(none));
  expect(new Set(first)).toEqual(new Set(photos));
  expect(new Set(second)).toEqual(new Set(photos));
  expect(first).not.toEqual(second);
});

test("prefer an unoccupied photo, then hold when every photo is on screen", () => {
  const sequence = new TrailSequence(() => 0.999);
  sequence.update(["a", "b", "c"]);
  expect(sequence.next(new Set(["a", "b"]), "a")).toBe("c");
  // All sources are already shown or reserved: no photo may be duplicated.
  expect(sequence.next(new Set(["a", "b", "c"]), "a")).toBeUndefined();
  sequence.update(["only", "only", ""]);
  expect(sequence.next(none)).toBe("only");
  expect(sequence.next(new Set(["only"]), "only")).toBeUndefined();
});

test("refreshes preserve the unshown queue while admitting new photos and removing old ones", () => {
  const sequence = new TrailSequence(() => 0.999);
  sequence.update(["a", "b", "c", "d"]);
  expect(sequence.next(none)).toBe("a");
  expect(sequence.update(["a", "b", "c", "d"])).toEqual([]);
  expect(sequence.next(none)).toBe("b");
  expect(sequence.update(["a", "b", "c", "new"])).toEqual(["new"]);
  expect(sequence.next(none)).toBe("new");
  expect(sequence.next(none)).toBe("c");
  expect(new Set(Array.from({ length: 4 }, () => sequence.next(none)))).toEqual(
    new Set(["a", "b", "c", "new"]),
  );
});

test("the uploader's photo is next without dropping anyone else from the pass", () => {
  const sequence = new TrailSequence(seededRandom());
  sequence.update(photos);
  sequence.prioritize([photos[42]!, photos[42]!, "/not-in-gallery.webp"]);
  const pass = photos.map(() => sequence.next(none));
  expect(pass[0]).toBe(photos[42]);
  expect(new Set(pass)).toEqual(new Set(photos));
});

test("an empty or failed pool terminates and a later refresh can restore it", () => {
  const sequence = new TrailSequence(seededRandom());
  expect(sequence.next(none)).toBeUndefined();
  sequence.update(["bad"]);
  sequence.update([]);
  expect(sequence.next(none)).toBeUndefined();
  sequence.update(["recovered"]);
  expect(sequence.next(none)).toBe("recovered");
});
