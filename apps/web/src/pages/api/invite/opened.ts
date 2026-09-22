import type { APIRoute } from "astro";
import { db } from "@wedding-website/db";
import { invites } from "@wedding-website/db/schema";
import { eq, sql } from "drizzle-orm";

import { inviteIdFromCookies, notFound } from "../../../lib/invite-session";
import { crossOriginPostForbidden, isSameOriginRequest } from "../../../lib/same-origin";

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
export const POST: APIRoute = async ({ cookies, request }) => {
  const cookieValue = inviteIdFromCookies(cookies);
  if (!cookieValue) {
    return notFound();
  }
  // Cross-origin guard. Load-bearing: the framework `checkOrigin` is disabled
  // (see lib/same-origin.ts and astro.config.mjs). This endpoint writes metrics
  // for whatever cookie it is handed, so without the guard any site could inflate
  // open counts for an invite id it had obtained.
  if (!isSameOriginRequest(request)) {
    return crossOriginPostForbidden();
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
