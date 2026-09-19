#!/usr/bin/env bash
# Restore the private (real) media from originals/private-media into the
# working tree before building a personal deployment. The public repository
# ships placeholders only — this script overlays the real files back.
#
# Usage: tools/restore-private-media.sh
set -euo pipefail
cd "$(dirname "$0")/.."

src="originals/private-media"
if [ ! -d "$src" ]; then
  echo "error: $src not found — run this on the machine that holds the private media" >&2
  exit 1
fi

cp -v "$src"/apps/web/public/* apps/web/public/

echo "Private media restored. Placeholders are now overlaid with the real photos, video, and soundtrack."
