# Operations: invitations, RSVP, and guest photos

The Node application, SQLite database, and guest-upload directory belong to one deployment. Public family images under `apps/web/public/` are separate and must never be included in a guest-data reset.

## Explicit targets

Use one shared service/cron environment. Scripts no longer guess database or photo paths:

```sh
DATABASE_URL=file:/srv/wedding/local.db
PHOTO_STORAGE_DIR=/srv/wedding/photos
BACKUP_DEST=/mnt/backup/wedding
```

These are examples: verify the actual application's configuration first. Backup/restore scripts support only absolute local `file:` URLs, not remote libSQL databases. The application can use remote libSQL with `DATABASE_AUTH_TOKEN`, but remote backup, reset, and migration authorization require provider-specific procedures.

Tables: `invites`, `rsvps`, `guest_photos`. Upload files:

```text
photos/guest-photos/<12-character-photo-id>/photo.webp  # required canonical
photos/guest-photos/<12-character-photo-id>/photo.avif  # optional derived variant
```

The canonical is orientation-corrected, capped at a 2048-pixel long edge without enlargement, and stripped of EXIF/XMP/IPTC. WebP quality is 80; already optimal safe WebP can pass through. JPEG, PNG, and AVIF uploads are converted to WebP. Originals, thumbnails, story groups, and position files are not stored.

## Fresh installation versus an existing environment

The generated initial migration and its metadata replace the old history. **This baseline cannot upgrade an initialized legacy database.** The guarded `db:migrate` command refuses old tables or incompatible migration hashes. Never use `db:push` to bypass that refusal.

For an approved empty target, create its parent and empty storage directory, export absolute paths, and run `pnpm run db:migrate` before starting the matching build. Running the command again on that matching baseline is a no-op. A fresh empty photo collection uses the public family starter images; they are never inserted as guest uploads.

### Separately authorized replacement

1. Identify exact database, sidecar, storage, service, and backup paths. Confirm who owns the existing records and whether they are disposable. No approval of source cleanup implicitly authorizes a database reset.
2. If any real data must survive, stop this procedure and design a forward/data-conversion migration instead.
3. Stop application writers and background AVIF work. Verify they have stopped. Do not unlink an active SQLite WAL/SHM or manipulate a running upload tree.
4. Preserve the prior code, migration metadata, database **with its WAL/SHM state**, and upload tree as one rollback set. Use SQLite's backup API for a consistent database snapshot; never copy only the main file while writers are active.
5. Prefer a different, new empty database path and a new empty upload root. Point the service and cron at these explicit targets only after authorization, migrate, then start the matching new build.
6. Verify invite creation/link binding, RSVP count/upsert, one accepted upload, public delivery, duplicate rejection, and a quiescent backup/restore drill.

Rollback means stopping writers and restoring the matching previous code/database/migration ledger/upload tree together. Never restore only one half or run old code on the new baseline. There is no automatic startup reset, conversion, or live orphan deletion.

## AVIF and caching

AVIF is optional background work: concurrency 1, bounded queue depth 64, deduplicated while pending/in-flight. `PHOTO_AVIF_ENABLED=false` disables generation but does not disable serving an existing variant. Missing variants fall back to WebP; AVIF-capable GETs requeue missing work after restart or a full queue. Failed encodes are logged and not retried again in that process.

Watch `[avif-queue] variant failed` and `depth cap 64 reached`. A variant failure never deletes an accepted canonical. Disk planning should include both files; codec ratios and CPU costs depend on images and hardware.

Successful file responses are `public, max-age=31536000, immutable` with `Vary: Accept`. Only explicit nonzero `image/avif` acceptance selects AVIF; wildcards alone do not. Collection/upload responses and missing files are `no-store`.

**Do not configure an image cache that ignores `Vary: Accept`.** In particular, a free Cloudflare cache rule can serve AVIF to incompatible browsers. Keep the route uncached at such a proxy or use a verified format-aware cache configuration. Caddy without image caching is suitable.

## Backups

Install scripts at `/srv/wedding/ops/`. Supply the same environment as the application:

```cron
17 3 * * * DATABASE_URL=file:/srv/wedding/local.db PHOTO_STORAGE_DIR=/srv/wedding/photos BACKUP_DEST=/mnt/backup/wedding /srv/wedding/ops/backup.sh >> /var/log/wedding-backup.log 2>&1
```

`backup.sh` takes a SQLite `.backup`, checks integrity, copies the whole guest-photo tree excluding `*.part`, incrementally syncs to a dated backup using hardlinks, and retains the latest 30 backup trees. Canonical and AVIF files are both included. Its normalized snapshot name is `db/local.db` regardless of the source filename; source selection always comes from `DATABASE_URL`. Monitor nonzero exits and `FATAL:` logs.

Database snapshots and filesystem copies are not a cross-resource transaction. A live backup can include an unreferenced in-flight directory or miss a concurrent moderation change. Use a quiescent source for strict comparison and final backups.

## Restore drill

```sh
DATABASE_URL=file:/absolute/quiescent-source.db \
PHOTO_STORAGE_DIR=/absolute/quiescent-source-photos \
./ops/restore-drill.sh /absolute/backup-tree
```

Alternatively set `BACKUP_DEST` to select its newest dated tree. The drill copies the snapshot to scratch, opens source/restore databases read-only, verifies integrity and foreign keys, queries all three required tables, and compares file checksums excluding partials. It also checks every canonical key points to a backed-up file.

Missing tables, SQL failures on either side, missing canonical files, or checksum differences **fail**, never compare as matching `n/a`. Compare to a source matching the backup, not a live database that has legitimately advanced since it was taken. The drill verifies but does not replace any environment.

## Moderation and offline recovery

See [MODERATION.md](MODERATION.md). Deleting a photo releases that invitation's posting slot; deleting an invitation is not a safe ban mechanism. Any orphan reconciliation requires stopped writers/AVIF jobs and explicit review, not automatic age-based deletion.

## Deployment checks still pending

The earlier `photo-normalization` change's production check is carried forward: after a separately authorized deployment, verify `PHOTO_AVIF_ENABLED` and one real `PHOTO_STORAGE_DIR/guest-photos/<photo-id>/` containing `photo.webp` and `photo.avif`. Temporary test fixtures do not prove production configuration. Recheck `Vary: Accept` behavior before adding any edge cache.

Keep a final database/photo backup off-host before the hosting subscription expires. A provider's recycle-bin grace period is not a backup.
