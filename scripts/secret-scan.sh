#!/usr/bin/env bash
# Scans the full git history for secrets with gitleaks (config: .gitleaks.toml, optional .gitleaks-baseline.json).
# Uses a gitleaks binary on PATH, else the pinned Docker image. Exit 1 on findings.
# Optional argument: another checkout to scan with this repo's config.
# `--self-test` proves a newly committed secret fails the scan: it builds a throwaway repo inside the
# gitleaks container (never in this checkout), commits a fake AWS key and expects a non-zero exit.
set -euo pipefail

GITLEAKS_IMAGE="ghcr.io/gitleaks/gitleaks:v8.30.0"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "${1:-}" = "--self-test" ]; then
  if docker run --rm --entrypoint sh -v "$here:/here:ro" "$GITLEAKS_IMAGE" -c '
      set -e; mkdir /t; cd /t; git init -q .; git config user.email a@b; git config user.name t
      echo ok > a.txt; git add .; git commit -qm base
      id="AKIA""IOSFODNN7""ABCDEFG"; sec="wJalrXUtnFEMI/K7MDENG""/bPxRfiCYzq9fA2b1cD"
      printf "aws_access_key_id = \"%s\"\naws_secret_access_key = \"%s\"\n" "$id" "$sec" > leak.txt
      git add .; git commit -qm leak
      gitleaks git --config /here/.gitleaks.toml --redact --no-banner --exit-code 1 /t' >/dev/null 2>&1; then
    echo "secret-scan self-test FAILED: a committed secret was not detected" >&2; exit 1
  fi
  echo "secret-scan self-test: a committed secret is detected (scan exits non-zero)"; exit 0
fi
root="$(cd "${1:-$here}" && pwd)"
cd "$root"

if command -v gitleaks >/dev/null 2>&1; then
  args=(git --config "$here/.gitleaks.toml" --redact --no-banner --exit-code 1 --verbose)
  [ -f "$here/.gitleaks-baseline.json" ] && args+=(--baseline-path "$here/.gitleaks-baseline.json")
  gitleaks "${args[@]}" "$root"
else
  command -v docker >/dev/null 2>&1 || { echo "secret-scan: neither gitleaks nor docker is available" >&2; exit 2; }
  args=(git --config /here/.gitleaks.toml --redact --no-banner --exit-code 1 --verbose)
  [ -f "$here/.gitleaks-baseline.json" ] && args+=(--baseline-path /here/.gitleaks-baseline.json)
  # In a git worktree .git is a file pointing into the main checkout: mount the real git dir read-only too.
  common="$(git rev-parse --git-common-dir)"
  case "$common" in /*) ;; *) common="$root/$common" ;; esac
  docker run --rm -v "$here:/here:ro" -v "$root:/repo" -v "$common:$common:ro" -w /repo "$GITLEAKS_IMAGE" "${args[@]}" /repo
fi
echo "secret-scan: clean"
