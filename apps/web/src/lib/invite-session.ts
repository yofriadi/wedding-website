import type { APIContext } from "astro";
import { db } from "@wedding-website/db";
import { invites } from "@wedding-website/db/schema";
import { eq } from "drizzle-orm";

export const INVITE_COOKIE_NAME = "ww_invite_id";
export const INVITE_ID_RE = /^[A-Za-z0-9_-]{12}$/;

// Uniform 404 for missing/malformed/unknown cookie — indistinguishable body
// shape, identical to GET /api/invite/me so endpoint existence never leaks.
export function notFound() {
  return new Response(null, {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

// Operational failure: distinct from identity 404s so consumers can tell a
// retryable service problem from an anonymous visitor.
export function serviceUnavailable() {
  return new Response(null, {
    status: 503,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export interface ResolvedInvite {
  id: string;
  displayName: string;
  maxPartySize: number;
}

export type InviteResolution =
  | { status: "ok"; invite: ResolvedInvite }
  | { status: "not_found" }
  | { status: "error" };

// Cookie-as-identity resolution shared by the RSVP endpoints. Read-only:
// invite metrics stay exclusive to GET /{id} and /api/invite/opened.
export async function resolveInvite(cookies: APIContext["cookies"]): Promise<InviteResolution> {
  const cookieValue = cookies.get(INVITE_COOKIE_NAME)?.value;

  if (typeof cookieValue !== "string" || !INVITE_ID_RE.test(cookieValue)) {
    return { status: "not_found" };
  }

  try {
    const rows = await db
      .select({
        id: invites.id,
        displayName: invites.displayName,
        maxPartySize: invites.maxPartySize,
      })
      .from(invites)
      .where(eq(invites.id, cookieValue))
      .limit(1);

    const invite = rows[0];
    if (!invite) {
      return { status: "not_found" };
    }
    return { status: "ok", invite };
  } catch (err) {
    console.error("[invite-session] lookup failed:", err);
    return { status: "error" };
  }
}
