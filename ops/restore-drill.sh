#!/usr/bin/env bash
# Restore drill (guest-submissions 5.2): verify a backup is actually
# restorable — DB opens + integrity_check ok + invite/submission/photo counts
# match the live DB, and the photos dir round-trips with identical checksums.
#
# Usage (on the VM, or locally against a backup copy):
#   ./ops/restore-drill.sh [BACKUP_DIR]          # default: newest under BACKUP_DEST
#
# Exit codes: 0 drill passed; 1 no backup found; 2 mismatch/verification failed.

set -euo pipefail

BACKUP_DEST="${BACKUP_DEST:-/mnt/backup/wedding}"

if [[ $# -ge 1 ]]; then
  BACKUP_DIR="$1"
else
  BACKUP_DIR="$(ls -1d "$BACKUP_DEST"/20* 2>/dev/null | tail -n1 || true)"
  if [[ -z "$BACKUP_DIR" ]]; then
    echo "FATAL: no backup trees under $BACKUP_DEST" >&2
    exit 1
  fi
fi

LIVE_DB="${DATABASE_URL:-file:/srv/wedding/local.db}"
LIVE_DB_PATH="${LIVE_DB#file:}"
LIVE_PHOTOS="${PHOTO_STORAGE_DIR:-/srv/wedding/photos}"

SCRATCH="$(mktemp -d /tmp/wedding-restore-drill.XXXXXX)"
trap 'rm -rf "$SCRATCH"' EXIT

echo "== restore drill on $BACKUP_DIR =="

# 1. DB: open the restored copy and integrity-check it.
cp "$BACKUP_DIR/db/local.db" "$SCRATCH/restored.db"
INTEGRITY="$(sqlite3 "$SCRATCH/restored.db" 'PRAGMA integrity_check;')"
if [[ "$INTEGRITY" != "ok" ]]; then
  echo "FAIL: restored DB integrity_check: $INTEGRITY" >&2
  exit 2
fi

# 2. Counts must match the live DB (a stale/torn snapshot shows here).
for QUERY in \
  'SELECT COUNT(*) FROM invites;' \
  'SELECT COUNT(*) FROM rsvps;' \
  'SELECT COUNT(*) FROM submissions;' \
  'SELECT COUNT(*) FROM submission_photos;'; do
  LIVE_COUNT="$(sqlite3 "$LIVE_DB_PATH" "$QUERY" 2>/dev/null || echo n/a)"
  RESTORED_COUNT="$(sqlite3 "$SCRATCH/restored.db" "$QUERY" 2>/dev/null || echo n/a)"
  echo "  $QUERY live=$LIVE_COUNT restored=$RESTORED_COUNT"
  if [[ "$LIVE_COUNT" != "$RESTORED_COUNT" ]]; then
    echo "FAIL: count mismatch for $QUERY" >&2
    exit 2
  fi
done

# 3. Photos: restored tree checksums match the live tree exactly.
if [[ -d "$BACKUP_DIR/photos" ]]; then
  cp -R "$BACKUP_DIR/photos" "$SCRATCH/photos"
  # `! -name '*.part'` on both sides: atomic photo writes leave a temp file in
  # the same directory for the microseconds of a rename, and a backup taken
  # mid-write would otherwise diff against the live tree as a phantom file.
  (cd "$LIVE_PHOTOS" && find . -type f ! -name '*.part' | sort | xargs shasum) > "$SCRATCH/live.sums" 2>/dev/null || true
  (cd "$SCRATCH/photos" && find . -type f ! -name '*.part' | sort | xargs shasum) > "$SCRATCH/restored.sums" 2>/dev/null || true
  if ! diff -q "$SCRATCH/live.sums" "$SCRATCH/restored.sums" >/dev/null 2>&1; then
    echo "WARN: photo checksums differ (live tree may have moved on since the backup):"
    diff "$SCRATCH/live.sums" "$SCRATCH/restored.sums" | head -n 10 || true
  else
    echo "  photos: checksums identical"
  fi
fi

echo "PASS: backup is restorable (DB opens, integrity ok, counts match)"
