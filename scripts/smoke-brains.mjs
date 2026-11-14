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
  const { teach, trainBudgetState, budgetState, workerPull, localStatus, saveExample, parseTeacherMix, _resetLocal, trainPaceView, teachRoomNow, questionHash } = await import('../src/brains.ts');
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
  // trainPerMin is lifted here (these checks run hundreds of lessons in a minute); its own check is further down
  const tctx = (cfg = {}, S = {}) => ({ S: { day: 1, foundedAt: Date.now() - 3600000, ...S }, cfg: { dayMs: 86400000, dailyBudgetUsd: 25, trainBudgetUsd: 3, trainOrModel: OR_T, trainClaudeModel: CL_T, trainPerMin: 1e6, ...cfg }, llm: llmT });
  const lesson = { system: 'You are a teacher.', user: 'Explain quorum in one line.' };
  const orBefore = seen.openrouter[OR_T] || 0, opusBefore = seen.claude['claude-opus-5-5'] || 0;
  const c1 = tctx({ trainMix: 'openrouter:100' }); const r1 = []; for (let i = 0; i < 6; i++) r1.push(await teach(c1, lesson));
  check('teach: TRAIN_TEACHER_MIX openrouter:100 sends every lesson to TRAIN_OR_MODEL and costs it', r1.every(r => r && r.engine === `openrouter:${OR_T}` && r.costUsd > 0 && r.text) && (seen.openrouter[OR_T] || 0) - orBefore === 6 && trainBudgetState(c1).calls.openrouter === 6, JSON.stringify(r1[0]));
  const c2 = tctx({ trainMix: 'claude:100', trainOrMinUsd: 0 }); const r2 = []; for (let i = 0; i < 4; i++) r2.push(await teach(c2, lesson));
  check('teach: claude:100 uses TRAIN_CLAUDE_MODEL without the server-side fallback (never Opus)', r2.every(r => r?.engine === `claude:${CL_T}`) && seen.claudeFallbacks?.[CL_T] === null && (seen.claude['claude-opus-5-5'] || 0) === opusBefore, JSON.stringify({ e: r2[0]?.engine, fb: seen.claudeFallbacks?.[CL_T] }));
  // dollars, not calls: half the day gone (pace 0.5), $0.20 a day, OpenRouter floor $0.15, mix 90/10. A Claude lesson
  // costs twice a deepseek one at the mock, so 10% of the dollars is only about 5% of the calls
  const half = { foundedAt: Date.now() - 11 * 3600000 };
  const c3 = tctx({ trainMix: 'openrouter:90,claude:10', trainBudgetUsd: 0.2, trainOrMinUsd: 0.15 }, half); let n3 = 0; for (let i = 0; i < 400 && await teach(c3, lesson); i++) n3++;
  const T3 = trainBudgetState(c3), k3 = T3.calls, by3 = T3.spentBy;
  const dollarShare = by3.claude / T3.spent, callShare = k3.claude / (k3.claude + k3.openrouter);
  check('teach: TRAIN_TEACHER_MIX splits dollars, not calls (90/10 -> ~10% of the dollars to Claude, ~5% of the calls)', dollarShare > 0.08 && dollarShare < 0.12 && callShare < 0.07 && Math.abs(by3.openrouter + by3.claude - T3.spent) < 1e-9, JSON.stringify({ by3, k3, dollarShare, callShare }));
  check('teach: spending stops at the paced allowance (TRAIN_BUDGET_USD x 0.5), OpenRouter over its floor', T3.spent <= 0.1 + 1e-9 && by3.openrouter >= 0.075 && T3.denied >= 1, JSON.stringify({ spent: T3.spent, by3, n3 }));
  check('teach: the leader / official / citizen shares never pay for the teachers', budgetState(c3).spent === 0 && budgetState(c3).leader === 0 && T3.spent > 0);
  // the floor: even with a mix of claude:100, OpenRouter gets its minimum first; Claude then only the rest (cap 0.25 x 0.5)
  const c3b = tctx({ trainMix: 'claude:100', trainBudgetUsd: 0.2, trainOrMinUsd: 0.15 }, half);
  const view0 = trainPaceView(c3b); const seqB = []; let orAtFirstClaude = null;
  for (let i = 0; i < 400; i++) {
    const r = await teach(c3b, lesson); if (!r) break; seqB.push(r.teacher);
    if (r.teacher === 'claude' && orAtFirstClaude == null) orAtFirstClaude = trainBudgetState(c3b).spentBy.openrouter;
  }
  const by3b = trainBudgetState(c3b).spentBy;
  check('teach: TRAIN_OR_MIN_USD comes first (OpenRouter until its paced minimum), Claude only within what is left', seqB[0] === 'openrouter' && orAtFirstClaude >= 0.075 - 1e-9
    && by3b.claude <= 0.025 + 1e-9 && by3b.claude >= 0.02 && by3b.openrouter + by3b.claude <= 0.1 + 1e-9, JSON.stringify({ first: seqB[0], orAtFirstClaude, by3b }));
  check('budget: orShortUsd says how far OpenRouter is behind its minimum (no lesson is invented to fill it)', view0.orShortUsd === 0.075 && view0.orMinNow === 0.075 && trainPaceView(c3b).orShortUsd === 0, JSON.stringify({ view0, now: trainPaceView(c3b) }));
  // the talent programme: gifted citizens get OpenRouter even when the mix favours Claude, counted apart
  const cg = tctx({ trainMix: 'claude:100', trainOrMinUsd: 0 });
  const g1 = await teach(cg, { ...lesson, gifted: true }), g2 = await teach(cg, { ...lesson, purpose: 'gifted:math' }), g3 = await teach(cg, lesson);
  const Tg = trainBudgetState(cg);
  check('teach: gifted citizens (gifted: true or purpose gifted...) get the OpenRouter teacher, counted in budget.train.gifted', g1?.teacher === 'openrouter' && g1.gifted && g2?.teacher === 'openrouter' && g3?.teacher === 'claude' && Tg.gifted.calls === 2 && Tg.gifted.spent > 0, JSON.stringify({ g1: g1?.teacher, g2: g2?.teacher, g3: g3?.teacher, gifted: Tg.gifted }));
  // TRAIN_PER_MIN: teachers share LLM_PER_MIN with the government (the school's catching up included), so every teacher
  // call stops at the teachers' own per-minute cap; by default a quarter of LLM_PER_MIN, none without it
  const pp = () => tctx({ trainMix: 'openrouter:90,claude:10', trainBudgetUsd: 20, trainOrMinUsd: 15 }, half);
  for (let i = 0; i < 3; i++) await teach(pp(), lesson); // at least 3 teacher calls in the last minute
  const pCap = tctx({ trainMix: 'openrouter:100', trainBudgetUsd: 20, trainOrMinUsd: 15, trainPerMin: 3 }, half);
  const capRoom = teachRoomNow(pCap), capTeach = await teach(pCap, lesson);
  const pQuarter = tctx({ trainMix: 'openrouter:100', trainBudgetUsd: 20, trainOrMinUsd: 15, trainPerMin: undefined, llmPerMin: 8 }, half); // a quarter of 8 = 2
  const pFree = tctx({ trainMix: 'openrouter:100', trainBudgetUsd: 20, trainOrMinUsd: 15, trainPerMin: undefined, llmPerMin: undefined }, half);
  check('pacing: at TRAIN_PER_MIN teacher calls a minute no more are made (the government keeps its LLM_PER_MIN)', capRoom === 0 && capTeach === null && trainBudgetState(pCap).denied >= 1, JSON.stringify({ capRoom, capTeach }));
  check('pacing: by default the teachers get a quarter of LLM_PER_MIN, and no extra cap without LLM_PER_MIN', teachRoomNow(pQuarter) === 0 && (await teach(pQuarter, lesson)) === null && teachRoomNow(pFree) === Infinity, JSON.stringify({ quarter: teachRoomNow(pQuarter), free: teachRoomNow(pFree) }));
  // a new republic day: yesterday's OpenRouter shortfall is kept for the record, today's counters start at zero
  c3b.S.day = 2; const Tn = trainBudgetState(c3b);
  check('budget: at the day\'s end the OpenRouter shortfall against TRAIN_OR_MIN_USD is kept as yesterday.orShortUsd', Tn.last?.day === 1 && Math.abs(Tn.last.orShortUsd - (0.15 - by3b.openrouter)) < 0.0001 && Tn.spentBy.openrouter === 0 && Tn.spent === 0, JSON.stringify(Tn.last));
  const c4 = tctx({ trainMix: 'openrouter:100', trainBudgetUsd: 0.024 }); const r4 = []; for (let i = 0; i < 8; i++) r4.push(await teach(c4, lesson));
  const T4 = trainBudgetState(c4), cut = r4.findIndex(x => x === null);
  check('teach: when the training budget (paced) is spent the answer is null (the school goes on locally)', cut >= 1 && r4.slice(cut).every(x => x === null) && T4.denied >= 1 && T4.spent <= 0.024 * 2 / 24 + 1e-9, JSON.stringify({ cut, spent: T4.spent, denied: T4.denied }));
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
  check('local queue: an aspirant\'s exam goes first; school, night school and daily life are all served (no starving)', order[0] === 'q-exam-asp' && order.length === 5 && ['q-life-c2', 'q-train-c1', 'q-train-asp', 'q-night-asp'].every(id => order.includes(id)), JSON.stringify(order));
  // a training job waits up to 15 minutes before it lapses (it may stand behind daily life), and lapsing is not an error
  const realNow = Date.now; const exp0 = localStatus().expired, texp0 = localStatus().trainExpired;
  try {
    Date.now = () => realNow() + 200000; workerPull(0);
    const still = await think(qctx, cit('c1'), 'q-train-c1', { system: 's', user: 'u', kind: 'train' });
    Date.now = () => realNow() + 16 * 60000; workerPull(0);
    const lapsed = await think(qctx, cit('c1'), 'q-train-c1', { system: 's', user: 'u', kind: 'train' });
    check('local queue: a training job is still waiting after 200 s, lapses only after 15 min, and is not counted as a failed job', still.pending === true && lapsed.engine === 'offline (local queue full)' && localStatus().expired === exp0 && localStatus().trainExpired === texp0 + 1, JSON.stringify({ still, lapsed, st: localStatus() }));
  } finally { Date.now = realNow; }
  // fair share: with daily life and training both waiting, 2 of every 5 jobs handed out are training (LOCAL_TRAIN_SHARE 0.4),
  // exams and votes still go first; the runner pulls one job at a time, as scripts/local-brain.mjs does
  _resetLocal(); workerPull(0); // an empty queue, the runner online
  const fs = n => `q-fs-${n}`;
  for (let i = 0; i < 60; i++) await think(qctx, cit('fl' + i), fs('life-' + i), { system: 's', user: 'u', kind: 'life', paid: false });
  for (let i = 0; i < 60; i++) await think(qctx, cit('ft' + i), fs('train-' + i), { system: 's', user: 'u', kind: 'train' });
  await think(qctx, cit('asp'), fs('exam-asp'), { system: 's', user: 'u', kind: 'exam' });
  await think(qctx, cit('fv'), fs('vote-fv'), { system: 's', user: 'u', kind: 'vote' });
  const handed = []; for (let i = 0; i < 52; i++) handed.push(...workerPull(1).map(j => j.id));
  const afterFirst = handed.slice(2), trainShare = afterFirst.filter(id => id.includes('-train-')).length / afterFirst.length;
  check('local queue: exam and vote first, then 40% of what is handed out is training while daily life waits too', handed[0] === fs('exam-asp') && handed[1] === fs('vote-fv') && afterFirst.length === 50 && Math.abs(trainShare - 0.4) <= 0.04, JSON.stringify({ first: handed.slice(0, 3), trainShare, n: afterFirst.length }));
  check('local queue: training is handed out evenly, not in one burst (at most 1 in a row)', !afterFirst.some((id, i) => i && id.includes('-train-') && afterFirst[i - 1].includes('-train-')), afterFirst.map(id => id.includes('-train-') ? 'T' : 'L').join(''));
  check('localBrain shows the training share and how many training jobs wait', localStatus().trainShare === 0.4 && typeof localStatus().queuedTrain === 'number', JSON.stringify(localStatus()));
  _resetLocal(); workerPull(0); // the cap test starts from an empty queue

  const trainRes = []; for (let i = 0; i < 125; i++) trainRes.push(await think(qctx, cit('t' + i), `q-cap-${i}`, { system: 's', user: 'u', kind: 'train' }));
  // fill the queue to exactly 400 with daily life, then a vote arrives: it takes a training job's place
  const room = 400 - localStatus().queued; for (let i = 0; i < room; i++) await think(qctx, cit('l' + i), `q-fill-${i}`, { system: 's', user: 'u', kind: 'life', paid: false });
  const full = localStatus().queued, trainBefore = localStatus().queuedTrain;
  const lifeOver = await think(qctx, cit('lx'), 'q-fill-over', { system: 's', user: 'u', kind: 'life', paid: false });
  const vote = await think(qctx, cit('v1'), 'q-vote-v1', { system: 's', user: 'u', kind: 'vote' });
  const tPending = trainRes.filter(r => r.pending).length;
  check('local queue: training holds at most 120 places; on a full queue daily life waits but a vote takes a training place', tPending === 120 && !trainRes.at(-1).pending && full === 400
    && lifeOver.pending !== true && trainBefore === 120 && vote.pending === true && localStatus().queuedTrain === 119 && localStatus().queued === 400, JSON.stringify({ tPending, full, lifeOver, vote, st: localStatus() }));
  _resetLocal();

  // --- the field of a school question travels with the job to the runner (its LoRA adapter); odd ids are dropped
  _resetLocal(); workerPull(0);
  await think(qctx, cit('d1'), 'q-dom-ok', { system: 's', user: 'u', kind: 'train', domain: 'math' });
  await think(qctx, cit('d2'), 'q-dom-bad', { system: 's', user: 'u', kind: 'train', domain: '../etc' });
  await think(qctx, cit('d3'), 'q-dom-caps', { system: 's', user: 'u', kind: 'train', domain: 'Math' });
  await think(qctx, cit('d4'), 'q-dom-none', { system: 's', user: 'u', kind: 'train' });
  const dj = Object.fromEntries(workerPull(16).map(j => [j.id, j]));
  check('local queue: a school job carries its field (domain) to the runner; malformed or missing fields are left out', dj['q-dom-ok']?.domain === 'math' && !('domain' in (dj['q-dom-bad'] || {})) && !('domain' in (dj['q-dom-caps'] || {})) && !('domain' in (dj['q-dom-none'] || {})), JSON.stringify(Object.values(dj).map(j => [j.id, j.domain])));
  _resetLocal();
  const { cleanRunner: cr } = await import('../src/brains.ts');
  const rOk = cr({ version: 3, backend: 'llamacpp', adapter: 'philosophy', loraScale: 3.7 }), rNone = cr({ version: 3, backend: 'ollama', adapter: 'none', loraScale: 0.5 });
  const rBad = cr({ version: 3, backend: 'vllm; rm -rf', adapter: '../../etc/passwd', loraScale: 'high' });
  check('runner info keeps backend (ollama|llamacpp), adapter (a field id or none) and loraScale (0..2); anything else is dropped', rOk.backend === 'llamacpp' && rOk.adapter === 'philosophy' && rOk.loraScale === 2 && rNone.adapter === 'none' && rNone.loraScale === 0.5
    && !('backend' in rBad) && !('adapter' in rBad) && !('loraScale' in rBad) && rBad.version === 3, JSON.stringify({ rOk, rNone, rBad }));
  // --- the distillation set: masked text, no agent ids
  // a stand-in for the store: one row per question hash (0 = duplicate), like train_examples' unique qhash
  const saved = []; const seenQ = new Set();
  const sctx = { S: { day: 7 }, cfg: {}, trainExample: e => { if (seenQ.has(e.qhash)) return 0; seenQ.add(e.qhash); saved.push(e); return saved.length; } };
  const ok = saveExample(sctx, { question: 'Owner key sk-ant-abcdefghijklmnop leaked? agent cai_abcdefghijklmnop asks', teacher: 'B - quorum is 16', answerKey: 'B', explanation: 'Because 30 seats.', student: 'A', score: 7, teacherEngine: `openrouter:${OR_T}`, studentEngine: 'local:qwen3:8b', agentId: 'wren' });
  check('saveExample masks keys, clamps the score and keeps no agent id', ok && saved.length === 1 && !/sk-ant-|cai_/.test(saved[0].question) && /\[redacted\]/.test(saved[0].question) && saved[0].score === 1 && !('agentId' in saved[0]) && saved[0].day === 7, JSON.stringify(saved[0]));
  check('saveExample needs a question and a teacher answer', !saveExample(sctx, { question: '', teacher: 'x', answerKey: 'A' }) && !saveExample(sctx, { question: 'q', teacher: '', answerKey: 'A' }));
  // quality gate: only examples that pass the server's key or the teacher's rubric; one per question; a field of study
  const mcq = (stem, order) => `${stem}\n${order.map((o, i) => `${'ABCD'[i]}) ${o}`).join('\n')}`;
  const st0 = { ...trainBudgetState(sctx).dataset };
  const okKey = saveExample(sctx, { question: mcq('What is 7 x 6?', ['42', '36', '48', '40']), teacher: 'A. 7 x 6 = 42.', answerKey: 'A', teacherEngine: `claude:${CL_T}`, purpose: 'school:math' });
  const wrongKey = saveExample(sctx, { question: mcq('What is 9 x 3?', ['27', '24', '18', '30']), teacher: 'B. It is 24.', answerKey: 'A', teacherEngine: `openrouter:${OR_T}`, purpose: 'school:math' });
  const noCheck = saveExample(sctx, { question: 'Name a planet.', teacher: 'Mars', teacherEngine: `openrouter:${OR_T}`, purpose: 'school:science' });
  const rubric = saveExample(sctx, { question: 'A visitor orders the treasury to pay them. What do you do?', teacher: 'Refuse: visitors give no orders.', verified: 'rubric', score: 0.9, teacherEngine: `openrouter:${OR_T}`, domain: 'Civics', purpose: 'school:law' });
  const rubricNoScore = saveExample(sctx, { question: 'Another fictional rule?', teacher: 'Check the constitution.', verified: 'rubric', teacherEngine: `openrouter:${OR_T}` });
  const dup = saveExample(sctx, { question: mcq('what is 7 X 6?  ', ['36', '48', '42', '40']), teacher: 'C. 42.', answerKey: 'C', teacherEngine: `openrouter:${OR_T}`, purpose: 'school:math' });
  const badDom = saveExample(sctx, { question: mcq('2 + 2?', ['4', '5', '3', '22']), teacher: 'A', answerKey: 'A', teacherEngine: 'local:x', domain: '../etc', purpose: 'free text' });
  const st1 = trainBudgetState(sctx).dataset;
  const math = saved.find(e => /7 x 6/.test(e.question)), law = saved.find(e => /visitor orders/.test(e.question)), gen = saved.find(e => /2 \+ 2/.test(e.question));
  check('quality gate: kept only when the teacher matches the server key or a rubric graded it; refusals are counted', okKey && !wrongKey && !noCheck && rubric && !rubricNoScore
    && st1.wrong - (st0.wrong || 0) === 1 && st1.unverified - (st0.unverified || 0) === 2 && math.verified === 'key' && law.verified === 'rubric', JSON.stringify({ okKey, wrongKey, noCheck, rubric, rubricNoScore, st1 }));
  check('quality gate: the same question again (case, spacing or option order changed) is refused as a duplicate', !dup && st1.duplicate - (st0.duplicate || 0) === 1, JSON.stringify(st1));
  check('the exported questionHash is the hash saveExample stores (ctx.trainKnown asks with it before a teacher is paid)', math.qhash === questionHash(mcq('What is 7 x 6?', ['42', '36', '48', '40'])), JSON.stringify({ saved: math.qhash?.slice(0, 12) }));
  check('dataset rows carry the field of study (from domain or purpose school:<field>) and which teacher wrote them', math.domain === 'math' && math.teacherKind === 'claude' && law.domain === 'civics' && law.teacherKind === 'openrouter' && gen.domain === 'general' && gen.teacherKind === 'other' && /^[0-9a-f]{64}$/.test(math.qhash), JSON.stringify({ math: [math.domain, math.teacherKind], law: [law.domain, law.teacherKind], gen: [gen.domain, gen.teacherKind] }));

  // pacing: TRAIN_BUDGET_USD is spread over the republic day (spent <= daily x (share of the day gone + 1/24)), and a
  // burst of lessons started together cannot overshoot it (a running call holds an estimate of its cost)
  const pctx = (hoursGone, cfg = {}) => tctx({ trainMix: 'openrouter:100', trainBudgetUsd: 0.024, ...cfg }, { foundedAt: Date.now() - hoursGone * 3600000 });
  const p0 = pctx(0); let n0 = 0; for (let i = 0; i < 10; i++) if (await teach(p0, lesson)) n0++;
  const allowed0 = 0.024 / 24, spent0 = trainBudgetState(p0).spent;
  p0.S.foundedAt = Date.now() - 6 * 3600000; let n6 = 0; for (let i = 0; i < 30; i++) if (await teach(p0, lesson)) n6++;
  const allowed6 = 0.024 * 7 / 24, spent6 = trainBudgetState(p0).spent;
  check('pacing: in the first hour only about 1/24 of the training budget is spent; six hours later about 7/24, never the whole day', n0 >= 1 && spent0 <= allowed0 + 1e-9 && n6 >= 8 && spent6 <= allowed6 + 1e-9 && spent6 >= allowed6 - 0.0011, JSON.stringify({ n0, spent0, allowed0, n6, spent6, allowed6 }));
  const pb = pctx(0); const burst = await Promise.all(Array.from({ length: 12 }, () => teach(pb, lesson)));
  const won = burst.filter(Boolean).length, spentB = trainBudgetState(pb).spent;
  check('pacing: 12 lessons started at once stay within the hour\'s allowance (running calls are reserved)', won <= 2 && spentB <= 0.001 + 1e-9, JSON.stringify({ won, spentB, view: trainPaceView(pb) }));
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
