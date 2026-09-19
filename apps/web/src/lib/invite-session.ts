import type { APIContext } from "astro";
import { db } from "@wedding-website/db";
import { invites } from "@wedding-website/db/schema";
import { eq } from "drizzle-orm";

export const INVITE_COOKIE_NAME = "ww_invite_id";
export const INVITE_ID_RE = /^[A-Za-z0-9_-]{12}$/;

export function inviteIdFromCookies(cookies: APIContext["cookies"]): string | null {
  const value = cookies.get(INVITE_COOKIE_NAME)?.value;
  return typeof value === "string" && INVITE_ID_RE.test(value) ? value : null;
}

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
}

export type InviteResolution =
  | { status: "ok"; invite: ResolvedInvite }
  | { status: "not_found" }
  | { status: "error" };

// Read-only identity shared by invite, RSVP, and guest-photo APIs.
// Invite metrics stay exclusive to GET /{id} and /api/invite/opened.
export async function resolveInvite(cookies: APIContext["cookies"]): Promise<InviteResolution> {
  const cookieValue = inviteIdFromCookies(cookies);
  if (!cookieValue) {
    return { status: "not_found" };
  }

  try {
    const rows = await db
      .select({
        id: invites.id,
        displayName: invites.displayName,
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
