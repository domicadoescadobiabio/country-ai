#!/usr/bin/env bash
# Everything that must pass before a commit or a deploy:
#   JavaScript/TypeScript smoke tests, brain routing tests, the Python auditor's unit tests
#   (including the cross-language hash and recount checks) and a secret scan.
. "$(dirname "$0")/common.sh"
cd "$ROOT"
PY="$(python_bin)"

say "secret scan (tracked and new files)"
pattern='(sk-ant-[A-Za-z0-9_-]{20,}|sk-or-v1-[a-f0-9]{20,}|sk-[A-Za-z0-9]{32,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[abp]-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9]{30,})'
if git ls-files -co --exclude-standard | grep -vE '^(node_modules|data)' | xargs -r grep -nIE "$pattern" 2>/dev/null; then
  die "something that looks like a secret is in the tree"
fi
ok "no secrets"

say "auditor unit tests (Python)"
"$PY" -m unittest discover -s auditor/tests -t . -q
ok "auditor"

say "voting rules (Node unit checks)"
node scripts/smoke-voting-rules.mjs | tail -n 1
say "smoke: the whole republic, compressed time (Node)"
node scripts/smoke.mjs | tail -n 3
say "smoke: the local brain worker (Node, mocked Ollama)"
node scripts/smoke-local-brain.mjs | tail -n 1
say "smoke: brains and model routing (Node, mocked providers)"
node scripts/smoke-brains.mjs | tail -n 2
say "smoke: citizens' feelings and nudges (Node)"
node scripts/smoke-feelings.mjs | tail -n 1
say "smoke: the underworld and mischievous citizens (Node)"
node scripts/smoke-underworld.mjs | tail -n 1
ok "all checks passed"
