// The nation's brain for agents without their own (founders). Two providers, usable together:
//   ANTHROPIC_API_KEY  -> Claude through the official SDK (CLAUDE_MODEL, default claude-haiku-5-5)
//   OPENROUTER_API_KEY -> every other model family through OpenRouter (each founder has its own model id)
// With both keys each founder thinks with ITS OWN model: ids starting with "anthropic/" go to Claude
// directly, the rest (Llama, Qwen, DeepSeek, Gemini, Mistral, Grok, ...) to OpenRouter; if OpenRouter
// fails the call falls back to Claude. Judges ask for CLAUDE_COURT_MODEL and always use Claude when it
// is available. Without any key everything runs on the offline engine (trait-based, free).
// LLM output is never executed: callers only accept a letter from a fixed list or an action from a
// fixed menu, then validate and clamp it in code.
import Anthropic from '@anthropic-ai/sdk';
import { cleanText } from './util.ts';

export function makeLLM(cfg: Record<string, any>, log: (kind: string, text: string) => void) {
  const calls = [];
  const hasClaude = !!cfg.anthropicKey, hasOR = !!cfg.orKey;
  const provider = hasClaude && hasOR ? 'mixed' : hasClaude ? 'anthropic' : hasOR ? 'openrouter' : null;
  const claude = hasClaude ? new Anthropic({ apiKey: cfg.anthropicKey, maxRetries: 1, timeout: 120000 }) : null;
  const orBase = (cfg.orBase || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, errors: 0, claude: 0, openrouter: 0, fallbacks: 0, costUsd: 0,
    errorsByModel: {} as Record<string, { errors: number; lastKind: string; lastStatus: number | null; lastAt: string }> };
  // Per-model failure counts so a broken model can be spotted on /api/state. Only the kind, the HTTP status
  // and the time are kept (never the provider's message, which can echo request details). The key set is
  // bounded: model ids come from config and the founders' list, but cap it anyway.
  // kind: http (non-2xx), timeout, bad-json (reply was not valid JSON), network (unreachable), auth, rate-limit
  function noteError(key: string, kind: string, status: number | null = null) {
    usage.errors++;
    const m = usage.errorsByModel;
    if (!m[key] && Object.keys(m).length >= 64) key = 'other';
    const e = m[key] || (m[key] = { errors: 0, lastKind: '', lastStatus: null, lastAt: '' });
    e.errors++; e.lastKind = kind; e.lastStatus = status; e.lastAt = new Date().toISOString();
  }
  // Claude prices in $ per million tokens (first-party API, checked 11 Nov 2026); cache writes cost 1.25x input
  const CLAUDE_PRICE = { 'claude-opus-5-5': [4, 20, 0.2], 'claude-sonnet-5-5': [2, 10, 0.2], 'claude-haiku-5-5': [0.1, 0.5, 0.01] };
  const claudeCost = (model, u) => {
    const [pin, pout, pread] = CLAUDE_PRICE[model] || CLAUDE_PRICE['claude-opus-5-5'];
    return ((u?.input_tokens || 0) * pin + (u?.cache_creation_input_tokens || 0) * pin * 1.25 + (u?.cache_read_input_tokens || 0) * pread + (u?.output_tokens || 0) * pout) / 1e6;
  };

  function budgetOk() {
    const now = Date.now();
    while (calls.length && now - calls[0] > 60000) calls.shift();
    if (calls.length >= cfg.llmPerMin) return false; // budget guard: fall back to offline
    calls.push(now);
    return true;
  }

  // Opus/Sonnet 5.5: adaptive thinking (always on), effort by task, and the server-side fallback
  // for safety-classifier declines (beta). Haiku has no server-side fallback, so it is never sent there.
  // The system prompt (constitution + charter) is the same for every call of an office: it is cached, so
  // repeated calls pay a tenth of the input price for it.
  // fallback: false = never the server-side fallback (the training teachers: a Sonnet call stays a Sonnet call)
  async function askClaude({ system, user, model, effort = 'low', fallback = true, maxTokens = 4000 }) {
    try {
      const params = { model, max_tokens: maxTokens, output_config: { effort }, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: user }] };
      const r = /haiku/.test(model) || !fallback
        ? await claude.messages.create(params)
        : await claude.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
      usage.inputTokens += (r.usage?.input_tokens || 0) + (r.usage?.cache_creation_input_tokens || 0) + (r.usage?.cache_read_input_tokens || 0);
      usage.cachedTokens += r.usage?.cache_read_input_tokens || 0;
      usage.outputTokens += r.usage?.output_tokens || 0;
      usage.claude++;
      lastCost = claudeCost(model, r.usage); usage.costUsd += lastCost;
      if (r.stop_reason === 'refusal') return null;
      return r.content.filter(b => b.type === 'text').map(b => b.text).join(' ');
    } catch (e) {
      const key = `claude:${model}`;
      // connection errors are APIError subclasses with no status: check them first
      if (e instanceof Anthropic.APIConnectionTimeoutError) { noteError(key, 'timeout'); log('engine', 'Claude: timeout, offline fallback'); }
      else if (e instanceof Anthropic.APIConnectionError) { noteError(key, 'network'); log('engine', 'Claude unreachable: offline fallback'); }
      else if (e instanceof Anthropic.AuthenticationError) { noteError(key, 'auth', e.status ?? null); log('engine', 'Claude: invalid ANTHROPIC_API_KEY'); }
      else if (e instanceof Anthropic.RateLimitError) { noteError(key, 'rate-limit', e.status ?? null); log('engine', 'Claude: rate limited, offline fallback'); }
      else if (e instanceof Anthropic.APIError) { noteError(key, 'http', e.status ?? null); log('engine', `Claude API ${e.status}: offline fallback`); }
      else if (e instanceof SyntaxError) { noteError(key, 'bad-json'); log('engine', 'Claude: unreadable reply, offline fallback'); }
      else { noteError(key, 'network'); log('engine', `Claude unreachable: ${String(e.message).slice(0, 50)}`); }
      return null;
    }
  }

  async function askOpenRouter({ model, system, user, maxTokens, effort = 'low' }) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 90000);
    try {
      const r = await fetch(`${orBase}/chat/completions`, {
        method: 'POST', signal: ac.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.orKey}`, 'X-Title': 'Country AI' },
        // reasoning models: think a little, return only the answer; leave room so the answer is not cut off
        // usage.include: OpenRouter returns the real cost of the call, which the daily budget is charged with
        body: JSON.stringify({ model, max_tokens: Math.max(maxTokens, 3000), reasoning: { effort, exclude: true }, usage: { include: true }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      });
      if (!r.ok) throw Object.assign(new Error(`openrouter ${r.status} (${model})`), { kind: r.status === 429 ? 'rate-limit' : r.status === 401 || r.status === 403 ? 'auth' : 'http', status: r.status });
      let j;
      try { j = await r.json(); } catch (e) { if (ac.signal.aborted) throw e; throw Object.assign(new Error(`openrouter bad JSON (${model})`), { kind: 'bad-json' }); }
      usage.inputTokens += j.usage?.prompt_tokens || 0;
      usage.cachedTokens += j.usage?.prompt_tokens_details?.cached_tokens || 0;
      usage.outputTokens += j.usage?.completion_tokens || 0;
      usage.openrouter++;
      // real cost when OpenRouter reports it; otherwise a cautious estimate ($1 / $5 per million tokens)
      lastCost = Number(j.usage?.cost) || ((j.usage?.prompt_tokens || 0) * 1 + (j.usage?.completion_tokens || 0) * 5) / 1e6;
      usage.costUsd += lastCost;
      return j.choices?.[0]?.message?.content || null;
    } catch (e) {
      // abort = our 90 s timer fired (it also aborts a body still streaming in r.json())
      const kind = e?.kind || (e?.name === 'AbortError' || ac.signal.aborted ? 'timeout' : 'network');
      noteError(`openrouter:${model}`, kind, e?.status ?? null);
      log('engine', `OpenRouter: ${kind === 'timeout' ? `timeout (${model})` : String(e.message).slice(0, 70)}`);
      return null;
    } finally { clearTimeout(t); }
  }

  // Which brain answers: { text, via } where via names the provider and model actually used.
  // effort: 'low' for exam answers and chat, 'medium' for decisions, votes and rulings
  // route 'openrouter' (officials and citizens, Art. 25) sends even anthropic/ models through OpenRouter;
  // claudeModel (the leadership and the judges) goes to Claude directly. Every result carries its cost in $.
  let lastCost = 0;
  // fallback: false keeps the call on the model asked for (no Claude server-side fallback); maxText caps the
  // returned text (900 for agents' answers; a teacher's worked explanation may be longer)
  async function askDetailed({ model = '', system, user, maxTokens = 160, claudeModel = null, effort = 'low', route = null, fallback = true, maxText = 900 }) {
    if (!provider || !budgetOk()) return { text: null, via: 'offline', cost: 0 };
    usage.calls++;
    let cost = 0;
    const claudeId = claudeModel || (/^claude-/.test(model) ? model : cfg.claudeModel);
    const wantsClaude = hasClaude && (claudeModel || !hasOR || (route !== 'openrouter' && (/^anthropic\//.test(model) || /^claude-/.test(model) || !model)));
    if (wantsClaude) {
      lastCost = 0;
      const text = cleanText(await askClaude({ system, user, model: claudeId, effort, fallback, maxTokens: fallback ? 4000 : Math.max(1500, Math.min(4000, maxTokens * 2)) }), maxText); // room for adaptive thinking
      return { text: text || null, via: `claude:${claudeId}`, cost: lastCost };
    }
    lastCost = 0;
    let text = cleanText(await askOpenRouter({ model: model || 'meta-llama/llama-4-maverick', system, user, maxTokens, effort }), maxText);
    cost += lastCost;
    if (text) return { text, via: `openrouter:${model}`, cost };
    if (hasClaude && route !== 'openrouter') { // OpenRouter failed: the agent still thinks, with Claude
      usage.fallbacks++; lastCost = 0;
      text = cleanText(await askClaude({ system, user, model: cfg.claudeModel, effort }), 900);
      return { text: text || null, via: `claude:${cfg.claudeModel} (fallback)`, cost: cost + lastCost };
    }
    return { text: null, via: 'offline', cost };
  }
  async function ask(opts) { return (await askDetailed(opts)).text; }

  // The model a founder actually thinks with right now (shown on profiles).
  function routeOf(model = '') {
    if (!provider) return 'offline';
    if (hasClaude && (!hasOR || /^anthropic\//.test(model) || /^claude-/.test(model) || !model)) return /^claude-/.test(model) ? model : cfg.claudeModel;
    return model;
  }

  // Pull the first {...} block out of a reply and parse it; null if it is not JSON.
  function json(text) {
    const m = String(text || '').match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }
  const label = provider === 'mixed' ? `mixed: claude (${cfg.claudeModel}) + openrouter` : provider === 'anthropic' ? `claude (${cfg.claudeModel})` : provider === 'openrouter' ? 'openrouter (per-agent models)' : 'offline';
  return { enabled: !!provider, provider, label, ask, askDetailed, routeOf, json, usage, hasClaude, hasOR };
}
