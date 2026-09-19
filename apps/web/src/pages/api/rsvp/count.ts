import type { APIRoute } from "astro";
import { getConfirmedReservationCount } from "../../../lib/rsvp";

// Public aggregate: an integer only — never per-invite data. No cookie
// required; no-store so every poll sees the real total.
export const GET: APIRoute = async () => {
  try {
    const count = await getConfirmedReservationCount();
    return new Response(JSON.stringify({ count }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[rsvp/count] aggregate failed:", err);
    return new Response(null, {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }
};
