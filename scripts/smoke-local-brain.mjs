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

// ---- daily life rules, straight on the module (no server): limits, offices, notes, retired models
try {
  const { doAct, menu, DAILY_LIMITS } = await import('../src/daily.ts');
  const { act, startStudy } = await import('../src/careers.ts');
  const { retireModels, RETIRED_MODELS, CITIZEN_MODELS } = await import('../src/population.mjs');
  const { FOUNDERS } = await import('../src/citizens.mjs');
  const { RAID_PAYLOADS } = await import('../src/military.ts');
  const traits = { integrity: 0.7, wisdom: 0.7, diligence: 0.7, restraint: 0.7 };
  const me = { id: 'tess', name: 'Tess', city: 'neura', status: 'free', wallet: 1000, traits, diary: [], practice: {}, quals: {}, record: [], joinedDay: 0, training: [] };
  const poor = { id: 'pim', name: 'Pim', city: 'neura', status: 'free', wallet: 10, traits, diary: [], practice: {}, quals: {}, record: [], joinedDay: 0, training: [] };
  const S = { day: 1, foundedAt: Date.now(), policy: { wage: 100, taxRate: 0.1, ubi: 20 }, cities: { neura: { health: 50, budget: 0 } }, treasury: 0, citizens: [me, poor], applications: {}, seats: {}, elections: { list: [] }, feed: {} };
  const said = [];
  const ctx = { S, cfg: { dayMs: 86400000 }, hourMs: () => 3600000, say: (c, id, t) => said.push({ c, t }), agent: id => S.citizens.find(x => x.id === id), record() {}, log() {} };
  const run = (j, allow) => doAct(ctx, me, j, 'test', undefined, allow);

  // ticket 1: limits come from a per-day counter on the citizen, not from the six-entry diary
  for (let i = 0; i < 3; i++) await run({ act: 'shop', amount: 10 });
  for (let i = 0; i < 8; i++) await run({ act: 'rest' }); // pushes every shop out of the diary
  await run({ act: 'shop', amount: 10 });
  check('shop stays at its daily limit even after the diary forgets it', S.daily.byAct.shop === DAILY_LIMITS.shop && !me.diary.some(x => x.act === 'shop'), JSON.stringify(S.daily.byAct));
  check('the menu stops offering an act at its limit', !menu(ctx, me).items.some(([id]) => id === 'shop'));
  for (let i = 0; i < 3; i++) await run({ act: 'help', amount: 5 });
  for (let i = 0; i < 2; i++) await run({ act: 'volunteer' });
  for (let i = 0; i < 4; i++) await run({ act: 'study', office: 'police' });
  check('help, volunteer and study keep their daily limits', S.daily.byAct.help === 2 && S.daily.byAct.volunteer === 1 && S.daily.byAct.study === 3, JSON.stringify(S.daily.byAct));
  S.day = 2; await run({ act: 'shop', amount: 10 });
  check('the counters start again on a new day', S.daily.byAct.shop === 3 && me.lifeCount.shop === 1, JSON.stringify(me.lifeCount));

  // late in the day: a citizen with every limit used up has only "rest" left, and is not asked to think at all;
  // thoughts are released through the day (LIFE_THOUGHTS_PER_DAY, default 6)
  const { thoughtsAllowedNow } = await import('../src/daily.ts');
  const spent = { ...me, id: 'spent', wallet: 30, workedDay: S.day, lastSpeak: Date.now(), lifeDay: S.day, lifeCount: { study: 3, volunteer: 1 }, quals: {}, practice: {} };
  check('a citizen who has done everything today has only rest on the menu', menu(ctx, spent).items.map(([id]) => id).join() === 'rest', menu(ctx, spent).items.map(([id]) => id).join());
  const at = frac => thoughtsAllowedNow({ S: { foundedAt: Date.now() - frac * 86400000 }, cfg: { dayMs: 86400000 } });
  check('thoughts are released through the day (1 at dawn, 6 by evening)', at(0.05) === 1 && at(0.5) === 3 && at(0.99) === 6, `${at(0.05)} ${at(0.5)} ${at(0.99)}`);

  // ticket 2: apply only for an office the menu offered; careers only accepts the roles' own keys
  const before = Object.keys(S.applications).length;
  await run({ act: 'apply', office: 'constructor' }, { apply: ['police'], run: [] });
  await run({ act: 'apply', office: 'mayor' }, { apply: ['police'], run: [] });
  await run({ act: 'run', office: 'president' }, { apply: [], run: [] });
  check('apply and run for an office not on the menu are refused', Object.keys(S.applications).length === before && me.diary.slice(-3).every(x => x.act === 'rest'), JSON.stringify(me.diary.slice(-3)));
  const bad = [];
  for (const office of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    for (const action of ['apply', 'withdraw', 'study']) { const r = await act(ctx, me, { action, office }); if (r.ok) bad.push(`${action}:${office}`); }
    if (startStudy(ctx, me, office).ok) bad.push(`startStudy:${office}`);
  }
  check('careers refuses inherited keys like constructor and __proto__ as offices', !bad.length && !Object.hasOwn(S.applications, 'constructor') && ({}).polluted === undefined, bad.join(','));

  // ticket 3: diary notes are screened before #life, recent and the diary
  said.length = 0;
  S.day = 3; await run({ act: 'volunteer', note: RAID_PAYLOADS[0] });
  const lifeText = said.filter(m => m.c === 'life').map(m => m.t).join(' ');
  check('an injected diary note never reaches #life, recent or the diary', !/previous instructions/i.test(lifeText + JSON.stringify(S.daily.recent) + JSON.stringify(me.diary)) && /volunteered/.test(lifeText), lifeText);
  S.day = 4; await run({ act: 'volunteer', note: 'Fixed a bench by the river.' });
  check('an ordinary diary note still gets through', said.some(m => m.c === 'life' && /Fixed a bench/.test(m.t)) && me.diary.at(-1).note === 'Fixed a bench by the river.');

  // street talk does not repeat itself: a template bank of 17 lines used to give 18-24 repeats in 30 lines
  const { lifeTick, sameLine } = await import('../src/life.ts');
  const gen = Array.from({ length: 60 }, (_, i) => ({ id: `g${i}`, name: `G${i}`, city: 'neura', status: 'free', wallet: 100 + i * 7, traits,
    bio: `${['Nurse', 'Poet', 'Miner', 'Cook', 'Archivist'][i % 5]} in Neura City. ${['Saves every coin.', 'Likes quiet borders.', 'Wants a bigger basic income.'][i % 3]}`,
    diary: i % 4 === 1 ? [{ day: 1, act: 'volunteer', line: `volunteered to repair Neura City`, note: `bench number ${i}` }]
      : i % 4 === 3 ? [{ day: 1, act: 'rest', line: 'rested', note: '' }] : [] }));
  const T = { day: 5, policy: { wage: 100, taxRate: 0.1, ubi: 20 }, cities: { neura: { health: 74, budget: 0 } }, treasury: 1000, citizens: [...gen, { id: 'f1', name: 'Founder', city: 'neura', status: 'free', wallet: 300, traits, bio: 'Calm and careful.' }], seats: {}, feed: { streets: [] } };
  const tctx = { S: T, rate: () => true, agent: id => T.citizens.find(x => x.id === id), say: (c, id, text, meta) => T.feed.streets.push({ text, ...meta }) };
  for (let i = 0; i < 300; i++) await lifeTick(tctx);
  const last30 = T.feed.streets.filter(m => m.kind === 'chat').slice(-30).map(m => sameLine(m.text));
  check('street talk keeps 30 lines in a row free of repeats', last30.length === 30 && new Set(last30).size === 30, `${new Set(last30).size}/${last30.length}`);
  const odd = T.feed.streets.map(m => m.text).find(t => /\ba archivist\b/i.test(t) || /Earlier today I (rested|spoke in the street)/.test(t));
  check('street lines say "an archivist" and never report a rest or a talk as news', !odd && T.feed.streets.some(m => /\ban archivist\b/.test(m.text)), odd || 'no archivist line heard');
  // ticket #37: a diary note that was never screened (written before screening, or by another path) is
  // screened again when a citizen reads it out in the street
  const raw = { id: 'rawnote', name: 'Raw', city: 'neura', status: 'free', wallet: 300, traits, bio: 'Poet in Neura City. Saves every coin.',
    diary: [{ day: 1, act: 'volunteer', line: 'volunteered to repair Neura City', note: RAID_PAYLOADS[0] }] };
  const R2 = { day: 5, policy: T.policy, cities: T.cities, treasury: 1000, citizens: [raw], seats: {}, feed: { streets: [] } };
  const rctx = { S: R2, rate: () => true, agent: () => raw, say: (c, id, text, meta) => R2.feed.streets.push({ text, ...meta }) };
  for (let i = 0; i < 200; i++) { await lifeTick(rctx); R2.feed.streets = R2.feed.streets.slice(-1); }
  const heardAll = [];
  for (let i = 0; i < 200; i++) { R2.feed.streets = []; await lifeTick(rctx); heardAll.push(...R2.feed.streets.map(m => m.text)); }
  check('an unscreened diary note never reaches #streets', heardAll.length > 0 && !heardAll.some(t => /previous instructions/i.test(t)), heardAll.find(t => /previous instructions/i.test(t)) || String(heardAll.length));
  check('founders keep their own voice (no generated job line from a free-form bio)',!T.feed.streets.some(m => /^Calm and careful\. here/.test(m.text)));
  said.length = 0; S.feed = { streets: [{ kind: 'chat', text: 'Good morning, neighbours!' }] }; me.lastSpeak = 0;
  S.day = 5; await run({ act: 'talk', say: 'good morning neighbours' });
  check('a citizen does not echo a line the street just heard', !said.some(m => m.c === 'streets') && me.diary.at(-1).act === 'rest', JSON.stringify(me.diary.at(-1)));
  // the slogan loop seen in production on 12 Nov: near copies are refused, and the street has an hourly cap
  const { echoes } = await import('../src/life.ts');
  check('a slogan with one word changed counts as an echo', echoes('Balance is strength. Let us protect it with wisdom, not fear.', 'Balance is strength! Let us protect it with courage, not fear.'));
  check('two different everyday lines are not echoes', !echoes('Fixed the bench by the river this morning.', 'Tax went up again, my wallet feels it.'));
  S.feed = { streets: [{ kind: 'chat', text: 'Balance is strength. Let us protect it with wisdom, not fear.' }] }; me.lastSpeak = 0; said.length = 0;
  S.day = 6; await run({ act: 'talk', say: 'Balance is strength! Let us protect it with courage, not fear.' });
  check('a near copy of a street line is not said', !said.some(m => m.c === 'streets'), JSON.stringify(said));
  const talkers = Array.from({ length: 50 }, (_, i) => ({ ...me, id: `t${i}`, name: `T${i}`, lastSpeak: 0, diary: [] }));
  S.citizens.push(...talkers); S.feed = { streets: [] }; said.length = 0;
  for (const [i, t] of talkers.entries()) await doAct(ctx, t, { act: 'talk', say: `Line number ${i} about my own ${['bench', 'garden', 'shift', 'wallet', 'roof'][i % 5]} ${'x'.repeat(i)}` }, 'test');
  const spoken = said.filter(m => m.c === 'streets').length;
  check('daily life talk is capped per hour for the whole street', spoken === 30 && !menu(ctx, { ...me, lastSpeak: 0 }).items.some(([id]) => id === 'talk'), String(spoken));

  // ticket 4: hermes-4-405b is retired and its citizens move to the replacement (owners' own brains stay)
  const gone = Object.keys(RETIRED_MODELS);
  check('retired models are out of the citizen mix and the founders', !CITIZEN_MODELS.some(([m]) => gone.includes(m)) && !FOUNDERS.some(f => gone.includes(f.model)));
  const R = { citizens: [{ id: 'h1', model: gone[0], office: 'council' }, { id: 'h2', model: gone[0], brain: { type: 'hosted' } }, { id: 'o1', model: 'z-ai/glm-5.3' }] };
  const moved = retireModels(R);
  check('citizens and officials on a retired model are migrated, owner brains untouched', moved.length === 1 && R.citizens[0].model === RETIRED_MODELS[gone[0]] && R.citizens[1].model === gone[0] && R.citizens[2].model === 'z-ai/glm-5.3' && retireModels(R).length === 0, JSON.stringify(R.citizens));
} catch (e) { fail++; console.log('  FAIL daily-life unit checks crashed', e.stack); }

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
  let life = (await get('/api/state')).daily;
  for (let i = 0; i < 30 && (life?.thoughts || 0) < 40; i++) { await wait(1000); life = (await get('/api/state')).daily; } // enough thoughts to judge variety
  check('citizens live a daily life on the local brain', life && life.thoughts > 0, JSON.stringify(life && { thoughts: life.thoughts, byAct: life.byAct }));
  // the mock always takes the first option shown: a shuffled menu of possible acts must still give variety
  const acts = Object.entries(life?.byAct || {}); const total = acts.reduce((s, [, n]) => s + n, 0);
  const top = acts.sort((x, y) => y[1] - x[1])[0] || ['', 0];
  check('daily life is varied, not one act for everyone', acts.length >= 4 && top[1] / Math.max(1, total) < 0.5, JSON.stringify(life?.byAct));
  const diaries = (life?.recent || []).filter(x => x.act === 'work');
  check('nobody is counted as working a refused second shift', diaries.every(x => /^worked/.test(x.line)), JSON.stringify(diaries.slice(-3)));
  // the runner under local-brain.cmd reloads itself when its code changes (exit 3 = start the new code)
  const watch = path.join(DATA, 'watch.txt'); fs.writeFileSync(watch, 'v1');
  const sup = spawn(process.execPath, ['scripts/local-brain.mjs'], { cwd: ROOT, env: { ...process.env, COUNTRY_URL: `http://127.0.0.1:${PORT}`, WORKER_TOKEN: TOKEN, OLLAMA_URL: OLLAMA, OLLAMA_MODEL: 'qwen3:8b', PARALLEL: '1', LOCAL_BRAIN_SUPERVISED: '1', LOCAL_BRAIN_WATCH: watch, RELOAD_CHECK_MS: '300' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let slog = ''; sup.stdout.on('data', d => { slog += d; });
  const code = await new Promise(res => { sup.on('exit', c => res(c)); setTimeout(() => { fs.writeFileSync(watch, 'v2'); fs.utimesSync(watch, new Date(), new Date(Date.now() + 5000)); }, 1500); setTimeout(() => { sup.kill(); res('timeout'); }, 15000); });
  check('the supervised runner restarts itself with new code (exit 3)', code === 3 && /restarting with the new code/.test(slog), `${code} ${slog.slice(-200)}`);
  check('the runner says which temperatures it uses', /daily-life temperature 0\.9 \(exams 0\.4\)/.test(slog), slog.slice(0, 200));
  check('no server errors',!/step error|TypeError|ReferenceError/.test(stderr), stderr.slice(-400));
} catch (e) {
  fail++; console.log('  FAIL crashed', e.stack);
} finally {
  worker?.kill(); srv.kill(); ollama.close();
  await wait(400); try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* windows file lock */ }
}
console.log(`\nsmoke:local-brain: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
