import { expect, test } from "@playwright/test";
import { createTestServer } from "./support/server";
import { TEST_ADMIN_TOKEN } from "./support/database";

let server: Awaited<ReturnType<typeof createTestServer>>;
const INVITE = "RsvpFresh001";
const OTHER = "RsvpOther001";
const headers = (id = INVITE) => ({
  cookie: `ww_invite_id=${id}`,
  origin: server.baseUrl,
  "content-type": "application/json",
});

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  test.setTimeout(150_000);
  server = await createTestServer("rsvp-api");
  const db = await server.connect();
  try {
    await db.execute({
      sql: "INSERT INTO invites (id, display_name, created_at) VALUES (?, ?, 1), (?, ?, 2)",
      args: [INVITE, "Guest One", OTHER, "Guest Two"],
    });
  } finally {
    db.close();
  }
});
test.afterAll(async () => {
  await server?.dispose();
});

async function count() {
  const response = await fetch(`${server.baseUrl}/api/rsvp/count`);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return ((await response.json()) as { count: number }).count;
}

test("fresh baseline has current RSVP fields and initial tracking defaults", async () => {
  const db = await server.connect();
  try {
    expect((await db.execute("PRAGMA table_info(rsvps)")).rows.map((row) => row.name)).toEqual([
      "invite_id",
      "attending",
      "responded_at",
      "updated_at",
    ]);
    expect(
      (await db.execute("PRAGMA table_info(invites)")).rows.map((row) => row.name),
    ).not.toContain("max_party_size");
    const tracking = await db.execute({
      sql: "SELECT seen_at, seen_count, opened_at, opened_count FROM invites WHERE id=?",
      args: [INVITE],
    });
    expect(tracking.rows).toEqual([
      { seen_at: null, seen_count: 0, opened_at: null, opened_count: 0 },
    ]);
  } finally {
    db.close();
  }
  expect(await count()).toBe(0);
});

test("attendance-only upserts preserve first response and count invitations", async () => {
  const initial = await fetch(`${server.baseUrl}/api/rsvp`, { headers: headers() });
  expect(await initial.json()).toEqual({ attending: null });
  const stale = await fetch(`${server.baseUrl}/api/rsvp`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ attending: true, partySize: 9 }),
  });
  expect(stale.status).toBe(400);
  const post = (attending: boolean) =>
    fetch(`${server.baseUrl}/api/rsvp`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ attending }),
    });
  expect((await post(true)).status).toBe(200);
  expect(await count()).toBe(1);
  const db = await server.connect();
  try {
    const first = (
      await db.execute({ sql: "SELECT responded_at FROM rsvps WHERE invite_id=?", args: [INVITE] })
    ).rows[0]?.responded_at;
    expect((await post(true)).status).toBe(200);
    expect(await count()).toBe(1);
    expect((await post(false)).status).toBe(200);
    expect(await count()).toBe(0);
    const rows = await db.execute({
      sql: "SELECT attending, responded_at, updated_at FROM rsvps WHERE invite_id=?",
      args: [INVITE],
    });
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.responded_at).toBe(first);
    expect(Number(rows.rows[0]?.updated_at)).toBeGreaterThanOrEqual(Number(first));
    expect(rows.rows[0]?.attending).toBe(0);
  } finally {
    db.close();
  }
});

test("shared identity resolution preserves invisible failures and link rebinding", async () => {
  for (const cookie of ["", "ww_invite_id=bad", "ww_invite_id=Unknown00001"]) {
    const response = await fetch(`${server.baseUrl}/api/rsvp`, {
      method: "POST",
      headers: { cookie, origin: server.baseUrl, "content-type": "application/json" },
      body: "invalid",
    });
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  }
  const link = await fetch(`${server.baseUrl}/${OTHER}`, {
    redirect: "manual",
    headers: headers(),
  });
  expect(link.status).toBe(302);
  expect(link.headers.get("set-cookie")).toContain(OTHER);
  expect(link.headers.get("cache-control")).toBe("no-store");
  const me = await fetch(`${server.baseUrl}/api/invite/me`, { headers: headers(OTHER) });
  expect(await me.json()).toEqual({ displayName: "Guest Two" });
  expect(
    (
      await fetch(`${server.baseUrl}/api/invite/opened`, {
        method: "POST",
        headers: headers(OTHER),
      })
    ).status,
  ).toBe(204);
  const admin = await fetch(`${server.baseUrl}/api/admin/${TEST_ADMIN_TOKEN}/invites`);
  const list = (await admin.json()) as {
    invites: { id: string; seenCount: number; openedCount: number }[];
  };
  expect(list.invites.find((row) => row.id === OTHER)).toMatchObject({
    seenCount: 1,
    openedCount: 1,
  });
  const home = await fetch(server.baseUrl, { headers: headers(OTHER) });
  expect(home.headers.get("cache-control")).toBe("no-store");
  const html = await home.text();
  expect(html).toContain("Guest Two");
  expect(html).not.toContain("<story-viewer");
  expect(html).toContain("magnetic-image-trail");
});
