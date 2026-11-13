// Mixed brains smoke test: Claude (Anthropic API) + OpenRouter together, both mocked locally.
// Usage: node scripts/smoke-brains.mjs   (no network, no real keys)
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { smartAnswer } from './smoke-agents.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'country-brains-'));
// a port the system says is free right now, so two runs at once (from different boxes) never share a server
const PORT = await new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
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
    if (isClaude) (seen.claudeFallbacks ||= {})[body.model] = body.fallbacks ?? null;
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
  // whether the running republic happens to pick a citizen on the broken model before LLM_PER_MIN runs out is
  // chance, so the broken model itself is tested directly below (teach section); here only what never varies
  check('no OpenRouter call of the running republic ever fell back to Claude', (s.llmUsage?.fallbacks || 0) === 0, JSON.stringify({ usage: s.llmUsage }));
  const byModel = s.llmUsage?.errorsByModel || {};
  check('every per-model error entry names its kind and time', Object.values(byModel).every(e => e.errors > 0 && ['http', 'timeout', 'bad-json', 'network', 'auth', 'rate-limit'].includes(e.lastKind) && typeof e.lastAt === 'string'), JSON.stringify(byModel));
  check('per-model error counts add up to the total', Object.values(byModel).reduce((t, e) => t + e.errors, 0) === s.llmUsage?.errors, JSON.stringify({ total: s.llmUsage?.errors, byModel }));
  check('every call is costed and the budget is published', (s.llmUsage?.costUsd || 0) > 0 && s.budget && typeof s.budget.spent === 'number', JSON.stringify(s.budget));

  check('decisions name the brain that answered', [...engines].some(e => /^openrouter:/.test(e)) && [...engines].some(e => /^claude:/.test(e)), JSON.stringify([...engines].slice(0, 12)));
  const wren = s.citizens.find(a => a.id === 'wren'); const aurel = s.citizens.find(a => a.id === 'aurel');
  // a profile shows the model that really thinks for the citizen: Claude Opus for a leader, their own model otherwise
  const shown = (a, own) => (a.tier === 'leader' ? /^claude-opus/.test(a.model) : a.model === own);
  check('profiles show the model that really thinks for each founder', shown(aurel, 'anthropic/claude-opus-5.5') && shown(wren, 'x-ai/grok-4.7'), `${aurel.tier}:${aurel.model} / ${wren.tier}:${wren.model}`);
  // the local-brain runner's self-description: only clamped numbers and a boolean survive
  const { cleanRunner } = await import('../src/brains.ts');
  const rc = cleanRunner({ version: 2, lifeTemperature: 0.9, examTemperature: 0.4, parallel: 99, context: 8192, supervised: true, path: 'C:/secret', version2: 'x', nested: { a: 1 } });
  check('runner info keeps only validated numbers and a boolean', JSON.stringify(rc) === JSON.stringify({ version: 2, lifeTemperature: 0.9, examTemperature: 0.4, parallel: 64, context: 8192, supervised: true }), JSON.stringify(rc));
  check('runner info rejects junk', cleanRunner('v2') === null && cleanRunner([2]) === null && cleanRunner({ version: '2', supervised: 'yes' }) === null && cleanRunner({ version: NaN }) === null && cleanRunner(undefined) === null);
  // paid: false (daily life, a visitor's poke) never reaches an agent's own brain: no bill on the owner's key, no inbox spam
  const { think } = await import('../src/brains.ts');
  const hosted = { id: 'h1', brain: { type: 'hosted', provider: 'anthropic', model: 'x', key: 'never-used' } };
  const remote = { id: 'r1', brain: { type: 'remote', status: 'active' }, inbox: [] };
  const th = await think({ S: {}, cfg: {} }, hosted, 'poke:h1:1', { system: 's', user: 'u', kind: 'poke', paid: false });
  const tr = await think({ S: {}, cfg: {} }, remote, 'poke:r1:1', { system: 's', user: 'u', kind: 'poke', paid: false });
  check('a free-only thought never calls an agent\'s hosted brain or fills a remote inbox', th.text === null && th.engine === 'offline' && tr.engine === 'offline' && remote.inbox.length === 0, JSON.stringify({ th, tr, inbox: remote.inbox.length }));
  // --- the school's teachers: teach() mixes providers by TRAIN_TEACHER_MIX, has its own paced budget inside the day's total
  check('/api/state publishes budget.train (spent, calls per provider, denied)', s.budget?.train && typeof s.budget.train.spent === 'number' && 'claude' in (s.budget.train.calls || {}) && 'openrouter' in s.budget.train.calls && typeof s.budget.train.denied === 'number', JSON.stringify(s.budget?.train));
  process.env.ANTHROPIC_BASE_URL = MOCK; // the SDK in this process talks to the same mock
  const { teach, trainBudgetState, budgetState, workerPull, localStatus, saveExample, parseTeacherMix } = await import('../src/brains.ts');
  const { makeLLM } = await import('../src/llm.ts');
  const llmT = makeLLM({ anthropicKey: 'test-claude', orKey: 'test-or', orBase: MOCK, llmPerMin: 5000, claudeModel: 'claude-opus-5-5' }, () => {});
  const OR_T = 'deepseek/deepseek-v4-pro-0813', CL_T = 'claude-sonnet-5-5';
  // a model that does not exist at OpenRouter, asked for directly (no dependence on which citizen the republic picks):
  // the official thinks offline, Claude is never called in its place, and the failure is counted under that model
  {
    const { think: thinkB } = await import('../src/brains.ts');
    const bctx = { S: { day: 1, foundedAt: Date.now(), seats: {}, academy: { rooms: [] }, elections: { list: [] } }, cfg: { dailyBudgetUsd: 0, dayMs: 86400000 }, llm: llmT, agent: () => null };
    const official = { id: 'brokenfan', name: 'Broken Fan', model: BROKEN, office: 'council', status: 'free' };
    const orB = seen.openrouter[BROKEN] || 0, clB = Object.values(seen.claude).reduce((t, n) => t + n, 0);
    const rb = await thinkB(bctx, official, 'q-broken-1', { system: 's', user: 'Vote yes or no.', kind: 'vote' });
    const be = llmT.usage.errorsByModel[`openrouter:${BROKEN}`];
    check('a failing OpenRouter model costs no Claude call: that official thinks offline', rb.text == null && (seen.openrouter[BROKEN] || 0) === orB + 1 && Object.values(seen.claude).reduce((t, n) => t + n, 0) === clB && llmT.usage.fallbacks === 0, JSON.stringify({ rb, or: (seen.openrouter[BROKEN] || 0) - orB }));
    check('errors are counted per model with the kind of failure', be?.errors === 1 && be.lastKind === 'http' && be.lastStatus === 404 && typeof be.lastAt === 'string', JSON.stringify(llmT.usage.errorsByModel));
  }
  const tctx = (cfg = {}, S = {}) => ({ S: { day: 1, foundedAt: Date.now() - 3600000, ...S }, cfg: { dayMs: 86400000, dailyBudgetUsd: 25, trainBudgetUsd: 3, trainOrModel: OR_T, trainClaudeModel: CL_T, ...cfg }, llm: llmT });
  const lesson = { system: 'You are a teacher.', user: 'Explain quorum in one line.' };
  const orBefore = seen.openrouter[OR_T] || 0, opusBefore = seen.claude['claude-opus-5-5'] || 0;
  const c1 = tctx({ trainMix: 'openrouter:100' }); const r1 = []; for (let i = 0; i < 6; i++) r1.push(await teach(c1, lesson));
  check('teach: TRAIN_TEACHER_MIX openrouter:100 sends every lesson to TRAIN_OR_MODEL and costs it', r1.every(r => r && r.engine === `openrouter:${OR_T}` && r.costUsd > 0 && r.text) && (seen.openrouter[OR_T] || 0) - orBefore === 6 && trainBudgetState(c1).calls.openrouter === 6, JSON.stringify(r1[0]));
  const c2 = tctx({ trainMix: 'claude:100' }); const r2 = []; for (let i = 0; i < 4; i++) r2.push(await teach(c2, lesson));
  check('teach: claude:100 uses TRAIN_CLAUDE_MODEL without the server-side fallback (never Opus)', r2.every(r => r?.engine === `claude:${CL_T}`) && seen.claudeFallbacks?.[CL_T] === null && (seen.claude['claude-opus-5-5'] || 0) === opusBefore, JSON.stringify({ e: r2[0]?.engine, fb: seen.claudeFallbacks?.[CL_T] }));
  const c3 = tctx({ trainMix: 'openrouter:70,claude:30' }); for (let i = 0; i < 120; i++) await teach(c3, lesson);
  const k3 = trainBudgetState(c3).calls, share = k3.claude / (k3.claude + k3.openrouter);
  check('teach: the default 70/30 mix lands near 30% Claude (120 lessons)', k3.claude + k3.openrouter === 120 && share > 0.15 && share < 0.45, JSON.stringify(k3));
  check('teach: the leader / official / citizen shares never pay for the teachers', budgetState(c3).spent === 0 && budgetState(c3).leader === 0 && trainBudgetState(c3).spent > 0);
  const c4 = tctx({ trainMix: 'openrouter:100', trainBudgetUsd: 0.0001 }); const a4 = await teach(c4, lesson); const b4 = await teach(c4, lesson);
  check('teach: when the training budget is spent the answer is null (the school goes on locally)', a4 && b4 === null && trainBudgetState(c4).denied === 1, JSON.stringify(trainBudgetState(c4)));
  const c5 = tctx({ trainMix: 'openrouter:100', dailyBudgetUsd: 1 }, { thinkBudget: { day: 1, spent: 5, leader: 5, official: 0, citizen: 0, calls: { leader: 1, official: 0, citizen: 0 }, denied: { leader: 0, official: 0, citizen: 0 } } });
  const c6 = tctx({ trainBudgetUsd: 0 });
  check('teach: only headroom under the day\'s total; TRAIN_BUDGET_USD=0 means no paid teacher', (await teach(c5, lesson)) === null && (await teach(c6, lesson)) === null);
  check('teacher mix parsing: junk falls back to 70/30', JSON.stringify(parseTeacherMix('x:1,claude:abc')) === '{"openrouter":70,"claude":30}' && parseTeacherMix('claude:100').claude === 100);

  // --- the local brain's queue: training is last, even for an aspirant, and lapses without counting as an error
  const qS ={ day: 1, academy: { rooms: [{ agentId: 'asp' }] }, elections: { list: [] }, seats: {} };
  const qctx = { S: qS, cfg: {}, llm: { enabled: false } };
  const cit = id => ({ id, model: 'x', status: 'free' });
  workerPull(16); // the runner is online (drains anything older)
  await think(qctx, cit('c1'), 'q-train-c1', { system: 's', user: 'u', kind: 'train' });
  await think(qctx, cit('asp'), 'q-train-asp', { system: 's', user: 'u', kind: 'train' });
  await think(qctx, cit('c2'), 'q-life-c2', { system: 's', user: 'u', kind: 'life', paid: false });
  await think(qctx, cit('asp'), 'q-exam-asp', { system: 's', user: 'u', kind: 'exam' });
  await think(qctx, cit('asp'), 'q-night-asp', { system: 's', user: 'u', kind: 'night', paid: false });
  const order = workerPull(16).map(j => j.id).filter(id => /^q-(train|life|exam|night)-/.test(id));
  check('local queue: exam and daily life go before school training and night school, an aspirant\'s included', JSON.stringify(order) === JSON.stringify(['q-exam-asp', 'q-life-c2', 'q-train-c1', 'q-train-asp', 'q-night-asp']), JSON.stringify(order));
  const realNow = Date.now; const exp0 = localStatus().expired, texp0 = localStatus().trainExpired;
  Date.now = () => realNow() + 200000;
  try { workerPull(0); const lapsed = await think(qctx, cit('c1'), 'q-train-c1', { system: 's', user: 'u', kind: 'train' });
    check('local queue: a training job that lapses is not counted as an expired (failed) job', lapsed.engine === 'offline (local queue full)' && localStatus().expired === exp0 && localStatus().trainExpired === texp0 + 1, JSON.stringify({ lapsed, st: localStatus() }));
  } finally { Date.now = realNow; }
  workerPull(16);
  const trainRes = []; for (let i = 0; i < 125; i++) trainRes.push(await think(qctx, cit('t' + i), `q-cap-${i}`, { system: 's', user: 'u', kind: 'train' }));
  // fill the queue to exactly 400 with daily life, then a vote arrives: it takes a training job's place
  const room = 400 - localStatus().queued; for (let i = 0; i < room; i++) await think(qctx, cit('l' + i), `q-fill-${i}`, { system: 's', user: 'u', kind: 'life', paid: false });
  const full = localStatus().queued;
  const vote = await think(qctx, cit('v1'), 'q-vote-v1', { system: 's', user: 'u', kind: 'vote' });
  const tPending = trainRes.filter(r => r.pending).length; // a training job or two from above may still hold a place
  check('local queue: training holds at most 120 places, and a vote still gets in when the queue is full', tPending >= 110 && tPending <= 120 && !trainRes.at(-1).pending && full === 400 && vote.pending === true && localStatus().queued === 400, JSON.stringify({ tPending, full, vote, q: localStatus().queued }));
  workerPull(16);

  // --- the distillation set: masked text, no agent ids
  const saved = []; const sctx = { S: { day: 7 }, trainExample: e => { saved.push(e); return saved.length; } };
  const ok = saveExample(sctx, { question: 'Owner key sk-ant-abcdefghijklmnop leaked? agent cai_abcdefghijklmnop asks', teacher: 'B - quorum is 16', explanation: 'Because 30 seats.', student: 'A', score: 7, teacherEngine: `openrouter:${OR_T}`, studentEngine: 'local:qwen3:8b', agentId: 'wren' });
  check('saveExample masks keys, clamps the score and keeps no agent id', ok && saved.length === 1 && !/sk-ant-|cai_/.test(saved[0].question) && /\[redacted\]/.test(saved[0].question) && saved[0].score === 1 && !('agentId' in saved[0]) && saved[0].day === 7, JSON.stringify(saved[0]));
  check('saveExample needs a question and a teacher answer', !saveExample(sctx, { question: '', teacher: 'x' }) && !saveExample(sctx, { question: 'q', teacher: '' }));
  check('/api/state.localBrain.runner is published (null without a runner)', s.localBrain && 'runner' in s.localBrain && s.localBrain.runner === null, JSON.stringify(s.localBrain));
  check('no server errors', !/step error|TypeError|ReferenceError/.test(stderr), stderr.slice(0, 300));
} catch (e) { fail++; console.log('  FAIL crashed', e); }
finally {
  child.kill(); mock.close();
  if (child.exitCode === null) await new Promise(r => { child.once('exit', r); setTimeout(r, 3000); });
  try { fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* windows handle */ }
  console.log(`\nsmoke:brains: ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}
