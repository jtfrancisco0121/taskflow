#!/usr/bin/env bash
# Who serves a local port: is it this checkout's own process (and, for the backend, the dev profile)?
# Sourced by scripts/e2e-local.sh (ClickUp 14yq6g333cd): it reused any backend answering on :8080 and any Vite
# on :5173, so an e2e run could test another checkout's code without saying so.
#   bash scripts/e2e-local-owner.sh --self-test   checks the decisions against fake listeners (e2e-local.sh runs it
#                                                 before every run)

# The PID listening on TCP port $1 (empty when none, or when it cannot be found out).
owner_pid() {
  local pid=""
  if command -v lsof >/dev/null 2>&1; then
    pid="$(lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -n 1)" || true
  elif command -v ss >/dev/null 2>&1; then
    pid="$(ss -ltnpH "sport = :$1" 2>/dev/null | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -n 1)" || true
  fi
  echo "$pid"
}

owner_cwd() {
  if [ -r "/proc/$1/cwd" ] || [ -L "/proc/$1/cwd" ]; then
    readlink "/proc/$1/cwd" 2>/dev/null || true
  else
    lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1 || true
  fi
}

# The command line and environment of PID $1, one item per line (only for our own user's processes).
owner_env() {
  if [ -r "/proc/$1/environ" ]; then
    tr '\0' '\n' <"/proc/$1/cmdline" 2>/dev/null || true
    tr '\0' '\n' <"/proc/$1/environ" 2>/dev/null || true
  else
    ps -E -ww -o command= -p "$1" 2>/dev/null | tr ' ' '\n' || true
  fi
}

# owner_check <port> <checkout root> <backend|vite> [expected proxy target, vite only]
# Prints why it refuses; exit 0 = ours, 1 = not ours (another checkout, wrong profile or wrong proxy),
# 2 = cannot tell who it is.
owner_check() {
  local port="$1" root="$2" kind="$3" target="${4:-}" pid cwd env
  pid="$(owner_pid "$port")"
  if [ -z "$pid" ]; then
    echo "found no process of this user listening on :$port (lsof or ss is needed to tell)"
    return 2
  fi
  cwd="$(owner_cwd "$pid")"
  if [ -z "$cwd" ]; then
    echo "cannot read the working directory of PID $pid on :$port"
    return 2
  fi
  case "$cwd/" in
    "$root"/*) ;;
    *)
      echo "PID $pid on :$port runs from $cwd, not from this checkout ($root)"
      return 1
      ;;
  esac
  env="$(owner_env "$pid")"
  if [ "$kind" = backend ]; then
    if ! grep -Eq '^(SPRING_PROFILES_ACTIVE=|--spring\.profiles\.active=|-Dspring\.profiles\.active=)([A-Za-z0-9_-]+,)*dev(,[A-Za-z0-9_-]+)*$' <<<"$env"; then
      echo "PID $pid on :$port is this checkout's backend but not on the dev profile"
      return 1
    fi
  else
    local proxy
    proxy="$(sed -n 's/^VITE_API_PROXY_TARGET=//p' <<<"$env" | head -n 1)" || true
    if [ "${proxy:-http://localhost:8080}" != "$target" ]; then
      echo "PID $pid on :$port is this checkout's Vite but proxies to ${proxy:-http://localhost:8080}, not $target"
      return 1
    fi
  fi
  return 0
}

# A fake server on a free port, started in directory $1 with only the variables "$@" set; prints "<pid> <port>".
fake_listener() {
  local dir="$1" out pid
  shift
  out="$(mktemp)"
  (cd "$dir" && exec env -i PATH="$PATH" "$@" node -e '
    const s = require("http").createServer((q, r) => r.end("{}"))
    s.listen(0, "127.0.0.1", () => require("fs").writeFileSync(process.argv[1], String(s.address().port)))
  ' "$out") &
  pid=$!
  for _ in $(seq 1 50); do
    [ -s "$out" ] && break
    sleep 0.1
  done
  echo "$pid $(cat "$out")"
  rm -f "$out"
}

owner_self_test() {
  local root here foreign failures=0 pid port reason code
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
  here="$root/backend"
  foreign="$(cd "$(mktemp -d)" && pwd -P)"
  expect() { # <expected code> <what> <dir> <kind> <target> <env...>
    local want="$1" what="$2" dir="$3" kind="$4" target="$5"
    shift 5
    read -r pid port < <(fake_listener "$dir" "$@")
    code=0
    reason="$(owner_check "$port" "$root" "$kind" "$target")" || code=$?
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    if [ "$code" != "$want" ]; then
      echo "e2e-local self-test: $what: expected $want, got $code ($reason)" >&2
      failures=$((failures + 1))
    fi
  }
  expect 1 "a backend from another directory" "$foreign" backend "" SPRING_PROFILES_ACTIVE=dev
  expect 0 "this checkout's dev backend" "$here" backend "" SPRING_PROFILES_ACTIVE=dev
  expect 0 "this checkout's backend with dev among profiles" "$here" backend "" SPRING_PROFILES_ACTIVE=local,dev
  expect 1 "this checkout's backend without a profile" "$here" backend ""
  expect 1 "this checkout's backend on a look-alike profile" "$here" backend "" SPRING_PROFILES_ACTIVE=devtools
  expect 1 "this checkout's backend on the prod profile" "$here" backend "" SPRING_PROFILES_ACTIVE=prod
  expect 1 "a Vite from another directory" "$foreign" vite "http://localhost:8080"
  expect 0 "this checkout's Vite on the default proxy" "$root/frontend" vite "http://localhost:8080"
  expect 1 "this checkout's Vite proxying elsewhere" "$root/frontend" vite "http://localhost:8081"
  expect 0 "this checkout's Vite proxying to the target" "$root/frontend" vite "http://localhost:8081" \
    VITE_API_PROXY_TARGET=http://localhost:8081
  rmdir "$foreign" 2>/dev/null || true
  [ "$failures" = 0 ] || return 1
  echo "e2e-local self-test: ok"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  case "${1:-}" in
    --self-test) owner_self_test ;;
    *)
      echo "usage: e2e-local-owner.sh --self-test (sourced by scripts/e2e-local.sh)" >&2
      exit 2
      ;;
  esac
fi
