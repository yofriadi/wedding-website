import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { invites } from "./invites";

// One accepted photo per invitation. Files are complete before a row is published.
export const guestPhotos = sqliteTable(
  "guest_photos",
  {
    id: text("id").primaryKey().notNull(),
    inviteId: text("invite_id")
      .notNull()
      .unique()
      .references(() => invites.id),
    key: text("key").notNull().unique(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("guest_photos_created_at_id_idx").on(table.createdAt, table.id)],
);
