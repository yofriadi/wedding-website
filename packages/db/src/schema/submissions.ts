import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { invites } from "./invites";

// One submission per invite (UNIQUE invite_id) — post-once is enforced entirely
// by this constraint. No display_name is copied here: story attribution
// (story-rail-attribution D3) is DERIVED at read time by joining invite_id to
// invites.display_name — no snapshot column, so an admin rename propagates to
// the wall and neither a migration nor a dual-write is needed. The caller's
// own submission is still identified via the session (`mine`), never by a
// name on the wish marquee (wishes stay author-free).
export const submissions = sqliteTable(
  "submissions",
  {
    id: text("id").primaryKey(),
    inviteId: text("invite_id")
      .notNull()
      .unique()
      .references(() => invites.id),
    wishText: text("wish_text"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("submissions_created_at_idx").on(table.createdAt)],
);

// Photo rows for a submission; `key` is the server-generated storage key
// (`submissions/<submission-id>/<position>.<ext>`), never a client filename.
export const submissionPhotos = sqliteTable(
  "submission_photos",
  {
    id: text("id").primaryKey(),
    submissionId: text("submission_id")
      .notNull()
      .references(() => submissions.id),
    key: text("key").notNull(),
    position: integer("position").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("submission_photos_submission_id_position_unique").on(
      table.submissionId,
      table.position,
    ),
    index("submission_photos_submission_id_idx").on(table.submissionId),
  ],
);
