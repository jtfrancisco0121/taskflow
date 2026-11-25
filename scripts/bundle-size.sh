#!/usr/bin/env bash
# Prints the size of the frontend build (dist/assets) for this branch and for its merge-base with main, and
# the delta, as a Markdown line for a PR body. "Code" is the sum of the gzip -9 size of every file that is not a
# font; "fonts" is the raw size of the .woff2 / .woff files, reported separately so self-hosted fonts neither
# hide in nor eat the code budget. The base is built in a temporary git worktree (npm ci there needs the network
# and a few minutes) that is always removed again; the main tree is never checked out.
#
# Usage:
#   bash scripts/bundle-size.sh [base-ref]   delta against the merge-base with base-ref (default: main)
#   bash scripts/bundle-size.sh --check      measures the current frontend/dist/assets (run npm run build first)
#                                            and exits 1 when the code size is above the budget in
#                                            frontend/bundle-budget.json: baselineKiB * (1 + maxIncreasePct / 100)
#   bash scripts/bundle-size.sh --self-test  runs --check on a fake dist and budgets: it must fail below the
#                                            measured size and pass at the real budget
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

measure() { # <assets dir>: prints "<code bytes> <font bytes>"
  local code=0 fonts=0 size f
  while IFS= read -r -d '' f; do
    case "$f" in
      *.woff2 | *.woff) fonts=$((fonts + $(wc -c < "$f" | tr -d ' '))) ;;
      *)
        size="$(gzip -9 -c "$f" | wc -c | tr -d ' ')"
        code=$((code + size))
        ;;
    esac
  done < <(find "$1" -type f -print0)
  echo "$code $fonts"
}

kib() { awk -v b="$1" 'BEGIN { printf "%.1f", b / 1024 }'; }

# check <assets dir> <budget file>: prints both sizes and the cap; returns 1 above the cap.
check() {
  local assets="$1" budget="$2" code fonts baseline pct cap_bytes
  [ -d "$assets" ] || { echo "bundle-size: $assets is missing: run npm run build first" >&2; return 2; }
  [ -f "$budget" ] || { echo "bundle-size: $budget is missing" >&2; return 2; }
  read -r code fonts < <(measure "$assets")
  baseline="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).baselineKiB)" "$budget")"
  pct="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).maxIncreasePct)" "$budget")"
  cap_bytes="$(awk -v b="$baseline" -v p="$pct" 'BEGIN { printf "%d", b * 1024 * (1 + p / 100) }')"
  echo "JS/CSS (gzip -9): $(kib "$code") KiB; cap $(kib "$cap_bytes") KiB (baseline $baseline KiB + $pct%)"
  echo "Fonts (raw .woff2/.woff, not in the cap): $(kib "$fonts") KiB"
  if [ "$code" -gt "$cap_bytes" ]; then
    echo "bundle-size: FAIL, the JS/CSS bundle is above the cap" >&2
    return 1
  fi
  echo "bundle-size: ok, the JS/CSS bundle is within the cap"
}

self_test() {
  local dir; dir="$(mktemp -d)"
  trap 'rm -rf "$dir"' RETURN
  mkdir -p "$dir/assets"
  head -c 60000 /dev/urandom > "$dir/assets/app.js"
  head -c 5000 /dev/urandom > "$dir/assets/font.woff2"
  local code fonts
  read -r code fonts < <(measure "$dir/assets")
  [ "$fonts" -eq 5000 ] || { echo "self-test: fonts must be counted raw and apart from code (got $fonts)" >&2; return 1; }
  # a budget the measured size fits (at the real +15%), and one it does not fit (baseline lowered below it)
  awk -v c="$code" 'BEGIN { printf "{ \"baselineKiB\": %.3f, \"maxIncreasePct\": 15 }\n", c / 1024 }' > "$dir/ok.json"
  awk -v c="$code" 'BEGIN { printf "{ \"baselineKiB\": %.3f, \"maxIncreasePct\": 15 }\n", c / 1024 / 2 }' > "$dir/low.json"
  check "$dir/assets" "$dir/ok.json" > /dev/null || { echo "self-test: the real budget must pass" >&2; return 1; }
  if check "$dir/assets" "$dir/low.json" > /dev/null 2>&1; then
    echo "self-test: a lowered budget must fail" >&2
    return 1
  fi
  echo "bundle-size self-test: passes at the real budget, fails with the baseline lowered, fonts counted apart"
}

case "${1:-}" in
  --check)
    check "$root/frontend/dist/assets" "$root/frontend/bundle-budget.json"
    exit $?
    ;;
  --self-test)
    self_test
    exit $?
    ;;
esac

merge_base="$(git -C "$root" merge-base HEAD "$base_ref")"

echo "bundle-size: building the branch ($(git -C "$root" rev-parse --short HEAD))" >&2
(cd "$root/frontend" && npm run build >/dev/null)
read -r branch_code branch_fonts < <(measure "$root/frontend/dist/assets")

tmp="$(mktemp -d)"
echo "bundle-size: building the merge-base ($(git -C "$root" rev-parse --short "$merge_base")) in a temporary worktree" >&2
git -C "$root" worktree add --detach "$tmp/base" "$merge_base" >/dev/null 2>&1
(cd "$tmp/base/frontend" && npm ci >/dev/null 2>&1 && npm run build >/dev/null)
read -r base_code base_fonts < <(measure "$tmp/base/frontend/dist/assets")

delta=$((branch_code - base_code))
sign=""
[ "$delta" -gt 0 ] && sign="+"
echo "branch: $(kib "$branch_code") KiB JS/CSS gzip, $(kib "$branch_fonts") KiB fonts"
echo "merge-base: $(kib "$base_code") KiB JS/CSS gzip, $(kib "$base_fonts") KiB fonts"
echo "Bundle size (JS/CSS gzip, dist/assets): $(kib "$base_code") KiB -> $(kib "$branch_code") KiB (${sign}$(kib "$delta") KiB); fonts (raw, separate): $(kib "$base_fonts") KiB -> $(kib "$branch_fonts") KiB"
