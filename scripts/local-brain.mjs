// The local brain: runs on a founder's own machine and thinks for the republic's aspirants (citizens sitting
// an Academy exam or standing in an election) and, when it has spare capacity, for ordinary citizens.
// It pulls questions from the server over HTTPS, answers them with an open model served on this machine
// (Ollama, or llama.cpp's llama-server with a LoRA adapter trained on the republic's own lessons) and posts
// the answers back. The server never connects to this machine; this machine never receives anything but the
// questions. Free and unlimited: nothing here touches the paid APIs.
//
//   1. install Ollama (https://ollama.com) and pull a model:   ollama pull qwen3:8b
//      or run llama-server with the same base model and the adapters loaded (LOCAL_BACKEND=llamacpp)
//   2. put WORKER_TOKEN (same value as on the server) in .env.local-brain
//   3. node scripts/local-brain.mjs   (or scripts\local-brain.cmd, which keeps it running)
//
// Settings (.env.local-brain or environment):
//   COUNTRY_URL      the republic (default https://country-ai-production.up.railway.app)
//   WORKER_TOKEN     shared secret with the server (required)
//   LOCAL_BACKEND    ollama (default) or llamacpp
//   OLLAMA_URL       default http://127.0.0.1:11434
//   OLLAMA_MODEL     default qwen3:8b
//   OLLAMA_CTX       context window in tokens (default 8192: a Council ballot with many candidates is long)
//   LLAMA_URL        llama-server, default http://127.0.0.1:8091
//   LLAMA_MODEL      the base model's name in labels (default qwen3:8b: the same GGUF Ollama serves)
//   LLAMA_LORAS      adapters by field, name:id (default general:0); a field with no adapter of its own uses general
//   LLAMA_LORA_SCALE strength of the adapter (default 1; 0 = the plain base model, a quick rollback)
//   PARALLEL         questions answered at the same time (default 2)
//   LIFE_TEMPERATURE sampling temperature for daily-life thoughts (default 0.9; exams and votes stay at 0.4)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from '../src/util.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadDotEnv(path.join(ROOT, '.env.local-brain'));
const num = (k, d, lo, hi) => { const s = String(process.env[k] ?? '').trim(); const v = Number(s); return s !== '' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const URL_ = (process.env.COUNTRY_URL || 'https://country-ai-production.up.railway.app').replace(/\/$/, '');
const TOKEN = (process.env.WORKER_TOKEN || '').trim();
const BACKEND = (process.env.LOCAL_BACKEND || 'ollama').trim().toLowerCase();
const OLLAMA = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const MODEL = (process.env.OLLAMA_MODEL || 'qwen3:8b').trim();
const LLAMA = (process.env.LLAMA_URL || 'http://127.0.0.1:8091').replace(/\/$/, '');
const LLAMA_MODEL = (process.env.LLAMA_MODEL || 'qwen3:8b').trim().replace(/[^\w.:-]/g, '').slice(0, 30) || 'qwen3:8b';
const LORA_SCALE = num('LLAMA_LORA_SCALE', 1, 0, 2);
const PARALLEL = Math.max(1, Math.min(8, Number(process.env.PARALLEL) || 2));
const CTX = Math.max(2048, Math.min(32768, Number(process.env.OLLAMA_CTX) || 8192));
const LIFE_TEMP = Math.max(0, Math.min(1.5, Number(process.env.LIFE_TEMPERATURE) || 0.9));
if (!TOKEN) { console.error('WORKER_TOKEN is missing (put it in .env.local-brain)'); process.exit(1); }
if (!['ollama', 'llamacpp'].includes(BACKEND)) { console.error(`LOCAL_BACKEND must be ollama or llamacpp, not "${BACKEND.slice(0, 20)}"`); process.exit(1); }

// Adapters by field: "general:0,law:1". Names are field ids (lower case), ids are llama-server's adapter ids.
// A question from a field with no adapter of its own (or with no field at all) goes to general.
function parseLoras(spec) {
  const m = new Map();
  for (const part of String(spec || '').split(',')) {
    const x = part.trim().match(/^([a-z0-9_]{1,32}):(\d{1,2})$/i);
    if (x) m.set(x[1].toLowerCase(), Number(x[2]));
    else if (part.trim()) { console.error(`LLAMA_LORAS: "${part.trim().slice(0, 40)}" is not name:id (for example general:0)`); process.exit(1); }
  }
  return m;
}
const LORAS = parseLoras(process.env.LLAMA_LORAS || 'general:0');
if (BACKEND === 'llamacpp' && !LORAS.has('general')) { console.error('LLAMA_LORAS needs a general adapter (for example general:0): it answers every field without one of its own'); process.exit(1); }
const adapterFor = job => { const d = String(job?.domain || '').toLowerCase(); return LORAS.has(d) ? d : 'general'; };
// the honest name of what answered: the base alone when the adapter is switched off
const llamaLabel = name => (LORA_SCALE > 0 ? `llamacpp/${LLAMA_MODEL}+${name}` : `llamacpp/${LLAMA_MODEL}`);
const PULL_MODEL = BACKEND === 'llamacpp' ? llamaLabel('general') : `ollama/${MODEL}`;
let LOADED_IDS = []; // adapter ids llama-server has loaded (GET /lora-adapters at start)

// What this runner is, sent with every pull so the republic (and its monitoring) can see which version
// answers and with which settings: no secrets, no paths, only numbers and short labels.
// RUNNER_VERSION goes up whenever the runner's behaviour changes. 2 = daily-life temperature + reload on change;
// 3 = llama.cpp backend with LoRA adapters (backend, adapter and loraScale say which).
const RUNNER_VERSION = 3;
const RUNNER = { version: RUNNER_VERSION, lifeTemperature: LIFE_TEMP, examTemperature: 0.4, parallel: PARALLEL, context: CTX, supervised: process.env.LOCAL_BRAIN_SUPERVISED === '1',
  backend: BACKEND, ...(BACKEND === 'llamacpp' ? { adapter: LORA_SCALE > 0 ? 'general' : 'none', loraScale: LORA_SCALE } : {}) };

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
const messages = job => [{ role: 'system', content: `${job.system}\n\n${instructions(job)}` }, { role: 'user', content: job.user }];
const noThink = t => String(t || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();

async function answerOllama(job) {
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(170000),
    body: JSON.stringify({ model: MODEL, stream: false, think: false, keep_alive: -1, options: { temperature: temperature(job), num_predict: 400, num_ctx: CTX }, messages: messages(job) }),
  });
  if (!r.ok) throw new Error(`ollama ${r.status}: ${(await r.text()).slice(0, 120)}`);
  const j = await r.json();
  stats.tokens += (j.prompt_eval_count || 0) + (j.eval_count || 0);
  return { text: noThink(j.message?.content), model: `ollama/${MODEL}` };
}

// llama-server: every loaded adapter is named in each request, the chosen one at LLAMA_LORA_SCALE and the rest
// at 0, so exactly one adapter (or none) is active whatever the server's own default is.
const loraFor = name => LOADED_IDS.map(id => ({ id, scale: LORA_SCALE > 0 && id === LORAS.get(name) ? LORA_SCALE : 0 }));
async function answerLlama(job) {
  const name = adapterFor(job);
  const r = await fetch(`${LLAMA}/v1/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(170000),
    body: JSON.stringify({ model: LLAMA_MODEL, stream: false, temperature: temperature(job), max_tokens: 400, messages: messages(job),
      chat_template_kwargs: { enable_thinking: false }, lora: loraFor(name), cache_prompt: true,
      ...(job.format === 'json' ? { response_format: { type: 'json_object' } } : {}) }),
  });
  if (!r.ok) throw new Error(`llama-server ${r.status}: ${(await r.text()).slice(0, 120)}`);
  const j = await r.json();
  stats.tokens += (j.usage?.prompt_tokens || 0) + (j.usage?.completion_tokens || 0);
  return { text: noThink(j.choices?.[0]?.message?.content), model: llamaLabel(name) };
}
const answer = BACKEND === 'llamacpp' ? answerLlama : answerOllama;

// Reload on change: this runner runs from the repository, so a fix to this file (or new settings in
// .env.local-brain) used to wait for someone to restart it by hand. Under scripts/local-brain.cmd
// (LOCAL_BRAIN_SUPERVISED=1) it finishes the answers in hand and exits with code 3; the .cmd starts the
// new code at once. Started by hand, it only says that a restart is needed.
const SELF = fileURLToPath(import.meta.url);
const WATCHED = [SELF, path.join(ROOT, '.env.local-brain'), process.env.LOCAL_BRAIN_WATCH].filter(Boolean); // LOCAL_BRAIN_WATCH: tests
const RELOAD_CHECK_MS = Math.max(200, Number(process.env.RELOAD_CHECK_MS) || 30000);
const SUPERVISED = process.env.LOCAL_BRAIN_SUPERVISED === '1';
const RELOAD_EXIT = 3;
const stamp = () => WATCHED.map(f => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } }).join('|');
const startedStamp = stamp();
let reload = false;
setInterval(() => {
  if (reload || stamp() === startedStamp) return;
  if (SUPERVISED) { reload = true; console.log(`[${new Date().toLocaleTimeString()}] local-brain.mjs or .env.local-brain changed: finishing the answers in hand, then restarting with the new code`); }
  else console.log(`[${new Date().toLocaleTimeString()}] local-brain.mjs or .env.local-brain changed: restart this runner to use the new code`);
}, RELOAD_CHECK_MS).unref();

// llama-server gone (crashed, closed window): after this many failures in a row the runner exits, and
// local-brain.cmd starts llama-server again before the next run. Ollama restarts on its own, so it is left alone.
const BACKEND_FAILS_MAX = Math.max(3, Number(process.env.BACKEND_FAILS_MAX) || 20);
let failsInRow = 0;
async function loop(slot) {
  let idle = 0;
  while (!reload) {
    try {
      const { jobs } = await server('/api/worker/pull', { max: 1, model: PULL_MODEL, runner: RUNNER });
      if (!jobs.length) { await sleep(Math.min(2000, 500 + idle++ * 250)); continue; }
      idle = 0;
      for (const job of jobs) {
        let out = null;
        try { out = await answer(job); failsInRow = 0; } catch (e) {
          stats.failed++; console.error(`[${slot}] ${e.message}`);
          if (BACKEND === 'llamacpp' && ++failsInRow >= BACKEND_FAILS_MAX) { console.error(`llama-server failed ${failsInRow} times in a row at ${LLAMA}: stopping so it can be started again`); process.exit(1); }
          await sleep(3000); continue;
        }
        try {
          if (out.text) { await server('/api/worker/answer', { answers: [{ id: job.id, text: out.text, model: out.model }] }); stats.answered++; }
          else stats.failed++;
        } catch (e) { stats.failed++; console.error(`[${slot}] ${e.message}`); await sleep(3000); }
      }
    } catch (e) { console.error(`[${slot}] ${e.message}`); await sleep(10000); }
  }
}

if (BACKEND === 'llamacpp') {
  // ready check: llama-server answers /health with ok and has loaded every adapter in LLAMA_LORAS
  let health = null;
  try { const r = await fetch(`${LLAMA}/health`, { signal: AbortSignal.timeout(5000) }); health = { status: r.status, body: await r.json().catch(() => ({})) }; }
  catch { console.error(`llama-server is not running at ${LLAMA}. Start it first (local-brain.cmd starts it with LLAMA_START).`); process.exit(1); }
  if (health.status !== 200 || health.body?.status !== 'ok') { console.error(`llama-server at ${LLAMA} is not ready yet (health ${health.status}${health.body?.error?.message ? `: ${String(health.body.error.message).slice(0, 80)}` : ''}). Trying again soon.`); process.exit(1); }
  try {
    const list = await (await fetch(`${LLAMA}/lora-adapters`, { signal: AbortSignal.timeout(5000) })).json();
    LOADED_IDS = (Array.isArray(list) ? list : []).map(x => Number(x?.id)).filter(Number.isInteger);
  } catch { console.error(`llama-server at ${LLAMA} did not list its adapters (GET /lora-adapters).`); process.exit(1); }
  const missing = [...LORAS].filter(([, id]) => !LOADED_IDS.includes(id));
  if (LORA_SCALE > 0 && missing.length) { console.error(`llama-server has not loaded the adapter(s) ${missing.map(([n, id]) => `${n}:${id}`).join(', ')} (loaded ids: ${LOADED_IDS.join(', ') || 'none'}). Start it with --lora for each, or set LLAMA_LORA_SCALE=0 for the plain base model.`); process.exit(1); }
  const fields = [...LORAS.keys()].filter(n => n !== 'general');
  console.log(`local brain: ${llamaLabel('general')} via llama-server ${LLAMA}, adapter scale ${LORA_SCALE}${LORA_SCALE > 0 && fields.length ? `, own adapters for ${fields.join(', ')}` : ''}, ${PARALLEL} at a time, daily-life temperature ${LIFE_TEMP} (exams 0.4), serving ${URL_}${SUPERVISED ? ', reloads itself when its code changes' : ''}`);
} else {
  // make sure the model is there before starting
  try {
    const tags = await (await fetch(`${OLLAMA}/api/tags`)).json();
    if (!(tags.models || []).some(m => m.name === MODEL || m.model === MODEL)) { console.error(`Ollama does not have ${MODEL}. Run: ollama pull ${MODEL}`); process.exit(1); }
  } catch { console.error(`Ollama is not running at ${OLLAMA}. Start Ollama first.`); process.exit(1); }
  // load the model into the GPU now and keep it there
  try { await fetch(`${OLLAMA}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, keep_alive: -1, options: { num_ctx: CTX } }) }); } catch { /* answered later */ }
  console.log(`local brain: ${MODEL} via ${OLLAMA}, ${PARALLEL} at a time, context ${CTX}, daily-life temperature ${LIFE_TEMP} (exams 0.4), kept in memory, serving ${URL_}${SUPERVISED ? ', reloads itself when its code changes' : ''}`);
}
setInterval(() => {
  const mins = (Date.now() - stats.started) / 60000;
  console.log(`[${new Date().toLocaleTimeString()}] answered ${stats.answered} (${(stats.answered / Math.max(mins, 1)).toFixed(1)}/min), failed ${stats.failed}, tokens ${stats.tokens}`);
}, 60000).unref();
await Promise.all(Array.from({ length: PARALLEL }, (_, i) => loop(i + 1)));
if (reload) process.exit(RELOAD_EXIT); // only reached when reloading: the loops run forever otherwise
