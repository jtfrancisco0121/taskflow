#!/usr/bin/env bash
# Prints the gzip size of the frontend build (sum of dist/assets/*) for this branch and for its merge-base
# with main, and the delta, as a Markdown line for a PR body. The base is built in a temporary git worktree
# (npm ci there needs the network and a few minutes) that is always removed again; the main tree is never
# checked out. Usage: bash scripts/bundle-size.sh [base-ref]   (default: main)
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
base_ref="${1:-main}"
tmp=""

cleanup() {
  if [ -n "$tmp" ]; then
    git -C "$root" worktree remove --force "$tmp/base" 2>/dev/null || true
    rm -rf "$tmp"
  fi
  git -C "$root" worktree prune
}
trap cleanup EXIT

gzip_bytes() { # <frontend dir>: the gzip size of every file under dist/assets
  local total=0 size f
  while IFS= read -r -d '' f; do
    size="$(gzip -9 -c "$f" | wc -c | tr -d ' ')"
    total=$((total + size))
  done < <(find "$1/dist/assets" -type f -print0)
  echo "$total"
}

kib() { awk -v b="$1" 'BEGIN { printf "%.1f", b / 1024 }'; }

merge_base="$(git -C "$root" merge-base HEAD "$base_ref")"

echo "bundle-size: building the branch ($(git -C "$root" rev-parse --short HEAD))" >&2
(cd "$root/frontend" && npm run build >/dev/null)
branch_bytes="$(gzip_bytes "$root/frontend")"

tmp="$(mktemp -d)"
echo "bundle-size: building the merge-base ($(git -C "$root" rev-parse --short "$merge_base")) in a temporary worktree" >&2
git -C "$root" worktree add --detach "$tmp/base" "$merge_base" >/dev/null 2>&1
(cd "$tmp/base/frontend" && npm ci >/dev/null 2>&1 && npm run build >/dev/null)
base_bytes="$(gzip_bytes "$tmp/base/frontend")"

delta=$((branch_bytes - base_bytes))
sign=""
[ "$delta" -gt 0 ] && sign="+"
echo "branch: $(kib "$branch_bytes") KiB gzip"
echo "merge-base: $(kib "$base_bytes") KiB gzip"
echo "Bundle size (gzip, dist/assets): $(kib "$base_bytes") KiB -> $(kib "$branch_bytes") KiB (${sign}$(kib "$delta") KiB)"
