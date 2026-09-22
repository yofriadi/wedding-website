import type { APIContext } from "astro";
import { db } from "@wedding-website/db";
import { invites } from "@wedding-website/db/schema";
import { env } from "@wedding-website/env/server";
import { eq, sql } from "drizzle-orm";

export const INVITE_COOKIE_NAME = "ww_invite_id";
export const INVITE_ID_RE = /^[A-Za-z0-9_-]{12}$/;

/** Astro's cookie jar, re-exported so consumers need no `astro` type import. */
export type APIContextCookies = APIContext["cookies"];

// Derived, never stored as a third `type` value (design D1): a "member" is an
// ordinary individual row with a parent, so every per-invite contract applies to
// it unchanged — only claim and admin care about the distinction.
export type InviteKind = "individual" | "member" | "group";

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

type InviteCookieOptions = NonNullable<Parameters<APIContext["cookies"]["set"]>[2]>;

export function toCookieMaxAgeSeconds(days: number) {
  return Math.max(1, Math.floor(days * 24 * 60 * 60));
}

// ONE source of truth for the invite cookie's attribute set. Every writer — the
// `GET /{id}` redirect, `POST /api/invite/claim`, and anything added later —
// consumes this, so a claim cookie is attribute-for-attribute identical to the
// link cookie instead of a hand-maintained copy.
//
// `httpOnly: false` is load-bearing, not an oversight: client surfaces gate on
// `document.cookie`, and the spec requires a claimed member's cookie to stay
// readable from the page.
export function inviteCookieOptions(): InviteCookieOptions {
  return {
    httpOnly: false,
    maxAge: toCookieMaxAgeSeconds(env.INVITE_COOKIE_DAYS),
    path: "/",
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
  };
}

export function setInviteCookie(cookies: APIContext["cookies"], inviteId: string): void {
  cookies.set(INVITE_COOKIE_NAME, inviteId, inviteCookieOptions());
}

export interface ResolvedGroupState {
  maxMembers: number;
  claimedCount: number;
}

/**
 * Read a group's quota and current occupancy in ONE query.
 *
 * `claimedCount` is always DERIVED from the member rows, never stored, so it
 * cannot drift (design D6). Returns null when the id is not a group row — callers
 * read that as "no claim form / no release affordance".
 *
 * Database errors are THROWN, not swallowed, so each caller picks its own fail
 * direction: `index.astro` degrades a group to anonymous (fail closed — never
 * offer a claim form on unknown quota), while `[id].ts` refuses a release (fail
 * closed — never destroy an identity on unknown quota).
 */
export async function readGroupQuota(groupId: string): Promise<ResolvedGroupState | null> {
  const rows = await db
    .select({
      type: invites.type,
      maxMembers: invites.maxMembers,
      claimedCount: sql<number>`(SELECT COUNT(*) FROM invites AS siblings WHERE siblings.parent_id = ${groupId})`,
    })
    .from(invites)
    .where(eq(invites.id, groupId))
    .limit(1);
  const row = rows[0];
  if (!row || row.type !== "group") return null;
  return {
    maxMembers: row.maxMembers ?? 0,
    claimedCount: Number(row.claimedCount ?? 0),
  };
}

export interface ResolvedInvite {
  id: string;
  displayName: string;
  kind: InviteKind;
  // Surfaced so `[id].ts`'s sticky rule can check that the cookie's member
  // belongs to THIS group rather than to a different one.
  parentId: string | null;
  /** Quota state for group identities only; always null otherwise. */
  group: ResolvedGroupState | null;
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
        type: invites.type,
        parentId: invites.parentId,
        maxMembers: invites.maxMembers,
      })
      .from(invites)
      .where(eq(invites.id, cookieValue))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return { status: "not_found" };
    }

    const parentId = row.parentId ?? null;
    const kind: InviteKind =
      parentId !== null ? "member" : row.type === "group" ? "group" : "individual";

    let group: ResolvedGroupState | null = null;
    if (kind === "group") {
      // Only group identities pay for the extra COUNT (design D6). claimedCount
      // is always derived, never stored, so it cannot drift from the member rows.
      //
      // Deliberately NOT readGroupQuota(): this function already holds the row, so
      // the shared helper would re-SELECT the `type`/`max_members` it has in hand.
      // Both compute the identical value — invites_member_shape_chk guarantees a
      // parented row is `individual`, so "members of G" means the same thing either
      // way — but they answer different questions: this one decorates an
      // already-resolved identity, the helper resolves a bare id. Keep them
      // separate; if the derivation ever changes, change both.
      const counted = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(invites)
        .where(eq(invites.parentId, row.id))
        .limit(1);
      group = {
        // CHECK invites_group_shape_chk guarantees max_members when type='group'.
        maxMembers: row.maxMembers ?? 0,
        claimedCount: Number(counted[0]?.count ?? 0),
      };
    }

    return {
      status: "ok",
      invite: { id: row.id, displayName: row.displayName, kind, parentId, group },
    };
  } catch (err) {
    console.error("[invite-session] lookup failed:", err);
    return { status: "error" };
  }
}
