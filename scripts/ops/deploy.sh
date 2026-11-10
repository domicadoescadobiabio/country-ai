#!/usr/bin/env bash
# Deploy to Railway after the checks pass, then confirm the new deployment is the one serving.
#   scripts/ops/deploy.sh            run checks, deploy, wait, verify the ledger
#   SKIP_CHECKS=1 scripts/ops/deploy.sh
. "$(dirname "$0")/common.sh"
cd "$ROOT"
need railway

if [[ "${SKIP_CHECKS:-}" != "1" ]]; then "$ROOT/scripts/ops/check.sh"; fi
[[ -z "$(git status --porcelain)" ]] || warn "working tree has uncommitted changes (they are deployed too)"

say "uploading to Railway"
railway up --detach
say "waiting for the newest deployment to finish"
for _ in $(seq 1 60); do
  line="$(railway deployment list 2>/dev/null | sed -n '2p' || true)"
  case "$line" in
    *SUCCESS*) ok "deployment: $line"; break ;;
    *FAILED*|*CRASHED*) die "deployment failed: $line" ;;
  esac
  sleep 10
done
wait_healthy 240
"$ROOT/scripts/ops/verify.sh"
