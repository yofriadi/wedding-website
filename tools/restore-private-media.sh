#!/usr/bin/env bash
# Overlay the private (real) media from originals/private-media back into the
# working tree for local development or a personal deployment, and mark those
# paths skip-worktree so git never sees — let alone commits — the real files.
#
# The public repository ships placeholders only; this keeps local = real.
#
# Usage:
#   tools/restore-private-media.sh          # overlay real media + hide from git
#   tools/restore-private-media.sh --undo   # revert to placeholders + unhide
set -euo pipefail
cd "$(dirname "$0")/.."

src="originals/private-media"
if [ ! -d "$src" ]; then
  echo "error: $src not found — run this on the machine that holds the private media" >&2
  exit 1
fi

undo=0
[ "${1:-}" = "--undo" ] && undo=1
files=("$src"/apps/web/public/*)

if [ "$undo" = 1 ]; then
  for f in "${files[@]}"; do
    rel="apps/web/public/$(basename "$f")"
    git update-index --no-skip-worktree "$rel" 2>/dev/null || true
    git checkout -- "$rel" 2>/dev/null || true
  done
  # Generated variants are derivatives of whatever masters were in place when
  # they were encoded, so after an --undo they are derivatives of the REAL
  # private photos while the tree is supposed to have returned to its public
  # state. `.gitignore` and `.dockerignore` cover git and the build context;
  # neither covers a working tree that `astro dev` is serving from. The forward
  # direction self-heals — `cp` without `-p` resets master mtimes, so
  # `isFresh()` invalidates every placeholder-derived variant — but --undo has
  # no such trigger.
  rm -rf apps/web/public/generated
  echo "Placeholders restored; git watches those paths again."
  echo "Removed apps/web/public/generated/ (held derivatives of the real media)."
  echo "Re-run 'pnpm --filter web run media:variants' to regenerate from placeholders."
  exit 0
fi

for f in "${files[@]}"; do
  cp -v "$f" apps/web/public/
done

# Hide the overlaid files from git status/add/commit: the repository keeps
# shipping placeholders at these paths while the working tree holds the real
# media. Untracked files (the soundtrack) are already gitignored — skip-worktree
# only applies to tracked paths, hence the || true.
for f in "${files[@]}"; do
  git update-index --skip-worktree "apps/web/public/$(basename "$f")" 2>/dev/null || true
done

echo "Private media restored and hidden from git (skip-worktree)."
echo "  - 'git status' stays clean; a push can never include the real media."
echo "  - If a pull ever conflicts on these paths: $0 --undo && git pull && $0"
