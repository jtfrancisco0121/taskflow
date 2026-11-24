#!/usr/bin/env bash
# Runs the Playwright suite against the local stack, like the CI `e2e` job (GitHub Actions is not the only gate).
# Starts the infrastructure, reuses a backend already answering on :8080 (else starts the dev profile and
# stops it again on exit), and saves screenshots into the git-ignored artifacts/screenshots
# (E2E_SCREENSHOTS_DIR); to refresh the committed docs/screenshots on purpose, set E2E_SCREENSHOTS_DIR=docs/screenshots.
# Extra arguments go to Playwright, for example: bash scripts/e2e-local.sh e2e/fields-manager.spec.ts
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
api="${E2E_API_URL:-http://localhost:8080}"
backend_pid=""

cleanup() {
  if [ -n "$backend_pid" ]; then
    # spring-boot:run forks the application: stop the whole process group we started.
    kill -- "-$backend_pid" 2>/dev/null || kill "$backend_pid" 2>/dev/null || true
    wait "$backend_pid" 2>/dev/null || true
    echo "e2e-local: stopped the backend it started"
  fi
}
trap cleanup EXIT

# Postgres and Redis often already run on this machine: when a default port is taken by something that is
# not this Compose project, publish ours on default+10000 and point the backend we start at it.
compose=(docker compose -f "$root/deploy/compose.yaml")
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
pick_port() { # <service> <container port> <default host port>: keep the port our own container already uses
  local own; own="$("${compose[@]}" port "$1" "$2" 2>/dev/null | sed 's/.*://' || true)"
  if [ -n "$own" ]; then echo "$own"; elif port_busy "$3"; then echo $(($3 + 10000)); else echo "$3"; fi
}
POSTGRES_PORT="${POSTGRES_PORT:-$(pick_port postgres 5432 5432)}"
REDIS_PORT="${REDIS_PORT:-$(pick_port redis 6379 6379)}"
export POSTGRES_PORT="${POSTGRES_PORT:-5432}" REDIS_PORT="${REDIS_PORT:-6379}"
"${compose[@]}" up -d --wait --wait-timeout 180

if curl -fsS "$api/api/v1/meta" >/dev/null 2>&1; then
  echo "e2e-local: reusing the backend already answering on $api"
else
  mkdir -p "$root/backend/target"
  cd "$root/backend"
  # set -m gives the background job its own process group so cleanup can stop the forked JVM too.
  set -m
  TASKFLOW_DB_URL="${TASKFLOW_DB_URL:-jdbc:postgresql://localhost:$POSTGRES_PORT/taskflow}" \
    TASKFLOW_REDIS_PORT="${TASKFLOW_REDIS_PORT:-$REDIS_PORT}" \
    SPRING_PROFILES_ACTIVE=dev nohup ./mvnw -B spring-boot:run > target/e2e-backend.log 2>&1 &
  backend_pid=$!
  set +m
  for _ in $(seq 1 90); do
    curl -fsS "$api/api/v1/meta" >/dev/null 2>&1 && break
    kill -0 "$backend_pid" 2>/dev/null || { tail -n 100 target/e2e-backend.log; echo "e2e-local: the backend exited" >&2; exit 1; }
    sleep 2
  done
  curl -fsS "$api/api/v1/meta" >/dev/null 2>&1 || { tail -n 100 target/e2e-backend.log; echo "e2e-local: the backend did not start" >&2; exit 1; }
fi

cd "$root/frontend"
[ -d node_modules ] || npm ci
npx playwright install chromium
export E2E_MAILPIT_URL="${E2E_MAILPIT_URL:-http://localhost:8025}"
export E2E_SCREENSHOTS_DIR="${E2E_SCREENSHOTS_DIR:-$root/artifacts/screenshots}"
mkdir -p "$E2E_SCREENSHOTS_DIR"
npm run test:e2e -- "$@"
