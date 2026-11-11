// The local brain: runs on a founder's own machine and thinks for the republic's aspirants (citizens sitting
// an Academy exam or standing in an election) and, when it has spare capacity, for ordinary citizens.
// It pulls questions from the server over HTTPS, answers them with an open model served by Ollama on this
// machine, and posts the answers back. The server never connects to this machine; this machine never
// receives anything but the questions. Free and unlimited: nothing here touches the paid APIs.
//
//   1. install Ollama (https://ollama.com) and pull a model:   ollama pull qwen3:8b
//   2. put WORKER_TOKEN (same value as on the server) in .env.local-brain
//   3. node scripts/local-brain.mjs
//
// Settings (.env.local-brain or environment):
//   COUNTRY_URL      the republic (default https://country-ai-production.up.railway.app)
//   WORKER_TOKEN     shared secret with the server (required)
//   OLLAMA_URL       default http://127.0.0.1:11434
//   OLLAMA_MODEL     default qwen3:8b
//   PARALLEL         questions answered at the same time (default 2)
//   OLLAMA_CTX       context window in tokens (default 8192: a Council ballot with many candidates is long)
//   LIFE_TEMPERATURE sampling temperature for daily-life thoughts (default 0.9; exams and votes stay at 0.4)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from '../src/util.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadDotEnv(path.join(ROOT, '.env.local-brain'));
const URL_ = (process.env.COUNTRY_URL || 'https://country-ai-production.up.railway.app').replace(/\/$/, '');
const TOKEN = (process.env.WORKER_TOKEN || '').trim();
const OLLAMA = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const MODEL = (process.env.OLLAMA_MODEL || 'qwen3:8b').trim();
const PARALLEL = Math.max(1, Math.min(8, Number(process.env.PARALLEL) || 2));
const CTX = Math.max(2048, Math.min(32768, Number(process.env.OLLAMA_CTX) || 8192));
const LIFE_TEMP = Math.max(0, Math.min(1.5, Number(process.env.LIFE_TEMPERATURE) || 0.9));
if (!TOKEN) { console.error('WORKER_TOKEN is missing (put it in .env.local-brain)'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const stats = { answered: 0, failed: 0, started: Date.now(), tokens: 0 };

async function server(pathname, body) {
  const r = await fetch(URL_ + pathname, { method: 'POST', headers: { 'content-type': 'application/json', 'x-worker-token': TOKEN }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  if (r.status === 401) throw new Error('the server refused the worker token');
  if (!r.ok) throw new Error(`server ${r.status}`);
  return r.json();
}

// Short, format-aware answers: the server only accepts a letter, a JSON object or one short paragraph.
function instructions(job) {
  if (job.format === 'letter') return 'Answer with the letter of your choice, then " - " and one short reason. Nothing else.';
  if (job.format === 'json') return 'Reply with the JSON object only, no other text, no code fence.';
  return 'Keep it short: at most three sentences.';
}
// Exams and votes want a steady answer; a citizen planning their day ("life:" jobs) should vary like a
// person does, otherwise a small model gives nearly the same choice to everyone.
const temperature = job => (String(job.id).startsWith('life:') ? LIFE_TEMP : 0.4);
async function answer(job) {
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(170000),
    body: JSON.stringify({ model: MODEL, stream: false, think: false, keep_alive: -1, options: { temperature: temperature(job), num_predict: 400, num_ctx: CTX },
      messages: [{ role: 'system', content: `${job.system}\n\n${instructions(job)}` }, { role: 'user', content: job.user }] }),
  });
  if (!r.ok) throw new Error(`ollama ${r.status}: ${(await r.text()).slice(0, 120)}`);
  const j = await r.json();
  stats.tokens += (j.prompt_eval_count || 0) + (j.eval_count || 0);
  return String(j.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

async function loop(slot) {
  let idle = 0;
  for (;;) {
    try {
      const { jobs } = await server('/api/worker/pull', { max: 1, model: `ollama/${MODEL}` });
      if (!jobs.length) { await sleep(Math.min(2000, 500 + idle++ * 250)); continue; }
      idle = 0;
      for (const job of jobs) {
        try {
          const text = await answer(job);
          if (text) { await server('/api/worker/answer', { answers: [{ id: job.id, text, model: `ollama/${MODEL}` }] }); stats.answered++; }
          else stats.failed++;
        } catch (e) { stats.failed++; console.error(`[${slot}] ${e.message}`); await sleep(3000); }
      }
    } catch (e) { console.error(`[${slot}] ${e.message}`); await sleep(10000); }
  }
}

// make sure the model is there before starting
try {
  const tags = await (await fetch(`${OLLAMA}/api/tags`)).json();
  if (!(tags.models || []).some(m => m.name === MODEL || m.model === MODEL)) { console.error(`Ollama does not have ${MODEL}. Run: ollama pull ${MODEL}`); process.exit(1); }
} catch { console.error(`Ollama is not running at ${OLLAMA}. Start Ollama first.`); process.exit(1); }

// load the model into the GPU now and keep it there
try { await fetch(`${OLLAMA}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, keep_alive: -1, options: { num_ctx: CTX } }) }); } catch { /* answered later */ }
console.log(`local brain: ${MODEL} via ${OLLAMA}, ${PARALLEL} at a time, context ${CTX}, kept in memory, serving ${URL_}`);
setInterval(() => {
  const mins = (Date.now() - stats.started) / 60000;
  console.log(`[${new Date().toLocaleTimeString()}] answered ${stats.answered} (${(stats.answered / Math.max(mins, 1)).toFixed(1)}/min), failed ${stats.failed}, tokens ${stats.tokens}`);
}, 60000).unref();
await Promise.all(Array.from({ length: PARALLEL }, (_, i) => loop(i + 1)));
