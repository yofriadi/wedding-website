import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const invites = sqliteTable("invites", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  createdAt: integer("created_at").notNull(),
  seenAt: integer("seen_at"),
  seenCount: integer("seen_count").notNull().default(0),
  openedAt: integer("opened_at"),
  openedCount: integer("opened_count").notNull().default(0),
});
