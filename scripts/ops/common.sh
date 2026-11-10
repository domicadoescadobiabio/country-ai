#!/usr/bin/env bash
# Shared helpers for the ops scripts. Source it: `. "$(dirname "$0")/common.sh"`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COUNTRY_URL="${COUNTRY_URL:-https://country-ai-production.up.railway.app}"
export COUNTRY_URL
# Git Bash on Windows rewrites arguments that look like paths (/data -> C:/Program Files/Git/data)
export MSYS_NO_PATHCONV=1

say()  { printf '\033[1;36m▸\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "missing tool: $1"; }

python_bin() {
  if command -v python3 >/dev/null 2>&1 && python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null; then echo python3
  elif command -v python >/dev/null 2>&1; then echo python
  else die "python 3.10+ is required for the auditor"; fi
}

# Read JSON field from stdin without jq (node is always present: the server needs it).
json_get() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{let v=JSON.parse(s);for(const k of process.argv[1].split('.'))v=v?.[k];console.log(typeof v==='object'?JSON.stringify(v):v)})" "$1"; }

# The admin token is loaded into the environment only, never printed or written to disk.
load_admin_token() {
  if [[ -n "${ADMIN_TOKEN:-}" ]]; then return; fi
  need railway
  ADMIN_TOKEN="$(cd "$ROOT" && railway variables --kv 2>/dev/null | sed -n 's/^ADMIN_TOKEN=//p' | head -n1)"
  [[ -n "$ADMIN_TOKEN" ]] || die "ADMIN_TOKEN is not set (export it or link the Railway project)"
  export ADMIN_TOKEN
}

admin_post() { # admin_post /api/admin/<path> '<json>'
  load_admin_token
  # the token goes in through a file descriptor, so it never shows in the process list
  curl -fsS -X POST "$COUNTRY_URL$1" -H 'content-type: application/json' -H @<(printf 'x-admin-token: %s\n' "$ADMIN_TOKEN") --data "$2"
}

wait_healthy() { # wait_healthy [seconds]
  local deadline=$(( $(date +%s) + ${1:-180} ))
  until curl -fsS "$COUNTRY_URL/api/health" >/dev/null 2>&1; do
    (( $(date +%s) < deadline )) || die "$COUNTRY_URL did not become healthy"
    sleep 3
  done
}
