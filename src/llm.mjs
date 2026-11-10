// Optional LLM brain via OpenRouter. Without OPENROUTER_API_KEY everything runs on the
// offline engine (trait-based, free). LLM output is never executed: callers only accept
// a letter from a fixed list or an action from a fixed menu, then validate it in code.
import { cleanText } from './util.mjs';

export function makeLLM(cfg, log) {
  const calls = [];
  const enabled = !!cfg.orKey;
  async function ask({ model, system, user, maxTokens = 160, temperature = 0.7 }) {
    if (!enabled) return null;
    const now = Date.now();
    while (calls.length && now - calls[0] > 60000) calls.shift();
    if (calls.length >= cfg.llmPerMin) return null; // budget guard: fall back to offline
    calls.push(now);
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 20000);
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', signal: ac.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.orKey}`, 'X-Title': 'Country AI' },
        body: JSON.stringify({ model, max_tokens: maxTokens, temperature, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      });
      if (!r.ok) throw new Error('openrouter ' + r.status);
      const j = await r.json();
      return cleanText(j.choices?.[0]?.message?.content, 900) || null;
    } catch (e) {
      log('engine', `LLM fallback (${String(e.message).slice(0, 50)})`);
      return null;
    } finally { clearTimeout(t); }
  }
  // Pull the first {...} block out of a reply and parse it; null if it is not JSON.
  function json(text) {
    const m = String(text || '').match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }
  return { enabled, ask, json };
}
