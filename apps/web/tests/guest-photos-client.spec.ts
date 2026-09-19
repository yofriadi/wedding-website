import { expect, test } from "@playwright/test";
import { invalidateGuestPhotos, loadGuestPhotos } from "../src/lib/guest-photos-client";

const valid = { inviteValid: true, mineId: null, photos: [] };
test.describe.configure({ mode: "serial" });
const originalFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  invalidateGuestPhotos();
});

test("concurrent consumers share one request and successful cache", async () => {
  let reads = 0;
  globalThis.fetch = async () => {
    reads++;
    return Response.json(valid);
  };
  const one = loadGuestPhotos();
  const two = loadGuestPhotos();
  expect(one).toBe(two);
  expect(await one).toEqual(valid);
  expect(await loadGuestPhotos()).toEqual(valid);
  expect(reads).toBe(1);
});

test("transient and malformed responses never become permanent cache or eligibility", async () => {
  let reads = 0;
  const outcomes = [
    new Response(null, { status: 503 }),
    Response.json({ mine: null, wall: { stories: [] } }),
    Response.json({ inviteValid: true, photos: [] }),
    Response.json(valid),
  ];
  globalThis.fetch = async () => outcomes[reads++]!;
  expect(await loadGuestPhotos()).toBeNull();
  expect(await loadGuestPhotos()).toBeNull();
  expect(await loadGuestPhotos()).toBeNull();
  expect(await loadGuestPhotos()).toEqual(valid);
  expect(reads).toBe(4);
});

test("an old failed request cannot invalidate a newer successful request", async () => {
  let finishOld!: (response: Response) => void;
  let reads = 0;
  globalThis.fetch = async () =>
    ++reads === 1
      ? new Promise<Response>((resolve) => {
          finishOld = resolve;
        })
      : Response.json(valid);
  const old = loadGuestPhotos();
  invalidateGuestPhotos();
  const current = loadGuestPhotos();
  expect(await current).toEqual(valid);
  finishOld(new Response(null, { status: 503 }));
  expect(await old).toBeNull();
  expect(loadGuestPhotos()).toBe(current);
  expect(reads).toBe(2);
});

test("identity-inconsistent collections cannot authorize the picker", async () => {
  for (const payload of [
    { ...valid, mineId: "missing" },
    {
      ...valid,
      inviteValid: false,
      mineId: "PhotoTest001",
      photos: [{ id: "PhotoTest001", photoUrl: "/photo.webp", createdAt: 1 }],
    },
    {
      ...valid,
      photos: [{ id: "PhotoTest001", photoUrl: "/photo.webp", createdAt: "not a timestamp" }],
    },
  ]) {
    globalThis.fetch = async () => Response.json(payload);
    expect(await loadGuestPhotos()).toBeNull();
  }
});
