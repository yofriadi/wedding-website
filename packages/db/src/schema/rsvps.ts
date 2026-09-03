import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { invites } from "./invites";

// NOTE: the FK is documentation-only until PRAGMA foreign_keys is enabled
// (tracked in guest-submissions); integrity is enforced at the API layer.
export const rsvps = sqliteTable(
  "rsvps",
  {
    inviteId: text("invite_id")
      .primaryKey()
      .references(() => invites.id),
    attending: integer("attending", { mode: "boolean" }).notNull(),
    partySize: integer("party_size").notNull(),
    respondedAt: integer("responded_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("rsvps_attending_idx").on(table.attending)],
);
