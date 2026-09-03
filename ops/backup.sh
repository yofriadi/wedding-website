#!/usr/bin/env bash
# Nightly backup: SQLite DB (via .backup — safe against a live writer) + the
# guest photos directory, then incremental off-box sync.
#
# Guest-submissions 5.1: extends the DB-only job to the photos dir and makes
# the transfer incremental (rsync --link-dest hardlinks unchanged files, so a
# nightly re-upload costs delta bytes, not 1–3GB of metered egress).
#
# Run on the VM as the service account, nightly via cron:
#   17 3 * * *  /srv/wedding/backup.sh >> /var/log/wedding-backup.log 2>&1
#
# Required env (or edit the defaults below):
#   DATABASE_URL      libsql file: URL of the SQLite DB (e.g. file:/srv/wedding/local.db)
#   PHOTO_STORAGE_DIR guest photos root (e.g. /srv/wedding/photos) — must match the app env
#   BACKUP_DEST       rsync destination (object-storage mount, e.g. /mnt/backup/wedding)
#
# Exit codes: 0 ok; 1 bad env; 2 db snapshot failed; 3 rsync failed.

set -euo pipefail

DATABASE_URL="${DATABASE_URL:-file:/srv/wedding/local.db}"
PHOTO_STORAGE_DIR="${PHOTO_STORAGE_DIR:-/srv/wedding/photos}"
BACKUP_DEST="${BACKUP_DEST:-/mnt/backup/wedding}"

STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
STAGING_ROOT="$(mktemp -d /tmp/wedding-backup.XXXXXX)"
trap 'rm -rf "$STAGING_ROOT"' EXIT

# -- DB: sqlite3 .backup -------------------------------------------------------
# A raw file copy of a live SQLite DB can capture a torn write; .backup takes
# a consistent snapshot while the app keeps writing.
DB_PATH="${DATABASE_URL#file:}"
if [[ ! -f "$DB_PATH" ]]; then
  echo "FATAL: DB not found at $DB_PATH (DATABASE_URL=$DATABASE_URL)" >&2
  exit 1
fi

DB_SNAPSHOT="$STAGING_ROOT/db/local.db"
mkdir -p "$(dirname "$DB_SNAPSHOT")"
if ! sqlite3 "$DB_PATH" ".backup '$DB_SNAPSHOT'"; then
  echo "FATAL: sqlite3 .backup failed" >&2
  exit 2
fi

# Integrity check on the snapshot itself — an untested backup isn't one.
INTEGRITY="$(sqlite3 "$DB_SNAPSHOT" 'PRAGMA integrity_check;')"
if [[ "$INTEGRITY" != "ok" ]]; then
  echo "FATAL: snapshot failed integrity_check: $INTEGRITY" >&2
  exit 2
fi

# -- Photos: copy into the dated tree -------------------------------------------
# Only canonical photos, AVIF variants and thumbnails under submissions/<id>/;
# the dated tree below is what rsync turns incremental via --link-dest against
# yesterday's snapshot.
# --exclude='*.part': photo writes are atomic via a temp file in the same
# directory (photo-normalization), so a backup taken mid-write would otherwise
# capture a torn temp that no reader can ever be served.
if [[ -d "$PHOTO_STORAGE_DIR" ]]; then
  mkdir -p "$STAGING_ROOT/photos"
  rsync -a --exclude='*.part' "$PHOTO_STORAGE_DIR/" "$STAGING_ROOT/photos/"
else
  echo "WARN: photo storage dir missing: $PHOTO_STORAGE_DIR (photos skipped)" >&2
  mkdir -p "$STAGING_ROOT/photos"
fi

# -- Manifest + restore hint ----------------------------------------------------
{
  echo "backup $STAMP"
  echo "db: db/local.db"
  echo "photos: photos/"
  echo "restore: see ops/RESTORE.md"
} > "$STAGING_ROOT/MANIFEST.txt"

# -- Off-box sync: dated tree, hardlinked against the previous ------------------
DEST_ROOT="$BACKUP_DEST"
mkdir -p "$DEST_ROOT"

PREVIOUS="$(ls -1d "$DEST_ROOT"/20* 2>/dev/null | tail -n1 || true)"
LINK_DEST_ARG=""
if [[ -n "$PREVIOUS" ]]; then
  LINK_DEST_ARG="--link-dest=$PREVIOUS"
fi

# --exclude: the integrity check opens the snapshot, leaving transient
# SQLite -shm/-wal siblings in staging; they must not land in the backup.
if ! rsync -a --delete-excluded   --exclude='local.db-shm' --exclude='local.db-wal'   ${LINK_DEST_ARG:+"$LINK_DEST_ARG"} "$STAGING_ROOT/" "$DEST_ROOT/$STAMP/"; then
  echo "FATAL: rsync to $DEST_ROOT failed" >&2
  exit 3
fi

# Keep the last 30 nightly trees (hardlinks make them cheap); prune older.
# (head -n -30 is GNU-only; count the survivors instead.)
PRUNE_LIST="$(ls -1d "$DEST_ROOT"/20* 2>/dev/null || true)"
TREE_COUNT="$(printf '%s
' "$PRUNE_LIST" | grep -c . || true)"
if [[ "$TREE_COUNT" -gt 30 ]]; then
  printf '%s
' "$PRUNE_LIST" | head -n $((TREE_COUNT - 30)) | xargs rm -rf
fi

echo "OK: backup $STAMP (db + photos) → $DEST_ROOT/$STAMP"
