import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { createTestServer } from "./support/server";
import { TEST_ADMIN_TOKEN } from "./support/database";
import { pinFullTier, waitForLoaderDismissed } from "./helpers";

let server: Awaited<ReturnType<typeof createTestServer>>;
let imageBytes: Buffer;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  test.setTimeout(180_000);
  server = await createTestServer("group-invitations");
  imageBytes = await sharp({
    create: { width: 20, height: 20, channels: 3, background: { r: 200, g: 100, b: 50 } },
  })
    .jpeg()
    .toBuffer();
});

test.afterAll(async () => {
  await server?.dispose();
});

function photoFormData(bytes: Buffer = imageBytes) {
  const body = new FormData();
  body.append("photo", new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), "photo.jpg");
  return body;
}

async function createAdminInvite(body: {
  displayName: string;
  type?: "individual" | "group";
  maxMembers?: number;
}) {
  const res = await fetch(`${server.baseUrl}/api/admin/${TEST_ADMIN_TOKEN}/invites`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; sharePath: string; type: string; maxMembers?: number };
}

test.describe("3.4 slot claim endpoint & sticky cookie", () => {
  test("first claim mints a member, rebinds cookie with identical attributes, and creates correct DB row", async () => {
    const group = await createAdminInvite({
      displayName: "The Claimers",
      type: "group",
      maxMembers: 3,
    });

    // Link redirect Set-Cookie reference for attribute parity comparison
    const linkRes = await fetch(`${server.baseUrl}${group.sharePath}`, { redirect: "manual" });
    expect(linkRes.status).toBe(302);
    const linkSetCookie = linkRes.headers.get("set-cookie") ?? "";
    expect(linkSetCookie).toContain("Path=/");
    expect(linkSetCookie).toContain("SameSite=Lax");
    expect(linkSetCookie).toContain("Max-Age=");
    expect(linkSetCookie).not.toContain("HttpOnly");

    // First claim
    const claimRes = await fetch(`${server.baseUrl}/api/invite/claim`, {
      method: "POST",
      headers: {
        origin: server.baseUrl,
        cookie: `ww_invite_id=${group.id}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ displayName: "Claimant One" }),
    });

    expect(claimRes.status).toBe(201);
    expect(claimRes.headers.get("cache-control")).toBe("no-store");
    const claimBody = await claimRes.json();
    expect(claimBody).toEqual({ displayName: "Claimant One", kind: "member" });

    // Claim Set-Cookie parity: same path, sameSite, maxAge, absence of HttpOnly
    const claimSetCookie = claimRes.headers.get("set-cookie") ?? "";
    const memberIdMatch = claimSetCookie.match(/ww_invite_id=([A-Za-z0-9_-]{12})/);
    expect(memberIdMatch).not.toBeNull();
    const memberId = memberIdMatch![1];
    expect(memberId).not.toBe(group.id);

    expect(claimSetCookie).toContain("Path=/");
    expect(claimSetCookie).toContain("SameSite=Lax");
    expect(claimSetCookie).toContain("Max-Age=");
    expect(claimSetCookie).not.toContain("HttpOnly");

    // DB row shape verification
    const db = await server.connect();
    try {
      const rows = (
        await db.execute({
          sql: "SELECT id, display_name, parent_id, type, max_members, seen_count, opened_count FROM invites WHERE id = ?",
          args: [memberId],
        })
      ).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: memberId,
        display_name: "Claimant One",
        parent_id: group.id,
        type: "individual",
        max_members: null,
        seen_count: 0,
        opened_count: 0,
      });
    } finally {
      db.close();
    }
  });

  test("re-claim by an already claimed member is idempotent", async () => {
    const group = await createAdminInvite({
      displayName: "Idempotent Group",
      type: "group",
      maxMembers: 3,
    });

    const first = await fetch(`${server.baseUrl}/api/invite/claim`, {
      method: "POST",
      headers: {
        origin: server.baseUrl,
        cookie: `ww_invite_id=${group.id}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ displayName: "First Claimant" }),
    });
    expect(first.status).toBe(201);
    const memberCookie = first.headers
      .get("set-cookie")!
      .match(/ww_invite_id=([A-Za-z0-9_-]{12})/)![0];

    // Re-claim with the member cookie returns 200 without parsing body or creating row
    const second = await fetch(`${server.baseUrl}/api/invite/claim`, {
      method: "POST",
      headers: {
        origin: server.baseUrl,
        cookie: memberCookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({ displayName: "Ignored Name" }),
    });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ displayName: "First Claimant", kind: "member" });

    // Verify member count did not increase
    const db = await server.connect();
    try {
      const count = (
        await db.execute({
          sql: "SELECT COUNT(*) AS n FROM invites WHERE parent_id = ?",
          args: [group.id],
        })
      ).rows[0]?.n;
      expect(count).toBe(1);
    } finally {
      db.close();
    }
  });

  test("standalone individual cannot claim (not_a_group)", async () => {
    const individual = await createAdminInvite({ displayName: "Solo Person", type: "individual" });

    const res = await fetch(`${server.baseUrl}/api/invite/claim`, {
      method: "POST",
      headers: {
        origin: server.baseUrl,
        cookie: `ww_invite_id=${individual.id}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ displayName: "Wannabe Member" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not_a_group" });
  });

  test("group_full at the quota boundary", async () => {
    const group = await createAdminInvite({
      displayName: "Two Quota Group",
      type: "group",
      maxMembers: 2,
    });

    const c1 = await fetch(`${server.baseUrl}/api/invite/claim`, {
      method: "POST",
      headers: {
        origin: server.baseUrl,
        cookie: `ww_invite_id=${group.id}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ displayName: "Member One" }),
    });
    expect(c1.status).toBe(201);

    const c2 = await fetch(`${server.baseUrl}/api/invite/claim`, {
      method: "POST",
      headers: {
        origin: server.baseUrl,
        cookie: `ww_invite_id=${group.id}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ displayName: "Member Two" }),
    });
    expect(c2.status).toBe(201);

    // Third claim over quota
    const c3 = await fetch(`${server.baseUrl}/api/invite/claim`, {
      method: "POST",
      headers: {
        origin: server.baseUrl,
        cookie: `ww_invite_id=${group.id}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ displayName: "Member Three" }),
    });
    expect(c3.status).toBe(409);
    expect(await c3.json()).toEqual({ error: "group_full" });
  });

  test("invalid request bodies return 400 with specific errors", async () => {
    const group = await createAdminInvite({
      displayName: "Validation Group",
      type: "group",
      maxMembers: 3,
    });
    const postClaim = (body: string) =>
      fetch(`${server.baseUrl}/api/invite/claim`, {
        method: "POST",
        headers: {
          origin: server.baseUrl,
          cookie: `ww_invite_id=${group.id}`,
          "content-type": "application/json",
        },
        body,
      });

    // Invalid JSON
    const r1 = await postClaim("not-valid-json");
    expect(r1.status).toBe(400);
    expect(await r1.json()).toEqual({ error: "invalid_json" });

    // Missing displayName
    const r2 = await postClaim(JSON.stringify({}));
    expect(r2.status).toBe(400);
    expect(await r2.json()).toEqual({ error: "display_name_required" });

    // Empty / whitespace displayName
    const r3 = await postClaim(JSON.stringify({ displayName: "   " }));
    expect(r3.status).toBe(400);
    expect(await r3.json()).toEqual({ error: "display_name_required" });

    // displayName too long (>120 chars)
    const r4 = await postClaim(JSON.stringify({ displayName: "x".repeat(121) }));
    expect(r4.status).toBe(400);
    expect(await r4.json()).toEqual({ error: "display_name_too_long" });
  });

  test("anonymous, malformed, or unknown cookies return uniform bare 404", async () => {
    for (const cookie of ["", "ww_invite_id=short", "ww_invite_id=Nonexistent01"]) {
      const res = await fetch(`${server.baseUrl}/api/invite/claim`, {
        method: "POST",
        headers: {
          origin: server.baseUrl,
          ...(cookie ? { cookie } : {}),
          "content-type": "application/json",
        },
        body: JSON.stringify({ displayName: "Anonymous" }),
      });
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("");
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  test("member revisit keeps member id with refreshed Max-Age while seen_count increments", async () => {
    const group = await createAdminInvite({
      displayName: "Revisit Group",
      type: "group",
      maxMembers: 3,
    });

    const claimRes = await fetch(`${server.baseUrl}/api/invite/claim`, {
      method: "POST",
      headers: {
        origin: server.baseUrl,
        cookie: `ww_invite_id=${group.id}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ displayName: "Revisiting Member" }),
    });
    expect(claimRes.status).toBe(201);
    const memberId = claimRes.headers
      .get("set-cookie")!
      .match(/ww_invite_id=([A-Za-z0-9_-]{12})/)![1];

    // Revisit the group link with the member cookie
    const visitRes = await fetch(`${server.baseUrl}${group.sharePath}`, {
      redirect: "manual",
      headers: { cookie: `ww_invite_id=${memberId}` },
    });
    expect(visitRes.status).toBe(302);
    const visitSetCookie = visitRes.headers.get("set-cookie") ?? "";
    expect(visitSetCookie).toContain(`ww_invite_id=${memberId}`);
    expect(visitSetCookie).toContain("Max-Age=");

    // Verify seen_count on the group bumped
    const db = await server.connect();
    try {
      const groupRow = (
        await db.execute({
          sql: "SELECT seen_count FROM invites WHERE id = ?",
          args: [group.id],
        })
      ).rows[0];
      // At least 1 seen_count from the visit
      expect(Number(groupRow?.seen_count)).toBeGreaterThanOrEqual(1);
    } finally {
      db.close();
    }
  });

  test("cross-group rebind: cookie = member of group A, visit group B link => rebinds to group B", async () => {
    const groupA = await createAdminInvite({
      displayName: "Group Alpha",
      type: "group",
      maxMembers: 3,
    });
    const groupB = await createAdminInvite({
      displayName: "Group Beta",
      type: "group",
      maxMembers: 3,
    });

    const claimA = await fetch(`${server.baseUrl}/api/invite/claim`, {
      method: "POST",
      headers: {
        origin: server.baseUrl,
        cookie: `ww_invite_id=${groupA.id}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ displayName: "Alpha Member" }),
    });
    expect(claimA.status).toBe(201);
    const memberAId = claimA.headers
      .get("set-cookie")!
      .match(/ww_invite_id=([A-Za-z0-9_-]{12})/)![1];

    // Member of group A visits group B link
    const visitB = await fetch(`${server.baseUrl}${groupB.sharePath}`, {
      redirect: "manual",
      headers: { cookie: `ww_invite_id=${memberAId}` },
    });
    expect(visitB.status).toBe(302);
    expect(visitB.headers.get("set-cookie")).toContain(`ww_invite_id=${groupB.id}`);

    // Group A's member row is unchanged
    const db = await server.connect();
    try {
      const memberRow = (
        await db.execute({
          sql: "SELECT id, parent_id FROM invites WHERE id = ?",
          args: [memberAId],
        })
      ).rows[0];
      expect(memberRow?.parent_id).toBe(groupA.id);
    } finally {
      db.close();
    }
  });

  test("storage failure (SQLITE_BUSY) returns 503, never group_full, with no member row created", async () => {
    const group = await createAdminInvite({
      displayName: "Busy Group",
      type: "group",
      maxMembers: 3,
    });

    const db = await server.connect();
    try {
      // Hold BEGIN EXCLUSIVE on the test client to induce SQLITE_BUSY on the server's insert
      await db.execute("BEGIN EXCLUSIVE");

      const claimPromise = fetch(`${server.baseUrl}/api/invite/claim`, {
        method: "POST",
        headers: {
          origin: server.baseUrl,
          cookie: `ww_invite_id=${group.id}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ displayName: "Busy Claimant" }),
      });

      const res = await claimPromise;
      expect(res.status).toBe(503);
      expect(res.headers.get("cache-control")).toBe("no-store");

      await db.execute("ROLLBACK");

      // Verify no member row was created
      const count = (
        await db.execute({
          sql: "SELECT COUNT(*) AS n FROM invites WHERE parent_id = ?",
          args: [group.id],
        })
      ).rows[0]?.n;
      expect(count).toBe(0);
    } finally {
      try {
        await db.execute("ROLLBACK");
      } catch {
        // already rolled back
      }
      db.close();
    }
  });
});

test.describe("4.3 mutation guards on RSVP & guest-photos", () => {
  test("group-cookie POSTs rejected with 409 claim_required and zero side effects", async () => {
    const group = await createAdminInvite({
      displayName: "Guard Group",
      type: "group",
      maxMembers: 3,
    });
    const headers = {
      origin: server.baseUrl,
      cookie: `ww_invite_id=${group.id}`,
    };

    // 1. POST /api/rsvp rejected with 409 claim_required
    const rsvpRes = await fetch(`${server.baseUrl}/api/rsvp`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ attending: true }),
    });
    expect(rsvpRes.status).toBe(409);
    expect(await rsvpRes.json()).toEqual({ error: "claim_required" });

    // 2. POST /api/guest-photos rejected with 409 claim_required
    const photoRes = await fetch(`${server.baseUrl}/api/guest-photos`, {
      method: "POST",
      headers,
      body: photoFormData(),
    });
    expect(photoRes.status).toBe(409);
    expect(await photoRes.json()).toEqual({ error: "claim_required" });

    // Verify zero side effects in DB
    const db = await server.connect();
    try {
      const rsvpCount = (
        await db.execute({
          sql: "SELECT COUNT(*) AS n FROM rsvps WHERE invite_id = ?",
          args: [group.id],
        })
      ).rows[0]?.n;
      expect(rsvpCount).toBe(0);

      const photoCount = (
        await db.execute({
          sql: "SELECT COUNT(*) AS n FROM guest_photos WHERE invite_id = ?",
          args: [group.id],
        })
      ).rows[0]?.n;
      expect(photoCount).toBe(0);
    } finally {
      db.close();
    }
  });

  test("two members of one group RSVP independently and update public count", async () => {
    const group = await createAdminInvite({
      displayName: "RSVP Independent",
      type: "group",
      maxMembers: 3,
    });

    // Claim member 1 & member 2
    const claim1 = await fetch(`${server.baseUrl}/api/invite/claim`, {
      method: "POST",
      headers: {
        origin: server.baseUrl,
        cookie: `ww_invite_id=${group.id}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ displayName: "Attendee" }),
    });
    const m1Id = claim1.headers.get("set-cookie")!.match(/ww_invite_id=([A-Za-z0-9_-]{12})/)![1];

    const claim2 = await fetch(`${server.baseUrl}/api/invite/claim`, {
      method: "POST",
      headers: {
        origin: server.baseUrl,
        cookie: `ww_invite_id=${group.id}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ displayName: "Decliner" }),
    });
    const m2Id = claim2.headers.get("set-cookie")!.match(/ww_invite_id=([A-Za-z0-9_-]{12})/)![1];

    const prevCountRes = await fetch(`${server.baseUrl}/api/rsvp/count`);
    const initialCount = ((await prevCountRes.json()) as { count: number }).count;

    // Member 1 confirms attending
    const rsvp1 = await fetch(`${server.baseUrl}/api/rsvp`, {
      method: "POST",
      headers: {
        origin: server.baseUrl,
        cookie: `ww_invite_id=${m1Id}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ attending: true }),
    });
    expect(rsvp1.status).toBe(200);

    // Member 2 declines
    const rsvp2 = await fetch(`${server.baseUrl}/api/rsvp`, {
      method: "POST",
      headers: {
        origin: server.baseUrl,
        cookie: `ww_invite_id=${m2Id}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ attending: false }),
    });
    expect(rsvp2.status).toBe(200);

    // Read back each member's RSVP independently
    const read1 = await fetch(`${server.baseUrl}/api/rsvp`, {
      headers: { cookie: `ww_invite_id=${m1Id}` },
    });
    expect(await read1.json()).toEqual({ attending: true });

    const read2 = await fetch(`${server.baseUrl}/api/rsvp`, {
      headers: { cookie: `ww_invite_id=${m2Id}` },
    });
    expect(await read2.json()).toEqual({ attending: false });

    // Public count incremented by 1 (the one attending member)
    const newCountRes = await fetch(`${server.baseUrl}/api/rsvp/count`);
    const newCount = ((await newCountRes.json()) as { count: number }).count;
    expect(newCount).toBe(initialCount + 1);
  });

  test("two members upload one photo each; duplicate upload yields 409 already_posted", async () => {
    const group = await createAdminInvite({
      displayName: "Photo Independent",
      type: "group",
      maxMembers: 3,
    });

    const claim1 = await fetch(`${server.baseUrl}/api/invite/claim`, {
      method: "POST",
      headers: {
        origin: server.baseUrl,
        cookie: `ww_invite_id=${group.id}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ displayName: "Photo Poster 1" }),
    });
    const m1Id = claim1.headers.get("set-cookie")!.match(/ww_invite_id=([A-Za-z0-9_-]{12})/)![1];

    const claim2 = await fetch(`${server.baseUrl}/api/invite/claim`, {
      method: "POST",
      headers: {
        origin: server.baseUrl,
        cookie: `ww_invite_id=${group.id}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ displayName: "Photo Poster 2" }),
    });
    const m2Id = claim2.headers.get("set-cookie")!.match(/ww_invite_id=([A-Za-z0-9_-]{12})/)![1];

    // Member 1 uploads
    const up1 = await fetch(`${server.baseUrl}/api/guest-photos`, {
      method: "POST",
      headers: { origin: server.baseUrl, cookie: `ww_invite_id=${m1Id}` },
      body: photoFormData(),
    });
    expect(up1.status).toBe(201);

    // Member 2 uploads
    const up2 = await fetch(`${server.baseUrl}/api/guest-photos`, {
      method: "POST",
      headers: { origin: server.baseUrl, cookie: `ww_invite_id=${m2Id}` },
      body: photoFormData(),
    });
    expect(up2.status).toBe(201);

    // Check mineId on both
    const read1 = await (
      await fetch(`${server.baseUrl}/api/guest-photos`, {
        headers: { cookie: `ww_invite_id=${m1Id}` },
      })
    ).json();
    const read2 = await (
      await fetch(`${server.baseUrl}/api/guest-photos`, {
        headers: { cookie: `ww_invite_id=${m2Id}` },
      })
    ).json();

    expect(read1.inviteValid).toBe(true);
    expect(read2.inviteValid).toBe(true);
    expect(read1.mineId).not.toBeNull();
    expect(read2.mineId).not.toBeNull();
    expect(read1.mineId).not.toBe(read2.mineId);

    // Duplicate upload by Member 1 returns 409 already_posted
    const up1Dup = await fetch(`${server.baseUrl}/api/guest-photos`, {
      method: "POST",
      headers: { origin: server.baseUrl, cookie: `ww_invite_id=${m1Id}` },
      body: photoFormData(),
    });
    expect(up1Dup.status).toBe(409);
    expect(await up1Dup.json()).toEqual({ error: "already_posted" });
  });

  test("group-cookie READs stay valid and unguarded", async () => {
    const group = await createAdminInvite({
      displayName: "Read Group",
      type: "group",
      maxMembers: 3,
    });

    // GET /api/rsvp => 200 { attending: null }
    const rsvpRead = await fetch(`${server.baseUrl}/api/rsvp`, {
      headers: { cookie: `ww_invite_id=${group.id}` },
    });
    expect(rsvpRead.status).toBe(200);
    expect(await rsvpRead.json()).toEqual({ attending: null });

    // GET /api/guest-photos => 200 { inviteValid: true, mineId: null }
    const photoRead = await fetch(`${server.baseUrl}/api/guest-photos`, {
      headers: { cookie: `ww_invite_id=${group.id}` },
    });
    expect(photoRead.status).toBe(200);
    const photoBody = await photoRead.json();
    expect(photoBody.inviteValid).toBe(true);
    expect(photoBody.mineId).toBeNull();
  });
});

test.describe("6.3 admin API", () => {
  test("create group: 201 shape + stored row; individual 201 carries type: individual", async () => {
    // 1. Create group
    const groupRes = await fetch(`${server.baseUrl}/api/admin/${TEST_ADMIN_TOKEN}/invites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "The Wilsons", type: "group", maxMembers: 4 }),
    });
    expect(groupRes.status).toBe(201);
    const groupData = await groupRes.json();
    expect(groupData).toMatchObject({
      type: "group",
      maxMembers: 4,
      sharePath: `/${groupData.id}`,
    });

    // Check stored group row
    const db = await server.connect();
    try {
      const stored = (
        await db.execute({
          sql: "SELECT id, display_name, type, max_members, parent_id FROM invites WHERE id = ?",
          args: [groupData.id],
        })
      ).rows[0];
      expect(stored).toMatchObject({
        id: groupData.id,
        display_name: "The Wilsons",
        type: "group",
        max_members: 4,
        parent_id: null,
      });
    } finally {
      db.close();
    }

    // 2. Create individual
    const indRes = await fetch(`${server.baseUrl}/api/admin/${TEST_ADMIN_TOKEN}/invites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Solo Wilson", type: "individual" }),
    });
    expect(indRes.status).toBe(201);
    const indData = await indRes.json();
    expect(indData).toMatchObject({
      type: "individual",
      sharePath: `/${indData.id}`,
    });
    expect(indData.maxMembers).toBeUndefined();
  });

  test("admin creation validation failures return specific 400 codes", async () => {
    const postAdmin = (body: Record<string, unknown>) =>
      fetch(`${server.baseUrl}/api/admin/${TEST_ADMIN_TOKEN}/invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    // invalid_type
    const r1 = await postAdmin({ displayName: "Invalid Type", type: "party" });
    expect(r1.status).toBe(400);
    expect(await r1.json()).toEqual({ error: "invalid_type" });

    // invalid_max_members: group missing maxMembers
    const r2 = await postAdmin({ displayName: "Missing Max", type: "group" });
    expect(r2.status).toBe(400);
    expect(await r2.json()).toEqual({ error: "invalid_max_members" });

    // invalid_max_members: group out-of-range (<2)
    const r3 = await postAdmin({ displayName: "Under Min", type: "group", maxMembers: 1 });
    expect(r3.status).toBe(400);
    expect(await r3.json()).toEqual({ error: "invalid_max_members" });

    // invalid_max_members: group out-of-range (>50)
    const r4 = await postAdmin({ displayName: "Over Max", type: "group", maxMembers: 51 });
    expect(r4.status).toBe(400);
    expect(await r4.json()).toEqual({ error: "invalid_max_members" });

    // invalid_max_members: group non-integer
    const r5 = await postAdmin({ displayName: "Fractional", type: "group", maxMembers: 3.5 });
    expect(r5.status).toBe(400);
    expect(await r5.json()).toEqual({ error: "invalid_max_members" });

    // invalid_max_members: individual carrying non-null maxMembers
    const r6 = await postAdmin({ displayName: "Solo With Max", type: "individual", maxMembers: 4 });
    expect(r6.status).toBe(400);
    expect(await r6.json()).toEqual({ error: "invalid_max_members" });

    // invalid_parent_id: any non-null parentId
    const r7 = await postAdmin({ displayName: "Child Via Admin", parentId: "SomeParent01" });
    expect(r7.status).toBe(400);
    expect(await r7.json()).toEqual({ error: "invalid_parent_id" });

    // Explicit null for maxMembers (individual) and parentId is ACCEPTED
    const r8 = await postAdmin({ displayName: "Explicit Nulls", maxMembers: null, parentId: null });
    expect(r8.status).toBe(201);
  });

  test("mixed list returns top-level entries with nested group breakdown; empty group list zeroed", async () => {
    // Isolated fresh database to assert exact 4 top-level entries
    const isolatedServer = await createTestServer("admin-mixed-list");
    try {
      const db = await isolatedServer.connect();
      const IND_ID = "AdminIndiv01";
      const GRP_ID = "AdminGroup01";
      const MEM1_ID = "AdminMember1";
      const MEM2_ID = "AdminMember2";
      const EMP_GRP_ID = "AdminEmpty01";

      try {
        // Individual
        await db.execute({
          sql: "INSERT INTO invites (id, display_name, created_at, type) VALUES (?, 'Solo Guest', 10, 'individual')",
          args: [IND_ID],
        });

        // Group with 2 members
        await db.execute({
          sql: "INSERT INTO invites (id, display_name, created_at, type, max_members) VALUES (?, 'The Mixed Family', 20, 'group', 4)",
          args: [GRP_ID],
        });
        await db.execute({
          sql: "INSERT INTO invites (id, display_name, created_at, type, parent_id) VALUES (?, 'Member Attending', 21, 'individual', ?)",
          args: [MEM1_ID, GRP_ID],
        });
        await db.execute({
          sql: "INSERT INTO invites (id, display_name, created_at, type, parent_id) VALUES (?, 'Member With Photo', 22, 'individual', ?)",
          args: [MEM2_ID, GRP_ID],
        });

        // Member 1 attending
        await db.execute({
          sql: "INSERT INTO rsvps (invite_id, attending, responded_at, updated_at) VALUES (?, 1, 25, 25)",
          args: [MEM1_ID],
        });

        // Member 2 photo
        await db.execute({
          sql: "INSERT INTO guest_photos (id, invite_id, key, created_at) VALUES ('PhotoAdmin01', ?, 'guest-photos/PhotoAdmin01/photo.webp', 30)",
          args: [MEM2_ID],
        });
      } finally {
        db.close();
      }

      const res = await fetch(`${isolatedServer.baseUrl}/api/admin/${TEST_ADMIN_TOKEN}/invites`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { invites: any[] };

      // Exactly four top-level entries: individual + group + two member rows
      expect(data.invites).toHaveLength(4);

      const ind = data.invites.find((i) => i.id === IND_ID);
      expect(ind).toMatchObject({
        id: IND_ID,
        displayName: "Solo Guest",
        type: "individual",
      });
      expect(ind.parentId).toBeUndefined();

      const group = data.invites.find((i) => i.id === GRP_ID);
      expect(group).toMatchObject({
        id: GRP_ID,
        displayName: "The Mixed Family",
        type: "group",
        maxMembers: 4,
        claimedCount: 2,
        attendingCount: 1,
        declinedCount: 0,
        photoCount: 1,
      });
      expect(group.members).toHaveLength(2);
      expect(group.members).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: MEM1_ID,
            displayName: "Member Attending",
            attending: true,
            hasPhoto: false,
          }),
          expect.objectContaining({
            id: MEM2_ID,
            displayName: "Member With Photo",
            attending: null,
            hasPhoto: true,
          }),
        ]),
      );

      // Verify empty group in second check
      const db2 = await isolatedServer.connect();
      try {
        await db2.execute({
          sql: "INSERT INTO invites (id, display_name, created_at, type, max_members) VALUES (?, 'Empty Family', 40, 'group', 5)",
          args: [EMP_GRP_ID],
        });
      } finally {
        db2.close();
      }

      const res2 = await fetch(`${isolatedServer.baseUrl}/api/admin/${TEST_ADMIN_TOKEN}/invites`);
      const data2 = (await res2.json()) as { invites: any[] };
      const emptyGroup = data2.invites.find((i) => i.id === EMP_GRP_ID);
      expect(emptyGroup).toMatchObject({
        id: EMP_GRP_ID,
        type: "group",
        claimedCount: 0,
        attendingCount: 0,
        declinedCount: 0,
        photoCount: 0,
        members: [],
      });
    } finally {
      await isolatedServer.dispose();
    }
  });
});

test.describe("7.1 concurrent claim storm", () => {
  test("5 parallel claims on maxMembers=3 never exceed 3 member rows; losers receive 409 group_full or 503", async () => {
    const group = await createAdminInvite({
      displayName: "Storm Group",
      type: "group",
      maxMembers: 3,
    });

    const promises = Array.from({ length: 5 }, (_, i) =>
      fetch(`${server.baseUrl}/api/invite/claim`, {
        method: "POST",
        headers: {
          origin: server.baseUrl,
          cookie: `ww_invite_id=${group.id}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ displayName: `Racer ${i + 1}` }),
      }),
    );

    const responses = await Promise.all(promises);

    const successes = responses.filter((r) => r.status === 201);
    const fulls = responses.filter((r) => r.status === 409);
    const unavailables = responses.filter((r) => r.status === 503);

    // At most 3 claims succeed
    expect(successes.length).toBeLessThanOrEqual(3);
    // Every response is 201, 409, or 503
    expect(successes.length + fulls.length + unavailables.length).toBe(5);

    // For 409 responses, the body must be { error: "group_full" }
    for (const res of fulls) {
      expect(await res.json()).toEqual({ error: "group_full" });
    }

    // Verify database row count: never more than 3
    const db = await server.connect();
    try {
      const rows = (
        await db.execute({
          sql: "SELECT id, display_name FROM invites WHERE parent_id = ?",
          args: [group.id],
        })
      ).rows;
      expect(rows.length).toBeLessThanOrEqual(3);
      if (unavailables.length === 0) {
        expect(rows.length).toBe(3);
      }
      // Distinct IDs
      const uniqueIds = new Set(rows.map((r) => r.id));
      expect(uniqueIds.size).toBe(rows.length);
    } finally {
      db.close();
    }
  });
});

test.describe("7.2 E2E member isolation", () => {
  test("two browser contexts claim on one group link, RSVP differently, upload distinct photos with no leakage", async ({
    browser,
  }) => {
    const group = await createAdminInvite({
      displayName: "Isolation Family",
      type: "group",
      maxMembers: 3,
    });

    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    try {
      const page1 = await context1.newPage();
      const page2 = await context2.newPage();
      pinFullTier(page1);
      pinFullTier(page2);

      // Context 1 claims
      await page1.goto(`${server.baseUrl}${group.sharePath}`);
      await waitForLoaderDismissed(page1);
      await page1.locator("#claim-gate-input").fill("Context One User");
      await page1.locator("#claim-gate-submit").click();
      await page1.locator("#claim-gate").waitFor({ state: "detached", timeout: 10_000 });
      await expect(page1.locator("#gate-greeting")).toHaveText("Context One User");

      // Context 2 claims
      await page2.goto(`${server.baseUrl}${group.sharePath}`);
      await waitForLoaderDismissed(page2);
      await page2.locator("#claim-gate-input").fill("Context Two User");
      await page2.locator("#claim-gate-submit").click();
      await page2.locator("#claim-gate").waitFor({ state: "detached", timeout: 10_000 });
      await expect(page2.locator("#gate-greeting")).toHaveText("Context Two User");

      // Extract cookies for API checks
      const c1Cookie = (await context1.cookies()).find((c) => c.name === "ww_invite_id")?.value;
      const c2Cookie = (await context2.cookies()).find((c) => c.name === "ww_invite_id")?.value;
      expect(c1Cookie).toBeDefined();
      expect(c2Cookie).toBeDefined();
      expect(c1Cookie).not.toBe(c2Cookie);

      // Context 1 RSVPs attending: true
      const r1 = await fetch(`${server.baseUrl}/api/rsvp`, {
        method: "POST",
        headers: {
          origin: server.baseUrl,
          cookie: `ww_invite_id=${c1Cookie}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ attending: true }),
      });
      expect(r1.status).toBe(200);

      // Context 2 RSVPs attending: false
      const r2 = await fetch(`${server.baseUrl}/api/rsvp`, {
        method: "POST",
        headers: {
          origin: server.baseUrl,
          cookie: `ww_invite_id=${c2Cookie}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ attending: false }),
      });
      expect(r2.status).toBe(200);

      // Context 1 uploads photo 1
      const photo1 = await fetch(`${server.baseUrl}/api/guest-photos`, {
        method: "POST",
        headers: { origin: server.baseUrl, cookie: `ww_invite_id=${c1Cookie}` },
        body: photoFormData(),
      });
      expect(photo1.status).toBe(201);

      // Context 2 uploads photo 2
      const photo2 = await fetch(`${server.baseUrl}/api/guest-photos`, {
        method: "POST",
        headers: { origin: server.baseUrl, cookie: `ww_invite_id=${c2Cookie}` },
        body: photoFormData(),
      });
      expect(photo2.status).toBe(201);

      // Per-cookie reads
      const me1 = await (
        await fetch(`${server.baseUrl}/api/invite/me`, {
          headers: { cookie: `ww_invite_id=${c1Cookie}` },
        })
      ).json();
      const me2 = await (
        await fetch(`${server.baseUrl}/api/invite/me`, {
          headers: { cookie: `ww_invite_id=${c2Cookie}` },
        })
      ).json();
      expect(me1.displayName).toBe("Context One User");
      expect(me2.displayName).toBe("Context Two User");

      const rsvpRead1 = await (
        await fetch(`${server.baseUrl}/api/rsvp`, {
          headers: { cookie: `ww_invite_id=${c1Cookie}` },
        })
      ).json();
      const rsvpRead2 = await (
        await fetch(`${server.baseUrl}/api/rsvp`, {
          headers: { cookie: `ww_invite_id=${c2Cookie}` },
        })
      ).json();
      expect(rsvpRead1.attending).toBe(true);
      expect(rsvpRead2.attending).toBe(false);

      const photoRead1 = await (
        await fetch(`${server.baseUrl}/api/guest-photos`, {
          headers: { cookie: `ww_invite_id=${c1Cookie}` },
        })
      ).json();
      const photoRead2 = await (
        await fetch(`${server.baseUrl}/api/guest-photos`, {
          headers: { cookie: `ww_invite_id=${c2Cookie}` },
        })
      ).json();
      expect(photoRead1.mineId).not.toBeNull();
      expect(photoRead2.mineId).not.toBeNull();
      expect(photoRead1.mineId).not.toBe(photoRead2.mineId);

      // Admin breakdown shows both members with isolated states
      const adminRes = await fetch(`${server.baseUrl}/api/admin/${TEST_ADMIN_TOKEN}/invites`);
      const adminData = await adminRes.json();
      const groupEntry = adminData.invites.find((i: any) => i.id === group.id);
      expect(groupEntry).toMatchObject({
        claimedCount: 2,
        attendingCount: 1,
        declinedCount: 1,
        photoCount: 2,
      });
    } finally {
      await context1.close();
      await context2.close();
    }
  });
});

test.describe("7.3 E2E capacity UX", () => {
  test("visitor N+1 on a full group browses greeting, wall, count; photo upload leaves status region clean", async ({
    page,
  }) => {
    pinFullTier(page);
    const group = await createAdminInvite({
      displayName: "Full House",
      type: "group",
      maxMembers: 2,
    });

    // Claim both slots
    const cl1 = await fetch(`${server.baseUrl}/api/invite/claim`, {
      method: "POST",
      headers: {
        origin: server.baseUrl,
        cookie: `ww_invite_id=${group.id}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ displayName: "First Occupant" }),
    });
    expect(cl1.status).toBe(201);

    const cl2 = await fetch(`${server.baseUrl}/api/invite/claim`, {
      method: "POST",
      headers: {
        origin: server.baseUrl,
        cookie: `ww_invite_id=${group.id}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ displayName: "Second Occupant" }),
    });
    expect(cl2.status).toBe(201);

    // Visitor N+1 opens the group link
    await page.goto(`${server.baseUrl}${group.sharePath}`);
    await waitForLoaderDismissed(page);

    // Bypasses claim gate directly to welcome gate with group display name
    await expect(page.locator("#claim-gate")).toHaveCount(0);
    const greeting = page.locator("#gate-greeting");
    await expect(greeting).toBeVisible();
    await expect(greeting).toHaveText("Full House");

    // Dismiss welcome gate
    await page.keyboard.press("Escape");
    await page.locator("#welcome-gate").waitFor({ state: "detached", timeout: 10_000 });

    // RSVP section: no interactive RSVP form
    await expect(page.locator("[data-rsvp-form]")).toHaveCount(0);

    // Photo CTA hidden at full capacity
    const addBtn = page.locator("[data-add-image]");
    await expect(addBtn).toBeHidden();

    // Direct POST with group cookie yields 409 claim_required
    const uploadAttempt = await fetch(`${server.baseUrl}/api/guest-photos`, {
      method: "POST",
      headers: { origin: server.baseUrl, cookie: `ww_invite_id=${group.id}` },
      body: photoFormData(),
    });
    expect(uploadAttempt.status).toBe(409);
    expect(await uploadAttempt.json()).toEqual({ error: "claim_required" });

    // In the page, photo status region does not contain upload sync error
    const statusEl = page.locator("[data-photo-status]");
    await expect(statusEl).toHaveText("");
    const errorEl = page.locator("[data-photo-error]");
    await expect(errorEl).toHaveText("");
  });
});

test.describe("7.4 E2E sticky cookie persistence", () => {
  test("claimed member re-opening group link retains member identity with refreshed Max-Age", async ({
    page,
  }) => {
    pinFullTier(page);
    const group = await createAdminInvite({
      displayName: "Sticky Family",
      type: "group",
      maxMembers: 3,
    });

    // Member claims a slot
    await page.goto(`${server.baseUrl}${group.sharePath}`);
    await waitForLoaderDismissed(page);
    await page.locator("#claim-gate-input").fill("Sticky Member");
    await page.locator("#claim-gate-submit").click();
    await page.locator("#claim-gate").waitFor({ state: "detached", timeout: 10_000 });

    const memberCookie = (await page.context().cookies()).find(
      (c) => c.name === "ww_invite_id",
    )?.value;
    expect(memberCookie).toBeDefined();
    expect(memberCookie).not.toBe(group.id);

    // Dismiss welcome gate
    await page.keyboard.press("Escape");
    await page.locator("#welcome-gate").waitFor({ state: "detached", timeout: 10_000 });

    // Re-open the group link directly
    const nav = await page.goto(`${server.baseUrl}${group.sharePath}`);
    expect(nav?.status()).toBe(200); // 302 -> 200 at /
    await waitForLoaderDismissed(page);

    // Welcome gate greeting displays the member name (identity persisted!)
    await expect(page.locator("#claim-gate")).toHaveCount(0);
    const greeting = page.locator("#gate-greeting");
    await expect(greeting).toBeVisible();
    await expect(greeting).toHaveText("Sticky Member");

    // Cookie is still the member ID
    const currentCookie = (await page.context().cookies()).find(
      (c) => c.name === "ww_invite_id",
    )?.value;
    expect(currentCookie).toBe(memberCookie);

    // Fresh / incognito visitor gets the group identity
    const freshContext = await page.context().browser()!.newContext();
    try {
      const freshPage = await freshContext.newPage();
      pinFullTier(freshPage);
      await freshPage.goto(`${server.baseUrl}${group.sharePath}`);
      await waitForLoaderDismissed(freshPage);

      const freshCookie = (await freshContext.cookies()).find(
        (c) => c.name === "ww_invite_id",
      )?.value;
      expect(freshCookie).toBe(group.id);
    } finally {
      await freshContext.close();
    }
  });
});
