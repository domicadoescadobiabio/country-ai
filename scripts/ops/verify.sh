#!/usr/bin/env bash
# Independent verification of a running republic (public endpoints only, no admin token):
# ledger hash chain recomputed in Python, finished elections recounted, invariants checked.
. "$(dirname "$0")/common.sh"
cd "$ROOT"
PY="$(python_bin)"
URL="${1:-$COUNTRY_URL}"

say "health"
curl -fsS "$URL/api/health"; echo
say "ledger chain (recomputed by the auditor)"
"$PY" -m auditor verify "$URL" | head -n 8
say "server's own verdict"
curl -fsS "$URL/api/ledger/verify"; echo
say "recount finished elections"
"$PY" -m auditor recount "$URL" | "$PY" -c 'import json,sys; r=json.load(sys.stdin); print("%d/%d elections recount to the certified result" % (sum(x["ok"] for x in r), len(r)))'
say "constitutional invariants"
"$PY" -m auditor check "$URL" | "$PY" -c 'import json,sys; r=json.load(sys.stdin); bad={k:v for k,v in r["checks"].items() if v}; print("all hold" if not bad else bad)'
