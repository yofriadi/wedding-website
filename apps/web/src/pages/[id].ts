import type { APIRoute } from "astro";
import { db } from "@wedding-website/db";
import { invites } from "@wedding-website/db/schema";
import { eq, sql } from "drizzle-orm";

import {
  INVITE_ID_RE,
  resolveInvite,
  setInviteCookie,
  type APIContextCookies,
} from "../lib/invite-session";

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

// A member who re-taps the group link in chat must NOT be silently demoted back
// to the anonymous group identity — that would make their RSVP appear to vanish.
// So when the link is a group and the incoming cookie already maps to a member
// OF THIS GROUP, the cookie is re-set to the SAME member id with a fresh
// Max-Age (identity preserved, sliding expiry preserved). Any resolution
// problem falls back to the plain rebind: a navigation is never a 5xx.
async function stickyMemberId(cookies: APIContextCookies, groupId: string): Promise<string | null> {
  try {
    const resolution = await resolveInvite(cookies);
    if (resolution.status !== "ok") return null;
    const { invite } = resolution;
    // A member of a DIFFERENT group falls through and rebinds to this link.
    return invite.kind === "member" && invite.parentId === groupId ? invite.id : null;
  } catch (err) {
    console.error("[invite-link] sticky cookie resolution failed:", err);
    return null;
  }
}

export const GET: APIRoute = async ({ params, cookies }) => {
  const id = params.id;

  if (typeof id !== "string" || !INVITE_ID_RE.test(id)) {
    return noStoreRedirect();
  }

  const now = Date.now();
  // Metrics are best-effort: a failed write must not stop the guest from
  // reaching the homepage. They always bump on the LINK id — group rows count
  // link opens, not member activity.
  let updated: { id: string; type: string }[] = [];
  try {
    updated = await db
      .update(invites)
      .set({
        seenAt: now,
        seenCount: sql`${invites.seenCount} + 1`,
      })
      .where(eq(invites.id, id))
      .returning({ id: invites.id, type: invites.type });
  } catch (err) {
    console.error("[invite-link] metric update failed:", err);
  }

  let inviteExists = updated.length > 0;
  let inviteType: string | null = updated[0]?.type ?? null;
  if (!inviteExists) {
    // The metrics write failed (or matched nothing): fall back to a read-only
    // lookup so a transient DB error doesn't silently consume the invite link.
    // If even the read fails, treat the invite as unverifiable — no cookie set,
    // and the redirect still lands the guest on a functional homepage.
    // `type` is read here too so the sticky rule still works on this path.
    try {
      const rows = await db
        .select({ id: invites.id, type: invites.type })
        .from(invites)
        .where(eq(invites.id, id))
        .limit(1);
      inviteExists = rows.length > 0;
      inviteType = rows[0]?.type ?? null;
    } catch (err) {
      console.error("[invite-link] existence lookup failed:", err);
      inviteExists = false;
    }
  }

  // Opening an invite link is an explicit identity statement: bind (or
  // rebind) the cookie to THIS invite, even if a stale/unknown cookie is
  // already present — otherwise a dead cookie from an earlier visit would
  // keep masking the greeting for every future invite link this guest opens.
  // The one exception is the sticky-member rule above.
  if (inviteExists) {
    const sticky = inviteType === "group" ? await stickyMemberId(cookies, id) : null;
    setInviteCookie(cookies, sticky ?? id);
  }

  return noStoreRedirect();
};
