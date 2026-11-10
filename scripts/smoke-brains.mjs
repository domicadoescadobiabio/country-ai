// Mixed brains smoke test: Claude (Anthropic API) + OpenRouter together, both mocked locally.
// Usage: node scripts/smoke-brains.mjs   (no network, no real keys)
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { smartAnswer } from './smoke-agents.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'country-brains-'));
const PORT = 3990 + Math.floor(Math.random() * 9);
const BROKEN = 'x-ai/grok-4.5'; // this model "does not exist" at the mock: must fall back to Claude
const seen = { claude: {}, openrouter: {} };

const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', c => { b += c; }); req.on('end', () => {
    const body = JSON.parse(b || '{}');
    const isClaude = req.url.includes('/v1/messages');
    const prompt = isClaude ? body.messages?.[0]?.content : body.messages?.find(m => m.role === 'user')?.content;
    const bucket = isClaude ? seen.claude : seen.openrouter;
    bucket[body.model] = (bucket[body.model] || 0) + 1;
    res.writeHead(!isClaude && body.model === BROKEN ? 404 : 200, { 'content-type': 'application/json' });
    if (!isClaude && body.model === BROKEN) return res.end('{"error":{"message":"model not found"}}');
    const text = smartAnswer(String(prompt || ''));
    res.end(JSON.stringify(isClaude
      ? { id: 'm', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', usage: { input_tokens: 400, output_tokens: 20 }, content: [{ type: 'text', text }] }
      : { id: 'c', choices: [{ message: { role: 'assistant', content: text } }], usage: { prompt_tokens: 400, completion_tokens: 20 } }));
  });
});
await new Promise(r => mock.listen(0, '127.0.0.1', r));
const MOCK = `http://127.0.0.1:${mock.address().port}`;

const child = spawn(process.execPath, ['server.mjs'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, TICK_SECONDS: '0.1', DAY_TICKS: '4', ELECTION_MIN_VOTING_MS: '0', LLM_PER_MIN: '600',
    ANTHROPIC_API_KEY: 'test-claude', ANTHROPIC_BASE_URL: MOCK, OPENROUTER_API_KEY: 'test-or', OPENROUTER_BASE_URL: MOCK },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = ''; child.stderr.on('data', d => { stderr += d; });
let pass = 0, fail = 0;
const check = (n, ok, info = '') => { if (ok) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${info}`); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
try {
  const engines = new Set();
  for (let i = 0; i < 10; i++) { await wait(5000); try { const x = await (await fetch(`http://127.0.0.1:${PORT}/api/state`)).json(); for (const d of x.decisions) engines.add(d.engine); } catch { /* booting */ } }
  const s = await (await fetch(`http://127.0.0.1:${PORT}/api/state`)).json();
  check('engine label says mixed', /mixed/.test(s.config.engineLabel), s.config.engineLabel);
  const orModels = Object.keys(seen.openrouter);
  check('several model families answered through OpenRouter', new Set(orModels.map(m => m.split('/')[0])).size >= 5, JSON.stringify(seen.openrouter));
  check('anthropic/ founders went to Claude directly, not OpenRouter', !orModels.some(m => m.startsWith('anthropic/')) && (seen.claude['claude-haiku-5-5'] || 0) > 0, JSON.stringify(seen.claude));
  check('a failing OpenRouter model fell back to Claude', (s.llmUsage?.fallbacks || 0) > 0 && (seen.openrouter[BROKEN] || 0) > 0, JSON.stringify(s.llmUsage));

  check('decisions name the brain that answered', [...engines].some(e => /^openrouter:/.test(e)) && [...engines].some(e => /^claude:/.test(e)), JSON.stringify([...engines].slice(0, 12)));
  const wren = s.citizens.find(a => a.id === 'wren'); const aurel = s.citizens.find(a => a.id === 'aurel');
  check('profiles show each founder\'s own model', aurel.model === 'claude-haiku-5-5' && wren.model === BROKEN, `${aurel.model} / ${wren.model}`);
  check('no server errors', !/step error|TypeError|ReferenceError/.test(stderr), stderr.slice(0, 300));
} catch (e) { fail++; console.log('  FAIL crashed', e); }
finally {
  child.kill(); mock.close();
  if (child.exitCode === null) await new Promise(r => { child.once('exit', r); setTimeout(r, 3000); });
  try { fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* windows handle */ }
  console.log(`\nsmoke:brains: ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}
