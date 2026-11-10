#!/usr/bin/env bash
# Refound the republic: day 1, founders only, empty seats, fresh ledger.
# The server first copies the old database next to itself on the volume (country.db.bak-<time>).
# Destructive for the live history, so it asks before doing anything.
. "$(dirname "$0")/common.sh"

say "target: $COUNTRY_URL"
curl -fsS "$COUNTRY_URL/api/health"; echo
if [[ "${YES:-}" != "1" ]]; then
  read -r -p "Type REFOUND to start the republic again from day 1: " answer
  [[ "$answer" == "REFOUND" ]] || die "cancelled"
fi
admin_post /api/admin/refound '{"confirm":"REFOUND"}' | json_get backup | sed 's/^/backup: /'
wait_healthy 60
day="$(curl -fsS "$COUNTRY_URL/api/health" | json_get day)"
[[ "$day" == "1" ]] || die "expected day 1 after refounding, got $day"
ok "refounded: day 1"
