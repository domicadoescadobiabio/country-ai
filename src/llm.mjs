// Optional LLM brain. Two providers, pick one with an env key:
//   ANTHROPIC_API_KEY  -> every agent thinks with Claude (CLAUDE_MODEL, default claude-haiku-5-5)
//   OPENROUTER_API_KEY -> every agent thinks with its own model id (anthropic/..., qwen/..., ...)
// Without a key everything runs on the offline engine (trait-based, free).
// LLM output is never executed: callers only accept a letter from a fixed list or an action
// from a fixed menu, then validate and clamp it in code.
import Anthropic from '@anthropic-ai/sdk';
import { cleanText } from './util.mjs';

export function makeLLM(cfg, log) {
  const calls = [];
  const provider = cfg.anthropicKey ? 'anthropic' : cfg.orKey ? 'openrouter' : null;
  const claude = provider === 'anthropic' ? new Anthropic({ apiKey: cfg.anthropicKey, maxRetries: 1, timeout: 30000 }) : null;
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0, errors: 0 };

  function budgetOk() {
    const now = Date.now();
    while (calls.length && now - calls[0] > 60000) calls.shift();
    if (calls.length >= cfg.llmPerMin) return false; // budget guard: fall back to offline
    calls.push(now);
    return true;
  }

  async function askClaude({ system, user, claudeModel }) {
    try {
      const r = await claude.messages.create({
        model: claudeModel || cfg.claudeModel,
        // room for adaptive thinking plus a short answer; effort low keeps it brief
        max_tokens: 1024,
        output_config: { effort: 'low' },
        system,
        messages: [{ role: 'user', content: user }],
      });
      usage.inputTokens += r.usage?.input_tokens || 0;
      usage.outputTokens += r.usage?.output_tokens || 0;
      if (r.stop_reason === 'refusal') return null;
      return r.content.filter(b => b.type === 'text').map(b => b.text).join(' ');
    } catch (e) {
      usage.errors++;
      if (e instanceof Anthropic.AuthenticationError) log('engine', 'Claude: invalid ANTHROPIC_API_KEY, using offline engine');
      else if (e instanceof Anthropic.RateLimitError) log('engine', 'Claude: rate limited, offline fallback');
      else if (e instanceof Anthropic.APIError) log('engine', `Claude API ${e.status}: offline fallback`);
      else log('engine', `Claude unreachable: ${String(e.message).slice(0, 50)}`);
      return null;
    }
  }

  async function askOpenRouter({ model, system, user, maxTokens, temperature }) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 20000);
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', signal: ac.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.orKey}`, 'X-Title': 'Country AI' },
        body: JSON.stringify({ model, max_tokens: maxTokens, temperature, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      });
      if (!r.ok) throw new Error('openrouter ' + r.status);
      const j = await r.json();
      usage.inputTokens += j.usage?.prompt_tokens || 0;
      usage.outputTokens += j.usage?.completion_tokens || 0;
      return j.choices?.[0]?.message?.content || null;
    } catch (e) {
      usage.errors++;
      log('engine', `LLM fallback (${String(e.message).slice(0, 50)})`);
      return null;
    } finally { clearTimeout(t); }
  }

  async function ask({ model, system, user, maxTokens = 160, temperature = 0.7, claudeModel }) {
    if (!provider || !budgetOk()) return null;
    usage.calls++;
    const text = provider === 'anthropic' ? await askClaude({ system, user, claudeModel }) : await askOpenRouter({ model, system, user, maxTokens, temperature });
    return cleanText(text, 900) || null;
  }
  // Pull the first {...} block out of a reply and parse it; null if it is not JSON.
  function json(text) {
    const m = String(text || '').match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }
  const label = provider === 'anthropic' ? `claude (${cfg.claudeModel})` : provider === 'openrouter' ? 'openrouter (per-agent models)' : 'offline';
  return { enabled: !!provider, provider, label, ask, json, usage };
}
