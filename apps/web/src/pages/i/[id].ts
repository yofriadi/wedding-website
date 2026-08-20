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

export const GET: APIRoute = async ({ params, cookies, redirect }) => {
  const id = params.id;

  if (typeof id !== "string" || id.length !== INVITE_ID_LENGTH || !ID_RE.test(id)) {
    return noStoreRedirect();
  }

  const now = Date.now();

  const updated = await db
    .update(invites)
    .set({
      seenAt: now,
      seenCount: sql`${invites.seenCount} + 1`,
    })
    .where(eq(invites.id, id))
    .returning({ id: invites.id });

  const existing = cookies.get(INVITE_COOKIE_NAME);
  const inviteExists = updated.length > 0;

  if (!existing && inviteExists) {
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
