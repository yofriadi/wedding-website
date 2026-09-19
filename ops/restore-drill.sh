#!/usr/bin/env bash
# Compare a backup to its quiescent source. Never open the source writable.
# Usage: DATABASE_URL=file:/absolute/db PHOTO_STORAGE_DIR=/absolute/photos \
#        ./ops/restore-drill.sh /absolute/backup-tree
set -euo pipefail
: "${DATABASE_URL:?Set the application's absolute file: URL}"
: "${PHOTO_STORAGE_DIR:?Set the application's absolute photo root}"
case "$DATABASE_URL" in file:/*) ;; *) echo 'FAIL: absolute local file: URL required' >&2; exit 1;; esac
case "$PHOTO_STORAGE_DIR" in /*) ;; *) echo 'FAIL: absolute photo root required' >&2; exit 1;; esac
LIVE_DB_PATH="${DATABASE_URL#file:}"
if [[ $# -ge 1 ]]; then
  BACKUP_DIR="$1"
else
  : "${BACKUP_DEST:?Set BACKUP_DEST or pass a backup directory}"
  BACKUP_DIR="$(ls -1d "$BACKUP_DEST"/20* 2>/dev/null | tail -n1 || true)"
fi
if [[ ! -f "$LIVE_DB_PATH" || ! -f "$BACKUP_DIR/db/local.db" || ! -d "$PHOTO_STORAGE_DIR" || ! -d "$BACKUP_DIR/photos" ]]; then
  echo 'FAIL: source or backup database/photo directory is missing' >&2
  exit 1
fi
SCRATCH="$(mktemp -d /tmp/wedding-restore-drill.XXXXXX)"
trap 'rm -rf "$SCRATCH"' EXIT
cp "$BACKUP_DIR/db/local.db" "$SCRATCH/restored.db"

for DATABASE in "$LIVE_DB_PATH" "$SCRATCH/restored.db"; do
  if ! INTEGRITY="$(sqlite3 -readonly "$DATABASE" 'PRAGMA integrity_check;')" || [[ "$INTEGRITY" != ok ]]; then
    echo 'FAIL: database integrity check failed' >&2; exit 2
  fi
  if ! FOREIGN_KEYS="$(sqlite3 -readonly "$DATABASE" 'PRAGMA foreign_key_check;')" || [[ -n "$FOREIGN_KEYS" ]]; then
    echo 'FAIL: database foreign-key check failed' >&2; exit 2
  fi
done
for TABLE in invites rsvps guest_photos; do
  if ! LIVE_COUNT="$(sqlite3 -readonly "$LIVE_DB_PATH" "SELECT COUNT(*) FROM $TABLE;")"; then
    echo "FAIL: cannot query source $TABLE" >&2; exit 2
  fi
  if ! RESTORED_COUNT="$(sqlite3 -readonly "$SCRATCH/restored.db" "SELECT COUNT(*) FROM $TABLE;")"; then
    echo "FAIL: cannot query restored $TABLE" >&2; exit 2
  fi
  echo "$TABLE: source=$LIVE_COUNT restored=$RESTORED_COUNT"
  if [[ "$LIVE_COUNT" != "$RESTORED_COUNT" ]]; then
    echo "FAIL: $TABLE count mismatch; compare a quiescent source matching this backup" >&2; exit 2
  fi
done

# Compare regular files by relative name and digest, ignoring unpublished partials.
# -exec handles spaces safely and an empty tree produces an empty manifest.
checksums() {
  (cd "$1" && find . -type f ! -name '*.part' -exec shasum -a 256 {} + | LC_ALL=C sort)
}
checksums "$PHOTO_STORAGE_DIR" > "$SCRATCH/source.sums"
checksums "$BACKUP_DIR/photos" > "$SCRATCH/restored.sums"
if ! diff -u "$SCRATCH/source.sums" "$SCRATCH/restored.sums"; then
  echo 'FAIL: photo files differ; source may have advanced since the backup' >&2
  exit 2
fi
# Matching trees could both be missing a required canonical file. Check DB keys too.
if ! sqlite3 -readonly "$SCRATCH/restored.db" 'SELECT key FROM guest_photos;' > "$SCRATCH/keys"; then
  echo 'FAIL: cannot read canonical photo keys' >&2; exit 2
fi
while IFS= read -r KEY; do
  if [[ ! "$KEY" =~ ^guest-photos/[A-Za-z0-9_-]{12}/photo\.webp$ ]] || [[ ! -f "$BACKUP_DIR/photos/$KEY" ]]; then
    echo 'FAIL: invalid or missing referenced canonical photo' >&2; exit 2
  fi
done < "$SCRATCH/keys"
echo 'PASS: database integrity, foreign keys, table counts, referenced photos and checksums verified'
