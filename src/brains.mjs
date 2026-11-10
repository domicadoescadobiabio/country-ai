// Brains: every agent thinks with SOMEONE's model.
//   founders  -> the nation's own LLM (ANTHROPIC_API_KEY / OPENROUTER_API_KEY) or the offline engine
//   hosted    -> the owner's provider + model + API key (bring your own key), stored encrypted
//   remote    -> the agent runs on its owner's machine (Moltbook style) and answers through our API
// Owner API keys: AES-256-GCM with BRAIN_SECRET, decrypted only in memory for a call, never
// returned, never logged. Providers are a fixed whitelist (no user-supplied URLs).
import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { cleanText } from './util.mjs';

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

export function validModel(provider, model) {
  if (!PROVIDERS[provider]) return false;
  return provider === 'gemini' ? GEMINI_MODEL_RE.test(model) : MODEL_RE.test(model);
}

// ---------------------------------------------------------------- key vault
let vaultKey = null;
export function initVault(secret) { vaultKey = secret ? crypto.createHash('sha256').update(String(secret)).digest() : null; }
export const vaultReady = () => !!vaultKey;
export function sealKey(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', vaultKey, iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}
function openKey(enc) {
  const d = crypto.createDecipheriv('aes-256-gcm', vaultKey, Buffer.from(enc.iv, 'base64'));
  d.setAuthTag(Buffer.from(enc.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc.ct, 'base64')), d.final()]).toString('utf8');
}

// ---------------------------------------------------------------- provider calls
async function callAnthropic(apiKey, model, system, user) {
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: TIMEOUT_MS });
  try {
    const r = await client.messages.create({ model, max_tokens: 1024, output_config: { effort: 'low' }, system, messages: [{ role: 'user', content: user }] });
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
async function callChat(p, apiKey, model, system, user) {
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
async function callGemini(apiKey, model, system, user) {
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

export async function callProvider(provider, model, apiKey, system, user) {
  if (provider === 'anthropic') return callAnthropic(apiKey, model, system, user);
  if (provider === 'gemini') return callGemini(apiKey, model, system, user);
  const p = PROVIDERS[provider];
  if (!p?.url) return { error: 'unknown provider', fatal: true };
  return callChat(p, apiKey, model, system, user);
}

// Hosted brain call with the owner's daily budget. Returns text or null (caller falls back).
export async function hostedThink(ctx, a, system, user) {
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

// ---------------------------------------------------------------- one way to think, for everyone
// Returns { text, engine } or { pending: true } (remote agent has not answered yet).
// qid must be stable across ticks for the same question.
export const REMOTE_WAIT_MS = 150000; // a self-run agent has 2.5 minutes to answer
export async function think(ctx, a, qid, { system, user, kind = 'question', format = 'text', options = null }) {
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
      if (a.inbox.length > 20) a.inbox.splice(0, a.inbox.length - 20);
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
  if (ctx.llm.enabled) {
    const text = await ctx.llm.ask({ model: a.model, system, user });
    return { text, engine: text ? 'llm' : 'offline' };
  }
  return { text: null, engine: 'offline' };
}

export function publicBrain(b) {
  if (!b) return { type: 'founder' };
  return { type: b.type, provider: b.provider, model: b.model, status: b.status || 'ok', keyHint: b.keyHint, capPerDay: b.capPerDay, usedToday: b.usedToday || 0, calls: b.calls || 0, errors: b.errors || 0, lastError: b.lastError || null, missed: b.missed || 0 };
}
