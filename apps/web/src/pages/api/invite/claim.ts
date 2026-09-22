import type { APIRoute } from "astro";
import { claimMemberSlot, inviteExists } from "../../../lib/group-claim";
import { crossOriginPostForbidden, isSameOriginRequest } from "../../../lib/same-origin";
import {
  notFound,
  resolveInvite,
  serviceUnavailable,
  setInviteCookie,
} from "../../../lib/invite-session";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

// Mints a member slot for a group-cookie visitor and rebinds the cookie to it.
//
// AUTHENTICATE FIRST, exactly like POST /api/rsvp and POST /api/guest-photos:
// the cookie is resolved before the body is even read, so anonymous callers get
// the uniform bare 404 regardless of body content and endpoint existence stays
// invisible. The 409s here are only ever reachable by an already-authenticated,
// valid identity — and everything they disclose is already handed to the same
// caller by GET /api/invite/me (design D2).
//
// No metrics are written: a claim is not a link open.
export const POST: APIRoute = async ({ cookies, request }) => {
  const resolution = await resolveInvite(cookies);
  if (resolution.status === "not_found") return notFound();
  if (resolution.status === "error") return serviceUnavailable();

  // THE origin check for this endpoint — not defence in depth. Astro's framework
  // `checkOrigin` is disabled repo-wide (see lib/same-origin.ts and
  // astro.config.mjs), so nothing else inspects this request. This endpoint mints
  // rows against a scarce quota, which is why the call sits before any body
  // parsing. PROXY-AWARE on purpose — behind the documented Caddy/HTTPS deployment
  // `request.url` is `http://<host>` while the browser's Origin is `https://<host>`,
  // and a naive comparison would 403 every legitimate claim. Placed AFTER identity
  // resolution and BEFORE any body parsing, so an anonymous caller still gets the
  // uniform bare 404 (endpoint-invisibility rule).
  if (!isSameOriginRequest(request)) {
    return crossOriginPostForbidden();
  }

  const { invite } = resolution;

  // A standalone individual has no slots to hand out.
  if (invite.kind === "individual") return json(409, { error: "not_a_group" });

  // Already claimed: idempotent, and the body is deliberately never read — no
  // name is taken from the request and the cookie is left exactly as it is.
  if (invite.kind === "member") {
    return json(200, { displayName: invite.displayName, kind: "member" });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const displayName =
    typeof (payload as { displayName?: unknown })?.displayName === "string"
      ? (payload as { displayName: string }).displayName.trim()
      : "";
  if (!displayName) return json(400, { error: "display_name_required" });
  if (displayName.length > 120) return json(400, { error: "display_name_too_long" });

  const result = await claimMemberSlot({ id: invite.id }, displayName, Date.now());

  if (result.status === "unavailable") return serviceUnavailable();

  if (result.status === "no_slot") {
    // Zero rows inserted means quota full OR the group vanished between
    // resolution and insert. Re-check so the two are never conflated: only a
    // group that still exists may be reported as full (design D3).
    const exists = await inviteExists(invite.id);
    if (exists !== true) return serviceUnavailable();
    return json(409, { error: "group_full" });
  }

  // Rebind to the member id with the SAME attribute set the link redirect uses
  // (one source of truth in invite-session), so the visitor holds an ordinary
  // individual-grade identity from here on.
  setInviteCookie(cookies, result.id);

  return json(201, { displayName: result.displayName, kind: "member" });
};
