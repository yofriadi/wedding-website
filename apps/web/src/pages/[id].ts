import type { APIRoute } from "astro";
import { db } from "@wedding-website/db";
import { invites } from "@wedding-website/db/schema";
import { eq, sql } from "drizzle-orm";

import {
  INVITE_ID_RE,
  readGroupQuota,
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

// `?fresh=1` is DESTRUCTIVE — it drops a member id that exists only in the
// cookie — and it is a GET, so NO origin check can protect it: origin checks
// cover non-safe methods by design (and the framework one is disabled repo-wide
// anyway), while SameSite=Lax *sends* the cookie on cross-site top-level
// navigations. Without this gate any other page could
// `location.replace("/<groupId>?fresh=1")` a member and permanently downgrade
// them to the group identity, which is exactly what the release requirement
// forbids ("an accidental tap or prefetch cannot downgrade an answered member").
//
// Sec-Fetch metadata separates a real visit from a forced one:
//   same-origin + document — the guest activated the release on our own page
//   none        + document — address bar, bookmark, or a reload
// Anything else — a cross-site navigation, or a subresource load on a
// shared-domain deployment — is refused: the release is skipped, the sticky
// rule still runs, and the member keeps their identity. Absent headers (older
// browsers, curl, the NOTE.md walkthrough) are allowed through, because the
// two-step confirmation in the UI remains the primary gate and refusing them
// would break manual verification.
function isExplicitReleaseNavigation(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  // Deliberately NOT "same-site": on a shared domain another tenant is
  // same-site but cross-origin, and its subresources would carry our cookie.
  if (site !== null && site !== "same-origin" && site !== "none") return false;
  const dest = request.headers.get("sec-fetch-dest");
  return dest === null || dest === "document";
}

export const GET: APIRoute = async ({ params, cookies, url, request }) => {
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
    // `?fresh=1` is the explicit release path for shared browsers: skip the
    // sticky rule and hand back the group identity so a second person can
    // claim their own slot. It creates no rows and consumes no slot (only the
    // group's seen-metrics move), and it has no effect on non-group links
    // because only groups consult it. Gated on Sec-Fetch metadata so a
    // cross-site navigation cannot force a release — see the helper above.
    let releaseRequested =
      url.searchParams.get("fresh") === "1" && isExplicitReleaseNavigation(request);
    // Server-side capacity gate on the release. At capacity the release is pure
    // loss — the member id lives only in the cookie and re-claiming would need a
    // slot that does not exist — so the UI already withholds the control; this
    // makes the server agree with it instead of honouring a hand-built URL.
    //
    // It also NARROWS — though it does not close — the history-replay hole that a
    // GET release opens: `/{id}?fresh=1` enters browser history and omnibox
    // autocomplete, and re-opening it sends `Sec-Fetch-Site: none`, which the gate
    // above must allow. Because a release does not delete the member row, a member
    // who releases and re-claims leaves the group full, so that replay is refused —
    // but a group with room to spare still honours it. Closing it properly needs the
    // release to stop being a GET (filed as the `release-via-post` change).
    //
    // Fails CLOSED: an unreadable quota refuses the release, because a destructive
    // action must not proceed on unknown state.
    if (releaseRequested) {
      try {
        const quota = await readGroupQuota(id);
        if (!quota || quota.claimedCount >= quota.maxMembers) {
          releaseRequested = false;
        }
      } catch (err) {
        console.error("[invite-link] release capacity check failed; refusing release:", err);
        releaseRequested = false;
      }
    }
    const sticky =
      inviteType === "group" && !releaseRequested ? await stickyMemberId(cookies, id) : null;
    setInviteCookie(cookies, sticky ?? id);
  }

  return noStoreRedirect();
};
