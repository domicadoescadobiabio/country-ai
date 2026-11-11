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
const BROKEN = 'z-ai/glm-5.3'; // a model many native citizens use "does not exist" at the mock: they must think offline, never on Claude
const seen = { claude: {}, openrouter: {} };

const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', c => { b += c; }); req.on('end', () => {
    const body = JSON.parse(b || '{}');
    const isClaude = req.url.includes('/v1/messages');
    const prompt = isClaude ? body.messages?.[0]?.content : body.messages?.find(m => m.role === 'user')?.content;
    const bucket = isClaude ? seen.claude : seen.openrouter;
    bucket[body.model] = (bucket[body.model] || 0) + 1;
    if (isClaude && body.fallbacks) seen.fallbacksParam = body.fallbacks;
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
  env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, TICK_SECONDS: '0.1', DAY_SECONDS: '0.4', POPULATION: '300', LLM_DAILY_BUDGET_USD: '0', ELECTION_MIN_VOTING_MS: '0', LLM_PER_MIN: '600',
    ANTHROPIC_API_KEY: 'test-claude', ANTHROPIC_BASE_URL: MOCK, OPENROUTER_API_KEY: 'test-or', OPENROUTER_BASE_URL: MOCK },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = ''; child.stderr.on('data', d => { stderr += d; });
let pass = 0, fail = 0;
const check = (n, ok, info = '') => { if (ok) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${info}`); } };
const wait = ms => new Promise(r => setTimeout(r, ms));
try {
  const engines = new Set();
  const both = () => [...engines].some(e => /^openrouter:/.test(e)) && [...engines].some(e => /^claude:/.test(e));
  // sample decisions for at least 50 s, and up to 2 minutes until both routes have answered one
  for (let i = 0; i < 24 && (i < 10 || !both()); i++) { await wait(5000); try { const x = await (await fetch(`http://127.0.0.1:${PORT}/api/state`)).json(); for (const d of x.decisions) engines.add(d.engine); } catch { /* booting */ } }
  const s = await (await fetch(`http://127.0.0.1:${PORT}/api/state`)).json();
  check('engine label says mixed', /mixed/.test(s.config.engineLabel), s.config.engineLabel);
  const orModels = Object.keys(seen.openrouter);
  check('several model families answered through OpenRouter', new Set(orModels.map(m => m.split('/')[0])).size >= 5, JSON.stringify(seen.openrouter));
  // Art. 25: the leadership thinks with Claude Opus; officials and citizens (anthropic/ ones included) through OpenRouter
  check('leadership thinks with Claude Opus directly', (seen.claude['claude-opus-5-5'] || 0) > 0, JSON.stringify(seen.claude));
  check('citizens with anthropic/ models think through OpenRouter, not Claude', Object.keys(seen.openrouter).some(m => m.startsWith('anthropic/')), JSON.stringify(Object.keys(seen.openrouter)));
  check('Opus requests opt into the server-side fallback', seen.fallbacksParam === 'default');
  check('a failing OpenRouter model costs no Claude call: that citizen thinks offline', (seen.openrouter[BROKEN] || 0) > 0 && (s.llmUsage?.fallbacks || 0) === 0, JSON.stringify({ broken: seen.openrouter[BROKEN] || 0, usage: s.llmUsage }));
  const byModel = s.llmUsage?.errorsByModel || {}; const brokenErr = byModel[`openrouter:${BROKEN}`];
  check('errors are counted per model with the kind of failure', brokenErr?.errors > 0 && brokenErr.lastKind === 'http' && brokenErr.lastStatus === 404 && typeof brokenErr.lastAt === 'string', JSON.stringify(byModel));
  check('per-model error counts add up to the total', Object.values(byModel).reduce((t, e) => t + e.errors, 0) === s.llmUsage?.errors, JSON.stringify({ total: s.llmUsage?.errors, byModel }));
  check('every call is costed and the budget is published', (s.llmUsage?.costUsd || 0) > 0 && s.budget && typeof s.budget.spent === 'number', JSON.stringify(s.budget));

  check('decisions name the brain that answered', [...engines].some(e => /^openrouter:/.test(e)) && [...engines].some(e => /^claude:/.test(e)), JSON.stringify([...engines].slice(0, 12)));
  const wren = s.citizens.find(a => a.id === 'wren'); const aurel = s.citizens.find(a => a.id === 'aurel');
  // a profile shows the model that really thinks for the citizen: Claude Opus for a leader, their own model otherwise
  const shown = (a, own) => (a.tier === 'leader' ? /^claude-opus/.test(a.model) : a.model === own);
  check('profiles show the model that really thinks for each founder', shown(aurel, 'anthropic/claude-opus-5.5') && shown(wren, 'x-ai/grok-4.7'), `${aurel.tier}:${aurel.model} / ${wren.tier}:${wren.model}`);
  check('no server errors', !/step error|TypeError|ReferenceError/.test(stderr), stderr.slice(0, 300));
} catch (e) { fail++; console.log('  FAIL crashed', e); }
finally {
  child.kill(); mock.close();
  if (child.exitCode === null) await new Promise(r => { child.once('exit', r); setTimeout(r, 3000); });
  try { fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* windows handle */ }
  console.log(`\nsmoke:brains: ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}
