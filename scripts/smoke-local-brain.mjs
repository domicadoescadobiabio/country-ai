// Local brain smoke test: a mock Ollama, the server, and scripts/local-brain.mjs together, no network.
// Checks that aspirants and citizens are answered by the local model, that its answers are learned,
// and that the worker endpoints refuse a wrong token.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { smartAnswer } from './smoke-agents.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'country-local-'));
const PORT = 3970 + Math.floor(Math.random() * 9);
const TOKEN = 'local-test-token-' + Math.random().toString(36).slice(2);
let asked = 0;

const ollama = http.createServer((req, res) => {
  let b = ''; req.on('data', c => { b += c; }); req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen3:8b', model: 'qwen3:8b' }] }));
    const body = JSON.parse(b || '{}'); asked++;
    const text = smartAnswer(String(body.messages?.find(m => m.role === 'user')?.content || ''));
    res.end(JSON.stringify({ message: { role: 'assistant', content: `<think>hm</think>${text}` }, prompt_eval_count: 300, eval_count: 20 }));
  });
});
await new Promise(r => ollama.listen(0, '127.0.0.1', r));
const OLLAMA = `http://127.0.0.1:${ollama.address().port}`;

const env = { ...process.env, PORT: String(PORT), DATA_DIR: DATA, TICK_SECONDS: '0.1', DAY_SECONDS: '3', POPULATION: '300', OPENROUTER_API_KEY: '', ANTHROPIC_API_KEY: '', WORKER_TOKEN: TOKEN };
const srv = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let stderr = ''; srv.stderr.on('data', d => { stderr += d; });
const wait = ms => new Promise(r => setTimeout(r, ms));
const get = async p => (await fetch(`http://127.0.0.1:${PORT}${p}`)).json();
for (let i = 0; i < 80; i++) { try { await get('/api/health'); break; } catch { await wait(150); } }

let pass = 0, fail = 0;
const check = (n, ok, info = '') => { if (ok) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${info}`); } };
let worker;
try {
  const bad = await fetch(`http://127.0.0.1:${PORT}/api/worker/pull`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-worker-token': 'wrong' }, body: '{}' });
  check('worker endpoints refuse a wrong token', bad.status === 401);
  const none = await fetch(`http://127.0.0.1:${PORT}/api/worker/pull`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  check('worker endpoints refuse a missing token', none.status === 401);

  worker = spawn(process.execPath, ['scripts/local-brain.mjs'], { cwd: ROOT, env: { ...process.env, COUNTRY_URL: `http://127.0.0.1:${PORT}`, WORKER_TOKEN: TOKEN, OLLAMA_URL: OLLAMA, OLLAMA_MODEL: 'qwen3:8b', PARALLEL: '3' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let wlog = ''; worker.stdout.on('data', d => { wlog += d; }); worker.stderr.on('data', d => { wlog += d; });

  let s = null;
  const engines = new Set();
  for (let i = 0; i < 40; i++) {
    await wait(1500);
    s = await get('/api/state');
    for (const d of s.decisions) engines.add(d.engine);
    if (s.localBrain?.answered > 30 && [...engines].some(e => /^local:/.test(e))) break;
  }
  check('the local brain is online and answering', s.localBrain?.online && s.localBrain.answered > 0, JSON.stringify(s.localBrain) + ' ' + wlog.slice(-300));
  check('the mock model was really asked', asked > 0, String(asked));
  check('decisions and exams carry the local model as their engine', [...engines].some(e => /^local:ollama\/qwen3:8b/.test(e)) || s.feed?.academy?.some?.(m => /local:/.test(m.engine || '')), JSON.stringify([...engines]));
  const exam = Object.values(s.feed || {}).flat().filter(m => m.kind === 'answer');
  check('Academy answers come from the local model (not the offline dice)', exam.some(m => /^local:/.test(m.engine || '')), JSON.stringify(exam.slice(-3).map(m => m.engine)));
  check('reasoning tags are stripped from local answers', !JSON.stringify(s.feed).includes('<think>'));
  // daily life: citizens think about their day with the local brain only (never a paid API)
  const life = (await get('/api/state')).daily;
  check('citizens live a daily life on the local brain', life && life.thoughts > 0, JSON.stringify(life && { thoughts: life.thoughts, byAct: life.byAct }));
  check('no server errors', !/step error|TypeError|ReferenceError/.test(stderr), stderr.slice(-400));
} catch (e) {
  fail++; console.log('  FAIL crashed', e.stack);
} finally {
  worker?.kill(); srv.kill(); ollama.close();
  await wait(400); try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* windows file lock */ }
}
console.log(`\nsmoke:local-brain: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
