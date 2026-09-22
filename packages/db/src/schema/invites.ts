import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// Row taxonomy is derived, never stored as a third `type` value:
//   group                = type 'group'   (+ non-null max_members)
//   member               = type 'individual' + non-null parent_id
//   standalone individual = type 'individual' + null parent_id
// The CHECK constraints below pin exactly that shape, so a member behaves like
// an individual everywhere except claim/admin and `rsvps`/`guest_photos` need no
// group awareness at all.
export const invites = sqliteTable(
  "invites",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    createdAt: integer("created_at").notNull(),
    seenAt: integer("seen_at"),
    seenCount: integer("seen_count").notNull().default(0),
    openedAt: integer("opened_at"),
    openedCount: integer("opened_count").notNull().default(0),
    // Self-FK needs the lazy callback: the table is not bound yet at this point.
    // `PRAGMA foreign_keys=ON` + the default `ON DELETE NO ACTION` make this the
    // mechanical backstop behind the ops rule against deleting invitations — a
    // group row cannot be deleted while member rows reference it.
    parentId: text("parent_id").references((): AnySQLiteColumn => invites.id),
    type: text("type").notNull().default("individual"),
    // Groups only; a group's member count is always derived (COUNT WHERE
    // parent_id = ?) rather than stored, so it can never drift.
    maxMembers: integer("max_members"),
  },
  (table) => [
    index("invites_parent_id_idx").on(table.parentId),
    check("invites_type_chk", sql`${table.type} IN ('individual','group')`),
    check(
      "invites_group_shape_chk",
      sql`(${table.type} = 'group') = (${table.maxMembers} IS NOT NULL)`,
    ),
    check(
      "invites_member_shape_chk",
      sql`${table.parentId} IS NULL OR ${table.type} = 'individual'`,
    ),
    check(
      "invites_max_members_range_chk",
      sql`${table.maxMembers} IS NULL OR ${table.maxMembers} BETWEEN 2 AND 50`,
    ),
  ],
);
