import { db } from "@wedding-website/db";
import { rsvps } from "@wedding-website/db/schema";
import { sql } from "drizzle-orm";

// Single source for the confirmed-reservation aggregate — used by /api/rsvp/count
// and the RSVP section frontmatter so the COUNT logic exists exactly once.
export async function getConfirmedReservationCount(): Promise<number> {
  const rows = await db
    .select({
      count: sql<number>`count(*)`,
    })
    .from(rsvps)
    .where(sql`${rsvps.attending} = 1`);

  return rows[0]?.count ?? 0;
}
