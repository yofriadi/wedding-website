#!/usr/bin/env bash
# Nightly backup: SQLite DB (via .backup — safe against a live writer) + the
# guest photos directory, then incremental off-box sync.
#
# rsync --link-dest hardlinks unchanged photos instead of uploading them again.
#
# Run on the VM as the service account, nightly via cron:
#   17 3 * * * /srv/wedding/ops/backup.sh >> /var/log/wedding-backup.log 2>&1
#   Export the same explicit database/storage targets as the application.
# Required env:
#   DATABASE_URL      libsql file: URL of the SQLite DB (e.g. file:/srv/wedding/local.db)
#   PHOTO_STORAGE_DIR guest photos root (e.g. /srv/wedding/photos) — must match the app env
#   BACKUP_DEST       rsync destination (object-storage mount, e.g. /mnt/backup/wedding)
#
# Exit codes: 0 ok; 1 bad env; 2 db snapshot failed; 3 rsync failed.

set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the application's absolute file: URL}"
: "${PHOTO_STORAGE_DIR:?Set PHOTO_STORAGE_DIR to the application's absolute upload root}"
: "${BACKUP_DEST:?Set BACKUP_DEST to an absolute backup destination}"
case "$DATABASE_URL" in file:/*) ;; *) echo 'FATAL: local absolute file: URL required' >&2; exit 1;; esac
case "$PHOTO_STORAGE_DIR:$BACKUP_DEST" in /*:/*) ;; *) echo 'FATAL: absolute storage and backup paths required' >&2; exit 1;; esac

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
if ! sqlite3 -readonly "$DB_PATH" ".backup '$DB_SNAPSHOT'"; then
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
# Canonical WebP and optional AVIF files live under guest-photos/<id>/.
# the dated tree below is what rsync turns incremental via --link-dest against
# yesterday's snapshot.
# --exclude='*.part': photo writes are atomic via a temp file in the same
# directory (photo-normalization), so a backup taken mid-write would otherwise
# capture a torn temp that no reader can ever be served.
if [[ -d "$PHOTO_STORAGE_DIR" ]]; then
  mkdir -p "$STAGING_ROOT/photos"
  rsync -a --exclude='*.part' "$PHOTO_STORAGE_DIR/" "$STAGING_ROOT/photos/"
else
  echo "FATAL: photo storage dir missing: $PHOTO_STORAGE_DIR" >&2
  exit 1
fi

# -- Manifest + restore hint ----------------------------------------------------
{
  echo "backup $STAMP"
  echo "db: db/local.db"
  echo "photos: photos/"
  echo "restore: see ops/README.md and ops/restore-drill.sh"
} > "$STAGING_ROOT/MANIFEST.txt"

# -- Off-box sync: dated tree, hardlinked against the previous ------------------
DEST_ROOT="$BACKUP_DEST"
mkdir -p "$DEST_ROOT"

BACKUP_TREES=()
shopt -s nullglob
for TREE in "$DEST_ROOT"/20*; do
  [[ -d "$TREE" && ! -L "$TREE" ]] && BACKUP_TREES+=("$TREE")
done
LINK_DEST_ARG=""
if [[ ${#BACKUP_TREES[@]} -gt 0 ]]; then
  LINK_DEST_ARG="--link-dest=${BACKUP_TREES[${#BACKUP_TREES[@]}-1]}"
fi

# Exclude transient SQLite sidecars in the staging snapshot.
if ! rsync -a --delete-excluded --exclude='local.db-shm' --exclude='local.db-wal' ${LINK_DEST_ARG:+"$LINK_DEST_ARG"} "$STAGING_ROOT/" "$DEST_ROOT/$STAMP/"; then
  echo "FATAL: rsync to $DEST_ROOT failed" >&2
  exit 3
fi

# Keep 30 dated backup trees; quote each path instead of splitting with xargs.
BACKUP_TREES=()
for TREE in "$DEST_ROOT"/20*; do
  [[ -d "$TREE" && ! -L "$TREE" ]] && BACKUP_TREES+=("$TREE")
done
PRUNE_COUNT=$((${#BACKUP_TREES[@]} - 30))
for ((i=0; i<PRUNE_COUNT; i++)); do
  rm -rf -- "${BACKUP_TREES[$i]}"
done

echo "OK: backup $STAMP (db + photos) → $DEST_ROOT/$STAMP"
