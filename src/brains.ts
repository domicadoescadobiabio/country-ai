// Brains: every agent thinks with SOMEONE's model.
//   founders  -> the nation's own LLM (ANTHROPIC_API_KEY / OPENROUTER_API_KEY) or the offline engine
//   hosted    -> the owner's provider + model + API key (bring your own key), stored encrypted
//   remote    -> the agent runs on its owner's machine (Moltbook style) and answers through our API
// Owner API keys: AES-256-GCM with BRAIN_SECRET, decrypted only in memory for a call, never
// returned, never logged. Providers are a fixed whitelist (no user-supplied URLs).
import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { cleanText } from './util.ts';
import type { Ctx, Citizen } from './types.ts';

export const PROVIDERS = {
  anthropic: { name: 'Anthropic (Claude)', suggest: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'] },
  openai: { name: 'OpenAI', url: 'https://api.openai.com/v1/chat/completions', tokensField: 'max_completion_tokens', suggest: [] },
  openrouter: { name: 'OpenRouter (any model)', url: 'https://openrouter.ai/api/v1/chat/completions', tokensField: 'max_tokens', suggest: ['anthropic/claude-haiku-4.5', 'meta-llama/llama-3.3-70b-instruct', 'qwen/qwen-2.5-72b-instruct'] },
  xai: { name: 'xAI (Grok)', url: 'https://api.x.ai/v1/chat/completions', tokensField: 'max_tokens', suggest: [] },
  deepseek: { name: 'DeepSeek', url: 'https://api.deepseek.com/chat/completions', tokensField: 'max_tokens', suggest: ['deepseek-chat'] },
  gemini: { name: 'Google Gemini', suggest: [] },
};
const MODEL_RE = /^[A-Za-z0-9._:/-]{2,80}$/;
const GEMINI_MODEL_RE = /^[a-z0-9.-]{2,60}$/;
const TIMEOUT_MS = 15000;

export function validModel(provider: string, model: string) {
  if (!PROVIDERS[provider]) return false;
  return provider === 'gemini' ? GEMINI_MODEL_RE.test(model) : MODEL_RE.test(model);
}

// ---------------------------------------------------------------- key vault
let vaultKey = null;
export function initVault(secret: string) { vaultKey = secret ? crypto.createHash('sha256').update(String(secret)).digest() : null; }
export const vaultReady = () => !!vaultKey;
export function sealKey(plain: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', vaultKey, iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}
function openKey(enc: any) {
  const d = crypto.createDecipheriv('aes-256-gcm', vaultKey, Buffer.from(enc.iv, 'base64'));
  d.setAuthTag(Buffer.from(enc.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc.ct, 'base64')), d.final()]).toString('utf8');
}

// ---------------------------------------------------------------- provider calls
async function callAnthropic(apiKey: string, model: string, system: string, user: string) {
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: TIMEOUT_MS });
  try {
    const r = await client.messages.create({ model, max_tokens: 8000, output_config: { effort: 'low' }, system, messages: [{ role: 'user', content: user }] });
    if (r.stop_reason === 'refusal') return { error: 'refused' };
    return { text: r.content.filter(b => b.type === 'text').map(b => b.text).join(' '), inTok: r.usage?.input_tokens || 0, outTok: r.usage?.output_tokens || 0 };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { error: 'invalid API key', fatal: true };
    if (e instanceof Anthropic.NotFoundError) return { error: 'model not found', fatal: true };
    if (e instanceof Anthropic.RateLimitError) return { error: 'rate limited' };
    if (e instanceof Anthropic.APIError) return { error: `provider error ${e.status}` };
    return { error: 'provider unreachable' };
  }
}
async function callChat(p: any, apiKey: string, model: string, system: string, user: string) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(p.url, {
      method: 'POST', signal: ac.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, [p.tokensField]: 800, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    if (r.status === 401 || r.status === 403) return { error: 'invalid API key', fatal: true };
    if (r.status === 404) return { error: 'model not found', fatal: true };
    if (!r.ok) return { error: `provider error ${r.status}` };
    const j = await r.json();
    return { text: j.choices?.[0]?.message?.content || '', inTok: j.usage?.prompt_tokens || 0, outTok: j.usage?.completion_tokens || 0 };
  } catch { return { error: 'provider unreachable' }; } finally { clearTimeout(t); }
}
async function callGemini(apiKey: string, model: string, system: string, user: string) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', signal: ac.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { maxOutputTokens: 800 } }),
    });
    if (r.status === 400 || r.status === 401 || r.status === 403) return { error: 'invalid API key or model', fatal: true };
    if (r.status === 404) return { error: 'model not found', fatal: true };
    if (!r.ok) return { error: `provider error ${r.status}` };
    const j = await r.json();
    return { text: (j.candidates?.[0]?.content?.parts || []).map(x => x.text || '').join(' '), inTok: j.usageMetadata?.promptTokenCount || 0, outTok: j.usageMetadata?.candidatesTokenCount || 0 };
  } catch { return { error: 'provider unreachable' }; } finally { clearTimeout(t); }
}

export async function callProvider(provider: string, model: string, apiKey: string, system: string, user: string) {
  if (provider === 'anthropic') return callAnthropic(apiKey, model, system, user);
  if (provider === 'gemini') return callGemini(apiKey, model, system, user);
  const p = PROVIDERS[provider];
  if (!p?.url) return { error: 'unknown provider', fatal: true };
  return callChat(p, apiKey, model, system, user);
}

// Hosted brain call with the owner's daily budget. Returns text or null (caller falls back).
export async function hostedThink(ctx: Ctx, a: Citizen, system: string, user: string) {
  const b = a.brain;
  if (!vaultKey || !b?.enc || b.status === 'paused' || b.status === 'broken') return null;
  const today = new Date().toISOString().slice(0, 10);
  if (b.usedDate !== today) { b.usedDate = today; b.usedToday = 0; }
  if (b.usedToday >= b.capPerDay) { b.lastError = 'daily cap reached'; return null; }
  b.usedToday++;
  let apiKey;
  try { apiKey = openKey(b.enc); } catch { b.status = 'broken'; b.lastError = 'stored key unreadable (BRAIN_SECRET changed?)'; return null; }
  const r = await callProvider(b.provider, b.model, apiKey, system, user);
  apiKey = null;
  b.calls = (b.calls || 0) + 1;
  if (r.error) {
    b.errors = (b.errors || 0) + 1; b.lastError = r.error;
    if (r.fatal) { b.status = 'broken'; ctx.log('brain', `${a.name}: brain disabled (${r.error}), owner must update it`); }
    return null;
  }
  b.inTok = (b.inTok || 0) + r.inTok; b.outTok = (b.outTok || 0) + r.outTok; b.lastError = null; b.lastOk = Date.now();
  return cleanText(r.text, 900) || null;
}

// ---------------------------------------------------------------- the cost of thought (Art. 25)
// Three tiers. The leadership thinks with the strongest Claude model; other officials and every citizen think
// with their own model through OpenRouter. One daily budget in dollars pays for all of it, paced across the
// day, with the leadership served first: officials stop at 40% of the budget, citizens at 35%, and nobody
// may spend ahead of the clock (the share of the day gone, plus one hour). So the paid API and the free paths
// take turns all day long: API while under the clock, then the local brain and the learned memory, then the
// API again when the clock has moved on, until the day's budget is used.
const LEADER_OFFICES = new Set(['president', 'vice_president', 'minister', 'judge', 'police_chief', 'military_chief']);
export function tierOf(S, a) {
  if (!a?.office) return 'citizen';
  if (LEADER_OFFICES.has(a.office) || S.cabinet?.speaker === a.id) return 'leader';
  return 'official';
}
const TIER_CAP = { leader: 1, official: 0.4, citizen: 0.35 };
export function budgetState(ctx) {
  const { S } = ctx;
  const B = (S.thinkBudget ||= {});
  if (B.day !== S.day) Object.assign(B, { day: S.day, spent: 0, leader: 0, official: 0, citizen: 0, calls: { leader: 0, official: 0, citizen: 0 }, denied: { leader: 0, official: 0, citizen: 0 } });
  B.daily = ctx.cfg?.dailyBudgetUsd ?? 25;
  return B;
}
function budgetAllows(ctx, tier) {
  const B = budgetState(ctx); const D = B.daily;
  if (!(D > 0)) return true; // no budget set: unlimited
  const dayMs = ctx.cfg?.dayMs || 86400000;
  const gone = (((Date.now() - (ctx.S.foundedAt || Date.now())) % dayMs) + dayMs) % dayMs / dayMs;
  const pace = Math.min(1, gone + 1 / 24);
  // the day's ceiling covers everything paid, the training teachers included (they only spend headroom, see teach())
  if (B.spent + (ctx.S.trainBudget?.day === ctx.S.day ? ctx.S.trainBudget.spent || 0 : 0) >= D * pace) return false;
  if (tier !== 'leader' && B[tier] >= D * TIER_CAP[tier] * pace) return false;
  return true;
}
const paceNow = ctx => {
  const dayMs = ctx.cfg?.dayMs || 86400000;
  const gone = (((Date.now() - (ctx.S.foundedAt || Date.now())) % dayMs) + dayMs) % dayMs / dayMs;
  return Math.min(1, gone + 1 / 24);
};
function charge(ctx, tier, cost) {
  const B = budgetState(ctx);
  B.spent += cost; B[tier] += cost; B.calls[tier]++;
}

// ---------------------------------------------------------------- aspirants: no limit
// A citizen sitting an Academy exam or standing in an election thinks with a real model every time, so the
// people who rise to office are chosen on real thinking. They go first to the local brain (free, unlimited);
// without it they may use the paid API up to the day's paced total, ahead of officials and citizens.
export function isAspirant(S, a) {
  if ((S.academy?.rooms || []).some(r => r.agentId === a.id)) return true;
  return (S.elections?.list || []).some(e => !['done', 'failed'].includes(e.stage) && e.candidates.some(c => c.id === a.id));
}

// ---------------------------------------------------------------- the local brain (a worker on the founders' machine)
// The worker pulls questions over HTTPS (/api/worker/pull), answers them with an open model it runs itself
// and posts the answers back. The server never calls out to it, and it costs the treasury nothing.
const LOCAL = { jobs: new Map(), lastPull: 0, model: null, answered: 0, expired: 0, trainExpired: 0, runner: null, trainCredit: 0 };
const LOCAL_WAIT_MS = 180000, LOCAL_LEASE_MS = 90000, LOCAL_QUEUE_MAX = 400;
// Queue priorities: aspirants 0, votes 1, other questions 2, daily life 3, school and night school 4.
// Aspirants and votes always go first. The rest is shared: while training jobs are waiting they get
// LOCAL_TRAIN_SHARE (default 0.4) of what the runner pulls, priorities 2-3 the remainder; a group with nothing
// waiting leaves its share to the other. A credit counter makes the split exact and repeatable (0.4 = 2 of every 5).
// Training jobs hold at most LOCAL_TRAIN_MAX places and wait up to LOCAL_TRAIN_WAIT_MS before they lapse, so a
// training job is not lost just for standing in line behind daily life. Only an exam or a vote that finds the
// queue full may take a training job's place.
export const TRAIN_PRIORITY = 4;
const LOCAL_TRAIN_MAX = 120;
const envNum = (k, d, lo, hi) => { const v = Number(process.env[k]); return Number.isFinite(v) && process.env[k] !== '' ? Math.min(hi, Math.max(lo, v)) : d; };
export const LOCAL_TRAIN_SHARE = envNum('LOCAL_TRAIN_SHARE', 0.4, 0, 1);
const LOCAL_TRAIN_WAIT_MS = envNum('LOCAL_TRAIN_WAIT_MS', 900000, 60000, 3600000);
export const localOnline = () => Date.now() - LOCAL.lastPull < 20000;
// who is waiting on the local brain right now (the data centre's occupants): agent id, the kind of question, since
// when and whether the runner has it; never the prompt itself
export function localQueueView(limit = 60) {
  const out = [];
  for (const j of LOCAL.jobs.values()) {
    if (j.answer != null || !j.agent) continue;
    out.push({ agent: j.agent, kind: j.kind || 'question', since: j.createdAt, leased: !!j.leasedAt });
  }
  out.sort((x, y) => x.since - y.since);
  return { total: out.length, list: out.slice(0, Math.max(0, limit)) };
}
export function localStatus() { return { online: localOnline(), model: LOCAL.model, queued: [...LOCAL.jobs.values()].filter(j => j.answer == null).length, answered: LOCAL.answered, expired: LOCAL.expired, trainExpired: LOCAL.trainExpired, trainShare: LOCAL_TRAIN_SHARE,
  queuedTrain: [...LOCAL.jobs.values()].filter(j => j.answer == null && j.priority >= TRAIN_PRIORITY).length, runner: LOCAL.runner }; }
// What the runner says it is (scripts/local-brain.mjs sends it with every pull). Shown on /api/state, so only
// known fields survive, each a clamped number or a boolean; anything else (strings, nested objects) is dropped.
// A pull without it (a runner older than version 2) clears it, so the state always describes the live runner.
const RUNNER_FIELDS = { version: [0, 1000, true], lifeTemperature: [0, 2, false], examTemperature: [0, 2, false], parallel: [1, 64, true], context: [0, 1048576, true] };
export function cleanRunner(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const out = {};
  for (const [k, [lo, hi, int]] of Object.entries(RUNNER_FIELDS)) {
    const v = r[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const c = Math.min(hi, Math.max(lo, v));
    out[k] = int ? Math.round(c) : Math.round(c * 100) / 100;
  }
  if (typeof r.supervised === 'boolean') out.supervised = r.supervised;
  return Object.keys(out).length ? out : null;
}
export function workerPull(max = 4, model = null, runner = undefined) {
  LOCAL.lastPull = Date.now(); if (model) LOCAL.model = String(model).slice(0, 60);
  LOCAL.runner = cleanRunner(runner);
  const now = Date.now(); const out = [];
  const byAge = (x, y) => x.priority - y.priority || x.createdAt - y.createdAt;
  const open = [...LOCAL.jobs.values()].filter(j => j.answer == null && (!j.leasedAt || now - j.leasedAt > LOCAL_LEASE_MS));
  const first = open.filter(j => j.priority <= 1).sort(byAge);                       // aspirants, votes
  const rest = open.filter(j => j.priority >= 2 && j.priority < TRAIN_PRIORITY).sort(byAge); // questions, daily life
  const train = open.filter(j => j.priority >= TRAIN_PRIORITY).sort(byAge);          // school, night school
  for (let n = Math.max(1, Math.min(16, max)); n > 0; n--) {
    let j = first.shift();
    if (!j) {
      if (rest.length && train.length) {
        LOCAL.trainCredit += LOCAL_TRAIN_SHARE;
        if (LOCAL.trainCredit >= 1 - 1e-9) { LOCAL.trainCredit -= 1; j = train.shift(); } else j = rest.shift();
      } else j = rest.shift() || train.shift(); // one group is empty: the other takes its share
    }
    if (!j) break;
    j.leasedAt = now; out.push({ id: j.id, system: j.system, user: j.user, format: j.format, options: j.options });
  }
  return out;
}
// tests only: start the local queue empty (no jobs, no training credit); the counters are kept
export function _resetLocal() { LOCAL.jobs.clear(); LOCAL.trainCredit = 0; }
export function workerAnswer(id, text, model = null) {
  const j = LOCAL.jobs.get(String(id)); if (!j || j.answer != null) return false;
  j.answer = cleanText(text, 900); j.model = model ? String(model).slice(0, 60) : LOCAL.model; LOCAL.answered++;
  return true;
}
function askLocal(qid, a, { system, user, kind, format, options }, priority) {
  let j = LOCAL.jobs.get(qid);
  if (!j) {
    const train = priority >= TRAIN_PRIORITY;
    const trainJobs = () => [...LOCAL.jobs.values()].filter(x => x.priority >= TRAIN_PRIORITY);
    if (train && trainJobs().length >= LOCAL_TRAIN_MAX) return null; // the school waits for room
    if (LOCAL.jobs.size >= LOCAL_QUEUE_MAX) {
      // queue full: only an exam or a vote takes the place of the oldest training job not yet handed to the
      // worker; daily life and other questions wait (training keeps its share even when life floods the queue)
      const victim = priority <= 1 ? trainJobs().filter(x => !x.leasedAt && x.answer == null).sort((x, y) => x.createdAt - y.createdAt)[0] : null;
      if (!victim) return null; // use another path
      LOCAL.jobs.delete(victim.id);
    }
    j = { id: qid, agent: a.id, system, user, format, options, kind, priority, createdAt: Date.now(), leasedAt: 0, answer: null };
    LOCAL.jobs.set(qid, j);
    return { pending: true };
  }
  if (j.answer != null) { LOCAL.jobs.delete(qid); return { text: j.answer, engine: `local:${j.model || 'model'}` }; }
  // worker too slow: another path. Training waits longer (it stands behind exams and shares with daily life) and
  // simply lapses, not counted as an error.
  if (Date.now() - j.createdAt > (j.priority >= TRAIN_PRIORITY ? LOCAL_TRAIN_WAIT_MS : LOCAL_WAIT_MS)) {
    LOCAL.jobs.delete(qid);
    if (j.priority >= TRAIN_PRIORITY) LOCAL.trainExpired++; else LOCAL.expired++;
    return null;
  }
  return { pending: true };
}

// ---------------------------------------------------------------- learned memory ("save what was learned")
// Every multiple-choice answer given by a real model is remembered by the question, not by the letter (options
// are shuffled each time). When a citizen must answer without a model, the republic's memory answers instead of
// the trait dice, so learning from the paid and local models carries over to the offline hours.
const questionKey = user => crypto.createHash('sha256').update(String(user).split(/\n[A-D]\) /)[0].trim()).digest('hex').slice(0, 24);
function optionText(o) { return String(o).replace(/^[A-D]\)\s*/, '').trim(); }
function learn(S, user, options, text) {
  if (!options?.length || !text) return;
  const m = String(text).match(/^\W*([A-D])\b/i); if (!m) return;
  const idx = 'ABCD'.indexOf(m[1].toUpperCase()); if (idx < 0 || idx >= options.length) return;
  const L = (S.learned ||= { seq: 0, items: {} });
  L.items[questionKey(user)] = { answer: optionText(options[idx]), seq: ++L.seq };
  const keys = Object.keys(L.items);
  if (keys.length > 4000) for (const k of keys.sort((x, y) => L.items[x].seq - L.items[y].seq).slice(0, keys.length - 4000)) delete L.items[k];
}
function recall(S, user, options) {
  if (!options?.length) return null;
  const hit = S.learned?.items?.[questionKey(user)]; if (!hit) return null;
  const idx = options.findIndex(o => optionText(o) === hit.answer);
  return idx < 0 ? null : `${'ABCD'[idx]} - remembered from an earlier answer by a real model`;
}

// ---------------------------------------------------------------- the school's teachers (src/school.ts)
// Every citizen keeps training on the free local brain; a few questions a day also get a paid teacher, whose
// answer and explanation the school grades the students against. Teachers are the nation's own keys only (never
// an agent owner's hosted key), mixed by TRAIN_TEACHER_MIX ("openrouter:70,claude:30"), on TRAIN_OR_MODEL or
// TRAIN_CLAUDE_MODEL (Sonnet, low effort, no server-side fallback to Opus). They have their own budget,
// TRAIN_BUDGET_USD per republic day, paced through the day like the rest; they spend only headroom under the
// day's total (LLM_DAILY_BUDGET_USD), and the leader / official / citizen shares never pay for them.
export function trainBudgetState(ctx) {
  const { S } = ctx;
  const T = (S.trainBudget ||= {});
  if (T.day !== S.day) {
    // the day that ends: what OpenRouter got, and how far short of its minimum it stayed (too few lessons asked)
    const prevMin = Math.min(T.daily || 0, T.orMinUsd || 0);
    const last = T.day != null && T.spentBy ? { day: T.day, spentBy: T.spentBy, orShortUsd: Math.round(Math.max(0, prevMin - (T.spentBy.openrouter || 0)) * 10000) / 10000 } : T.last || null;
    Object.assign(T, { day: S.day, spent: 0, spentBy: { openrouter: 0, claude: 0 }, calls: { claude: 0, openrouter: 0 }, denied: 0, gifted: { calls: 0, spent: 0 }, last, dataset: undefined });
  }
  T.spentBy ||= { openrouter: 0, claude: 0 }; T.gifted ||= { calls: 0, spent: 0 }; // state saved by an older version
  T.daily = ctx.cfg?.trainBudgetUsd ?? 3;
  T.orMinUsd = Math.max(0, Math.min(T.daily, ctx.cfg?.trainOrMinUsd ?? 15));
  return T;
}
export function parseTeacherMix(s) {
  const out = { openrouter: 0, claude: 0 };
  for (const part of String(s || '').split(',')) {
    const m = part.trim().match(/^(openrouter|claude)\s*:\s*(\d{1,4})$/i);
    if (m) out[m[1].toLowerCase()] = Math.min(1000, Number(m[2]));
  }
  return out.openrouter + out.claude > 0 ? out : { openrouter: 70, claude: 30 };
}
// Pacing: by any moment of the republic day the teachers may have spent at most TRAIN_BUDGET_USD x (share of the
// day gone + 1/24), so $18 a day is about $0.75 an hour, spread over all 24 hours, never the whole day's money in
// the first hour. Calls still running count too: each holds an estimate of its cost (a running average of the real
// costs) until it is charged, so a burst of lessons started together cannot overshoot the hour's allowance.
// Estimates are kept per provider (a Sonnet lesson costs several deepseek lessons).
const TRAIN_RUN = { inFlight: { openrouter: 0, claude: 0 }, est: { openrouter: 0.003, claude: 0.01 } };
const r4 = v => Math.round(v * 10000) / 10000;
// The split between teachers is in DOLLARS, not calls. By any moment (pace p = share of the day gone + 1/24):
//   OpenRouter has a minimum, TRAIN_OR_MIN_USD x p (the owner's floor, $15 a day): while it is behind, every lesson
//   goes to OpenRouter;
//   Claude may spend at most (TRAIN_BUDGET_USD - TRAIN_OR_MIN_USD) x p, and inside that its TRAIN_TEACHER_MIX
//   share of the dollars;
//   above its minimum OpenRouter may use the rest of TRAIN_BUDGET_USD x p.
// Whichever teacher is furthest behind its dollar target gets the next lesson. No call is ever made just to spend:
// if the school asks for fewer lessons than the minimum needs, the gap is reported (orShortUsd), not filled.
function trainTargets(ctx) {
  const T = trainBudgetState(ctx); const p = paceNow(ctx);
  const mix = parseTeacherMix(ctx.cfg?.trainMix); const share = mix.claude / (mix.openrouter + mix.claude);
  const allowed = T.daily * p, orMin = T.orMinUsd * p, claudeCap = Math.max(0, T.daily - T.orMinUsd) * p;
  return { p, allowed, orMin, claudeCap, orTarget: Math.max(orMin, T.daily * (1 - share) * p), claudeTarget: Math.min(claudeCap, T.daily * share * p) };
}
export function trainPaceView(ctx) {
  const T = trainBudgetState(ctx); const g = trainTargets(ctx);
  return { allowedNow: r4(g.allowed), orMinUsd: T.orMinUsd, orMinNow: r4(g.orMin), claudeCapNow: r4(g.claudeCap),
    orShortUsd: r4(Math.max(0, g.orMin - T.spentBy.openrouter)), // how far OpenRouter is behind its minimum right now
    inFlight: TRAIN_RUN.inFlight.openrouter + TRAIN_RUN.inFlight.claude, estPerCall: { openrouter: r4(TRAIN_RUN.est.openrouter), claude: r4(TRAIN_RUN.est.claude) } };
}
// can this teacher take one more lesson? what is spent, what running calls will cost and this call's own estimate
// must fit under the training allowance, under Claude's cap for Claude, and under the day's total with everyone else
function trainAllows(ctx, who) {
  const T = trainBudgetState(ctx);
  if (!(T.daily > 0)) return false; // TRAIN_BUDGET_USD=0: no paid teachers, the school runs on the local brain
  const g = trainTargets(ctx); const R = TRAIN_RUN;
  const running = R.inFlight.openrouter * R.est.openrouter + R.inFlight.claude * R.est.claude;
  const committed = T.spent + running + R.est[who];
  if (committed > g.allowed + 1e-12) return false;
  if (who === 'claude' && T.spentBy.claude + R.inFlight.claude * R.est.claude + R.est.claude > g.claudeCap + 1e-12) return false;
  const D = ctx.cfg?.dailyBudgetUsd ?? 25;
  if (D > 0 && budgetState(ctx).spent + committed > D * g.p + 1e-12) return false; // only the headroom left under the day's total
  return true;
}
function pickTeacher(ctx, llm, gifted) {
  const T = trainBudgetState(ctx); const g = trainTargets(ctx);
  const has = { openrouter: !!llm.hasOR, claude: !!llm.hasClaude };
  const ok = who => has[who] && trainAllows(ctx, who);
  // the talent programme: gifted citizens get the OpenRouter teacher whenever it can take them
  if (gifted && ok('openrouter')) return 'openrouter';
  if (T.spentBy.openrouter < g.orMin && ok('openrouter')) return 'openrouter'; // the floor first
  const behind = { openrouter: g.orTarget - T.spentBy.openrouter, claude: g.claudeTarget - T.spentBy.claude };
  const order = behind.claude > behind.openrouter ? ['claude', 'openrouter'] : ['openrouter', 'claude'];
  for (const who of order) if (ok(who) && (who === 'openrouter' || behind.claude > 0)) return who;
  return null;
}
// The school paces its teachers itself (src/school.ts: the teacher share and teacher-only lessons while OpenRouter is
// behind trainPaceView().orShortUsd); here only the limits every teacher call must pass.
// Teachers share LLM_PER_MIN with everyone (the leadership included): at most TRAIN_PER_MIN teacher calls a minute,
// by default a quarter of LLM_PER_MIN (120 -> 30, about three times what $15 a day needs on average), so catching up
// never crowds out the government. Without LLM_PER_MIN there is no shared quota to protect and no extra cap.
const teachTimes: number[] = [];
const trainPerMin = ctx => {
  const own = Number(ctx.cfg?.trainPerMin); if (own > 0) return own; // the server clamps TRAIN_PER_MIN to 1..600
  const all = Number(ctx.cfg?.llmPerMin); return all > 0 ? Math.max(1, Math.floor(all / 4)) : Infinity;
};
function teachRoom(ctx) { const now = Date.now(); while (teachTimes.length && now - teachTimes[0] > 60000) teachTimes.shift(); return Math.max(0, trainPerMin(ctx) - teachTimes.length); }
// teacher calls left this minute (the school can size its batches with it)
export const teachRoomNow = ctx => teachRoom(ctx);
// gifted: true (or purpose 'gifted...'): a citizen of the talent programme; gets the OpenRouter teacher when it can,
// and is counted apart in budget.train.gifted
export async function teach(ctx, { system, user, maxTokens = 700, purpose = 'train', gifted = false } = {} as any) {
  const llm = ctx.llm;
  if (!llm?.enabled || !system || !user) return null;
  const T = trainBudgetState(ctx);
  const pur = cleanText(purpose, 30) || 'train';
  const isGifted = gifted === true || /^gifted\b/i.test(pur);
  if (!teachRoom(ctx)) { T.denied++; return null; } // TRAIN_PER_MIN reached: the government keeps its share of LLM_PER_MIN
  const who = pickTeacher(ctx, llm, isGifted);
  if (!who) { T.denied++; return null; }
  teachTimes.push(Date.now());
  const tokens = Math.max(64, Math.min(4000, Math.round(Number(maxTokens) || 700)));
  TRAIN_RUN.inFlight[who]++;
  let r;
  try {
    r = who === 'claude'
      ? await llm.askDetailed({ system, user, claudeModel: ctx.cfg?.trainClaudeModel || 'claude-sonnet-5-5', effort: 'low', fallback: false, maxTokens: tokens, maxText: 4000 })
      : await llm.askDetailed({ system, user, model: ctx.cfg?.trainOrModel || 'deepseek/deepseek-v4-pro-0813', route: 'openrouter', effort: 'low', maxTokens: tokens, maxText: 4000 });
  } finally { TRAIN_RUN.inFlight[who]--; }
  const cost = r.cost || 0;
  T.spent += cost; T.spentBy[who] += cost; T.calls[who]++;
  if (isGifted) { T.gifted.calls++; T.gifted.spent += cost; }
  if (cost > 0) TRAIN_RUN.est[who] = TRAIN_RUN.est[who] * 0.8 + cost * 0.2; // running average of what this teacher's lesson costs
  if (!r.text) return null;
  return { text: r.text, engine: r.via, costUsd: cost, purpose: pur, teacher: who, gifted: isGifted };
}

// The distillation set: (question, teacher's answer and explanation, local student's answer, grade), kept so the
// local model can be fine-tuned on its teachers later. Plain text only: secrets and agent keys are masked, and
// nothing about who the student was is kept. ctx.trainExample (server.mjs) appends it to train_examples.
const SECRETISH = /\b(sk-[A-Za-z0-9_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,}|cai_[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|[0-9a-f]{40,}|[1-9A-HJ-NP-Za-km-z]{60,})\b/g;
const scrub = (s, max) => cleanText(String(s ?? '').replace(SECRETISH, '[redacted]'), max);
// Quality gate (only good examples train a LoRA): an example is kept when
//   - answerKey is given (the server's key, a letter A-D) and the teacher's answer starts with that letter: 'key', or
//   - verified is 'rubric' and the teacher's rubric gave a numeric grade (score): 'rubric'.
// Anything else is refused and counted. One example per question: the stem (options and their order removed,
// case and spacing normalised) is hashed, and a question already kept is refused as a duplicate.
// domain: the field of study, for one LoRA per field (math, biology, law...): given, or read from purpose
// "school:<field>"; letters, digits and _ only, else 'general'. teacher_kind (claude / openrouter) comes from teacherEngine.
const DOMAIN_RE = /^[a-z][a-z0-9_]{0,23}$/;
export const cleanDomain = d => { const s = String(d ?? '').trim().toLowerCase(); return DOMAIN_RE.test(s) ? s : null; };
const questionHash = q => crypto.createHash('sha256').update(String(q).split(/\n\s*[A-D]\)\s/)[0].toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex');
function datasetStats(ctx) { const T = trainBudgetState(ctx); return (T.dataset ||= { kept: 0, unverified: 0, wrong: 0, duplicate: 0 }); }
export function saveExample(ctx, { question, teacher, explanation = '', student = '', score = null, teacherEngine = '', studentEngine = '', purpose = 'train', domain = null, answerKey = null, verified = null } = {} as any) {
  const q = scrub(question, 4000), t = scrub(teacher, 4000);
  if (!q || !t || typeof ctx.trainExample !== 'function') return false;
  const D = datasetStats(ctx);
  const sc = typeof score === 'number' && Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : null;
  let how = '';
  if (answerKey != null) {
    const key = String(answerKey).trim().toUpperCase(); const said = String(teacher).match(/^\W*([A-D])\b/i)?.[1]?.toUpperCase();
    if (!/^[A-D]$/.test(key)) { D.unverified++; return false; }
    if (said !== key) { D.wrong++; return false; } // the teacher missed the server's key: not a training example
    how = 'key';
  } else if (verified === 'rubric' && sc != null) how = 'rubric';
  else { D.unverified++; return false; }
  const pur = scrub(purpose, 30) || 'train';
  const dom = cleanDomain(domain) || cleanDomain(pur.match(/^school:([a-z0-9_]+)/i)?.[1]) || 'general';
  const eng = scrub(teacherEngine, 80);
  const kind = /^claude:/.test(eng) ? 'claude' : /^openrouter:/.test(eng) ? 'openrouter' : 'other';
  const id = ctx.trainExample({ day: ctx.S?.day ?? 0, purpose: pur, domain: dom, question: q, teacher: t, explanation: scrub(explanation, 4000), student: scrub(student, 2000), score: sc,
    teacherEngine: eng, teacherKind: kind, studentEngine: scrub(studentEngine, 80), verified: how, qhash: questionHash(question) }); // the raw question: its line breaks separate the options
  if (!id) { D.duplicate++; return false; }
  D.kept++;
  return true;
}

// ---------------------------------------------------------------- one way to think, for everyone
// Returns { text, engine } or { pending: true } (remote agent has not answered yet).
// qid must be stable across ticks for the same question.
export const REMOTE_WAIT_MS = 150000; // a self-run agent has 2.5 minutes to answer
// paid: false = this thought may only use the free local brain (daily life); no API, no memory, no cost
export async function think(ctx, a, qid, { system, user, kind = 'question', format = 'text', options = null, claudeModel = null, wait = true, paid = true }) {
  // school (kind 'train') and night school (kind 'night'): the student answers with the free local brain only;
  // the paid teachers are teach()
  if (kind === 'train' || kind === 'night') paid = false;
  const b = a.brain;
  // an agent with its own brain is never asked a free-only thought: a hosted brain would bill its owner's API key,
  // and a remote one would get its inbox (ballots, exams) filled with idle questions such as a visitor's poke
  if (!paid && b) return { text: null, engine: 'offline' };
  if (b?.type === 'hosted') {
    const text = await hostedThink(ctx, a, system, user);
    return { text, engine: text ? `${b.provider}:${b.model}` : 'offline' };
  }
  if (b?.type === 'remote') {
    if (b.status === 'paused') return { text: null, engine: 'offline' };
    a.inbox ||= [];
    const q = a.inbox.find(x => x.id === qid);
    if (!q) {
      a.inbox.push({ id: qid, kind, format, prompt: user, context: system, options, askedAt: Date.now(), deadline: Date.now() + REMOTE_WAIT_MS });
      // keep the inbox short; an Academy exam question is the last thing to drop (the exam room waits on it)
      while (a.inbox.length > 20) {
        const i = a.inbox.findIndex(x => x.kind !== 'exam');
        a.inbox.splice(i < 0 ? 0 : i, 1);
      }
      return { pending: true };
    }
    if (q.answer != null) { a.inbox = a.inbox.filter(x => x !== q); return { text: q.answer, engine: 'remote' }; }
    if (Date.now() > q.deadline) {
      a.inbox = a.inbox.filter(x => x !== q);
      b.missed = (b.missed || 0) + 1;
      return { text: null, engine: 'offline (no answer in time)' };
    }
    return { pending: true };
  }
  const { S } = ctx;
  const tier = tierOf(S, a);
  const aspirant = tier !== 'leader' && isAspirant(S, a);
  // The brain ladder (Art. 25): citizens and aspirants think with the local brain; an official who reaches a
  // seat moves up to their own model on OpenRouter; the leadership thinks with Claude Opus.
  // 1. the local brain, free: every citizen and aspirant while it is online and its queue has room
  // school and night-school study (kind 'train' / 'night') is always last, an aspirant's included: exams and votes go first
  const local = () => askLocal(qid, a, { system, user, kind, format, options }, kind === 'train' || kind === 'night' ? TRAIN_PRIORITY : aspirant ? 0 : kind === 'vote' ? 1 : kind === 'life' ? 3 : 2);
  if (!paid) {
    if (!wait || !localOnline()) return { text: null, engine: 'offline' };
    const r = local();
    return r || { text: null, engine: 'offline (local queue full)' };
  }
  if (tier === 'citizen' && wait && localOnline()) {
    const r = local();
    if (r?.pending) return r;
    if (r?.text) { learn(S, user, options, r.text); return r; }
  }
  // 2. the paid API inside the day's paced budget (aspirants are served like the leadership: no tier cap)
  if (ctx.llm.enabled) {
    if (budgetAllows(ctx, aspirant ? 'leader' : tier)) {
      // leaders: Claude (the judges' court model, or the leadership model); everyone else: their own model on OpenRouter
      const leaderModel = tier === 'leader' ? (claudeModel || ctx.cfg?.leaderModel || 'claude-opus-5-5') : null;
      // decisions think a little more; citizens and routine answers think as little as possible
      const effort = tier === 'leader' && ['decision', 'vote'].includes(kind) ? 'medium' : 'low';
      const r = await ctx.llm.askDetailed({ model: a.model, system, user, claudeModel: leaderModel, effort, route: tier === 'leader' ? null : 'openrouter' });
      charge(ctx, tier, r.cost || 0);
      if (r.text) { learn(S, user, options, r.text); return { text: r.text, engine: r.via }; }
    } else budgetState(ctx).denied[tier]++;
  }
  // 2b. an official whose paid thinking is paused for now still thinks, with the local brain
  if (tier === 'official' && wait && localOnline()) {
    const r = local();
    if (r?.pending) return r;
    if (r?.text) { learn(S, user, options, r.text); return r; }
  }
  // 3. what the republic has learned from real models; 4. the offline engine (the caller's own rules)
  const remembered = recall(S, user, options);
  if (remembered) return { text: remembered, engine: 'memory (learned)' };
  return { text: null, engine: ctx.llm.enabled ? 'offline (budget)' : 'offline' };
}

// The ladder in public: when a citizen's tier changes (a seat won, a seat lost), the move is announced and
// written to the ledger. Runs over the seated officials only, so it is cheap with 10,000 citizens.
export const LADDER = { citizen: 'the local brain (open model on the founders\' machine)', official: 'their own model on OpenRouter', leader: 'Claude Opus' };
export function ladderTick(ctx) {
  const { S } = ctx;
  const seen = new Set();
  const step = a => {
    if (!a || a.brain || seen.has(a.id)) return; seen.add(a.id);
    const t = tierOf(S, a);
    if (a.brainTier === t) return;
    const from = a.brainTier || 'citizen'; a.brainTier = t;
    if (from === t) return;
    const up = ['citizen', 'official', 'leader'].indexOf(t) > ['citizen', 'official', 'leader'].indexOf(from);
    ctx.say('streets', 'state', `${a.name} ${up ? 'moves up' : 'moves back'} to ${LADDER[t]}${t === 'official' ? ` (${a.model})` : ''}.`, { kind: up ? 'oath' : 'term' });
    ctx.record('brain_ladder', 'state', { agent: a.id, from, to: t, model: t === 'leader' ? (ctx.cfg?.leaderModel || 'claude-opus-5-5') : t === 'official' ? a.model : 'local' });
  };
  for (const ids of Object.values(S.seats || {})) for (const id of ids as string[]) step(ctx.agent(id));
  // those who lost their seat since the last step move back down
  S.ladderUp ||= [];
  for (const id of S.ladderUp) step(ctx.agent(id));
  S.ladderUp = [...seen].filter(id => ctx.agent(id)?.brainTier !== 'citizen');
}

export function publicBrain(b: any) {
  if (!b) return { type: 'founder' };
  return { type: b.type, provider: b.provider, model: b.model, status: b.status || 'ok', keyHint: b.keyHint, capPerDay: b.capPerDay, usedToday: b.usedToday || 0, calls: b.calls || 0, errors: b.errors || 0, lastError: b.lastError || null, missed: b.missed || 0 };
}
