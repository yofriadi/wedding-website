# Ops runbook — guest submissions

Operational scripts for the guest-submissions change. The VM runs the app
(`apps/web`, Astro + Node adapter), the SQLite DB, and the photos directory.

## Layout on the VM

```
/srv/wedding/
  local.db          # SQLite (DATABASE_URL=file:/srv/wedding/local.db)
  photos/           # PHOTO_STORAGE_DIR; submissions/<id>/<position>.webp plus
                    #   an .avif variant, and thumb.webp/thumb.avif — see
                    #   "Photo formats" below. Uploads are re-encoded on the way
                    #   in; originals are never stored. A `.part` sibling exists
                    #   only for the microseconds of an atomic write.
ops/                # this directory (deployed alongside)
  backup.sh         # nightly: DB snapshot + photos, incremental off-box sync
  restore-drill.sh  # verifies a backup actually restores
  MODERATION.md     # manual removal runbook
```

## Photo formats (photo-normalization)

Uploads are re-encoded on the way in — the guest's original is never stored. Each
submission directory holds:

```
submissions/<id>/0.webp     # canonical: EXIF applied + stripped, long edge <= 2048px, q80
submissions/<id>/0.avif     # variant, written AFTER the 201 by an in-process queue
submissions/<id>/thumb.webp # 224x400 rail cover
submissions/<id>/thumb.avif
```

`GET /api/photos/<key>` serves the `.avif` variant only when the request's
`Accept` explicitly lists `image/avif`; everyone else (including iOS <= 15, which
has no AVIF decoder) gets the WebP from the same URL. Successes carry
`Vary: Accept` alongside the existing `immutable` year-long `Cache-Control`.

Operations notes:

- **CPU**: the request path pays ~0.4s/photo for the WebP; the AVIF encode
  (~1.4s/photo on an M1, expect 2-4x on this VM) runs afterwards at concurrency
  1, so a burst of uploads queues rather than saturates. Two journal lines to
  know: `[avif-queue] variant failed` (logged, non-fatal — the WebP keeps
  serving) and `[avif-queue] depth cap 64 reached, dropping variant job`, which
  is the one signal that the host cannot keep up. A dropped job is not lost: the
  photo route re-enqueues it on the next AVIF-capable request for that photo.
- **Kill switch**: `PHOTO_AVIF_ENABLED=false` stops variant generation without a
  deploy; existing variants keep being served.
- **Do not put `/api/photos/*` behind a free Cloudflare cache rule.** Cloudflare's
  free plan ignores `Vary: Accept` for images, so one visitor's cached AVIF would
  be served to a browser that cannot decode it — a broken image, not a fallback.
  Caddy in front (no image caching) is correct as-is.
- **Backups**: `backup.sh` copies the whole photos tree, so variants are
  included, and both backup and restore-drill exclude `*.part` — the temp file
  an atomic photo write renames into place. Variants are derived data: if a
  restore ever lands without them, the route regenerates a variant on the next
  AVIF-capable request.
- **Disk**: budget ~1.4x the canonical bytes per photo for the variant. A
  submission that would have been 8MB of PNG is now ~0.4MB of WebP + ~0.3MB of
  AVIF, so the nightly tree gets much smaller, not larger.

## Nightly backup (guest-submissions 5.1)

Cron, as the service account:

```
17 3 * * *  DATABASE_URL=file:/srv/wedding/local.db PHOTO_STORAGE_DIR=/srv/wedding/photos BACKUP_DEST=/mnt/backup/wedding /srv/wedding/ops/backup.sh >> /var/log/wedding-backup.log 2>&1
```

What it does:

1. `sqlite3 .backup` — a consistent snapshot of a live DB (a raw `cp` of a
   database with an active writer can capture a torn page).
2. Integrity-checks the snapshot (`PRAGMA integrity_check`).
3. Copies the photos tree into the dated backup.
4. `rsync --link-dest=<previous nightly>` into
   `$BACKUP_DEST/<UTC timestamp>/` — unchanged photo files are HARDLINKS,
   so the nightly transfer is delta-only. 1–3GB of photos costs kilobytes of
   egress per night after the first full copy.
5. Prunes trees older than 30 days.

Failure notification: the log line `FATAL:` (and a non-zero exit) — hook to
whatever monitoring exists (a simple `grep FATAL /var/log/wedding-backup.log`
mail via cron output is enough at this scale).

## Restore drill (5.2)

Run before the wedding (once the backup has accumulated at least one tree),
and once more in the final-archive window:

```
BACKUP_DEST=/mnt/backup/wedding ./ops/restore-drill.sh
```

It restores DB + photos to a scratch dir and verifies: the DB opens,
`integrity_check` is ok, row counts match live, photo checksums match. An
untested backup isn't one.

## Decision point: ~Oct 1 — renew or archive

The VM expires **Oct 18**; the recycle-bin grace runs out **~Nov 2**. Around
**Oct 1**, decide:

- **Renew the VM** for another term (cost: the current VM's monthly rate,
  owner: whoever holds the provider account), or
- **Archive to a static memorial** (Cloudflare Pages, free): export the final
  wishes/photos into static HTML during the last week and publish.

Either way, run the final archive (backup.sh + restore-drill.sh) **before
Oct 18**. The grace window is a backstop, not the plan.

## Final archive (before Oct 18)

1. `./ops/backup.sh` one last time.
2. `./ops/restore-drill.sh` — verify.
3. Copy `$BACKUP_DEST` (the whole tree) somewhere durable: the couple's
   laptop, plus object storage if available. This is the memorial: the DB has
   every wish; the photos dir has every photo.
