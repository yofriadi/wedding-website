import { db } from "@wedding-website/db";
import { rsvps } from "@wedding-website/db/schema";
import { sql } from "drizzle-orm";

// Single source for the confirmed-guest aggregate — used by /api/rsvp/count
// and the RSVP section frontmatter so the SUM logic exists exactly once.
// SQLite SUM over zero rows is NULL; coalesce to 0.
export async function getConfirmedGuestCount(): Promise<number> {
  const rows = await db
    .select({
      count: sql<number>`coalesce(sum(${rsvps.partySize}), 0)`,
    })
    .from(rsvps)
    .where(sql`${rsvps.attending} = 1`);

  return rows[0]?.count ?? 0;
}
