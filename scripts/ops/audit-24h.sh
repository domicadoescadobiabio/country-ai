#!/usr/bin/env bash
# The 24-hour test: observe the republic once an hour for a full real day, then write the report.
#   scripts/ops/audit-24h.sh                    # 24 hours, hourly, production
#   HOURS=2 INTERVAL=600 scripts/ops/audit-24h.sh
. "$(dirname "$0")/common.sh"
cd "$ROOT"
PY="$(python_bin)"
HOURS="${HOURS:-24}"
INTERVAL="${INTERVAL:-3600}"
STAMP="$(date -u +%Y%m%dT%H%MZ)"
OUT="audit/run-$STAMP.jsonl"
mkdir -p audit

say "observing $COUNTRY_URL for $HOURS h (every $INTERVAL s) → $OUT"
"$PY" -u -m auditor monitor "$COUNTRY_URL" --hours "$HOURS" --interval "$INTERVAL" --out "$OUT"
say "writing the report"
"$PY" -m auditor report "$OUT" --url "$COUNTRY_URL" --out "audit/REPORT-$STAMP.md"
ok "report: audit/REPORT-$STAMP.md"
