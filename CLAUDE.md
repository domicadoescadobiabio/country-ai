# COUNTRY AI: notes for Claude

A nation run by AI agents: 10,000 citizens (local Qwen 3 8B via Ollama), officials (OpenRouter), leadership (Claude Opus).
Live: https://country-ai-production.up.railway.app · Railway project `country-ai` · GitHub `domicadoescadobiabio/country-ai` (private).

## Work is split into seven boxes (Agent Office, `~/Downloads/agent-office`)

Each box may change only its own files (full list in `agent-office/src/boxes.mjs`). Anything else: finish your part and
write `HANDOFF <box-id>: <what and why>` in your answer.

| Box | Owns |
|---|---|
| negara | `server.mjs`, `src/db.ts`, `src/llm.ts`, `src/brains.ts`, `src/constitution.mjs`, `src/institutions.ts`, `src/types.ts`, `src/util.ts`, `src/decisions.ts`, `db/`, `scripts/smoke.mjs`, `scripts/smoke-brains.mjs`, `scripts/smoke-voting-rules.mjs`, `.claude/` |
| pemerintah | `src/president.ts`, `cabinet.ts`, `council.ts`, `court.ts`, `command.ts`, `elections.ts`, `police.ts`, `military.ts`, `auditoffice.ts`, `training.ts`, `academy.ts`, `audit.ts`, `roles.mjs`, `cases.mjs`, `scripts/smoke-{institutions,command,elections,oversight}.mjs` |
| rakyat | `src/citizens.mjs`, `population.mjs`, `daily.ts`, `careers.ts`, `cities.ts`, `underworld.ts`, `life.ts`, `registry.mjs`, `scripts/local-brain.*`, `scripts/smoke-{agents,underworld,local-brain}.mjs` |
| frontend | `public/` |
| deploy | `scripts/ops/`, `.railwayignore`, `.gitignore`, `package.json`, `package-lock.json`, `tsconfig.json`, `.env.example`, `README.md` |
| security | nothing: reports and HANDOFFs only |
| monitor | `auditor/`, `audit/` |

## Rules

- Never read or print `.env*`, `.keys/` or tokens. Secrets live only in Railway variables and `.env.local-brain`.
- Tests: `node scripts/smoke.mjs` (136 checks), `node scripts/smoke-brains.mjs`, `node scripts/smoke-voting-rules.mjs`,
  `node scripts/smoke-local-brain.mjs`, `python -m unittest discover -s auditor/tests -t .`; all of them: `scripts/ops/check.sh`.
- Only the deploy box commits, pushes (`git -c credential.helper= -c "credential.helper=!gh auth git-credential" push`)
  and deploys (`railway up --detach`, then check `railway deployment list`), after the owner approves and security is clean.
- Engine code is TypeScript run directly by Node 24 (type stripping: erasable syntax only, `import type`, `.ts` specifiers).
- The real clock: one republic day is one real day; tests compress time with `DAY_SECONDS` and the population with `POPULATION`.
- Reply to the owner in Indonesian (casual); code, comments and commit messages in English.
