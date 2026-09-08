import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer, type AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { createClient } from "@libsql/client";
import { test, expect } from "@playwright/test";
import { dismissWelcomeGate } from "./helpers";

// story-rail-mocks D4 (adversarial-review findings) + story-rail-attribution
// D1/D6: the SSR mock gate's BOTH branches, asserted on the SERVED HTML (no
// client JS involved):
//   empty wall  → three mock tiles for everyone (fail-open gate), the rail's
//                 ONLY mock/real story-viewers (demos + teasers retired);
//   real photo  → zero mock tiles for everyone (public and invitee alike) and
//                 no rail story-viewers — real tiles are client-injected by
//                 guest-rail.ts (D6).
// In BOTH branches the served HTML also holds exactly ONE extra
// <story-viewer>: the always-present, hidden example-story intro
// (retire-wishes-story-intro D3), which lives OUTSIDE [data-story-rail], carries
// no data-mock, and is never gated or evicted.
//
// The suite's shared dev server reads the shared scratch DB that every other
// test assumes is empty, so this file runs its OWN `astro dev` on a private
// port against a throwaway DB built from the COMMITTED migrations (a clean
// checkout has no .playwright/db.sqlite to clone — reviews flagged that).
//
// Chromium-only: both playwright projects would otherwise spawn this server
// concurrently over the same fixed resources.

const MIGRATIONS_DIR = resolve(process.cwd(), "..", "..", "packages", "db", "src", "migrations");
// INVITE_ID_RE in index.astro is ^[A-Za-z0-9_-]{12}$ — keep exactly 12 chars.
const SEEDED_INVITE = "SsrGateTst01";

test.beforeEach(({}, testInfo) => {
  // Runs once, not once per project: the fixed resources (spawned server,
  // temp DB) must not collide across the chromium/mobile-chrome projects.
  test.skip(testInfo.project.name !== "chromium", "chromium project only");
});
test.describe.configure({ mode: "serial" });

const workDir = mkdtempSync(join(tmpdir(), "ww-ssr-gate-"));
const dbPath = join(workDir, "gate.sqlite");
let baseUrl = "";
let server: ReturnType<typeof spawn> | undefined;
let serverExit: Promise<void> | undefined;
// Set by the child's exit EVENT, not inferred from exitCode/killed: a
// signal-killed child reports exitCode null forever, and `killed` is only set
// by ChildProcess.kill() — neither reflects our process.kill(-pid) teardown.
let serverExited = false;

// Ctrl+C / SIGTERM / SIGINT during a run skips afterAll entirely — a
// detached process group then survives the Playwright process. Kill the
// group SYNCHRONOUSLY on fatal signals so an interrupted run cannot leak
// the server (this is how the earlier :4321 leak happened).
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

async function seedOnePhoto(): Promise<void> {
  const db = createClient({ url: `file:${dbPath}` });
  const now = Date.now();
  await db.execute({
    sql: "insert into invites (id, display_name, created_at, max_party_size) values (?, 'Gate Test', ?, 2)",
    args: [SEEDED_INVITE, now],
  });
  await db.execute({
    sql: "insert into submissions (id, invite_id, created_at) values ('gate-sub-001', ?, ?)",
    args: [SEEDED_INVITE, now],
  });
  await db.execute({
    sql: "insert into submission_photos (id, submission_id, key, position, created_at) values ('gate-ph-001', 'gate-sub-001', 'submissions/gate-sub-001/0.jpg', 0, ?)",
    args: [now],
  });
  await db.close();
  // The photo route reads the file from PHOTO_STORAGE_DIR (env default:
  // ./var/photos relative to the dev server's cwd). Write a real JPEG there
  // so the anonymous file fetch below exercises the 200 path, not 404.
  const photoDir = join(workDir, "photos", "submissions", "gate-sub-001");
  mkdirSync(photoDir, { recursive: true });
  writeFileSync(join(photoDir, "0.jpg"), MINIMAL_JPEG);
}

// Minimal valid JPEG (1×1, from the JFIF spec's smallest example).
const MINIMAL_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==",
  "base64",
);

test.beforeAll(async () => {
  test.setTimeout(150_000); // covers this hook itself — astro dev cold start
  await applyMigrations();

  const port = await freePort();
  // "localhost" (not 127.0.0.1): astro dev binds ::1-only in some environments,
  // and this URL is used for BOTH the readiness fetch and browser navigation.
  baseUrl = `http://localhost:${port}`;
  // Unix-likes: detached process group so teardown kills pnpm → node → astro.
  server = spawn("pnpm", ["dev:bare", "--port", String(port), "--ignore-lock"], {
    env: {
      ...process.env,
      DATABASE_URL: `file:${dbPath}`,
      PHOTO_STORAGE_DIR: join(workDir, "photos"),
    },
    stdio: ["ignore", "ignore", "ignore"],
    detached: true,
  });
  serverExit = new Promise<void>((res) =>
    server?.once("exit", () => {
      serverExited = true;
      res();
    }),
  );

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
  throw new Error("gate-test dev server did not come up");
});

test.afterAll(async () => {
  // Teardown must be LEAK-PROOF: a surviving dev server holds the port and
  // its throwaway DB forever — an earlier version's SIGTERM-only teardown
  // leaked servers that later masqueraded as the real dev server on :4321.
  // Escalate: SIGTERM the group → wait 5s → SIGKILL the group → wait 5s →
  // report loudly if the process somehow survives (it should not).
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      // already gone
    }
    if (serverExit) {
      await Promise.race([serverExit, new Promise((r) => setTimeout(r, 5_000))]);
    }
    if (!serverExited) {
      try {
        process.kill(-server.pid, "SIGKILL");
      } catch {
        // already gone
      }
      if (serverExit) {
        await Promise.race([serverExit, new Promise((r) => setTimeout(r, 5_000))]);
      }
    }
    if (!serverExited && serverExit) {
      // One last chance for the exit event to land before crying leak: the
      // races above can expire a beat early, and a false alarm on every
      // SUCCESSFUL teardown trains people to ignore the real one.
      await Promise.race([serverExit, new Promise((r) => setTimeout(r, 3_000))]);
    }
    if (!serverExited) {
      // Last resort, diagnostics only — do not throw (afterAll failures
      // mask test results); the message makes the leak visible in the log.
      console.error(`[mock-gate-ssr] LEAK: server pid ${server.pid} survived SIGTERM+SIGKILL`);
    }
  }
  // The group is dead — safe to remove its DB files (-wal/-shm sidecars
  // cannot outlive the connection now).
  rmSync(workDir, { recursive: true, force: true });
});

const mockOccurrences = (html: string): number => html.split("data-mock").length - 1;

test("empty wall SSR-renders three mocks; one real photo removes them for everyone", async () => {
  // Empty wall (fresh migrated DB): fail-open gate renders the mocks.
  const emptyHtml = await (await fetch(baseUrl)).text();
  expect(mockOccurrences(emptyHtml)).toBe(3);
  expect(emptyHtml).toContain("data-story-rail");

  // story-rail-attribution D1: those three mocks are the rail's ONLY story
  // tiles — the ten demo StoryViewers and the static teaser <img>s are
  // retired. The served HTML holds four <story-viewer> elements: the three
  // rail mocks plus the always-present hidden example intro
  // (retire-wishes-story-intro D3).
  expect(emptyHtml.split("<story-viewer").length - 1).toBe(4);
  // Exactly one of them is the intro, and it sits outside the rail.
  expect(emptyHtml.split("data-story-intro").length - 1).toBe(1);

  // Seed the first real guest photo.
  await seedOnePhoto();

  // Anonymous GET /api/submissions (public-wall D1): the wall is served —
  // 200, mine null, the seeded story on the wall, no anonymous-only errors.
  const submissionsRes = await fetch(`${baseUrl}/api/submissions`);
  expect(submissionsRes.status).toBe(200);
  expect(submissionsRes.headers.get("cache-control")).toBe("no-store");
  const submissionsBody = (await submissionsRes.json()) as {
    mine: unknown;
    wall: {
      stories: { photos: unknown[]; firstName: string | null; createdAt: number }[];
    };
  };
  expect(submissionsBody.mine).toBeNull();
  expect(submissionsBody.wall.stories).toHaveLength(1);
  const seededStory = submissionsBody.wall.stories[0]!;
  expect(seededStory.photos.length).toBeGreaterThan(0);
  // guest-photos "Wall payload carries poster first name and timestamp",
  // against a REAL database (the routed-fixture specs can't prove the join):
  // the entry carries the first whitespace token of the seeded invite's
  // display_name ("Gate Test" → "Gate") and the submission's epoch-ms time.
  expect(seededStory.firstName).toBe("Gate");
  expect(typeof seededStory.createdAt).toBe("number");
  expect(seededStory.createdAt).toBeGreaterThan(0);

  // Public: no cookie at all — the gate is cookie-blind by design.
  const publicHtml = await (await fetch(baseUrl)).text();
  expect(mockOccurrences(publicHtml)).toBe(0);
  expect(publicHtml).toContain("data-story-rail"); // the rail itself still renders
  // story-rail-attribution D6: with a real photo the SSR HTML holds NO mock or
  // real story tiles — the mocks are gated off and the real wall tiles are
  // injected client-side after the payload fetch (the rail's reserved
  // min-height covers the gap). The ONLY <story-viewer> left is the hidden
  // example intro (retire-wishes-story-intro D3), outside the rail.
  expect(publicHtml.split("<story-viewer").length - 1).toBe(1);
  expect(publicHtml.split("data-story-intro").length - 1).toBe(1);

  // Invitee (the seeded submitter): same SSR decision.
  const inviteeHtml = await (
    await fetch(baseUrl, { headers: { Cookie: `ww_invite_id=${SEEDED_INVITE}` } })
  ).text();
  expect(mockOccurrences(inviteeHtml)).toBe(0);
  expect(inviteeHtml.split("<story-viewer").length - 1).toBe(1); // the intro only
});

test("anonymous photo file fetch succeeds with public cache headers", async () => {
  // public-wall D3: no cookie, valid key, file on disk (seeded above) — the
  // photo route serves it without any invite resolution, and the success
  // response is shared-cacheable.
  const res = await fetch(`${baseUrl}/api/photos/submissions/gate-sub-001/0.jpg`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/jpeg");
  expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  const bytes = Buffer.from(await res.arrayBuffer());
  // Magic bytes survive the round-trip (a real file, not an error page).
  expect(bytes[0]).toBe(0xff);
  expect(bytes[1]).toBe(0xd8);
  expect(bytes.length).toBe(MINIMAL_JPEG.length);

  // Missing-file 404s stay no-store (never negatively cached).
  const missing = await fetch(`${baseUrl}/api/photos/submissions/gate-sub-001/1.jpg`);
  expect(missing.status).toBe(404);
  expect(missing.headers.get("cache-control")).toBe("no-store");
});

// Regression (story-rail-attribution D6): SSR renders StoryViewer ONLY on an
// empty wall, and Astro ships a component's <script> only when that component
// renders — so once a real photo existed the page no longer defined the
// <story-viewer> custom element at all. guest-rail.ts's injected tiles were
// then inert markup: named and thumbnailed, but with no openStory/closeStory,
// no modal portal and no listeners. Worse, the un-portaled closed modal's
// pointer-events-auto nav buttons resolved `position: fixed` against the tile
// wrapper's fade-up transform and landed on the tile, swallowing its click.
// The definition now lives in scripts/story-viewer-element.ts, which
// guest-rail.ts imports directly.
//
// This is the only spec with a REAL seeded photo behind a live server, so it
// is the only place the non-empty-wall client path can be asserted end to end
// — every other rail spec routes a payload over the empty scratch DB, where
// the mocks (and with them the element definition) always rendered.
test("non-empty wall: injected guest tiles are defined, named and openable", async ({ page }) => {
  await page.goto(baseUrl);
  await dismissWelcomeGate(page);
  await page.locator("[data-story-rail]").scrollIntoViewIfNeeded();

  // The seeded submission (invite "Gate Test") renders as one named tile.
  const tile = page.locator("[data-story-rail] [data-guest]");
  await expect(tile).toHaveCount(1);
  await expect(tile.locator("span.truncate")).toHaveText("Gate");
  await expect(tile.locator("[data-open]")).toHaveAttribute("aria-label", "View Gate's stories");

  // The element is genuinely upgraded: defined, initialized, modal portaled
  // out of the tile (an un-portaled modal is what ate the click).
  expect(await page.evaluate(() => !!customElements.get("story-viewer"))).toBe(true);
  await expect(tile).toHaveAttribute("data-initialized", "true");
  expect(
    await page.evaluate(() => document.querySelectorAll("story-viewer > [data-modal]").length),
  ).toBe(0);

  // And it OPENS — the behavior that was silently dead. The seeded photo is a
  // real JPEG on disk, so the slide loads and the author header fills in with
  // the name plus a relative timestamp and no avatar circle.
  await tile.locator("[data-open]").click();
  const modal = page.locator('body > [data-modal][aria-hidden="false"]');
  await expect(modal).toHaveCount(1);
  await expect(modal.locator("[data-username]")).toHaveText("Gate");
  await expect(modal.locator("[data-timestamp]")).toHaveText(/(Just now|ago)$/);
  await expect(modal.locator("[data-avatar]")).toHaveCount(0);
});
