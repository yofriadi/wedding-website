import crypto from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import type { Exif } from "sharp";
import type { GuestPhoto, GuestPhotosPayload } from "../src/lib/guest-photos";
import { createTestServer, startTestServer } from "./support/server";

let server: Awaited<ReturnType<typeof createTestServer>>;
let nextInvite = 0;
let uploaded: GuestPhoto;
let bigJpeg: Buffer;
const canonicalPath = (photo: GuestPhoto) =>
  join(server.photosDir, photo.photoUrl.replace("/api/photos/", ""));

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);
test.beforeAll(async () => {
  test.setTimeout(180_000);
  server = await createTestServer("photo-pipeline");
});
test.afterAll(async () => {
  await server?.dispose();
});

async function invite() {
  const id = `Photo${String(++nextInvite).padStart(7, "0")}`;
  const db = await server.connect();
  try {
    await db.execute({
      sql: "INSERT INTO invites (id, display_name, created_at) VALUES (?, ?, ?)",
      args: [id, "Private Guest Name", nextInvite],
    });
  } finally {
    db.close();
  }
  return id;
}
function form(bytes?: Buffer, field = "photo") {
  const body = new FormData();
  if (bytes)
    body.append(
      field,
      new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }),
      "../../untrusted.jpg",
    );
  return body;
}
function post(id: string, body: FormData | string, extraHeaders: Record<string, string> = {}) {
  return fetch(`${server.baseUrl}/api/guest-photos`, {
    method: "POST",
    headers: { origin: server.baseUrl, cookie: `ww_invite_id=${id}`, ...extraHeaders },
    body,
  });
}
async function upload(bytes: Buffer) {
  const response = await post(await invite(), form(bytes));
  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const photo = (await response.json()) as GuestPhoto;
  expect(Object.keys(photo).sort()).toEqual(["createdAt", "id", "photoUrl"]);
  expect(photo.id).toMatch(/^[A-Za-z0-9_-]{12}$/);
  expect(photo.photoUrl).toBe(`/api/photos/guest-photos/${photo.id}/photo.webp`);
  const collection = await fetch(`${server.baseUrl}/api/guest-photos`);
  const payload = (await collection.json()) as GuestPhotosPayload;
  expect(payload.photos.find((entry) => entry.id === photo.id)).toEqual(photo);
  return photo;
}
async function makeTestPhoto(width: number, height: number) {
  return sharp(crypto.randomBytes(Math.round(width / 8) * Math.round(height / 8) * 3), {
    raw: { width: Math.round(width / 8), height: Math.round(height / 8), channels: 3 },
  })
    .resize(width, height)
    .linear([0.4, 0.4, 0.4], [76, 76, 76])
    .png()
    .toBuffer();
}
async function waitForAvif(photo: GuestPhoto, baseUrl = server.baseUrl) {
  let response: Response;
  await expect
    .poll(
      async () => {
        response = await fetch(`${baseUrl}${photo.photoUrl}`, {
          headers: { accept: "image/avif,image/webp" },
        });
        return response.headers.get("content-type");
      },
      { timeout: 90_000, intervals: [200, 500, 1000] },
    )
    .toBe("image/avif");
  return response!;
}

test("auth precedes parsing and every invalid single-file request leaves no data", async () => {
  const id = await invite();
  const image = await sharp({
    create: { width: 32, height: 48, channels: 3, background: "#846253" },
  })
    .png()
    .toBuffer();
  for (const anonymous of ["", "bad", "Unknown00001"]) {
    const response = await post(anonymous, "not-json", { "content-type": "application/json" });
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  }
  const tooMany = form(image);
  tooMany.append("photo", new Blob([new Uint8Array(image)]), "second.png");
  const notAFile = new FormData();
  notAFile.append("photo", "text");
  const unsupported = Buffer.from("not an image at all");
  const corruptJpeg = Buffer.from([0xff, 0xd8, 0xff, ...Array(32).fill(0)]);
  const cases: [FormData, string][] = [
    [form(), "empty_photo"],
    [tooMany, "too_many_photos"],
    [notAFile, "invalid_body"],
    [form(image, "photos"), "invalid_body"],
    [form(image, "wishText"), "invalid_body"],
    [form(Buffer.alloc(10 * 1024 * 1024 + 1)), "photo_too_large"],
    [form(unsupported), "invalid_photo_type"],
    [form(corruptJpeg), "invalid_photo_type"],
  ];
  for (const [body, error] of cases) {
    const response = await post(id, body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
  const malformed = await post(id, "broken", {
    "content-type": "multipart/form-data; boundary=missing",
  });
  expect(malformed.status).toBe(400);
  const foreign = await post(id, form(image), { origin: "https://foreign.example" });
  expect(foreign.status).toBe(403);
  const db = await server.connect();
  try {
    expect((await db.execute("SELECT COUNT(*) AS n FROM guest_photos")).rows[0]?.n).toBe(0);
  } finally {
    db.close();
  }
  expect(readdirSync(server.photosDir)).toEqual([]);
});

test("normalization caps dimensions, reduces bytes, and creates no thumbnails", async () => {
  bigJpeg = await sharp(await makeTestPhoto(3000, 2000))
    .jpeg({ quality: 92 })
    .toBuffer();
  uploaded = await upload(bigJpeg);
  const stored = readFileSync(canonicalPath(uploaded));
  expect(await sharp(stored).metadata()).toMatchObject({
    format: "webp",
    width: 2048,
    height: 1365,
  });
  expect(stored.length).toBeLessThan(bigJpeg.length);
  const small = await upload(await makeTestPhoto(1000, 704));
  expect(await sharp(readFileSync(canonicalPath(small))).metadata()).toMatchObject({
    width: 1000,
    height: 704,
  });
  for (const photo of [uploaded, small]) {
    const names = readdirSync(join(server.photosDir, "guest-photos", photo.id));
    expect(names).toContain("photo.webp");
    expect(
      names.every(
        (name) =>
          ["photo.webp", "photo.avif"].includes(name) ||
          /^photo\.avif\.[0-9a-f-]+\.part$/.test(name),
      ),
    ).toBe(true);
  }
});

test("orientation is applied and camera EXIF/GPS never reaches public output", async () => {
  const original = await sharp(await makeTestPhoto(1200, 800))
    .jpeg({ quality: 90 })
    .withMetadata({ orientation: 6 })
    .withExif({
      IFD0: { Make: "Apple", ImageDescription: "private camera information" },
      GPS: { GPSLatitude: "6/1", GPSLatitudeRef: "N", GPSLongitude: "106/1", GPSLongitudeRef: "E" },
    } as unknown as Exif)
    .toBuffer();
  expect((await sharp(original).metadata()).exif?.length).toBeGreaterThan(0);
  const photo = await upload(original);
  const meta = await sharp(readFileSync(canonicalPath(photo))).metadata();
  expect(meta).toMatchObject({ width: 800, height: 1200, format: "webp" });
  expect(meta.exif).toBeUndefined();
  expect(meta.xmp).toBeUndefined();
  expect(meta.iptc).toBeUndefined();
  expect(meta.orientation).toBeUndefined();
});

test("WebP pass-through requires every size, dimension, orientation and privacy condition", async () => {
  const source = await makeTestPhoto(1504, 1000);
  const optimal = await sharp(source).webp({ quality: 20 }).toBuffer();
  const original = await upload(optimal);
  expect(readFileSync(canonicalPath(original))).toEqual(optimal);
  const privateWebp = await sharp(source)
    .webp({ quality: 20 })
    .withExif({ IFD0: { Make: "Apple" } })
    .toBuffer();
  const stripped = await upload(privateWebp);
  expect(readFileSync(canonicalPath(stripped))).not.toEqual(privateWebp);
  expect((await sharp(readFileSync(canonicalPath(stripped))).metadata()).exif).toBeUndefined();
  const oversized = await upload(
    await sharp(await makeTestPhoto(3000, 2000))
      .webp({ quality: 20 })
      .toBuffer(),
  );
  expect((await sharp(readFileSync(canonicalPath(oversized))).metadata()).width).toBe(2048);
  const rotated = await upload(
    await sharp(source).webp({ quality: 20 }).withMetadata({ orientation: 6 }).toBuffer(),
  );
  expect(await sharp(readFileSync(canonicalPath(rotated))).metadata()).toMatchObject({
    width: 1000,
    height: 1504,
  });
  const expensive = await sharp(source).webp({ lossless: true }).toBuffer();
  const smaller = await upload(expensive);
  expect(readFileSync(canonicalPath(smaller)).length).toBeLessThan(expensive.length);
});

test("AVIF input always has a universally decodable WebP canonical", async () => {
  const avif = await sharp(await makeTestPhoto(800, 600))
    .avif({ quality: 40 })
    .toBuffer();
  const photo = await upload(avif);
  expect((await sharp(readFileSync(canonicalPath(photo))).metadata()).format).toBe("webp");
  expect((await waitForAvif(photo)).status).toBe(200);
});

test("public immutable delivery negotiates AVIF only for explicit nonzero support", async () => {
  const variant = await waitForAvif(uploaded);
  expect((await sharp(Buffer.from(await variant.arrayBuffer())).metadata()).format).toBe("heif");
  expect(variant.headers.get("vary")).toBe("Accept");
  for (const accept of [
    "image/webp",
    "*/*",
    "image/*",
    "image/avif;q=0,image/webp",
    "image/avif;q=oops",
    "image/avif;q=2",
  ]) {
    const response = await fetch(`${server.baseUrl}${uploaded.photoUrl}`, { headers: { accept } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("vary")).toBe("Accept");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      readFileSync(canonicalPath(uploaded)),
    );
  }
  expect(readdirSync(join(server.photosDir, "guest-photos", uploaded.id)).sort()).toEqual([
    "photo.avif",
    "photo.webp",
  ]);
  for (const key of [
    "guest-photos/Unknown00001/photo.webp",
    `guest-photos/${uploaded.id}/thumb.webp`,
    `guest-photos/${uploaded.id}/0.webp`,
    `guest-photos/${uploaded.id}/photo.webp.part`,
    `submissions/${uploaded.id}/0.webp`,
  ]) {
    const response = await fetch(`${server.baseUrl}/api/photos/${key}`);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
});

test("public collection is flat, ordered, identity-minimal and identifies the caller once", async () => {
  const id = await invite();
  const accepted = await post(id, form(bigJpeg));
  const mine = (await accepted.json()) as GuestPhoto;
  const db = await server.connect();
  try {
    await db.execute("UPDATE guest_photos SET created_at=100");
  } finally {
    db.close();
  }
  for (const cookie of ["", "bad", "Unknown00001", id]) {
    const response = await fetch(`${server.baseUrl}/api/guest-photos`, {
      headers: { cookie: `ww_invite_id=${cookie}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = (await response.json()) as GuestPhotosPayload;
    expect(payload.inviteValid).toBe(cookie === id);
    expect(payload.mineId).toBe(cookie === id ? mine.id : null);
    expect(Object.keys(payload).sort()).toEqual(["inviteValid", "mineId", "photos"]);
    expect(payload.photos.filter((photo) => photo.id === mine.id)).toHaveLength(1);
    expect(payload.photos.map((photo) => photo.id)).toEqual(
      payload.photos
        .map((photo) => photo.id)
        .sort()
        .reverse(),
    );
    expect(
      payload.photos.every((photo) => Object.keys(photo).sort().join() === "createdAt,id,photoUrl"),
    ).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("Private Guest Name");
    expect(JSON.stringify(payload)).not.toContain(id);
  }
});

test("concurrent uploads publish one row and remove only the losing directory", async () => {
  const id = await invite();
  const before = readdirSync(join(server.photosDir, "guest-photos"));
  const results = await Promise.all([post(id, form(bigJpeg)), post(id, form(bigJpeg))]);
  expect(results.map((response) => response.status).sort()).toEqual([201, 409]);
  const winner = (await results.find((response) => response.status === 201)!.json()) as GuestPhoto;
  expect(await results.find((response) => response.status === 409)!.json()).toEqual({
    error: "already_posted",
  });
  expect(
    readdirSync(join(server.photosDir, "guest-photos")).filter(
      (directory) => !before.includes(directory),
    ),
  ).toEqual([winner.id]);
  expect(existsSync(canonicalPath(winner))).toBe(true);
  const db = await server.connect();
  try {
    expect(
      (
        await db.execute({
          sql: "SELECT COUNT(*) AS n FROM guest_photos WHERE invite_id=?",
          args: [id],
        })
      ).rows[0]?.n,
    ).toBe(1);
    expect((await db.execute("PRAGMA foreign_key_check")).rows).toEqual([]);
  } finally {
    db.close();
  }
});

test("generation flag preserves existing variants and GET retries absent variants after restart", async () => {
  const database = await import("./support/database").then(({ createTestDatabase }) =>
    createTestDatabase("avif-flag"),
  );
  const client = await database.connect();
  await client.execute(
    "INSERT INTO invites (id, display_name, created_at) VALUES ('AvifFlag0001', 'Fixture', 1)",
  );
  client.close();
  let process = await startTestServer(database, 0, { PHOTO_AVIF_ENABLED: "false" });
  try {
    const response = await fetch(`${process.baseUrl}/api/guest-photos`, {
      method: "POST",
      headers: { cookie: "ww_invite_id=AvifFlag0001", origin: process.baseUrl },
      body: form(bigJpeg),
    });
    expect(response.status).toBe(201);
    const photo = (await response.json()) as GuestPhoto;
    const first = await fetch(`${process.baseUrl}${photo.photoUrl}`, {
      headers: { accept: "image/avif" },
    });
    expect(first.headers.get("content-type")).toBe("image/webp");
    expect(readdirSync(join(database.photosDir, "guest-photos", photo.id))).toEqual(["photo.webp"]);
    await process.stop();
    process = await startTestServer(database, 0, { PHOTO_AVIF_ENABLED: "true" });
    expect((await waitForAvif(photo, process.baseUrl)).status).toBe(200);
    await process.stop();
    process = await startTestServer(database, 0, { PHOTO_AVIF_ENABLED: "false" });
    expect(
      (
        await fetch(`${process.baseUrl}${photo.photoUrl}`, { headers: { accept: "image/avif" } })
      ).headers.get("content-type"),
    ).toBe("image/avif");
  } finally {
    await process.stop();
    database.dispose();
  }
});

test("database lookup failures return unavailable rather than empty public state", async () => {
  const database = await import("./support/database").then(({ createTestDatabase }) =>
    createTestDatabase("photo-outage"),
  );
  const process = await startTestServer(database);
  const db = await database.connect();
  try {
    await db.execute("DROP TABLE guest_photos");
    const publicRead = await fetch(`${process.baseUrl}/api/guest-photos`);
    expect(publicRead.status).toBe(503);
    expect(publicRead.headers.get("cache-control")).toBe("no-store");
    await db.execute("DROP TABLE rsvps");
    await db.execute("DROP TABLE invites");
    const privateWrite = await fetch(`${process.baseUrl}/api/guest-photos`, {
      method: "POST",
      headers: {
        cookie: "ww_invite_id=Unknown00001",
        origin: process.baseUrl,
        "content-type": "application/json",
      },
      body: "invalid",
    });
    expect(privateWrite.status).toBe(503);
    expect(privateWrite.headers.get("cache-control")).toBe("no-store");
    expect(await privateWrite.text()).toBe("");
  } finally {
    db.close();
    await process.stop();
    database.dispose();
  }
});
