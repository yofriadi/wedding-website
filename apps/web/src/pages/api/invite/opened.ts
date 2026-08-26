import type { APIRoute } from "astro";
import { db } from "@wedding-website/db";
import { invites } from "@wedding-website/db/schema";
import { eq, sql } from "drizzle-orm";

const INVITE_COOKIE_NAME = "ww_invite_id";
const INVITE_ID_RE = /^[A-Za-z0-9_-]{12}$/;

// Uniform 404 for missing/malformed/unknown cookie — indistinguishable body shape.
function notFound() {
  return new Response(null, {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function noContent() {
  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

// Identity comes from the cookie only: the invite id is never accepted from the
// path or query (see invite-session). The body is ignored entirely.
export const POST: APIRoute = async ({ cookies }) => {
  const cookieValue = cookies.get(INVITE_COOKIE_NAME)?.value;

  if (typeof cookieValue !== "string" || !INVITE_ID_RE.test(cookieValue)) {
    return notFound();
  }

  const now = Date.now();

  // Metrics are best-effort: a failed write must never surface to the guest,
  // whose reveal already happened client-side (mirrors GET /:id).
  try {
    const updated = await db
      .update(invites)
      .set({
        openedAt: now,
        openedCount: sql`${invites.openedCount} + 1`,
      })
      .where(eq(invites.id, cookieValue))
      .returning({ id: invites.id });

    if (updated.length === 0) {
      return notFound();
    }
  } catch (err) {
    console.error("[invite/opened] metric update failed:", err);
  }

  return noContent();
};
