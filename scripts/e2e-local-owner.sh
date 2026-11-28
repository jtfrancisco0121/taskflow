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

# Whether anything serves TCP port $1 on this machine, IPv4 or IPv6 (Vite's default host "localhost" resolves to
# ::1 on macOS, which a 127.0.0.1-only probe misses): a listener lsof/ss can see, or an HTTP answer on localhost.
port_in_use() {
  [ -n "$(owner_pid "$1")" ] && return 0
  local code
  code="$(curl -s -o /dev/null -m 2 -w '%{http_code}' "http://localhost:$1/" 2>/dev/null)" || true
  [ -n "$code" ] && [ "$code" != 000 ]
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

# The port named in URL $1 (http://host:port[/path]); fails when the URL names none: the script starts the backend
# on that port, so it must be explicit.
api_port_of() {
  local rest="${1#*://}"
  rest="${rest%%/*}"
  local port="${rest##*:}"
  case "$rest" in *:*) ;; *) port="" ;; esac
  case "$port" in
    '' | *[!0-9]*)
      echo "E2E_API_URL must name its port, for example http://localhost:8081 (got $1)" >&2
      return 1
      ;;
  esac
  echo "$port"
}

# The Spring profiles PID's command line and environment ($1, as owner_env prints it) make active: the strongest
# source set wins, as in Spring (--spring.profiles.active, then -Dspring.profiles.active, then the environment).
effective_profiles() {
  local source value
  for source in '--spring\.profiles\.active=' '-Dspring\.profiles\.active=' 'SPRING_PROFILES_ACTIVE='; do
    value="$(grep -E "^${source}" <<<"$1" | tail -n 1 | sed -E "s/^${source}//")" || true
    if [ -n "$value" ]; then
      echo "$value"
      return 0
    fi
  done
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
  # A checkout nested inside this one (a worktree in a subfolder) shares the path prefix but is other code.
  local top
  top="$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)" || top=""
  if [ -n "$top" ] && [ "$(cd "$top" && pwd -P)" != "$root" ]; then
    echo "PID $pid on :$port runs from $cwd, in the checkout $top, not this one ($root)"
    return 1
  fi
  env="$(owner_env "$pid")"
  if [ "$kind" = backend ]; then
    local profiles
    profiles="$(effective_profiles "$env")"
    if [[ ",$profiles," != *,dev,* || ",$profiles," == *,prod,* ]]; then
      echo "PID $pid on :$port is this checkout's backend but its active profiles (${profiles:-none}) are not dev without prod"
      return 1
    fi
  else
    local proxy
    proxy="$(sed -n 's/^VITE_API_PROXY_TARGET=//p' <<<"$env" | head -n 1)" || true
    proxy="${proxy:-http://localhost:8080}"
    if [ "${proxy%/}" != "${target%/}" ]; then
      echo "PID $pid on :$port is this checkout's Vite but proxies to $proxy, not $target"
      return 1
    fi
  fi
  return 0
}

# A fake server on a free port of host $FAKE_HOST (default 127.0.0.1), started in directory $1 with only the
# variables "$@" set and the words of $FAKE_ARGS on its command line; prints "<pid> <port>".
fake_listener() {
  local dir="$1" out pid host="${FAKE_HOST:-127.0.0.1}"
  shift
  out="$(mktemp)"
  (cd "$dir" && exec env -i PATH="$PATH" "$@" node -e '
    const s = require("http").createServer((q, r) => r.end("{}"))
    s.listen(0, process.argv[2], () => require("fs").writeFileSync(process.argv[1], String(s.address().port)))
  ' "$out" "$host" ${FAKE_ARGS:-}) &
  pid=$!
  for _ in $(seq 1 50); do
    [ -s "$out" ] && break
    sleep 0.1
  done
  echo "$pid $(cat "$out")"
  rm -f "$out"
}

# Whether this host can listen on IPv6 loopback (::1). E2E_NO_IPV6_LOOPBACK=1 answers no, so the self-test can
# prove the skip path on a host that has it.
ipv6_loopback() {
  [ -z "${E2E_NO_IPV6_LOOPBACK:-}" ] || return 1
  node -e '
    const s = require("net").createServer()
    s.on("error", () => process.exit(1))
    s.listen(0, "::1", () => s.close(() => process.exit(0)))
  ' 2>/dev/null
}

# Vite binds "localhost" (::1 on macOS): the port must count as in use and its owner must still be checked. The ::1
# case runs only where IPv6 loopback exists, so a host without it does not fail every e2e run.
host_cases() { # <checkout root> <foreign dir>
  local root="$1" foreign="$2" host pid port code reason bad=0
  local hosts=(localhost)
  if ipv6_loopback; then
    hosts+=(::1)
  else
    echo "e2e-local self-test: no IPv6 loopback here, skipped the ::1 case"
  fi
  for host in "${hosts[@]}"; do
    read -r pid port < <(FAKE_HOST="$host" fake_listener "$foreign")
    if ! port_in_use "$port"; then
      echo "e2e-local self-test: a listener on $host:$port was not seen as in use" >&2
      bad=1
    fi
    code=0
    reason="$(owner_check "$port" "$root" vite "http://localhost:8080")" || code=$?
    if [ "$code" != 1 ]; then
      echo "e2e-local self-test: a foreign Vite on $host: expected 1, got $code ($reason)" >&2
      bad=1
    fi
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    if port_in_use "$port"; then
      echo "e2e-local self-test: port $port still counts as in use after its listener stopped" >&2
      bad=1
    fi
  done
  return "$bad"
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
  # Spring takes --spring.profiles.active over -Dspring.profiles.active over the environment, so the profile that
  # counts is the strongest one set; dev must be in it and prod must not (review on PR #37).
  FAKE_ARGS=--spring.profiles.active=prod expect 1 "dev in the environment, prod on the command line" "$here" \
    backend "" SPRING_PROFILES_ACTIVE=dev
  FAKE_ARGS=--spring.profiles.active=dev expect 0 "prod in the environment, dev on the command line" "$here" \
    backend "" SPRING_PROFILES_ACTIVE=prod
  FAKE_ARGS=-Dspring.profiles.active=prod expect 1 "dev in the environment, prod as a system property" "$here" \
    backend "" SPRING_PROFILES_ACTIVE=dev
  expect 1 "dev and prod together" "$here" backend "" SPRING_PROFILES_ACTIVE=dev,prod
  expect 0 "this checkout's Vite proxying to the target with a trailing slash" "$root/frontend" vite \
    "http://localhost:8081" VITE_API_PROXY_TARGET=http://localhost:8081/
  # A checkout nested under this one (a worktree in a subfolder) is not this checkout (review on PR #37).
  local fake_root nested
  fake_root="$(cd "$(mktemp -d)" && pwd -P)"
  nested="$fake_root/.worktrees/other"
  mkdir -p "$nested/backend" "$fake_root/backend"
  git -C "$fake_root" init -q && git -C "$nested" init -q
  local real_root="$root"
  root="$fake_root"
  expect 1 "a checkout nested under this one" "$nested/backend" backend "" SPRING_PROFILES_ACTIVE=dev
  expect 0 "a plain subfolder of this checkout" "$fake_root/backend" backend "" SPRING_PROFILES_ACTIVE=dev
  root="$real_root"
  rm -rf "$fake_root"
  # E2E_API_URL must name its port: the script starts the backend on it.
  local url want got
  for url in "http://localhost:8081=8081" "http://localhost:8081/=8081" "http://[::1]:8082=8082" \
    "http://localhost=" "http://localhost/api=" "localhost:8083=8083"; do
    want="${url##*=}"
    got="$(api_port_of "${url%=*}" 2>/dev/null)" || got=""
    if [ "$got" != "$want" ]; then
      echo "e2e-local self-test: port of ${url%=*}: expected '${want}', got '${got}'" >&2
      failures=$((failures + 1))
    fi
  done
  host_cases "$root" "$foreign" || failures=$((failures + 1))
  rmdir "$foreign" 2>/dev/null || true
  # A host without IPv6 loopback must skip the ::1 case and still pass (review on PR #37).
  local skip
  skip="$(E2E_NO_IPV6_LOOPBACK=1 bash "${BASH_SOURCE[0]}" --self-test-hosts 2>&1)" || {
    echo "e2e-local self-test: without ::1 the host cases failed: $skip" >&2
    failures=$((failures + 1))
  }
  if ! grep -q "skipped the ::1 case" <<<"$skip"; then
    echo "e2e-local self-test: without ::1 the ::1 case was not skipped ($skip)" >&2
    failures=$((failures + 1))
  fi
  [ "$failures" = 0 ] || return 1
  echo "e2e-local self-test: ok"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  case "${1:-}" in
    --self-test) owner_self_test ;;
    --self-test-hosts)
      root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
      foreign="$(cd "$(mktemp -d)" && pwd -P)"
      code=0
      host_cases "$root" "$foreign" || code=$?
      rmdir "$foreign" 2>/dev/null || true
      exit "$code"
      ;;
    *)
      echo "usage: e2e-local-owner.sh --self-test (sourced by scripts/e2e-local.sh)" >&2
      exit 2
      ;;
  esac
fi
