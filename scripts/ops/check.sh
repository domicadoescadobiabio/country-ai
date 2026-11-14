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

# Run one Node suite: print every FAIL line (so a flaky check is named) and the summary,
# keep going after a failure, and remember it for the end.
failed=()
suite() { # suite "<title>" <script>
  local title="$1" script="$2" out rc=0
  say "$title"
  out="$(node "$script" 2>&1)" || rc=$?
  printf '%s\n' "$out" | grep -E '^[[:space:]]*FAIL' || true
  printf '%s\n' "$out" | tail -n 1
  if (( rc != 0 )); then failed+=("$script"); fi
}

suite "voting rules (Node unit checks)" scripts/smoke-voting-rules.mjs
suite "smoke: the whole republic, compressed time (Node)" scripts/smoke.mjs
suite "smoke: the local brain worker (Node, mocked Ollama)" scripts/smoke-local-brain.mjs
suite "smoke: brains and model routing (Node, mocked providers)" scripts/smoke-brains.mjs
suite "smoke: citizens' feelings and nudges (Node)" scripts/smoke-feelings.mjs
suite "smoke: the underworld and mischievous citizens (Node)" scripts/smoke-underworld.mjs
suite "smoke: the school (Node)" scripts/smoke-school.mjs

if (( ${#failed[@]} )); then die "failed: ${failed[*]}"; fi
ok "all checks passed"
