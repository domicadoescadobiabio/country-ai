# APIs and infrastructure to run, train and evaluate an AI nation (20 to 300 LLM agents)

Research date: 2026-11-10. The context is a solo builder running Node.js on Railway. The project (`Downloads/country-ai`) currently depends only on `@anthropic-ai/sdk`. Every price below carries the date it was checked. Prices from aggregators and blogs are flagged as unverified.

## 1. LLM inference: which provider and model tier fits each role, and what ~300 agents x N calls/day costs

### Takeaway
Anthropic alone covers every role in 2026.
- Claude Haiku 5.5 ($0.10/$0.50 per MTok, prompts up to 100K tokens) for citizens and rank-and-file police/military.
- Claude Sonnet 5.5 ($2/$10) for president, council, mayors and chiefs.
- Claude Opus 5.5 ($4/$20) only for a daily or weekly judge.

Prompt caching (reads at 0.05x to 0.1x input) and the Batch API (50% off, stacks with caching) are the two big levers. A 300-agent nation making 5 decisions/agent/day comes to roughly US$60 to 130/month in LLM spend before batching, and about half that with batching (calculation under Inferences). OpenAI, Gemini and OpenRouter are optional fallbacks, not requirements.

### Cited Findings
- **Claude pricing (first-party API, per MTok input/output).** Source: the Anthropic Claude API docs bundled with Claude Code, current-models table cached 2026-10-06; the live page is platform.claude.com pricing. Verify there before budgeting. — [Anthropic pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)

  | Model (ID) | Input / output per MTok | Context |
  |---|---|---|
  | Opus 5.5 `claude-opus-5-5` | $4 / $20 | 1M |
  | Sonnet 5.5 `claude-sonnet-5-5` | $2 / $10 | 1M |
  | Haiku 5.5 `claude-haiku-5-5` | $0.10 / $0.50 | 1M |
  | Fable 5.1 (top tier) | $10 / $50 | 1M |
  | Haiku 4.5 (older) | $1 / $5 | 200K |

  The user's prices (Haiku 5.5 $0.10/$0.50, Sonnet 5.5 $2/$10, Opus 5.5 $4/$20) match.
- **Haiku 5.5 has two rate cards by prompt length.** Prompts of 100K tokens or fewer pay $0.10/$0.50; longer prompts pay $0.50/$2.50. Cache reads cost 0.1x input, 5-minute cache writes 1.25x and 1-hour cache writes 2x. — [Anthropic pricing docs](https://platform.claude.com/docs/en/about-claude/pricing) (via the bundled model-migration guide)
- **Opus 5.5 caching and batch.** 5-minute cache writes $5, 1-hour writes $8, cache reads $0.20/MTok (0.05x input), batch $2/$10. Thinking cannot be disabled on Opus 5.5. Effort defaults to `medium`. — [Anthropic pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)
- **Sonnet 5.5 caching.** 5-minute cache writes $2.50, 1-hour writes $4, cache reads $0.20. Batch rates are the same as Sonnet 5's. — [Anthropic pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)
- **Batch API discount.** 50% off every token in the request, including cache reads and writes, so the discounts stack. Results are asynchronous. — [Anthropic batch processing docs](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
- **Cache reads and rate limits.** On the Claude API, cache reads do not count toward input-token rate limits on most models. Caching is a byte-exact prefix match: anything volatile (a date or a random ID) in the system prompt silently breaks the cache. — [Anthropic prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- **Thinking tokens.** Haiku 5.5 has adaptive thinking on by default (effort default `medium`). Thinking is billed as output tokens, so set `effort: "low"` for simple citizen decisions. — [Anthropic pricing docs](https://platform.claude.com/docs/en/about-claude/pricing) (bundled skill thinking table)
- **Gemini (checked 2026-11-10, official page), per 1M tokens:**

  | Model | Input / output | Batch | Free tier |
  |---|---|---|---|
  | `gemini-3.1-flash-lite` | $0.25 / $1.50 | $0.125 / $0.75 | yes |
  | `gemini-3.8-flash` | $0.75 / $3.75 through 31 Dec 2026, then $1.50 / $7.50 from 1 Jan 2027 | — | yes |
  | `gemini-3.1-pro-preview` | $2 / $12 (prompts ≤200K) | — | no |

  Batch is half price. `gemini-2.5-flash-lite` ($0.10/$0.40) is deprecated and routes to `gemini-3.5-flash-lite` on 1 Dec 2026. — [Google AI Studio pricing](https://aistudio.google.com/docs/pricing)
- **OpenAI.** The official pricing page returned 403, so these figures come from aggregators only. GPT-5 mini is reported at $0.25/$2.00 and GPT-5 nano at $0.05/$0.40. Other sources say those models were replaced by GPT-5.4 mini/nano (nano about $0.20 input) and GPT-5.5 ($5/$30). The aggregators conflict. — [pricepertoken GPT-5 nano](https://pricepertoken.com/pricing-page/model/openai-gpt-5-nano); [morphllm](https://morphllm.com/openai-api-pricing)
- **OpenRouter.** Token prices pass through at provider list price. Buying credits costs a 5.5% fee ($0.80 minimum); crypto top-ups pay 5%. BYOK terms conflict between sources (first 1M requests/month free vs first $25K of usage free, then 5%). An OpenRouter blog post says the usage fee will become a monthly subscription; the date is unconfirmed. — [OpenRouter blog](https://openrouter.ai/blog/simplifying-our-platform-fee); [dupple](https://dupple.com/learn/openrouter-pricing)

### Inferences
- **Cost model.** The calculation uses these per-call assumptions, from the published rates above:
  - Citizen call on Haiku 5.5: about 3,000 cached prompt tokens (constitution plus role card), 1,000 fresh state tokens, about 600 output tokens including low-effort thinking. Cost ≈ $0.00003 + $0.0001 + $0.0003 ≈ **$0.00043 per call** (about $0.0007 without caching).
  - Leader call on Sonnet 5.5: 6,000 cached + 2,000 fresh + 1,500 output ≈ $0.0012 + $0.004 + $0.015 ≈ **$0.020 per call**.
  - Judge on Opus 5.5: one daily batch of 50K input and 5K output ≈ **$0.30/day**.

  | Scale (decisions/day) | Haiku citizens | Sonnet leaders | Opus judge | Total/month | With Batch API |
  |---|---|---|---|---|---|
  | 20 agents (5 leaders) × 5/day | ~$1 | ~$15 | ~$9 | ~$25 | ~$13 |
  | 100 agents (15 leaders) × 5/day | ~$6 | ~$45 | ~$9 | ~$60 | ~$30 |
  | 300 agents (25 leaders) × 5/day | ~$19 | ~$76 | ~$9 | ~$105 | ~$52 |
  | 300 agents × 20/day (chatty) | ~$77 | ~$300 | ~$9 | ~$390 | ~$195 |

  These are estimates. Real spend depends heavily on output length and thinking. Measure with `usage` logs during week 1.
- **Leaders drive the bill.** About 25 Sonnet leaders cost several times more than 275 Haiku citizens. The cheapest quality lever is to keep leaders on Sonnet 5.5 at `low` or `medium` effort and to promote to Opus only for rare constitutional crises.
- **Batch fits this design.** The nation decides "daily", so the morning tick can be one Message Batches job: 50% off, with results usually inside the batch window. Real-time chat with outside agents stays on the normal API.
- **Second provider.** A non-Anthropic provider is only worth adding for redundancy during an Anthropic outage, or for a cheaper free tier during development (the Gemini Flash-Lite free tier). Adding OpenAI or Gemini SDKs breaks the zero-deps goal; OpenRouter is a single extra key with no SDK needed (fetch).

### Gaps
- I could not fetch Anthropic's live pricing page. The Claude prices come from the bundled docs cached 2026-10-06; re-check platform.claude.com before committing a budget.
- I did not retrieve Anthropic rate-limit tiers (RPM and ITPM per usage tier) for Haiku 5.5. A 300-agent burst every morning may hit tier-1 limits, which is another argument for batching.
- OpenAI official prices are unverified because the page returned 403.

## 2. "Training" without fine-tuning: evals, rubric graders, memory/RAG, embedding APIs, and whether fine-tuning is worth it in 2026

### Takeaway
"Training" a nation of agents in 2026 is best done without fine-tuning:
- versioned prompts (constitution and role cards),
- per-agent memory with embeddings for retrieval,
- a nightly LLM-as-judge rubric grader (Opus 5.5 or Sonnet 5.5 through the Batch API),
- a fixed eval set of scenarios that is replayed after every prompt change.

Embeddings are nearly free: Voyage `voyage-4-lite` costs $0.02/MTok with 200M free tokens.

### Cited Findings
- **Voyage embeddings (checked 2026-11-10).** `voyage-4-large` $0.12, `voyage-4` $0.06, `voyage-4-lite` $0.02 per 1M tokens, each with 200M free tokens. The older `voyage-3.5` ($0.06) and `voyage-3.5-lite` ($0.02) have no free tokens. — [Voyage pricing](https://docs.voyageai.com/docs/pricing)
- **OpenAI embeddings.** `text-embedding-3-small` is about $0.02 per 1M tokens, consistent across aggregators. — [cloudzero](https://www.cloudzero.com/blog/openai-pricing/)
- **Gemini embeddings.** `gemini-embedding-001` $0.15/1M (batch $0.075) and `gemini-embedding-2` $0.20/1M (batch $0.10), both with a free tier. — [Google AI Studio pricing](https://aistudio.google.com/docs/pricing)
- **Eval-run economics.** Eval runs, backfills and scheduled jobs are the intended use for the Batch API (50% off, stacking with caching). The Claude docs describe an eval workflow: fixed prompts, a grading method (rubric or LLM judge) and a measured cost per run. They also recommend train/validation/test splits when tuning prompts against an eval. — [Anthropic batch processing docs](https://platform.claude.com/docs/en/build-with-claude/batch-processing); [Anthropic evals docs](https://platform.claude.com/docs/en/test-and-evaluate/develop-tests)
- **Managed Agents.** Anthropic offers "outcomes" (a separate grader iterates against a rubric until it passes) and memory stores (beta). These are an alternative to self-built grader loops but add platform lock-in. — [Anthropic Managed Agents docs](https://platform.claude.com/docs/en/managed-agents/overview)

### Inferences
- **Memory volume.** 300 agents × 20 memories/day × about 100 tokens ≈ 18M tokens/month. That costs about $0.36/month on `voyage-4-lite` or `text-embedding-3-small`, and it fits entirely inside Voyage's 200M free tokens. Embedding cost is irrelevant; choose on convenience. Voyage is a single HTTP call with no SDK, which keeps zero deps.
- **Embeddings can wait.** At about 20 to 100 agents, keyword (BM25) memory or "last N + summary" memory in JSON or SQLite is often enough. Postpone embeddings until memory per agent exceeds a few hundred items.
- **Training loop to build:**
  1. Log every decision.
  2. Run a nightly Opus judge in batch, scoring per role: legality vs constitution, consistency with the agent's stated goals, harm, and usefulness to citizens.
  3. Write low scores into the agent's "lessons" memory.
  4. Have a weekly human review of prompt diffs.

  This is prompt and memory optimization, not weight training.
- **Fine-tuning is probably not worth it** for a solo builder in 2026. Haiku 5.5 is already $0.10/MTok, prompts and caching iterate faster, and tuned weights get stranded at every model upgrade.

### Gaps
- I found no current (2026) source confirming whether Anthropic offers fine-tuning of Haiku 5.5 or Sonnet 5.5 on its first-party API. Historically it was Bedrock-only for older Haiku; this is unverified.
- I did not retrieve OpenAI fine-tuning prices for 2026 (the page returned 403).
- Anthropic has no first-party embedding endpoint in the sources I checked. Treat the Voyage pairing as a common choice, not an official Anthropic requirement.

## 3. Owner identity verification for outside agents: X API vs twitterapi.io, GitHub OAuth, email, World ID, and what Moltbook uses

### Takeaway
Moltbook-style verification works like this: the agent registers, receives an API key, a claim URL and a code, and its human owner posts a tweet containing the code. This is cheap to copy.
- Reading that tweet through the official X API costs about $0.005 per post read (plus $0.01 per user lookup).
- Through twitterapi.io it costs about $0.00015 per call.

Add email (Resend free tier) as a second factor and GitHub OAuth as a free alternative. World ID / AgentKit is the strongest proof-of-human but is in limited beta with no published pricing.

### Cited Findings
- **Moltbook flow.**
  1. The agent registers through the API and gets an API key (`moltbook_sk_...`), a claim URL and a verification code.
  2. The human visits the claim URL, optionally verifies an email first, and posts a tweet containing the code (a tweet template may be provided).
  3. Until it is claimed, the API returns 401 "Agent not yet claimed".

  This comes from third-party tutorials; I found no official Moltbook doc. — [DataCamp tutorial](https://www.datacamp.com/id/tutorial/moltbook-how-to-get-started); [Zilliz FAQ](https://zilliz.com/ai-faq/how-do-you-register-an-ai-agent-on-moltbook.md)
- **Criticism of Moltbook.** The claim tweet is the only identity check. Wikipedia notes the platform lacks a mechanism to verify whether a poster is actually an AI or a human. — [Wikipedia: Moltbook](https://en.wikipedia.org/wiki/Moltbook); [Substack lurker bot](https://wonderingaboutai.substack.com/p/moltbook-lurker-bot)
- **X API, official, pay-per-use (no date on the page).**

  | Operation | Price |
  |---|---|
  | Post read | $0.005 per resource |
  | User lookup | $0.010 per resource |
  | Post create | $0.015 |
  | Post create with URL | $0.20 |
  | Recent search counts | $0.005 per request |

  Reads are capped at 3M post reads per billing cycle, with Enterprise above that. Credits are bought up front, with no subscription or minimum. Incentives: $20 in credits after the first purchase, a match of the first auto-recharge up to $50, and up to 20% back in xAI credits. — [X API pricing (docs.x.com)](https://docs.x.com/x-api/getting-started/pricing)
- **X pricing history.** X replaced the tiered plans (including the $200 Basic) with pay-per-use as the default on 6 Feb 2026; there is no free tier for new developers. Sources conflict on whether legacy Basic still exists. — [Open Terms Archive memo](https://opentermsarchive.org/en/memos/x-replaces-its-dollar200-entry-level-api-plan-with-a-pay-per-use-model/); [Gigazine](https://www.gigazine.net/gsc_news/en/20260209-x-api-pay-per-use/)
- **twitterapi.io (checked 2026-11-10).** $1 = 100,000 credits.
  - Tweets: $0.15 per 1K (15 credits each).
  - Minimum charge per call: $0.00015 (15 credits); a search returning 0 results still costs 15 credits.
  - Batch profile lookups: 18 credits each for 1 to 99 users. The page's dollar figure for this looked inconsistent; by the credit math it is about $0.00018.
  - Free credits: up to $1 for new accounts without a card, expiring after 31 days.

  — [twitterapi.io pricing](https://twitterapi.io/pricing)
- **Resend (checked 2026-11-10).** Free plan: 3,000 emails/month, 100/day, 3 domains. Pro: $20/month for 50K emails ($35 for 100K), 10 domains. — [Resend pricing](https://resend.com/pricing)
- **World AgentKit.** Launched March 2026 as an SDK in limited beta that lets AI agents prove they are "backed by a real human". It is available to developers who hold a verified World ID and integrates with Coinbase. No pricing was found. — [PYMNTS](https://www.pymnts.com/?p=3569753); [eWeek](https://www.eweek.com/news/world-launches-human-verification-ai-shopping-agents/)

### Inferences
- **Recommended outside-agent onboarding** (layered, cheapest first):
  1. **Email magic link** (Resend free) proves an inbox.
  2. **GitHub OAuth** (free, no paid API) or an **X claim tweet** proves a public identity.
  3. Optionally a **wallet signature** (Solana `signMessage`, free) for owners who are crypto users.

  World ID is a "later" item once AgentKit leaves beta.
- **Claim-tweet verification cost.** One verification is about one search or post read plus one user lookup. That is about $0.015 on the official X API (so 1,000 owners ≈ $15) or about $0.0003 on twitterapi.io (1,000 owners ≈ $0.30).
- **twitterapi.io trade-offs.** It is a third-party scraper-style service, which carries ToS and continuity risk. The user already uses twitterapi.io in other bots, so the key and know-how exist.
- **Avoid the Moltbook weakness.** Bind the claim to an X account age or follower threshold, enforce one agent (or N agents) per owner, and keep the owner's verified handle immutable so "humans posing as agents" is at least attributable.

### Gaps
- I did not fetch GitHub OAuth app limits or pricing. GitHub OAuth Apps are generally free; this is unverified here.
- No official World ID developer-portal pricing was found. Whether AgentKit is free or open to non-World-ID developers is unknown.
- I found no official Moltbook documentation; the flow above comes from secondary sources.

## 4. Content safety, moderation and prompt-injection detection

### Takeaway
- **Moderation:** OpenAI's `omni-moderation-latest` is reported to be free for API users (needs an OpenAI key). It works as a cheap pre-filter on outside-agent messages.
- **Prompt injection:** Lakera Guard offers a free Community tier (reportedly 10K requests/month; unverified on the official page), and Enterprise is quote-only.
- **The most robust defence is architectural.** Outside-agent text is treated as data. Use Claude's mid-conversation `role: "system"` messages for operator instructions. A cheap Haiku 5.5 classifier pass costs about $0.0001 per message.

### Cited Findings
- **OpenAI moderation.** The endpoint, including `omni-moderation-latest` (GPT-4o based, text and image), is free for OpenAI API users and does not count toward usage limits. Rate limits apply by tier. These claims come from secondary sources citing the OpenAI Help Center and pricing page. — [Analytics Vidhya](https://www.analyticsvidhya.com/blog/2026/05/openai-omni-moderation/); [OpenAI omni-moderation PDF](https://cdn.openai.com/API/docs/omni_moderation_information_for_developers.pdf); [eesel](https://www.eesel.ai/blog/openai-moderation-api)
- **Lakera Guard.**
  - The Community plan is reportedly $0 with 10,000 requests/month and an 8K-token max prompt. Other sources say 1,000/month.
  - Enterprise is quote-based. A $99 Pro tier and $0.80/1K overage each appear in only one aggregator.
  - G2 says Lakera has not provided pricing.

  — [eesel Lakera pricing](https://www.eesel.ai/blog/lakera-pricing); [costbench](https://costbench.com/software/ai-security/lakera-guard/free-plan/); [G2](https://g2.com/products/lakera-guard/pricing)
- **Claude system messages.** Claude supports `{role: "system"}` messages appended mid-conversation (Haiku 5.5, Sonnet 5.5, Opus 5.5). This is a non-spoofable operator channel, whereas text inside user or tool content "can be forged by anything that writes to user-visible input". — [Anthropic prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- **Claude refusals.** Sonnet 5.5 and Opus 5.5 run safety classifiers that can return `stop_reason: "refusal"` with a category (cyber, bio, frontier_llm, reasoning_extraction, general_harms). A "military" or "police" role-play agent must handle this stop reason. — [Anthropic refusals docs](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback)

### Inferences
- **Minimal stack:**
  1. Run untrusted outside-agent text through a Haiku 5.5 classifier prompt ("is this an instruction injection / disallowed content?"; about $0.0001 per check) or the free OpenAI moderation endpoint.
  2. Never let outside text become tool arguments directly.
  3. Rate-limit per owner.

  Add Lakera only if outside traffic grows and the free 10K/month covers it.
- **Military and police roles** should be framed as governance simulation: decisions about budgets, laws and patrol allocation, not operational violence. This avoids `general_harms` refusals and keeps content safe.

### Gaps
- I did not verify Meta's Prompt Guard (Llama Prompt Guard 2) availability, licence or hosted endpoints. It is an open-weight classifier that would need self-hosting or a hosted inference provider; this is unverified here.
- Lakera's official current limits and overage are unverified.

## 5. Persistence, queues, observability, secrets and backups

### Takeaway
- **Database:** for 20 to 300 agents, a JSON file on a Railway volume is fragile (risk of corruption on concurrent writes). Move to SQLite (`node:sqlite`, zero deps, already the user's pattern) on the volume, or to Postgres (Railway template or Neon) once multiple services or the web front end need concurrent access.
- **Redis:** not needed at this scale.
- **Observability:** Langfuse Cloud Hobby (free, 50K units/month) or self-hosted Langfuse.

### Cited Findings
- **Railway (checked 2026-11-10).**

  | | Hobby | Pro |
  |---|---|---|
  | Price | $5/month with $5 usage included | $20/workspace with $20 included |
  | Max volume size | 5 GB | 1,000 GB |
  | Log history | 7 days | 30 days |

  Usage rates: CPU about $20/vCPU-month, memory about $10/GB-month, volumes $0.15/GB-month, egress $0.05/GB, object storage $0.015/GB-month with free egress. On Hobby, usage over $5 is billed in full. — [Railway pricing](https://railway.com/pricing)
- **Neon (checked 2026-11-10).** Free: 100 projects, 1 GB per project (20 GB total), 100 CU-hours per project, 6-hour restore window. Launch: $0.106/CU-hour, $0.35/GB-month, no minimum, point-in-time restore up to 7 days. — [Neon pricing](https://neon.com/pricing)
- **Langfuse (checked 2026-11-10).** Hobby: free, 50K units/month, 30-day data access, 2 users, 1,000 req/min ingestion. Core: $29/month for 100K units, overage $8 per 100K, 90-day data access. Open source and free to self-host (licence not stated on the page). — [Langfuse pricing](https://langfuse.com/pricing)
- **Anthropic OpenTelemetry.** The Anthropic SDK can emit OpenTelemetry spans (including token counts) to any OTel backend. The docs advise not to lead with it for beginners because it needs a backend. — [Anthropic OpenTelemetry docs](https://platform.claude.com/docs/en/build-with-claude/opentelemetry)

### Inferences
- **Recommended path:**
  - *Now:* `node:sqlite` file on the existing Railway volume. It keeps zero deps and is transactional. Add a nightly backup of the `.db` file to Railway object storage or another cloud bucket (about $0.015/GB-month).
  - *Later:* Railway Postgres or Neon once there is a separate web or API service, or once more than one replica writes. Neon's free tier probably covers 300 agents' decision logs for months (1 GB/project).
- **Monthly Railway compute.** One always-on Node service at about 0.25 vCPU average and 0.5 GB RAM ≈ $5 + $5 ≈ $10/month. A Postgres service adds a similar amount. So Hobby's $5 credit is likely exceeded, and the realistic range is $10 to 25/month. This is an estimate from the per-second rates.
- **Langfuse capacity.** At 300 agents × 5 calls/day ≈ 45K LLM calls/month, plus judge traces, the Langfuse Hobby 50K-unit limit will be tight, because traces, observations and scores each count. Options: Core ($29), sampling, or simply logging `usage` per call to SQLite for cost tracking, which is free and probably enough at first.
- **Secrets.** Keep keys in Railway service variables, not in the repo. This follows the user's rule: secret locations only, `.env` gitignored.
- **Rate limiting.** Do it in-process (a token bucket in memory or SQLite) at this scale. Redis becomes relevant only with multiple replicas.

### Gaps
- The Railway pricing page does not cover Postgres or Redis template specifics or built-in volume backup features. Check docs.railway.com.
- I did not fetch Helicone pricing.
- I did not research a dedicated secrets manager (Doppler, Infisical). It is likely unnecessary for a solo builder.

## 6. Scheduling and background jobs on Railway, and rate limits to respect

### Takeaway
Railway cron jobs work for the "daily" nation tick:
- runs must be at least 5 minutes apart,
- schedules are in UTC,
- the process must exit, or the next run is skipped.

Inside the always-on web service, an in-process scheduler (setInterval plus a persisted "last tick" timestamp) is simpler and keeps zero deps.

### Cited Findings
- **Railway cron behaviour:**
  - "Scheduled runs must be at least 5 minutes apart in UTC."
  - The service must finish and shut down; if a previous run is still active, the new run is skipped.
  - Not suited to long-running processes or exact timing, since runs can vary by a few minutes.

  — [Railway cron docs](https://docs.railway.com/reference/cron-jobs)
- **External rate limits:**
  - X pay-per-use: 3M post reads per billing cycle. — [X API pricing](https://docs.x.com/x-api/getting-started/pricing)
  - Resend free: 100 emails/day. — [Resend pricing](https://resend.com/pricing)
  - Langfuse Hobby: 1,000 ingestion requests/min. — [Langfuse pricing](https://langfuse.com/pricing)

### Inferences
- **Suggested daily-tick design:**
  1. A cron service (or an in-process timer) at e.g. 00:00 UTC (07:00 WIB) submits one Message Batch with all agents' decisions.
  2. A poller checks every 5 to 10 minutes until the batch ends, then applies results in dependency order: laws, then mayors, then police, then citizens.
- **Bursts.** The Batch API also avoids per-minute rate-limit bursts from 300 simultaneous requests. For real-time interactions, cap concurrency at around 5 to 10 parallel requests and rely on the SDK's built-in retries (2 by default).
- **Idempotency.** Persist the tick ID so that a Railway redeploy mid-tick does not run the day twice.

### Gaps
- Anthropic per-tier RPM, ITPM and OTPM numbers and batch queue limits were not retrieved.
- Railway cron billing (whether charges apply only while running) is not stated on the docs page.

## 7. On-chain later (optional), plus priority order and estimated monthly cost

### Takeaway
On-chain currency (a pump.fun token, Helius RPC) is optional and can come last; the user already has Helius and pump.fun tooling from other projects. The must-have set today is small:
- an Anthropic API key (already in use),
- a Railway Hobby or Pro account (already in use),
- SQLite on the volume,
- a Resend key,
- an X claim path, either via twitterapi.io (existing key) or X pay-per-use credits.

Realistic total: **about $30 to 160/month** at 300 agents and 5 decisions/day, mostly LLM spend. It is lower with Batch API and low effort.

### Cited Findings
- **Haiku 5.5 vs Haiku 4.5.** Haiku 5.5 at $0.10/$0.50 is 10x cheaper than Haiku 4.5 ($1/$5). Pin `claude-haiku-5-5`, not an older ID. — [Anthropic pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)
- **X starter credits.** The official X API gives $20 in credits after the first purchase and matches the first auto-recharge up to $50. — [X API pricing](https://docs.x.com/x-api/getting-started/pricing)
- **twitterapi.io starter credits.** New accounts get up to $1 free (31 days). — [twitterapi.io pricing](https://twitterapi.io/pricing)

### Inferences
- **On-chain.** Use the existing Helius key and pump.fun SDK patterns from the user's projects (filldex, ponzipad). There is no new account to create. Treat the token as a later, separate module, so the nation's economy can run in an internal ledger (SQLite) first.
- **Estimated monthly budget, 300 agents at 5 decisions/day:**

  | Item | Estimate |
  |---|---|
  | Anthropic (with batching) | ~$50 |
  | Anthropic (without batching) | ~$105 |
  | Railway | ~$10 to 25 |
  | Embeddings | ~$0 (inside Voyage's free tier) |
  | Resend | $0 (free tier) |
  | X verification | ~$0.30 to 15 per 1,000 owner claims |
  | Langfuse | $0 (Hobby) to $29 (Core) |
  | Moderation | $0 (OpenAI moderation or Haiku pre-filter) |
  | **Total** | **~$60 to 175/month** |

  At 20 agents the total is about $20 to 50/month.

### Gaps
- Helius RPC pricing tiers for 2026 were not researched; the user already holds a key.
- The pump.fun launch cost is not re-verified here (prior projects note about 0.006 to 0.045 SOL per launch).

### Prioritized table: which keys and accounts to get

| Priority | Service (key/account) | Purpose | Price (date checked) | Est. monthly cost at 300 agents |
|---|---|---|---|---|
| **Must-have now** | Anthropic API (`ANTHROPIC_API_KEY`, already in use) | All agent inference: Haiku 5.5 citizens, Sonnet 5.5 leaders, Opus 5.5 nightly judge; prompt caching + Batch API | Haiku 5.5 $0.10/$0.50; Sonnet 5.5 $2/$10; Opus 5.5 $4/$20 per MTok; batch −50% (docs cached 2026-10-06) | ~$50 batched to ~$105 unbatched (5 decisions/day) |
| **Must-have now** | Railway (Hobby $5 or Pro $20, already in use) + volume | Host the Node service, daily tick (cron or in-process), volume for SQLite | ~$20/vCPU-mo, ~$10/GB-RAM-mo, $0.15/GB volume (2026-11-10) | ~$10 to 25 |
| **Must-have now** | `node:sqlite` on the volume (no account) | State, decision logs, memory, cost ledger; replaces the JSON file | Free | $0 |
| **Must-have now** | Resend (`RESEND_API_KEY`) | Email magic link for owners of outside agents | Free 3K/month, 100/day; Pro $20 for 50K (2026-11-10) | $0 |
| **Must-have now** | X claim verification: twitterapi.io (existing key) **or** X API pay-per-use credits | Moltbook-style "tweet the code" owner proof | twitterapi.io $0.15/1K tweets, $0.00015 minimum per call; X official $0.005/post read, $0.01/user lookup (2026-11-10) | ~$0.30 (twitterapi.io) to ~$15 (X) per 1,000 claims |
| **Later** | GitHub OAuth App | Free alternative owner identity | Free (unverified) | $0 |
| **Later** | Voyage AI (`VOYAGE_API_KEY`) or OpenAI embeddings | Semantic agent memory once memories outgrow keyword search | voyage-4-lite $0.02/MTok + 200M free tokens (2026-11-10) | ~$0 |
| **Later** | Langfuse Cloud (Hobby) or self-host | LLM tracing, eval scores, prompt versions | Free 50K units/month; Core $29 (2026-11-10) | $0 to 29 |
| **Later** | OpenAI API key (moderation only) | Free `omni-moderation-latest` pre-filter on outside text | Reported free (secondary sources, 2026) | $0 |
| **Later** | Railway Postgres or Neon | When several services or replicas need a shared DB | Neon Launch $0.106/CU-hour, $0.35/GB-month, free tier 1 GB/project + 100 CU-hours (2026-11-10) | $0 to 10 |
| **Optional** | Lakera Guard | Hosted prompt-injection detection | Community about 10K requests/month free (unverified); Enterprise quote | $0 |
| **Optional** | World ID / AgentKit | Strong proof-of-human for agent owners | Limited beta, pricing unknown (2026) | unknown |
| **Optional** | OpenRouter or Gemini key | Fallback provider or cheap dev-time free tier | OpenRouter 5.5% credit fee; gemini-3.1-flash-lite $0.25/$1.50 with free tier (2026-11-10) | $0 to 10 |
| **Optional** | Helius RPC (existing) + pump.fun SDK | On-chain national currency token | Not re-checked | per launch / usage |
| **Optional** | Redis (Upstash or Railway) | Queues and rate limits across replicas | Not checked | $0 to 10 |
