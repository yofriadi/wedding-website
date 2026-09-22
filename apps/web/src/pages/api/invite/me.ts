import type { APIRoute } from "astro";
import { notFound, resolveInvite, serviceUnavailable } from "../../../lib/invite-session";

export const GET: APIRoute = async ({ cookies }) => {
  const resolution = await resolveInvite(cookies);
  if (resolution.status === "not_found") return notFound();
  if (resolution.status === "error") return serviceUnavailable();

  const { invite } = resolution;
  // `group` is present for group identities ONLY — individual and member
  // responses must not carry the key at all (invite-session spec).
  const body = invite.group
    ? { displayName: invite.displayName, kind: invite.kind, group: invite.group }
    : { displayName: invite.displayName, kind: invite.kind };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
};
