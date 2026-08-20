import type { APIRoute } from "astro";
import { db } from "@wedding-website/db";
import { invites } from "@wedding-website/db/schema";
import { eq } from "drizzle-orm";

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

export const GET: APIRoute = async ({ cookies }) => {
  const cookieValue = cookies.get(INVITE_COOKIE_NAME)?.value;

  if (typeof cookieValue !== "string" || !INVITE_ID_RE.test(cookieValue)) {
    return notFound();
  }

  // Read-only: metrics stay exclusive to GET /i/:id.
  const rows = await db
    .select({ displayName: invites.displayName })
    .from(invites)
    .where(eq(invites.id, cookieValue))
    .limit(1);

  const displayName = rows[0]?.displayName;
  if (typeof displayName !== "string") {
    return notFound();
  }

  return new Response(JSON.stringify({ displayName }), {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
};
