import type { APIRoute } from "astro";
import { db } from "@wedding-website/db";
import { invites, rsvps } from "@wedding-website/db/schema";
import { env } from "@wedding-website/env/server";
import { desc, eq } from "drizzle-orm";

const INVITE_ID_LENGTH = 12;
const INVITE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function generateInviteId() {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (!cryptoObj?.getRandomValues) {
    throw new Error("crypto.getRandomValues is not available");
  }

  const bytes = new Uint8Array(INVITE_ID_LENGTH);
  cryptoObj.getRandomValues(bytes);

  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte === undefined) {
      throw new Error("Failed to generate invite ID");
    }
    out += INVITE_ALPHABET.charAt(byte & 63);
  }
  return out;
}

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
        maxPartySize: invites.maxPartySize,
        attending: rsvps.attending,
        partySize: rsvps.partySize,
      })
      .from(invites)
      .leftJoin(rsvps, eq(rsvps.inviteId, invites.id))
      .orderBy(desc(invites.createdAt));

    return json(200, { invites: rows });
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

  const displayName =
    typeof (payload as { displayName?: unknown })?.displayName === "string"
      ? (payload as { displayName: string }).displayName.trim()
      : "";

  if (!displayName) {
    return json(400, { error: "display_name_required" });
  }
  if (displayName.length > 120) {
    return json(400, { error: "display_name_too_long" });
  }

  const rawMaxPartySize = (payload as { maxPartySize?: unknown })?.maxPartySize;
  const maxPartySize = rawMaxPartySize === undefined ? 1 : rawMaxPartySize;
  if (
    typeof maxPartySize !== "number" ||
    !Number.isInteger(maxPartySize) ||
    maxPartySize < 1 ||
    maxPartySize > 20
  ) {
    return json(400, { error: "invalid_max_party_size" });
  }

  const now = Date.now();

  for (let attempt = 0; attempt < 5; attempt++) {
    const id = generateInviteId();

    try {
      await db.insert(invites).values({
        id,
        displayName,
        createdAt: now,
        seenAt: null,
        seenCount: 0,
        maxPartySize,
      });

      return json(201, {
        id,
        sharePath: `/${id}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      const looksLikeCollision =
        message.includes("UNIQUE") ||
        message.includes("constraint") ||
        message.includes("PRIMARYKEY") ||
        message.includes("SQLITE_CONSTRAINT");

      if (!looksLikeCollision || attempt === 4) {
        return json(500, { error: "invite_create_failed" });
      }
    }
  }

  return json(500, { error: "invite_create_failed" });
};
