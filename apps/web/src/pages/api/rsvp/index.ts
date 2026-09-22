import type { APIRoute } from "astro";
import { db } from "@wedding-website/db";
import { rsvps } from "@wedding-website/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  notFound,
  resolveInvite,
  serviceUnavailable,
  type ResolvedInvite,
} from "../../../lib/invite-session";
import { crossOriginPostForbidden, isSameOriginRequest } from "../../../lib/same-origin";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

const rsvpBodySchema = z.object({ attending: z.boolean() }).strict();

// Read the caller's own RSVP state. Read-only: invite metrics are untouched.
export const GET: APIRoute = async ({ cookies }) => {
  const resolution = await resolveInvite(cookies);
  if (resolution.status === "not_found") {
    return notFound();
  }
  if (resolution.status === "error") {
    return serviceUnavailable();
  }
  const { invite } = resolution;

  let row: { attending: boolean } | undefined;
  try {
    const rows = await db
      .select({ attending: rsvps.attending })
      .from(rsvps)
      .where(eq(rsvps.inviteId, invite.id))
      .limit(1);
    row = rows[0];
  } catch (err) {
    console.error("[rsvp] status read failed:", err);
    return serviceUnavailable();
  }

  return json(200, {
    attending: row?.attending ?? null,
  });
};

// Upsert the caller's RSVP. AUTHENTICATE FIRST: the cookie is resolved before
// the body is read, so anonymous callers get the uniform 404 even with a
// garbage body (endpoint-invisibility rule).
export const POST: APIRoute = async ({ cookies, request }) => {
  const resolution = await resolveInvite(cookies);
  if (resolution.status === "not_found") {
    return notFound();
  }
  if (resolution.status === "error") {
    return serviceUnavailable();
  }
  // Cross-origin guard. Astro's framework checkOrigin is DISABLED in
  // astro.config.mjs, because its naive `Origin === request.url.origin`
  // comparison cannot match behind a TLS-terminating proxy and it runs before
  // user middleware so it cannot be corrected there (see lib/same-origin.ts).
  // This call is what replaces it — every cookie-authenticated POST must have
  // one, and tests/origin-guard.spec.ts fails the build if one goes missing.
  // Placed after the identity checks so an anonymous caller still gets the
  // uniform bare 404.
  if (!isSameOriginRequest(request)) {
    return crossOriginPostForbidden();
  }
  const { invite } = resolution;

  // A group cookie is a VALID but UNCLAIMED identity: it must never write shared
  // state on behalf of a whole party. Standalone individuals and claimed members
  // pass through unchanged (rsvp-responses spec).
  if (invite.kind === "group") {
    return json(409, { error: "claim_required" });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json(400, { error: "invalid_body" });
  }

  const parsed = rsvpBodySchema.safeParse(payload);
  if (!parsed.success) {
    return json(400, { error: "invalid_body" });
  }

  const { attending } = parsed.data;

  try {
    await upsertRsvp(invite, attending);
  } catch (err) {
    // SQLITE_BUSY and other retryable storage failures surface as 503, never
    // as a partial or duplicate write.
    console.error("[rsvp] write failed:", err);
    return serviceUnavailable();
  }

  return json(200, { attending });
};

async function upsertRsvp(invite: ResolvedInvite, attending: boolean) {
  const now = Date.now();
  await db
    .insert(rsvps)
    .values({
      inviteId: invite.id,
      attending,
      respondedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: rsvps.inviteId,
      // responded_at deliberately excluded: the first-response timestamp
      // survives a change of mind.
      set: { attending, updatedAt: now },
    });
}
