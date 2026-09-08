import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createClient } from "@libsql/client";
import { expect, test } from "@playwright/test";
import sharp from "sharp";

// photo-normalization: the ingest pipeline and the photo route's format
// negotiation, asserted against a real server and real files — the mocked
// /api/submissions payloads in guest-rail.spec.ts cannot cover either.
//
//   upload  → what is stored is a CAPPED WEBP, not the guest's original, and
//             it carries no EXIF (the wall is public, so a stored original
//             would publish whatever the camera embedded — GPS above all)
//   AVIF    → written by a background queue AFTER the 201, then served from
//             the SAME url when — and only when — the request advertises
//             `image/avif`. A browser that cannot decode AVIF (iOS ≤ 15) must
//             never receive one, so the fallback direction is asserted too.
//   reject  → undecodable bytes fail BEFORE the row is claimed, so nothing is
//             stored and the guest is not locked out of retrying.
//
// Own server + throwaway DB + throwaway PHOTO_STORAGE_DIR, like
// mock-gate-ssr.spec.ts: the shared suite DB must stay empty for every other
// spec, and these tests write real image files.
//
// Chromium-only: both playwright projects would otherwise spawn this server
// concurrently over the same fixed resources.

const MIGRATIONS_DIR = resolve(process.cwd(), "..", "..", "packages", "db", "src", "migrations");
// INVITE_ID_RE is ^[A-Za-z0-9_-]{12}$ — keep exactly 12 chars.
const UPLOAD_INVITE = "PipeUpload01";
const EXIF_INVITE = "PipeExif0001";
const REJECT_INVITE = "PipeReject01";
const PASSTHROUGH_INVITE = "PipePassThr1";
const AVIF_UPLOAD_INVITE = "PipeAvifUp01";

const AVIF_ACCEPT = "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";
// No `image/avif` anywhere: what an iOS ≤ 15 browser sends for an <img>.
const NO_AVIF_ACCEPT = "image/webp,image/png,image/*,*/*;q=0.8";

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "chromium project only");
});
test.describe.configure({ mode: "serial" });

const workDir = mkdtempSync(join(tmpdir(), "ww-photo-pipeline-"));
const dbPath = join(workDir, "pipeline.sqlite");
const photosDir = join(workDir, "photos");
let baseUrl = "";
let server: ReturnType<typeof spawn> | undefined;
let serverExit: Promise<void> | undefined;

// Shared across the serial tests: the submission created by the upload test is
// what the negotiation tests assert on.
let uploadId = "";
let uploadKey = ""; // submissions/<id>/0.webp
let exifId = "";
let passThroughId = "";
let avifUploadId = "";

const killServerGroup = () => {
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
};
process.once("SIGINT", () => {
  killServerGroup();
  process.exit(130);
});
process.once("SIGTERM", () => {
  killServerGroup();
  process.exit(143);
});

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const probe = createServer();
    // No host: binds every interface (astro dev picks ::1 on some setups,
    // 127.0.0.1 on others — the port must be free on whichever it chooses).
    probe.listen(0, () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => res(port));
    });
    probe.on("error", rej);
  });
}

async function applyMigrations(): Promise<void> {
  const db = createClient({ url: `file:${dbPath}` });
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await db.executeMultiple(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  await db.close();
}

async function seedInvites(): Promise<void> {
  const db = createClient({ url: `file:${dbPath}` });
  const now = Date.now();
  for (const id of [
    UPLOAD_INVITE,
    EXIF_INVITE,
    REJECT_INVITE,
    PASSTHROUGH_INVITE,
    AVIF_UPLOAD_INVITE,
  ]) {
    await db.execute({
      sql: "insert into invites (id, display_name, created_at, max_party_size) values (?, 'Pipeline Guest', ?, 2)",
      args: [id, now],
    });
  }
  await db.close();
}

/**
 * A photo-like test image: colour base with a blended noise layer. The noise
 * keeps it from being trivially compressible the way a flat `create()` fixture
 * would be — a flat image would make every size assertion pass for the wrong
 * reason (a 3000×2000 solid colour JPEG is ~40KB).
 *
 * The noise is generated at 1/8 scale and ATTENUATED toward mid-grey with
 * linear() rather than an opacity option — sharp's OverlayOptions has no
 * opacity key. Attenuation matters for size: full-strength per-pixel noise at
 * 3000×2000 makes a 19MB PNG, which would trip the 10MB upload cap and test
 * the rejection path instead of the normalization path.
 */
async function makeTestPhoto(width: number, height: number): Promise<Buffer> {
  const noiseWidth = Math.round(width / 8);
  const noiseHeight = Math.round(height / 8);
  const noise = await sharp(crypto.randomBytes(noiseWidth * noiseHeight * 3), {
    raw: { width: noiseWidth, height: noiseHeight, channels: 3 },
  })
    .resize(width, height)
    .linear([0.4, 0.4, 0.4], [76, 76, 76])
    .png()
    .toBuffer();
  const base = await sharp({
    create: { width, height, channels: 3, background: { r: 190, g: 140, b: 110 } },
  })
    .png()
    .toBuffer();
  return sharp(base)
    .composite([{ input: noise, blend: "overlay" }])
    .toBuffer();
}

/**
 * A JPEG carrying camera EXIF, GPS coordinates included — the leak
 * normalization must remove before the photo reaches a public wall.
 *
 * The cast is the FIXTURE reaching past sharp's typings (its Exif type exposes
 * only IFD0–IFD3, while libvips writes any IFD you name). Nothing in src/
 * writes EXIF; the app only ever strips it.
 */
async function makeGeotaggedJpeg(): Promise<Buffer> {
  const photo = await makeTestPhoto(1200, 800);
  const exif = {
    "0th": { ImageDescription: "venue shot", Make: "Apple", Model: "iPhone 15 Pro" },
    GPS: {
      GPSLatitude: "6/1",
      GPSLatitudeRef: "N",
      GPSLongitude: "106/1",
      GPSLongitudeRef: "E",
    },
  } as unknown as sharp.Exif;
  return sharp(photo).jpeg({ quality: 90 }).withExif(exif).toBuffer();
}

interface UploadFile {
  bytes: Buffer;
  filename: string;
  type: string;
}

async function postSubmission(inviteId: string, files: UploadFile[]) {
  const form = new FormData();
  for (const file of files) {
    form.append(
      "photos",
      new Blob([new Uint8Array(file.bytes)], { type: file.type }),
      file.filename,
    );
  }
  return fetch(`${baseUrl}/api/submissions`, {
    method: "POST",
    // Astro's checkOrigin (on by default for SSR) rejects a state-changing
    // request whose Origin is missing or foreign — the same reason the ops
    // runbook's curl example sends `-H 'origin: ...'`.
    headers: { cookie: `ww_invite_id=${inviteId}`, origin: baseUrl },
    body: form,
  });
}

const storedPath = (key: string): string => join(photosDir, key);

/** GET a photo url, polling until the background AVIF variant has landed. */
async function waitForAvif(pathname: string, timeoutMs = 90_000): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let last: Response | undefined;
  while (Date.now() < deadline) {
    last = await fetch(`${baseUrl}${pathname}`, { headers: { accept: AVIF_ACCEPT } });
    if (last.headers.get("content-type") === "image/avif") return last;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `AVIF variant never served for ${pathname} (last content-type: ${last?.headers.get("content-type")})`,
  );
}

test.beforeAll(async () => {
  test.setTimeout(240_000); // covers this hook: astro dev cold start + migrations
  await applyMigrations();
  await seedInvites();
  mkdirSync(photosDir, { recursive: true });

  const port = await freePort();
  // "localhost" (not 127.0.0.1): astro dev binds ::1-only in some environments.
  baseUrl = `http://localhost:${port}`;
  server = spawn("pnpm", ["dev:bare", "--port", String(port), "--ignore-lock"], {
    env: { ...process.env, DATABASE_URL: `file:${dbPath}`, PHOTO_STORAGE_DIR: photosDir },
    stdio: ["ignore", "ignore", "ignore"],
    detached: true,
  });
  serverExit = new Promise<void>((res) => server?.once("exit", () => res()));

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(baseUrl);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("photo-pipeline dev server did not come up");
});

test.afterAll(async () => {
  // Leak-proof teardown, same escalation as mock-gate-ssr.spec.ts: a surviving
  // dev server holds the port and its throwaway DB forever.
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      // already gone
    }
    if (serverExit) {
      await Promise.race([serverExit, new Promise((r) => setTimeout(r, 5_000))]);
    }
    if (server.exitCode === null && !server.killed) {
      try {
        process.kill(-server.pid, "SIGKILL");
      } catch {
        // already gone
      }
      if (serverExit) {
        await Promise.race([serverExit, new Promise((r) => setTimeout(r, 5_000))]);
      }
    }
    if (server.exitCode === null && !server.killed) {
      console.error(`[photo-pipeline] LEAK: server pid ${server.pid} survived SIGTERM+SIGKILL`);
    }
  }
  rmSync(workDir, { recursive: true, force: true });
});

test("uploads are stored as capped WebPs, smaller than what arrived", async () => {
  // One submission, two formats: a 3000×2000 phone-sized JPEG (exercises the
  // dimension cap) and a 1000×700 PNG (the format the stored fixtures were —
  // 2.4–3.0MB each, served verbatim into a full-screen <img> before this).
  const bigJpeg = await sharp(await makeTestPhoto(3000, 2000))
    .jpeg({ quality: 92 })
    .toBuffer();
  const smallPng = await sharp(await makeTestPhoto(1000, 700))
    .png()
    .toBuffer();
  expect(bigJpeg.byteLength).toBeGreaterThan(1024 * 1024);
  expect(smallPng.byteLength).toBeGreaterThan(1024 * 1024);

  const res = await postSubmission(UPLOAD_INVITE, [
    { bytes: bigJpeg, filename: "holiday.jpg", type: "image/jpeg" },
    { bytes: smallPng, filename: "screenshot.png", type: "image/png" },
  ]);
  expect(res.status).toBe(201);
  const body = (await res.json()) as {
    id: string;
    photos: { photoUrl: string; thumbnailUrl: string }[];
  };
  uploadId = body.id;

  // Every canonical key is a WebP, whatever the guest sent.
  expect(body.photos.map((p) => p.photoUrl)).toEqual([
    `/api/photos/submissions/${uploadId}/0.webp`,
    `/api/photos/submissions/${uploadId}/1.webp`,
  ]);
  expect(body.photos[0]?.thumbnailUrl).toBe(`/api/photos/submissions/${uploadId}/thumb.webp`);
  uploadKey = `submissions/${uploadId}/0.webp`;

  // Photo 0: capped on the long edge, aspect preserved, smaller than the input.
  const first = readFileSync(storedPath(uploadKey));
  const firstMeta = await sharp(first).metadata();
  expect(firstMeta.format).toBe("webp");
  expect(firstMeta.width).toBe(2048);
  expect(firstMeta.height).toBe(1365); // 3000×2000 → 2048×1365
  expect(first.byteLength).toBeLessThan(bigJpeg.byteLength);

  // Photo 1: under the cap, so NOT enlarged — same pixels, ~20× fewer bytes.
  const second = readFileSync(storedPath(`submissions/${uploadId}/1.webp`));
  const secondMeta = await sharp(second).metadata();
  expect(secondMeta.format).toBe("webp");
  expect(secondMeta.width).toBe(1000);
  expect(secondMeta.height).toBe(700);
  expect(second.byteLength).toBeLessThan(smallPng.byteLength / 4);

  // The rail thumbnail is normalized too: 224×400 WebP cover, never a scaled
  // original (L6).
  const thumb = readFileSync(storedPath(`submissions/${uploadId}/thumb.webp`));
  const thumbMeta = await sharp(thumb).metadata();
  expect(thumbMeta.format).toBe("webp");
  expect(thumbMeta.width).toBe(224);
  expect(thumbMeta.height).toBe(400);
});

test("EXIF (including GPS) is stripped from what the public wall serves", async () => {
  const geotagged = await makeGeotaggedJpeg();
  const inputMeta = await sharp(geotagged).metadata();
  expect(inputMeta.exif?.length ?? 0).toBeGreaterThan(0); // the fixture really is geotagged

  const res = await postSubmission(EXIF_INVITE, [
    { bytes: geotagged, filename: "venue.jpg", type: "image/jpeg" },
  ]);
  expect(res.status).toBe(201);
  exifId = ((await res.json()) as { id: string }).id;

  const stored = readFileSync(storedPath(`submissions/${exifId}/0.webp`));
  const storedMeta = await sharp(stored).metadata();
  expect(storedMeta.exif).toBeUndefined();
  expect(storedMeta.xmp).toBeUndefined();
  expect(storedMeta.iptc).toBeUndefined();
});

test("one URL serves WebP first, then AVIF, only to browsers that ask for it", async () => {
  const pathname = `/api/photos/${uploadKey}`;

  // Headers while the canonical is definitely all there is.
  const plain = await fetch(`${baseUrl}${pathname}`, { headers: { accept: NO_AVIF_ACCEPT } });
  expect(plain.status).toBe(200);
  expect(plain.headers.get("content-type")).toBe("image/webp");
  expect(plain.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  // A negotiated response MUST vary on Accept, or a shared cache serves one
  // browser's format to another.
  expect(plain.headers.get("vary")).toBe("Accept");
  const webpBytes = Buffer.from(await plain.arrayBuffer());

  // The variant is written after the 201 — poll until the route serves it.
  const avif = await waitForAvif(pathname);
  expect(avif.status).toBe(200);
  expect(avif.headers.get("content-type")).toBe("image/avif");
  expect(avif.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  expect(avif.headers.get("vary")).toBe("Accept");
  const avifBytes = Buffer.from(await avif.arrayBuffer());
  expect((await sharp(avifBytes).metadata()).format).toBe("heif");
  // The whole point: the efficient format is smaller than the fallback.
  expect(avifBytes.byteLength).toBeLessThan(webpBytes.byteLength);
  expect(avifBytes.byteLength).toBeGreaterThan(0);

  // Same URL, no `image/avif` in Accept → still WebP, now that the variant
  // exists. This is the iOS ≤ 15 guarantee, and it is why the negotiation
  // lives in the route rather than in a <picture> sidecar.
  const after = await fetch(`${baseUrl}${pathname}`, { headers: { accept: NO_AVIF_ACCEPT } });
  expect(after.headers.get("content-type")).toBe("image/webp");

  // `*/*` is not a promise of AVIF support (curl, prefetchers, some WebViews):
  // guessing wrong there is a broken image, not a slightly larger file.
  const wildcard = await fetch(`${baseUrl}${pathname}`, { headers: { accept: "*/*" } });
  expect(wildcard.headers.get("content-type")).toBe("image/webp");

  // The rail thumbnail and the second photo go through the same queue — the
  // thumbnail is the highest-traffic surface on the page. Wait for both before
  // listing the directory: the queue is FIFO, so 0.avif existing says nothing
  // about the jobs behind it, and asserting the full set early would flake.
  const thumbAvif = await waitForAvif(`/api/photos/submissions/${uploadId}/thumb.webp`);
  expect(thumbAvif.headers.get("content-type")).toBe("image/avif");
  const secondAvif = await waitForAvif(`/api/photos/submissions/${uploadId}/1.webp`);
  expect(secondAvif.headers.get("content-type")).toBe("image/avif");

  // Both variants on disk for every canonical file, and the canonicals are
  // untouched by the variants' arrival. The EXACT listing is deliberate: writes
  // are atomic via a `<file>.part` temp that is renamed into place, so a leftover
  // temp would fail here rather than silently littering a live photo directory.
  expect(readdirSync(storedPath(`submissions/${uploadId}`)).sort()).toEqual([
    "0.avif",
    "0.webp",
    "1.avif",
    "1.webp",
    "thumb.avif",
    "thumb.webp",
  ]);
  expect(readFileSync(storedPath(uploadKey))).toEqual(webpBytes);
});

test("an already-optimal upload passes through; each blocking condition re-encodes", async () => {
  // The pass-through rule is five conjuncts, and it is the ONE branch that
  // returns the guest's bytes verbatim — so a regression there is silent. One
  // submission, three fixtures, each isolating a different conjunct:
  //   0 — WebP, in cap, orientation unset, metadata-free, and SMALLER than our
  //       re-encode → stored BYTE-IDENTICAL (normalizing must never enlarge a
  //       photo, which is what an Android AVIF or a small WebP would hit)
  //   1 — the SAME image plus 254 bytes of camera EXIF, identical dimensions
  //       and near-identical size → RE-ENCODED, because metadata must not reach
  //       a public wall. Only the metadata conjunct differs from case 0.
  //   2 — over the dimension cap but SMALLER than its re-encode (~213KB in,
  //       ~411KB out) → RESIZED, so the size conjunct alone can never keep an
  //       oversized image: the cap is not a suggestion.
  const photo = await makeTestPhoto(1500, 1000);
  const optimal = await sharp(photo).webp({ quality: 30 }).toBuffer();
  const withExif = await sharp(photo)
    .webp({ quality: 30 })
    .withExif({ IFD0: { ImageDescription: "venue shot", Make: "Apple" } })
    .toBuffer();
  const overCap = await sharp(await makeTestPhoto(3000, 2000))
    .webp({ quality: 20 })
    .toBuffer();

  // The fixtures must sit on the intended side of each threshold, or the test
  // would pass for the wrong reason (a "pass-through" that was never a choice).
  expect((await sharp(withExif).metadata()).exif?.length ?? 0).toBeGreaterThan(0);
  expect((await sharp(optimal).metadata()).width).toBe(1500);
  expect((await sharp(overCap).metadata()).width).toBe(3000);

  const res = await postSubmission(PASSTHROUGH_INVITE, [
    { bytes: optimal, filename: "optimal.webp", type: "image/webp" },
    { bytes: withExif, filename: "geotag.webp", type: "image/webp" },
    { bytes: overCap, filename: "huge.webp", type: "image/webp" },
  ]);
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string; photos: { photoUrl: string }[] };
  passThroughId = body.id;
  // Pass-through keeps the upload's own type, so the key shape is unchanged.
  expect(body.photos.map((p) => p.photoUrl)).toEqual([
    `/api/photos/submissions/${passThroughId}/0.webp`,
    `/api/photos/submissions/${passThroughId}/1.webp`,
    `/api/photos/submissions/${passThroughId}/2.webp`,
  ]);

  // 0: byte-identical.
  expect(readFileSync(storedPath(`submissions/${passThroughId}/0.webp`)).equals(optimal)).toBe(
    true,
  );

  // 1: same dimensions, different bytes, no EXIF.
  const storedWithExif = readFileSync(storedPath(`submissions/${passThroughId}/1.webp`));
  expect(storedWithExif.equals(withExif)).toBe(false);
  const storedWithExifMeta = await sharp(storedWithExif).metadata();
  expect(storedWithExifMeta.exif).toBeUndefined();
  expect(storedWithExifMeta.width).toBe(1500);

  // 2: capped, even though passing it through would have been smaller.
  const storedOverCap = await sharp(
    readFileSync(storedPath(`submissions/${passThroughId}/2.webp`)),
  ).metadata();
  expect(storedOverCap.width).toBe(2048);
  expect(storedOverCap.height).toBe(1365);
});

test("an AVIF upload becomes a WebP canonical, never an AVIF one", async () => {
  // The canonical is what every browser gets when it does not ask for AVIF, so
  // it must be decodable unconditionally: iOS <= 15.8 has no AVIF decoder and
  // every iOS browser is WebKit, including the WhatsApp in-app browser most
  // guests arrive in. An AVIF pass-through would serve it to them verbatim (and
  // the viewer keys its progress off img.onload, so they would get a stuck
  // spinner, not even a broken-image icon). Hence the pass-through rule is
  // WebP-only, and an AVIF upload is re-encoded like any other format.
  const avif = await sharp(await makeTestPhoto(1500, 1000))
    .avif({ quality: 40 })
    .toBuffer();
  expect((await sharp(avif).metadata()).format).toBe("heif"); // really an AVIF

  const res = await postSubmission(AVIF_UPLOAD_INVITE, [
    { bytes: avif, filename: "modern.avif", type: "image/avif" },
  ]);
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string; photos: { photoUrl: string }[] };
  avifUploadId = body.id;
  expect(body.photos[0]?.photoUrl).toBe(`/api/photos/submissions/${avifUploadId}/0.webp`);

  const stored = readFileSync(storedPath(`submissions/${avifUploadId}/0.webp`));
  expect((await sharp(stored).metadata()).format).toBe("webp");
  expect(stored.equals(avif)).toBe(false);

  // The guest's format choice is not lost, just not canonical: the variant still
  // lands, so AVIF-capable browsers get the efficient format from the same URL.
  const negotiated = await waitForAvif(`/api/photos/submissions/${avifUploadId}/0.webp`);
  expect(negotiated.headers.get("content-type")).toBe("image/avif");
});

test("undecodable bytes are rejected before anything is claimed or written", async () => {
  const res = await postSubmission(REJECT_INVITE, [
    { bytes: crypto.randomBytes(64 * 1024), filename: "photo.jpg", type: "image/jpeg" },
  ]);
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: string }).error).toBe("invalid_photo_type");

  // Nothing claimed (the guest may retry) and nothing written.
  const db = createClient({ url: `file:${dbPath}` });
  const rows = await db.execute({
    sql: "select count(*) as n from submissions where invite_id = ?",
    args: [REJECT_INVITE],
  });
  await db.close();
  expect(Number(rows.rows[0]?.n)).toBe(0);

  const dirs = readdirSync(join(photosDir, "submissions")).sort();
  expect(dirs).toEqual([avifUploadId, exifId, passThroughId, uploadId].sort());
});
