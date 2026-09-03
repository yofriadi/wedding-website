import type { APIRoute } from "astro";
import { db } from "@wedding-website/db";
import { invites } from "@wedding-website/db/schema";
import { env } from "@wedding-website/env/server";
import { eq, sql } from "drizzle-orm";

const INVITE_ID_LENGTH = 12;
const INVITE_COOKIE_NAME = "ww_invite_id";
const ID_RE = /^[A-Za-z0-9_-]{12}$/;

function toCookieMaxAgeSeconds(days: number) {
  return Math.max(1, Math.floor(days * 24 * 60 * 60));
}

// The redirect carries Set-Cookie and bumps seen-metrics — it must never be cached.
function noStoreRedirect() {
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Cache-Control": "no-store",
    },
  });
}

export const GET: APIRoute = async ({ params, cookies }) => {
  const id = params.id;

  if (typeof id !== "string" || id.length !== INVITE_ID_LENGTH || !ID_RE.test(id)) {
    return noStoreRedirect();
  }

  const now = Date.now();
  // Metrics are best-effort: a failed write must not stop the guest from
  // reaching the homepage.
  let updated: { id: string }[] = [];
  try {
    updated = await db
      .update(invites)
      .set({
        seenAt: now,
        seenCount: sql`${invites.seenCount} + 1`,
      })
      .where(eq(invites.id, id))
      .returning({ id: invites.id });
  } catch (err) {
    console.error("[invite/i] metric update failed:", err);
  }

  let inviteExists = updated.length > 0;
  if (!inviteExists) {
    // The metrics write failed (or matched nothing): fall back to a read-only
    // lookup so a transient DB error doesn't silently consume the invite link.
    // If even the read fails, treat the invite as unverifiable — no cookie set,
    // and the redirect still lands the guest on a functional homepage.
    try {
      const rows = await db
        .select({ id: invites.id })
        .from(invites)
        .where(eq(invites.id, id))
        .limit(1);
      inviteExists = rows.length > 0;
    } catch (err) {
      console.error("[invite/i] existence lookup failed:", err);
      inviteExists = false;
    }
  }
  // Opening an invite link is an explicit identity statement: bind (or
  // rebind) the cookie to THIS invite, even if a stale/unknown cookie is
  // already present — otherwise a dead cookie from an earlier visit would
  // keep masking the greeting for every future invite link this guest opens.
  if (inviteExists) {
    const days = env.INVITE_COOKIE_DAYS;
    cookies.set(INVITE_COOKIE_NAME, id, {
      httpOnly: false,
      maxAge: toCookieMaxAgeSeconds(days),
      path: "/",
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
    });
  }

  return noStoreRedirect();
};
