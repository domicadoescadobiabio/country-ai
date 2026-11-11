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
  if (B.spent >= D * pace) return false;
  if (tier !== 'leader' && B[tier] >= D * TIER_CAP[tier] * pace) return false;
  return true;
}
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
const LOCAL = { jobs: new Map(), lastPull: 0, model: null, answered: 0, expired: 0 };
const LOCAL_WAIT_MS = 180000, LOCAL_LEASE_MS = 90000, LOCAL_QUEUE_MAX = 400;
export const localOnline = () => Date.now() - LOCAL.lastPull < 20000;
export function localStatus() { return { online: localOnline(), model: LOCAL.model, queued: [...LOCAL.jobs.values()].filter(j => j.answer == null).length, answered: LOCAL.answered, expired: LOCAL.expired }; }
export function workerPull(max = 4, model = null) {
  LOCAL.lastPull = Date.now(); if (model) LOCAL.model = String(model).slice(0, 60);
  const now = Date.now(); const out = [];
  const open = [...LOCAL.jobs.values()].filter(j => j.answer == null && (!j.leasedAt || now - j.leasedAt > LOCAL_LEASE_MS)).sort((x, y) => x.priority - y.priority || x.createdAt - y.createdAt);
  for (const j of open.slice(0, Math.max(1, Math.min(16, max)))) { j.leasedAt = now; out.push({ id: j.id, system: j.system, user: j.user, format: j.format, options: j.options }); }
  return out;
}
export function workerAnswer(id, text, model = null) {
  const j = LOCAL.jobs.get(String(id)); if (!j || j.answer != null) return false;
  j.answer = cleanText(text, 900); j.model = model ? String(model).slice(0, 60) : LOCAL.model; LOCAL.answered++;
  return true;
}
function askLocal(qid, a, { system, user, kind, format, options }, priority) {
  let j = LOCAL.jobs.get(qid);
  if (!j) {
    if (LOCAL.jobs.size >= LOCAL_QUEUE_MAX) return null; // queue full: use another path
    j = { id: qid, agent: a.id, system, user, format, options, kind, priority, createdAt: Date.now(), leasedAt: 0, answer: null };
    LOCAL.jobs.set(qid, j);
    return { pending: true };
  }
  if (j.answer != null) { LOCAL.jobs.delete(qid); return { text: j.answer, engine: `local:${j.model || 'model'}` }; }
  if (Date.now() - j.createdAt > LOCAL_WAIT_MS) { LOCAL.jobs.delete(qid); LOCAL.expired++; return null; } // worker too slow: another path
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

// ---------------------------------------------------------------- one way to think, for everyone
// Returns { text, engine } or { pending: true } (remote agent has not answered yet).
// qid must be stable across ticks for the same question.
export const REMOTE_WAIT_MS = 150000; // a self-run agent has 2.5 minutes to answer
// paid: false = this thought may only use the free local brain (daily life); no API, no memory, no cost
export async function think(ctx, a, qid, { system, user, kind = 'question', format = 'text', options = null, claudeModel = null, wait = true, paid = true }) {
  const b = a.brain;
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
  const local = () => askLocal(qid, a, { system, user, kind, format, options }, aspirant ? 0 : kind === 'vote' ? 1 : kind === 'life' ? 3 : 2);
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
