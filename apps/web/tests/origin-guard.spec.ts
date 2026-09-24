import { expect, test } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { WEB_ROOT } from "./support/database";
import { createTestServer } from "./support/server";

/**
 * Architecture guard for the origin check.
 *
 * `security.checkOrigin` is DISABLED in astro.config.mjs, because Astro compares
 * `Origin` against `new URL(request.url).origin` and `request.url`'s scheme comes
 * from `req.socket.encrypted` — false behind the documented Caddy deployment, so
 * every form-like and bodiless POST 403s in production. It is replaced by
 * `isSameOriginRequest()` in src/lib/same-origin.ts, which every cookie-authenticated
 * mutating endpoint must call BEFORE any side effect.
 *
 * That invariant is otherwise enforced by convention alone, so these tests make it
 * structural: a new endpoint without the guard fails here, a guard placed after a
 * side effect fails here, and re-enabling `checkOrigin` fails here too — because it
 * would both break production and let the behavioural assertions pass for the wrong
 * reason.
 *
 * KNOWN BOUNDARIES, stated so nobody trusts this file further than it reaches:
 *   - It scans every route file under `src/pages` (not just `src/pages/api`), with
 *     the extensions Astro treats as routes. It does NOT see Astro Actions, which
 *     live in `src/actions.ts` and are served at `/_actions/*`; this project
 *     defines none, and adopting them requires extending the inventory below first.
 *   - It covers NON-SAFE methods only. All state-changing endpoints in this
 *     project use POST/PUT/PATCH/DELETE methods.
 */

const PAGES_DIR = join(WEB_ROOT, "src/pages");
// Astro's ROUTE_FILE_EXTENSIONS that can export endpoint handlers. `.astro` pages
// are components and cannot export method handlers; markdown routes cannot either.
const ROUTE_EXTENSIONS = [".ts", ".js", ".mjs"];
// `ALL` is included because astro/dist/runtime/server/endpoint.js resolves
// `mod[method] ?? mod.ALL`, so an exported ALL is a live POST/PUT/PATCH/DELETE
// handler that a POST-only scan would miss.
const MUTATING_METHODS = ["POST", "PUT", "PATCH", "DELETE", "ALL"] as const;

// Endpoints whose authority is a secret in the PATH rather than an ambient
// cookie: a cross-site page cannot make the browser supply it, so CSRF cannot
// reach them. Adding an entry here requires a written justification.
const PATH_TOKEN_EXEMPT = new Set(["api/admin/[token]/invites.ts"]);

function collectRouteFiles(dir: string = PAGES_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    // `withFileTypes` reports a symlink as neither file nor directory, so resolve
    // it explicitly rather than silently skipping a symlinked route tree.
    if (entry.isSymbolicLink()) return collectRouteFiles(full);
    if (entry.isDirectory()) return collectRouteFiles(full);
    return ROUTE_EXTENSIONS.some((ext) => entry.name.endsWith(ext)) ? [full] : [];
  });
}

function routePath(file: string): string {
  return relative(PAGES_DIR, file).replaceAll("\\", "/");
}

// Matches `export const POST`, `export function POST`, and
// `export async function POST` — all three are valid Astro handlers.
function exportedMutatingMethods(source: string): string[] {
  return MUTATING_METHODS.filter((method) =>
    new RegExp(`export\\s+(?:const|let|var|(?:async\\s+)?function)\\s+${method}\\b`).test(source),
  );
}

// Both are exactly 12 characters: INVITE_ID_RE rejects anything else, and identity
// resolution runs BEFORE the origin guard (endpoint-invisibility rule), so a
// malformed id would 404 and the guard would never be exercised.
const INVITE = "OriginGuard1"; // standalone individual
const GROUP = "OriginGuardG"; // group with a 2-slot quota, for the claim side-effect check
const EVIL_ORIGIN = "https://evil.example";
// The public origin a TLS-terminating proxy would present, and the forwarded
// headers Caddy/Traefik/cloudflared set alongside it.
const PUBLIC_ORIGIN = "https://wedding.example.com";

let server: Awaited<ReturnType<typeof createTestServer>>;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  test.setTimeout(150_000);
  server = await createTestServer("origin-guard");
  const db = await server.connect();
  try {
    await db.execute({
      sql: "INSERT INTO invites (id, display_name, created_at) VALUES (?, ?, 1)",
      args: [INVITE, "Guard Guest"],
    });
    await db.execute({
      sql: "INSERT INTO invites (id, display_name, created_at, type, max_members) VALUES (?, ?, 1, 'group', 2)",
      args: [GROUP, "Guard Group"],
    });
  } finally {
    db.close();
  }
});

test.afterAll(async () => {
  await server?.dispose();
});

// Observable state for the "no state changes" half of the spec scenario. Without
// this, moving a guard BELOW its side effect passes every assertion here while a
// cross-origin POST inflates metrics, writes an RSVP, and mints a member row
// against a scarce quota — the refactor shape people actually produce when they
// reorder "authenticate, authorise, act" into "authenticate, act, authorise".
async function readState() {
  const db = await server.connect();
  try {
    const opened = await db.execute({
      sql: "SELECT opened_count FROM invites WHERE id = ?",
      args: [INVITE],
    });
    const rsvps = await db.execute({
      sql: "SELECT COUNT(*) AS n FROM rsvps WHERE invite_id = ?",
      args: [INVITE],
    });
    const invites = await db.execute("SELECT COUNT(*) AS n FROM invites");
    const members = await db.execute({
      sql: "SELECT COUNT(*) AS n FROM invites WHERE parent_id = ?",
      args: [GROUP],
    });
    return {
      openedCount: Number(opened.rows[0]?.opened_count ?? 0),
      rsvpCount: Number(rsvps.rows[0]?.n ?? 0),
      inviteCount: Number(invites.rows[0]?.n ?? 0),
      memberCount: Number(members.rows[0]?.n ?? 0),
    };
  } finally {
    db.close();
  }
}

test("framework checkOrigin stays disabled, so the guard is provably ours", () => {
  const config = readFileSync(join(WEB_ROOT, "astro.config.mjs"), "utf8");
  // Re-enabling it would 403 every legitimate POST in production AND let the
  // behavioural assertions below pass via the framework instead of the guard.
  expect(config).toMatch(/checkOrigin:\s*false/);
});

test("every cookie-authenticated mutating endpoint calls the origin guard", () => {
  const inspected: string[] = [];
  const offenders: string[] = [];

  for (const file of collectRouteFiles()) {
    const source = readFileSync(file, "utf8");
    const methods = exportedMutatingMethods(source);
    if (methods.length === 0) continue;

    const route = routePath(file);
    inspected.push(`${route} [${methods.join(",")}]`);
    if (PATH_TOKEN_EXEMPT.has(route)) continue;
    if (!source.includes("isSameOriginRequest(")) {
      offenders.push(`${route} exports ${methods.join("/")} but never calls isSameOriginRequest`);
    }
  }

  // Guard the guard: the scan must actually have found the endpoints it claims to
  // cover, otherwise a refactor that moves or renames them would silently vacuate
  // this test. Extending the app means extending this list.
  expect(inspected.sort()).toEqual([
    "api/admin/[token]/invites.ts [POST]",
    "api/guest-photos/index.ts [POST]",
    "api/invite/claim.ts [POST]",
    "api/invite/opened.ts [POST]",
    "api/rsvp/index.ts [POST]",
  ]);
  expect(offenders).toEqual([]);
});

// `claim` uses the GROUP cookie so an unguarded call would mint a member row; the
// rest use the individual. Each entry also records the status a legitimately
// proxied same-origin request should produce, so the proxy test asserts a real
// outcome rather than merely "not 403".
const ENDPOINTS = [
  {
    path: "/api/rsvp",
    cookie: INVITE,
    proxiedStatus: 200,
    init: {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ attending: true }),
    },
  },
  {
    path: "/api/invite/claim",
    cookie: GROUP,
    // The group has an open slot, so a request that reached the handler would mint
    // a member row and answer 201. Anything other than 403 here is a failure.
    proxiedStatus: 201,
    init: {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Guard Claimer" }),
    },
  },
  { path: "/api/invite/opened", cookie: INVITE, proxiedStatus: 204, init: {} },
  {
    // text/plain is the interesting one: it is CORS-simple, so it needs no
    // preflight and could otherwise smuggle a JSON body past the browser's own
    // protection. The guard must run before any multipart parsing.
    path: "/api/guest-photos",
    cookie: INVITE,
    proxiedStatus: 400,
    init: { headers: { "content-type": "text/plain" }, body: "not-a-photo" },
  },
];

test("a cross-origin POST is refused, and changes no state, on every endpoint", async () => {
  const before = await readState();

  for (const { path, cookie, init } of ENDPOINTS) {
    const response = await fetch(`${server.baseUrl}${path}`, {
      method: "POST",
      ...init,
      headers: {
        cookie: `ww_invite_id=${cookie}`,
        origin: EVIL_ORIGIN,
        ...init.headers,
      },
    });
    expect(response.status, `${path} must refuse a cross-origin POST`).toBe(403);
    expect(await response.json(), `${path} 403 body`).toEqual({ error: "cross_origin_post" });
  }

  // The guard must run BEFORE any side effect, not merely exist somewhere in the
  // handler. `claim` is the load-bearing case: it mints a row against a quota that
  // may be 2.
  expect(await readState()).toEqual(before);
});

test("an anonymous cross-origin POST still gets the uniform bare 404", async () => {
  // Identity resolution runs BEFORE the origin guard, so endpoint existence stays
  // invisible: an unauthenticated caller must not be able to distinguish "this
  // endpoint exists but your origin is wrong" from "no such endpoint".
  for (const { path } of ENDPOINTS) {
    const response = await fetch(`${server.baseUrl}${path}`, {
      method: "POST",
      headers: { origin: EVIL_ORIGIN, "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status, `${path} anonymous cross-origin`).toBe(404);
    expect(await response.text(), `${path} anonymous 404 body must be empty`).toBe("");
  }
});

test("a same-origin POST is not refused by the guard", async () => {
  // /api/invite/opened is the cleanest control: bodiless, and it answers 204 for a
  // valid identity, so any 403 here is unambiguously the guard.
  const response = await fetch(`${server.baseUrl}/api/invite/opened`, {
    method: "POST",
    headers: { cookie: `ww_invite_id=${INVITE}`, origin: server.baseUrl },
  });
  expect(response.status).toBe(204);
});

test("a TLS-terminating proxy does not make a legitimate POST look cross-origin", async () => {
  // This is the production regression the guard exists to prevent: request.url is
  // built from req.socket.encrypted, so behind Caddy it is http:// while the
  // browser's Origin is https://. The harness server is itself plain HTTP, so this
  // reproduces the production shape faithfully. Each endpoint is asserted against
  // its real expected outcome, not just "not 403", so a broken proxy path that
  // happens to 500 cannot pass.
  for (const { path, cookie, proxiedStatus, init } of ENDPOINTS) {
    const response = await fetch(`${server.baseUrl}${path}`, {
      method: "POST",
      ...init,
      headers: {
        cookie: `ww_invite_id=${cookie}`,
        origin: PUBLIC_ORIGIN,
        "x-forwarded-proto": "https",
        "x-forwarded-host": "wedding.example.com",
        ...init.headers,
      },
    });
    expect(response.status, `${path} behind a TLS-terminating proxy`).toBe(proxiedStatus);
  }
});
