import type { APIRoute } from "astro";
import { notFound, resolveInvite, serviceUnavailable } from "../../../lib/invite-session";

export const GET: APIRoute = async ({ cookies }) => {
  const resolution = await resolveInvite(cookies);
  if (resolution.status === "not_found") return notFound();
  if (resolution.status === "error") return serviceUnavailable();
  return new Response(JSON.stringify({ displayName: resolution.invite.displayName }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
};
