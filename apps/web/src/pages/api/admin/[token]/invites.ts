import type { APIRoute } from "astro";
import { db } from "@wedding-website/db";
import { guestPhotos, invites, rsvps } from "@wedding-website/db/schema";
import { env } from "@wedding-website/env/server";
import { desc, eq } from "drizzle-orm";
import {
  generateInviteId,
  INVITE_ID_MAX_ATTEMPTS,
  isInviteIdCollision,
  redactInviteError,
} from "../../../../lib/invite-id";

const MIN_MAX_MEMBERS = 2;
const MAX_MAX_MEMBERS = 50;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

// Constant-time compare: the admin token is a secret; don't leak match length/timing.
function tokenEquals(a: string, b: string) {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Bare 404 (no body) — identical for missing and wrong tokens so the route is
// indistinguishable from a non-existent path.
function bareNotFound() {
  return new Response(null, {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function isAuthorized(token: unknown) {
  const expectedToken = env.INVITE_ADMIN_TOKEN;
  return typeof token === "string" && !!expectedToken && tokenEquals(token, expectedToken);
}

// Read side for the couple: who has been sent an invite, who looked, who opened.
//
// Every row is a top-level entry — standalone individuals, groups, AND member
// rows — so nothing is hidden inside a group. Group entries additionally carry
// their quota and a per-member breakdown. Both left joins are 1:1 (`rsvps` has
// `invite_id` as PK, `guest_photos` has it UNIQUE), so no row multiplies and the
// whole list costs ONE query plus in-JS grouping: no N+1, no per-member query.
export const GET: APIRoute = async ({ params }) => {
  if (!isAuthorized(params.token)) {
    return bareNotFound();
  }

  try {
    const rows = await db
      .select({
        id: invites.id,
        displayName: invites.displayName,
        createdAt: invites.createdAt,
        seenAt: invites.seenAt,
        seenCount: invites.seenCount,
        openedAt: invites.openedAt,
        openedCount: invites.openedCount,
        type: invites.type,
        parentId: invites.parentId,
        maxMembers: invites.maxMembers,
        attending: rsvps.attending,
        photoId: guestPhotos.id,
      })
      .from(invites)
      .leftJoin(rsvps, eq(rsvps.inviteId, invites.id))
      .leftJoin(guestPhotos, eq(guestPhotos.inviteId, invites.id))
      // `id` is the tiebreaker: a claim storm mints several members within one
      // millisecond, and `createdAt` alone leaves their relative order up to the
      // query planner — nondeterministic across runs, which is how a list test
      // starts flaking. Every other list in the repo pairs its timestamp with
      // `desc(id)` for exactly this reason.
      .orderBy(desc(invites.createdAt), desc(invites.id));

    const membersByParent = new Map<string, typeof rows>();
    for (const row of rows) {
      if (row.parentId === null) continue;
      const bucket = membersByParent.get(row.parentId);
      if (bucket) bucket.push(row);
      else membersByParent.set(row.parentId, [row]);
    }

    const list = rows.map((row) => {
      // Standalone individuals keep their existing flat shape, plus `type`.
      const entry = {
        id: row.id,
        displayName: row.displayName,
        createdAt: row.createdAt,
        seenAt: row.seenAt,
        seenCount: row.seenCount,
        openedAt: row.openedAt,
        openedCount: row.openedCount,
        attending: row.attending ?? null,
        type: row.type,
        // Only members carry a parent; groups and individuals stay flat.
        ...(row.parentId !== null ? { parentId: row.parentId } : {}),
      };

      if (row.type !== "group") return entry;

      const members = membersByParent.get(row.id) ?? [];
      return {
        ...entry,
        maxMembers: row.maxMembers ?? null,
        claimedCount: members.length,
        attendingCount: members.filter((member) => member.attending === true).length,
        declinedCount: members.filter((member) => member.attending === false).length,
        photoCount: members.filter((member) => member.photoId !== null).length,
        // `seen_*` is deliberately OMITTED for members: link metrics bump on the
        // link id, so a member's seen counters are normally zero and reporting
        // them would only invite a wrong reading.
        members: members.map((member) => ({
          id: member.id,
          displayName: member.displayName,
          attending: member.attending ?? null,
          openedAt: member.openedAt ?? null,
          openedCount: member.openedCount,
          hasPhoto: member.photoId !== null,
        })),
      };
    });

    return json(200, { invites: list });
  } catch (err) {
    console.error("[admin/invites] listing failed:", err);
    return json(500, { error: "invite_list_failed" });
  }
};

export const POST: APIRoute = async ({ params, request }) => {
  if (!isAuthorized(params.token)) {
    return bareNotFound();
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const body = (payload ?? {}) as {
    displayName?: unknown;
    type?: unknown;
    maxMembers?: unknown;
    parentId?: unknown;
  };

  // Member rows are created ONLY through the claim flow. Letting admin set a
  // parent would create a second writer past the atomic quota guard.
  if (body.parentId !== undefined && body.parentId !== null) {
    return json(400, { error: "invalid_parent_id" });
  }

  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";

  if (!displayName) {
    return json(400, { error: "display_name_required" });
  }
  if (displayName.length > 120) {
    return json(400, { error: "display_name_too_long" });
  }

  const type = body.type === undefined ? "individual" : body.type;
  if (type !== "individual" && type !== "group") {
    return json(400, { error: "invalid_type" });
  }

  const rawMaxMembers = body.maxMembers;
  const hasMaxMembers = rawMaxMembers !== undefined && rawMaxMembers !== null;
  let maxMembers: number | null = null;

  if (type === "group") {
    // Mirrors CHECK invites_max_members_range_chk — reject here so the caller
    // gets a specific 400 instead of an opaque constraint failure.
    if (
      typeof rawMaxMembers !== "number" ||
      !Number.isInteger(rawMaxMembers) ||
      rawMaxMembers < MIN_MAX_MEMBERS ||
      rawMaxMembers > MAX_MAX_MEMBERS
    ) {
      return json(400, { error: "invalid_max_members" });
    }
    maxMembers = rawMaxMembers;
  } else if (hasMaxMembers) {
    // CHECK invites_group_shape_chk forbids a quota on a non-group row.
    return json(400, { error: "invalid_max_members" });
  }

  const now = Date.now();

  for (let attempt = 0; attempt < INVITE_ID_MAX_ATTEMPTS; attempt++) {
    const id = generateInviteId();

    try {
      await db.insert(invites).values({
        id,
        displayName,
        createdAt: now,
        seenAt: null,
        seenCount: 0,
        type,
        maxMembers,
      });

      return json(
        201,
        type === "group"
          ? { id, sharePath: `/${id}`, type: "group", maxMembers }
          : { id, sharePath: `/${id}`, type: "individual" },
      );
    } catch (err) {
      // PRECISE classifier (shared with the group claim path): only a genuine
      // `invites.id` collision may be retried with a fresh id. The CHECK/FK
      // failures this schema adds must fail fast as a 500 — the old four
      // substring check (`"UNIQUE" || "constraint" || "PRIMARYKEY" ||
      // "SQLITE_CONSTRAINT"`) would have swallowed them into five pointless
      // retries and an opaque error.
      if (!isInviteIdCollision(err)) {
        console.error("[admin/invites] create failed:", redactInviteError(err));
        return json(500, { error: "invite_create_failed" });
      }
      console.error(
        `[admin/invites] invite id collision (attempt ${attempt + 1}):`,
        redactInviteError(err),
      );
    }
  }

  return json(500, { error: "invite_create_failed" });
};
