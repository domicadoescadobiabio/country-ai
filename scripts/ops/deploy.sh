#!/usr/bin/env bash
# Deploy to Railway after the checks pass, then confirm the new deployment is the one serving.
#   scripts/ops/deploy.sh            run checks, deploy, wait, verify the ledger
#   SKIP_CHECKS=1 scripts/ops/deploy.sh
. "$(dirname "$0")/common.sh"
cd "$ROOT"
need railway

# Only a clean tree is deployed: railway up uploads the working tree, so an uncommitted (unreviewed) edit would
# go live too (Security #1118/#1123, deployment af6e9ec3). Commit or stash first, or deploy a reviewed commit from
# a worktree (git worktree add --detach <dir> <commit>; railway up <dir> --path-as-root --detach).
dirty="$(git status --short)"
[[ -z "$dirty" ]] || die "working tree is not clean, refusing to deploy:
$dirty"

if [[ "${SKIP_CHECKS:-}" != "1" ]]; then "$ROOT/scripts/ops/check.sh"; fi
# check again right before the upload: another box may have changed a file while the checks ran
[[ -z "$(git status --short)" ]] || die "working tree changed during the checks, refusing to deploy"

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
