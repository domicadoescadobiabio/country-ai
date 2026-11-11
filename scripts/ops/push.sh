#!/usr/bin/env bash
# Push the committed work on main to GitHub, through the gh login (no stored git credentials).
#   bash scripts/ops/push.sh
# One plain command with no pipes or quotes, so an approval card in the agent office matches it exactly.
# Never forces, only pushes main, and lists what is about to go out.
. "$(dirname "$0")/common.sh"
cd "$ROOT"
need git
need gh

branch="$(git rev-parse --abbrev-ref HEAD)"
[[ "$branch" == "main" ]] || die "on branch $branch: push only from main"
git fetch --quiet origin main || die "cannot reach origin"
behind="$(git rev-list --count HEAD..origin/main)"
[[ "$behind" == "0" ]] || die "origin/main has $behind commit(s) this checkout lacks: pull first, never force"
ahead="$(git rev-list --count origin/main..HEAD)"
if [[ "$ahead" == "0" ]]; then ok "nothing to push: main matches origin/main"; exit 0; fi

say "pushing $ahead commit(s) to origin/main"
git log --oneline origin/main..HEAD
git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push origin main
ok "origin/main is now $(git rev-parse --short HEAD)"
[[ -z "$(git status --porcelain)" ]] || warn "uncommitted changes stay local (not pushed)"
