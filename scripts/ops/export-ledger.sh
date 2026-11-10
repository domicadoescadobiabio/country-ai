#!/usr/bin/env bash
# Export the whole national ledger as JSON Lines (one entry per line) for an offline copy.
# Anyone can do this: the ledger is public. Verify the copy later with
#   python -m auditor verify <file>    (via scripts/ops/verify-file.sh)
. "$(dirname "$0")/common.sh"
cd "$ROOT"
OUT="${1:-audit/ledger-$(date -u +%Y%m%dT%H%MZ).jsonl}"
mkdir -p "$(dirname "$OUT")"
: > "$OUT"
after=0; total=0
while :; do
  page="$(curl -fsS "$COUNTRY_URL/api/ledger?after=$after&limit=500")"
  n="$(printf '%s' "$page" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);for(const e of j.entries)console.log(JSON.stringify(e));console.error(j.entries.length+' '+(j.entries.at(-1)?.seq??0))})" 2>&1 >>"$OUT" | tail -n1)"
  count="${n%% *}"; last="${n##* }"
  total=$((total + count))
  (( count == 500 )) || break
  after="$last"
done
ok "$total entries → $OUT"
