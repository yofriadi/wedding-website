# Guest-photo moderation and offline reconciliation

Photos are public. Each invitation can own one `guest_photos` row. Invitation display names remain private to invitation/admin features, not photo labels.

A **group member** is an ordinary `invites` row with a `parent_id`, so it owns its own photo slot and is moderated exactly like a standalone invitation. The group row itself never owns a photo. Find a member's group with `SELECT id, display_name, parent_id, type FROM invites WHERE id = :invite_id;` — and treat those ids as private invitation access data, like every other `invite_id` below.

## Remove one photo

1. Confirm the exact database and `PHOTO_STORAGE_DIR` from the running service. Take a matched database/photo backup. Stop application writers and all AVIF jobs before manual filesystem changes.
2. Inspect the chosen photo using a read-only connection:

   ```sql
   SELECT id, invite_id, key, created_at FROM guest_photos ORDER BY created_at DESC, id DESC;
   ```

   Treat `invite_id` as private invitation access data. Do not paste it into public logs or issue trackers.

3. After confirming the exact row, use a bound parameter and foreign keys enabled to delete only that photo, in a transaction:

   ```sql
   PRAGMA foreign_keys=ON;
   BEGIN IMMEDIATE;
   DELETE FROM guest_photos WHERE id = :reviewed_photo_id;
   COMMIT;
   ```

   `:reviewed_photo_id` is an operator-bound value, not a command to run literally. Verify exactly one row changed. Never disable foreign keys to force a deletion.

4. Remove or quarantine only `PHOTO_STORAGE_DIR/guest-photos/<reviewed-photo-id>/`. Validate the 12-character URL-safe ID and that the resolved directory stays under the configured root. Do not touch `apps/web/public/` or other upload directories. Restart only after database/filesystem handling is complete.

Deleting the row frees that invitation's unique upload slot, so it can post again — for a group member, that frees only _their_ slot, and the group's `claimedCount` is unchanged because the member row still exists.

**Do not delete the invitation as a ban**: dependent RSVP/photo foreign keys and shared-link semantics require a separate policy. No moderation API or ban feature is implemented. Two group-specific consequences of that rule:

- Deleting a group that still has member rows **fails** on the `invites.parent_id` self-foreign key (with foreign keys enabled). This is a backstop, not a procedure — never disable foreign keys to force it, and never delete the members first to work around it.
- Removing a member row **fails** on the `rsvps`/`guest_photos` foreign keys as soon as that member has an RSVP or a photo — the same no-action protection that stops a group being deleted out from under its members. Even for a member with neither, removing the row releases that person's slot irreversibly, and it is _not_ how a double-claim is cleaned up. Double-claims from one person using several browsers are expected under cookie identity: they are visible in the admin list's per-group `members[]` breakdown and bounded by `max_members`. Do not hand-delete rows to resolve them — design an explicit, reviewed slot-release procedure first. One known cause deserves that procedure: a transient storage failure can leave a claim committed without its browser ever receiving the `Set-Cookie`, and the guest's retry then consumes a second slot (recorded as a residual risk in `openspec/changes/group-invitations/handoff.md`).

Browser/CDN caches can keep already-served immutable photos; local removal does not remotely revoke them. Backups also retain removed content until their retention policy expires. Account for both if removal is privacy-sensitive.

## Offline orphan reconciliation

The upload pipeline completes a file before publishing its row. A crash between those steps, an uncertain database commit, or cleanup failure may leave a directory that requires review.

1. Stop all application/variant writers and record the exact database/storage targets. Take a backup before changing anything.
2. Read `id, key` from `guest_photos` and inventory immediate `guest-photos/<id>/` directories. Never run this against public family assets.
3. Check that each row has canonical key `guest-photos/<id>/photo.webp` and that the file exists. A missing referenced canonical is data loss: investigate/restore it rather than silently deleting its row. A missing AVIF is not data loss; it can be regenerated later.
4. Compute directory IDs absent from the complete database row set. Validate key containment and investigate each against logs for unresolved publication. With remote replication or uncertain read freshness, do not assume an absent row is authoritative.
5. Produce a dry-run inventory first. Quarantine only separately approved, proven-unreferenced directories with writers still stopped. Do not perform automatic live or age-based cleanup. Stale `*.part` files are unpublished; review them offline too, and preserve any still needed for incident analysis.
6. Recheck foreign keys/integrity and canonical references, then restart. Keep the quarantine until its retention decision is approved.

No SQL or filesystem cleanup script is automatically run during application startup, tests, migration, or proposal generation.
