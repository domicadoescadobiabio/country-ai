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
import { cleanText } from './util.mjs';

export function makeLLM(cfg, log) {
  const calls = [];
  const hasClaude = !!cfg.anthropicKey, hasOR = !!cfg.orKey;
  const provider = hasClaude && hasOR ? 'mixed' : hasClaude ? 'anthropic' : hasOR ? 'openrouter' : null;
  const claude = hasClaude ? new Anthropic({ apiKey: cfg.anthropicKey, maxRetries: 1, timeout: 30000 }) : null;
  const orBase = (cfg.orBase || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0, errors: 0, claude: 0, openrouter: 0, fallbacks: 0 };

  function budgetOk() {
    const now = Date.now();
    while (calls.length && now - calls[0] > 60000) calls.shift();
    if (calls.length >= cfg.llmPerMin) return false; // budget guard: fall back to offline
    calls.push(now);
    return true;
  }

  async function askClaude({ system, user, model }) {
    try {
      const r = await claude.messages.create({
        model,
        // room for adaptive thinking plus a short answer; effort low keeps it brief
        max_tokens: 1024,
        output_config: { effort: 'low' },
        system,
        messages: [{ role: 'user', content: user }],
      });
      usage.inputTokens += r.usage?.input_tokens || 0;
      usage.outputTokens += r.usage?.output_tokens || 0;
      usage.claude++;
      if (r.stop_reason === 'refusal') return null;
      return r.content.filter(b => b.type === 'text').map(b => b.text).join(' ');
    } catch (e) {
      usage.errors++;
      if (e instanceof Anthropic.AuthenticationError) log('engine', 'Claude: invalid ANTHROPIC_API_KEY');
      else if (e instanceof Anthropic.RateLimitError) log('engine', 'Claude: rate limited, offline fallback');
      else if (e instanceof Anthropic.APIError) log('engine', `Claude API ${e.status}: offline fallback`);
      else log('engine', `Claude unreachable: ${String(e.message).slice(0, 50)}`);
      return null;
    }
  }

  async function askOpenRouter({ model, system, user, maxTokens }) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 25000);
    try {
      const r = await fetch(`${orBase}/chat/completions`, {
        method: 'POST', signal: ac.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.orKey}`, 'X-Title': 'Country AI' },
        // reasoning models: think a little, return only the answer; leave room so the answer is not cut off
        body: JSON.stringify({ model, max_tokens: Math.max(maxTokens, 700), reasoning: { effort: 'low', exclude: true }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      });
      if (!r.ok) throw new Error(`openrouter ${r.status} (${model})`);
      const j = await r.json();
      usage.inputTokens += j.usage?.prompt_tokens || 0;
      usage.outputTokens += j.usage?.completion_tokens || 0;
      usage.openrouter++;
      return j.choices?.[0]?.message?.content || null;
    } catch (e) {
      usage.errors++;
      log('engine', `OpenRouter: ${String(e.message).slice(0, 70)}`);
      return null;
    } finally { clearTimeout(t); }
  }

  // Which brain answers: { text, via } where via names the provider and model actually used.
  async function askDetailed({ model = '', system, user, maxTokens = 160, claudeModel = null }) {
    if (!provider || !budgetOk()) return { text: null, via: 'offline' };
    usage.calls++;
    const claudeId = claudeModel || (/^claude-/.test(model) ? model : cfg.claudeModel);
    const wantsClaude = hasClaude && (claudeModel || !hasOR || /^anthropic\//.test(model) || /^claude-/.test(model) || !model);
    if (wantsClaude) {
      const text = cleanText(await askClaude({ system, user, model: claudeId }), 900);
      return { text: text || null, via: `claude:${claudeId}` };
    }
    let text = cleanText(await askOpenRouter({ model, system, user, maxTokens }), 900);
    if (text) return { text, via: `openrouter:${model}` };
    if (hasClaude) { // OpenRouter failed: the agent still thinks, with Claude
      usage.fallbacks++;
      text = cleanText(await askClaude({ system, user, model: cfg.claudeModel }), 900);
      return { text: text || null, via: `claude:${cfg.claudeModel} (fallback)` };
    }
    return { text: null, via: 'offline' };
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
  return { enabled: !!provider, provider, label, ask, askDetailed, routeOf, json, usage };
}
