#!/usr/bin/env bash
# Assert that every protected private-media path still holds its PLACEHOLDER
# blob rather than the real media that tools/restore-private-media.sh overlays
# locally. See tools/media-placeholders.lock for why this guard exists.
#
# skip-worktree hides the real files from `git status`, but it is a caching
# hint that git porcelain clears routinely — and once cleared, ~5 MB of private
# media is one `git commit -a` away from a public repository's history. This
# script is the boundary that does not depend on that hint being intact.
#
# Usage:
#   tools/assert-placeholders.sh            # check the HEAD tree (CI)
#   tools/assert-placeholders.sh --staged   # check the index (pre-commit hook)
#   tools/assert-placeholders.sh --update   # regenerate the lock from HEAD
set -euo pipefail
cd "$(dirname "$0")/.."

LOCK="tools/media-placeholders.lock"
PRIV="originals/private-media/apps/web/public"

mode="tree"
case "${1:-}" in
  "") ;;
  --staged) mode="staged" ;;
  --update) mode="update" ;;
  -h | --help) sed -n '2,17p' "$0"; exit 0 ;;
  *)
    echo "usage: $0 [--staged|--update]" >&2
    exit 2
    ;;
esac

if [ ! -f "$LOCK" ]; then
  echo "assert-placeholders: missing $LOCK" >&2
  exit 2
fi

# Paths and SHAs, comments stripped.
entries() { grep -v '^[[:space:]]*#' "$LOCK" | grep -v '^[[:space:]]*$'; }

# --- regenerate -------------------------------------------------------------
if [ "$mode" = update ]; then
  tmp="$(mktemp)"
  grep '^[[:space:]]*#' "$LOCK" >"$tmp"
  # The path set comes from the EXISTING lock, never from the live
  # skip-worktree flags: those flags are precisely what gets cleared in the
  # incident this guard exists for, so deriving the set from them would let
  # --update silently empty the allowlist and disable the check.
  dropped=0
  while read -r _ path; do
    [ -n "${path:-}" ] || continue
    if sha="$(git rev-parse -q --verify "HEAD:$path" 2>/dev/null)"; then
      printf '%s  %s\n' "$sha" "$path" >>"$tmp"
    else
      echo "  dropped (absent from HEAD): $path" >&2
      dropped=$((dropped + 1))
    fi
  done < <(entries | awk '{print $1, $2}')
  mv "$tmp" "$LOCK"
  echo "assert-placeholders: regenerated $LOCK from HEAD ($(( $(entries | wc -l) )) paths, $dropped dropped)."
  echo "  REVIEW THE DIFF. Blessing a real media blob here defeats the guard."
  exit 0
fi

# --- check ------------------------------------------------------------------
fail=0
checked=0
while read -r want path; do
  [ -n "${path:-}" ] || continue
  checked=$((checked + 1))

  if [ "$mode" = staged ]; then
    got="$(git ls-files -s -- "$path" | awk '{print $2}' | head -1)"
  else
    got="$(git rev-parse -q --verify "HEAD:$path" 2>/dev/null || true)"
  fi

  # Absent from the index/tree means deleted or renamed away. A deletion is not
  # a privacy leak, so it is reported but does not fail the check.
  if [ -z "$got" ]; then
    echo "note: $path has no $([ "$mode" = staged ] && echo index || echo HEAD) entry (deleted?)" >&2
    continue
  fi

  if [ "$got" != "$want" ]; then
    fail=1
    size="$(git cat-file -s "$got" 2>/dev/null || echo '?')"
    want_size="$(git cat-file -s "$want" 2>/dev/null || echo '?')"
    echo "MISMATCH: $path" >&2
    echo "  expected placeholder blob  $want (${want_size} bytes)" >&2
    echo "  found                      $got (${size} bytes)" >&2
  fi
done < <(entries | awk '{print $1, $2}')

# --- coverage ---------------------------------------------------------------
# A private master added to the overlay without a lock entry would escape the
# guard entirely, so cross-check against the overlay when this machine has it.
# Untracked paths (the soundtrack) are skipped: git cannot leak what it does not
# track, and skip-worktree only applies to tracked paths.
if [ -d "$PRIV" ]; then
  listed="$(entries | awk '{print $2}')"
  for f in "$PRIV"/*; do
    [ -e "$f" ] || continue
    rel="apps/web/public/$(basename "$f")"
    git ls-files --error-unmatch "$rel" >/dev/null 2>&1 || continue
    if ! printf '%s\n' "$listed" | grep -Fxq "$rel"; then
      echo "UNLISTED: $rel is overlaid private media but has no entry in $LOCK" >&2
      echo "          run: tools/assert-placeholders.sh --update" >&2
      fail=1
    fi
  done
fi

if [ "$fail" -ne 0 ]; then
  cat >&2 <<'MSG'

assert-placeholders: FAILED.

A protected path holds something other than its committed placeholder. The most
likely cause is that git cleared the `skip-worktree` flags (stash, reset --hard,
checkout across branches, rebase, am, sparse-checkout) so the real private media
became visible, and it was then staged.

  - Do NOT commit this. Unstage the media:
      git restore --staged apps/web/public
  - Re-hide the real files:
      tools/restore-private-media.sh
  - If you genuinely intended to replace a placeholder, that is a deliberate act:
      tools/assert-placeholders.sh --update
    then review the resulting diff before committing it.
MSG
  exit 1
fi

echo "assert-placeholders: OK ($checked protected paths hold their placeholder blobs)."
