import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { invites } from "./invites";

// The application enables foreign keys. Keep first-response and latest-change
// timestamps even though the public count exposes no per-invitation history.
export const rsvps = sqliteTable(
  "rsvps",
  {
    inviteId: text("invite_id")
      .primaryKey()
      .references(() => invites.id),
    attending: integer("attending", { mode: "boolean" }).notNull(),
    respondedAt: integer("responded_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("rsvps_attending_idx").on(table.attending)],
);
