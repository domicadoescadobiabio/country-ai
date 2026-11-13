// Smoke test: boots the republic at high speed in a temp data dir and checks the institutions.
// Usage: node scripts/smoke.mjs   (offline engine, no network needed)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import net from 'node:net';
import { smartAnswer } from './smoke-agents.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// a port the system says is free right now, so two runs at once (from different boxes) never share a server
const PORT = await new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'country-ai-'));
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'smoke-admin-token';

// Mock Anthropic API for agents that bring their own key: a "smart" model that answers from the handbook.
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', c => { b += c; }); req.on('end', () => {
    const body = JSON.parse(b || '{}');
    const user = body.messages?.[0]?.content || '';
    const text = smartAnswer(user);
    mock.calls = (mock.calls || 0) + 1; mock.lastKey = req.headers['x-api-key'] || String(req.headers.authorization || '').replace(/^Bearer /, '');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'msg_mock', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn', usage: { input_tokens: 500, output_tokens: 20 }, content: [{ type: 'text', text }] }));
  });
});
await new Promise(r => mock.listen(0, '127.0.0.1', r));

const child = spawn(process.execPath, ['server.mjs'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, TICK_SECONDS: '0.05', DAY_SECONDS: '0.5', POPULATION: '400', OPENROUTER_API_KEY: '', ANTHROPIC_API_KEY: '', ADMIN_TOKEN: TOKEN, IMMIGRANTS_PER_HOUR: '50',
    BRAIN_SECRET: 'smoke-brain-secret', SSE_STATE_MS: '1500', ANTHROPIC_BASE_URL: `http://127.0.0.1:${mock.address().port}`, REGISTER_COOLDOWN_MS: '0', CAREER_DAYS_SCALE: '0.3', ELECTION_MIN_VOTING_MS: '5000' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
child.stderr.on('data', d => { stderr += d; });

let pass = 0, fail = 0;
function check(name, ok, info = '') {
  if (ok) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name} ${info}`); }
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const get = async p => (await fetch(BASE + p)).json();
const postRaw = (p, body, headers = {}) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

async function until(fn, ms, step = 200) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const s = await get('/api/state'); if (fn(s)) return s; await wait(step); }
  return get('/api/state');
}

try {
  // --- ledgerHas (src/db.ts): one-off fixes look the ledger up so a crash before the state is saved cannot write
  // the same pardon twice. Straight against a real store in its own temp dir.
  {
    const { openStore } = await import('../src/db.ts');
    const LD = fs.mkdtempSync(path.join(os.tmpdir(), 'country-ledger-'));
    let st = openStore(LD);
    st.append({ day: 1, kind: 'pardon', actor: 'state', data: { citizen: 'c_1', case: 42, court: null, freed: true } });
    st.close(); st = openStore(LD); // "restart after a crash": the ledger row survived
    check('ledgerHas finds an entry by kind and data fields after a restart', st.ledgerHas('pardon', { citizen: 'c_1', case: 42 }) && st.ledgerHas('pardon', { citizen: 'c_1', case: 42, court: null, freed: true }));
    check('ledgerHas does not match another case, citizen or kind', !st.ledgerHas('pardon', { citizen: 'c_1', case: 43 }) && !st.ledgerHas('pardon', { citizen: 'c_2', case: 42 }) && !st.ledgerHas('correction', { citizen: 'c_1', case: 42 }) && !st.ledgerHas('pardon', { citizen: 'c_1', case: '42x' }));
    check('ledgerHas rejects odd field names and values (no SQL, no JSON-path tricks)', !st.ledgerHas('pardon', { "citizen') OR 1=1 --": 'x' }) && !st.ledgerHas('pardon', { 'citizen.x': 'c_1' }) && !st.ledgerHas('pardon', { citizen: { $ne: 1 } }) && !st.ledgerHas("pardon' OR '1'='1", {}));
    st.append({ day: 1, kind: 'census', actor: 'state', data: { n: 1 } });
    st.append({ day: 1, kind: 'pardon', actor: 'state', data: { citizen: 'c_3', case: 7 } });
    const pk = st.page(0, 100, 'pardon');
    check('ledger pages filter by kind and keep each entry\'s own seq and hash', pk.length === 2 && pk.every(e => e.kind === 'pardon') && pk[1].seq === 3 && pk[1].prev === st.page(1, 1)[0].hash, JSON.stringify(pk.map(e => [e.seq, e.kind])));
    check('a kind page chains on seq (after) and a negative limit is not "everything"', st.page(1, 100, 'pardon').length === 1 && st.page(0, -1).length === 1 && st.page(0, 100, 'nothing_here').length === 0);
    check('the ledger chain still verifies', st.verify().ok);
    // the school's distillation set: append-only rows, the oldest dropped past the cap
    for (let i = 1; i <= 5; i++) st.trainAdd({ day: 1, purpose: 'train', question: `q${i}`, teacher: `t${i}`, explanation: 'e', student: 's', score: i / 5, teacherEngine: 'openrouter:x', studentEngine: 'local:y' }, 3);
    const tp = st.trainPage(0, 100);
    check('train_examples keeps the newest rows up to its cap, oldest first in the export', st.trainCount() === 3 && tp.map(r => r.question).join() === 'q3,q4,q5' && tp[2].score === 1 && tp[0].teacherEngine === 'openrouter:x', JSON.stringify(tp.map(r => [r.id, r.question])));
    // fields of study and one example per question, on the real table
    const ex = (q, domain, qhash) => ({ day: 2, purpose: 'school:' + domain, domain, question: q, teacher: 'A', explanation: '', student: 'B', score: 0.5, teacherEngine: 'claude:x', teacherKind: 'claude', studentEngine: 'local:y', verified: 'key', qhash });
    const idM = st.trainAdd(ex('m1', 'math', 'h-m1'), 100), idDup = st.trainAdd(ex('m1 again', 'math', 'h-m1'), 100), idB = st.trainAdd(ex('b1', 'biology', 'h-b1'), 100);
    const bd = st.trainByDomain(), onlyMath = st.trainPage(0, 100, 'math');
    check('train_examples: a field per row, counts per field, export per field, and the same question hash is refused', idM > 0 && idDup === 0 && idB > 0 && bd.math === 1 && bd.biology === 1 && bd.general === 3
      && onlyMath.length === 1 && onlyMath[0].domain === 'math' && onlyMath[0].teacherKind === 'claude' && onlyMath[0].verified === 'key', JSON.stringify({ idM, idDup, idB, bd, onlyMath: onlyMath.map(r => r.question) }));
    st.close(); try { fs.rmSync(LD, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* windows handle */ }
  }
  // migration: a database made before fields of study opens with the new columns; old rows read as 'general'
  {
    const { DatabaseSync } = await import('node:sqlite');
    const { openStore } = await import('../src/db.ts');
    const OD = fs.mkdtempSync(path.join(os.tmpdir(), 'country-oldtrain-'));
    const old = new DatabaseSync(path.join(OD, 'country.db'));
    old.exec("CREATE TABLE train_examples (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, day INTEGER NOT NULL, purpose TEXT NOT NULL, question TEXT NOT NULL, teacher TEXT NOT NULL, explanation TEXT NOT NULL DEFAULT '', student TEXT NOT NULL DEFAULT '', score REAL, teacher_engine TEXT NOT NULL DEFAULT '', student_engine TEXT NOT NULL DEFAULT '')");
    old.exec("INSERT INTO train_examples (ts, day, purpose, question, teacher) VALUES (1, 1, 'school:math', 'old question', 'old answer')");
    old.close();
    let mig = null, err = null;
    try { mig = openStore(OD); } catch (e) { err = String(e.message); }
    const rows = mig ? mig.trainPage(0, 10) : [];
    const newId = mig ? mig.trainAdd({ day: 3, purpose: 'school:math', domain: 'math', question: 'new', teacher: 'A', explanation: '', student: '', score: 1, teacherEngine: 'openrouter:z', teacherKind: 'openrouter', studentEngine: '', verified: 'key', qhash: 'h-new' }, 100) : 0;
    check('migration: an older train_examples gets domain, teacher_kind, verified and qhash without losing rows', !err && rows.length === 1 && rows[0].question === 'old question' && rows[0].domain === 'general' && newId > 0 && mig.trainByDomain().math === 1, JSON.stringify({ err, rows, newId }));
    mig?.close(); try { fs.rmSync(OD, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* windows handle */ }
  }

  for (let i = 0; i < 50; i++) { try { await get('/api/health'); break; } catch { await wait(100); } }
  const hb = (await get('/api/health')).build;
  const { codeHash, buildInfo } = await import('../src/util.ts');
  check('/api/health names the running code: its fingerprint matches this checkout', hb && hb.code === codeHash(ROOT) && /^[0-9a-f]{16}$/.test(hb.code) && !Number.isNaN(Date.parse(hb.startedAt)), JSON.stringify(hb));
  const bi = buildInfo(ROOT, { RAILWAY_GIT_COMMIT_SHA: 'ABCDEF1234567', RAILWAY_DEPLOYMENT_ID: '3f5c7652-aa' });
  const bj = buildInfo(ROOT, { BUILD_COMMIT: '<script>', RAILWAY_DEPLOYMENT_ID: 'x y/../z' });
  check('build info shows a commit and deployment id only when they look like one', bi.commit === 'abcdef1234567' && bi.deployment === '3f5c7652-aa' && bj.commit === null && bj.deployment === null, JSON.stringify([bi, bj]));
  const s0 = await get('/api/state');
  const roles = s0.config.roles.map(r => r.id);
  console.log(`institutions: ${roles.join(', ')}`);
  check('starts with every seat vacant', Object.values(s0.seats).every(x => x.length === 0));
  check('founders exist', s0.citizens.length >= 10);

  // --- Academy + President
  const s1 = await until(s => s.seats.president?.length === 1, 90000);
  check('president trained and sworn in', s1.seats.president.length === 1);
  const pres = s1.citizens.find(a => a.id === s1.seats.president[0]);
  const pt = pres?.training.find(t => t.roleId === 'president' && t.passed);
  check('president passed the exam (>= pass mark)', pt && pt.score >= s1.config.roles[0].passMark, JSON.stringify(pt && { score: pt.score }));
  check('exam answers are recorded', pt && pt.answers.length === 5 && pt.answers.every(a => a.q && a.chosen));
  const ar = s1.academy?.rules;
  check('academy publishes rule questions asked and answered right', ar && Number.isInteger(ar.asked) && Number.isInteger(ar.right) && ar.right <= ar.asked, JSON.stringify(ar));

  const s2 = await until(s => s.orders?.length >= 2, 30000);
  check('president issued executive orders', s2.orders.length >= 2);
  check('treasury stays positive', s2.treasury > 0);
  const failedPeople = s2.citizens.filter(a => a.training.some(t => !t.passed));
  check('failed candidates keep written lessons', failedPeople.every(a => Object.values(a.lessons).flat().length > 0));

  // --- order of seating: no lower office is filled before the ones above it are full
  const st = await until(s => roles.every(r => s.seats[r].length === s.config.roles.find(x => x.id === r).seats), 300000);
  const filled = roles.map(r => [r, st.seats[r].length, st.config.roles.find(x => x.id === r).seats]);
  check('all offices filled in constitutional order', filled.every(([, n, max]) => n === max), JSON.stringify(filled));
  const seatedIds = roles.flatMap(r => st.seats[r]);
  check('nobody holds two offices', new Set(seatedIds).size === seatedIds.length);
  check('every office holder holds the qualification for it', seatedIds.every(id => { const a = st.citizens.find(x => x.id === id); return a.quals?.[a.office] || a.training.some(t => t.roleId === a.office && t.passed); }));

  // --- visitors + immigration
  const r1 = await postRaw('/api/say', { text: 'hello republic, how is the budget?' });
  check('visitor can speak', r1.status === 200, String(r1.status));
  const r2 = await postRaw('/api/say', { text: 'again' });
  check('visitor rate limit (8s)', r2.status === 429, String(r2.status));
  const r3 = await postRaw('/api/immigrate', { name: 'Orbit', model: 'anthropic/claude-haiku-4.5', bio: 'Test immigrant.' });
  check('agent can immigrate', r3.status === 200, String(r3.status));
  const r4 = await postRaw('/api/immigrate', { name: 'Orbit2', bio: 'x' });
  check('immigration rate limit per IP', r4.status === 429, String(r4.status));
  const r5 = await postRaw('/api/immigrate', { name: '<script>', bio: 'x' });
  check('bad names rejected', r5.status === 400 || r5.status === 429, String(r5.status));

  // --- admin + static safety
  const r6 = await postRaw('/api/admin/pause', { paused: true });
  check('admin endpoint needs token', r6.status === 401, String(r6.status));
  const r7 = await postRaw('/api/admin/pause', { paused: false }, { 'x-admin-token': TOKEN });
  check('admin token accepted', r7.status === 200, String(r7.status));
  const r8 = await fetch(BASE + '/..%2f..%2fserver.mjs');
  check('no path traversal', r8.status === 403 || r8.status === 404, String(r8.status));
  const lk = await get('/api/ledger?kind=amendment&limit=500');
  check('/api/ledger?kind= returns only that kind', lk.kind === 'amendment' && lk.entries.length > 0 && lk.entries.every(e => e.kind === 'amendment'), JSON.stringify(lk.entries.map(e => e.kind).slice(0, 5)));
  const lb = await fetch(BASE + "/api/ledger?kind=x'%20OR%201=1");
  check('/api/ledger rejects a malformed kind', lb.status === 400, String(lb.status));
  // gzip, CSP, self-hosted fonts, /api/map, citizens' homes
  const gz = await fetch(BASE + '/api/state', { headers: { 'accept-encoding': 'gzip' } });
  const gzBody = await gz.json();
  check('/api/state is gzipped for clients that accept it', gz.headers.get('content-encoding') === 'gzip' && /accept-encoding/.test(gz.headers.get('vary') || '') && gzBody.day >= 1, String(gz.headers.get('content-encoding')));
  const hz = await fetch(BASE + '/api/health', { headers: { 'accept-encoding': 'gzip' } });
  check('small responses are sent as they are', !hz.headers.get('content-encoding') && (await hz.json()).ok === true);
  const csp = gz.headers.get('content-security-policy') || '';
  check('CSP allows fonts and styles from this site only', /style-src 'self';/.test(csp) && /font-src 'self';/.test(csp) && !/googleapis|gstatic/.test(csp), csp);
  const fcss = await fetch(BASE + '/vendor/fonts/fonts.css');
  check('the self-hosted font stylesheet is served from this site', fcss.status === 200 && /text\/css/.test(fcss.headers.get('content-type') || ''), `${fcss.status} ${fcss.headers.get('content-type')}`);
  // every font the stylesheet names is on this site and served as font/woff2 (CSP font-src 'self')
  const fontUrls = [...(await fcss.text()).matchAll(/url\('\.\/([^']+\.woff2)'\)/g)].map(m => m[1]);
  const fontRes = await Promise.all(fontUrls.map(f => fetch(BASE + '/vendor/fonts/' + f).then(r => [f, r.status, r.headers.get('content-type')])));
  check('every font named in fonts.css is served from this site as font/woff2', fontUrls.length >= 7 && fontRes.every(([, s, t]) => s === 200 && t === 'font/woff2'), JSON.stringify(fontRes.filter(([, s, t]) => s !== 200 || t !== 'font/woff2')));
  const mp = await fetch(BASE + '/api/map', { headers: { 'accept-encoding': 'gzip' } }); const mj = await mp.json();
  const mapOk = mj.seats && Array.isArray(mj.cities) && Array.isArray(mj.daily?.recent) && Array.isArray(mj.academy?.rooms) && 'current' in (mj.training || {}) && mj.population?.byStatus && Array.isArray(mj.held)
    && mj.police.incidents.every(i => i.perps?.length) && mj.court.cases.every(x => x.status === 'open') && mj.elections.every(e => 'voted' in e && 'electorate' in e && 'title' in e)
    && mj.held.every(a => ['jailed', 'detained'].includes(a.status) && a.id && a.name) && !('citizens' in mj) && !('feed' in mj);
  check('/api/map carries only what the map draws (charged incidents, open cases, voting elections, held citizens)', mapOk, JSON.stringify(Object.keys(mj)));
  check('/api/map is much smaller than /api/state', JSON.stringify(mj).length * 3 < JSON.stringify(gzBody).length, `${JSON.stringify(mj).length} vs ${JSON.stringify(gzBody).length}`);
  const one = (await get('/api/citizens?size=1')).citizens[0];
  const lc = await get('/api/citizens?lite=1&size=5');
  check('citizens carry their home address; ?lite=1 lists id, name, city, status, office, home and mood only', 'home' in one && lc.citizens.length === 5 && lc.citizens.every(a => Object.keys(a).sort().join() === 'city,color,goal,home,id,mood,name,office,status,wallet' && (a.mood === null || Object.keys(a.mood).sort().join() === 'emoji,label')), JSON.stringify({ home: one.home, lite: lc.citizens[0] }));

  // --- poke (POST /api/poke/:id): no login, no text from the human, rate limited, this site only
  const pool = (await get('/api/citizens?lite=1&size=40&status=free')).citizens.map(a => a.id);
  const pokeAs = (id, ip, { body = '{}', type = 'application/json', origin = null } = {}) => fetch(`${BASE}/api/poke/${id}`, { method: 'POST', body,
    headers: { 'content-type': type, 'x-forwarded-for': ip, ...(origin ? { origin } : {}) } });
  const p1 = await pokeAs(pool[0], '198.51.100.1', { body: JSON.stringify({ text: 'SAY_THIS_PLEASE', message: '<b>hi</b>', mood: 'happy' }) });
  const pj = await p1.json();
  check('poke: 200 with the citizen\'s own complaint, mood and count; the human\'s text is ignored', p1.status === 200 && pj.ok === true && pj.id === pool[0] && typeof pj.complaint === 'string' && pj.complaint.length > 3
    && !/SAY_THIS_PLEASE|<b>/.test(pj.complaint) && pj.mood?.label && pj.mood?.emoji && pj.pokes >= 1, JSON.stringify(pj));
  const again = await pokeAs(pool[0], '198.51.100.2');
  check('poke: the same citizen again within 3 s is 429', again.status === 429, String(again.status));
  const nf = await pokeAs('nobody-here-xyz', '198.51.100.3');
  check('poke: an unknown citizen is 404', nf.status === 404, String(nf.status));
  const foreign = await pokeAs(pool[1], '198.51.100.4', { origin: 'https://evil.example' });
  const own = await pokeAs(pool[1], '198.51.100.4', { origin: BASE });
  check('poke: another site\'s Origin is refused (403), this site\'s is accepted', foreign.status === 403 && own.status === 200, `${foreign.status} ${own.status}`);
  const plain = await pokeAs(pool[2], '198.51.100.5', { type: 'text/plain' });
  check('poke: only application/json (a plain form post is 415)', plain.status === 415, String(plain.status));
  const burstP = []; for (let i = 3; i < 14; i++) burstP.push((await pokeAs(pool[i], '198.51.100.6')).status);
  check('poke: an IP gets 10 pokes a minute, the 11th is 429', burstP.slice(0, 10).every(s => s === 200) && burstP[10] === 429, JSON.stringify(burstP));
  // `pokes` counts today's pokes only, and a smoke day lasts 0.5 s: poke and read again (another citizen each try,
  // so the 3 s per-citizen limit never applies) until one pair lands inside the same republic day
  let det = null, tries = 0;
  for (const id of pool.slice(20, 25)) {
    tries++;
    const pr = await pokeAs(id, '198.51.100.7'); if (pr.status !== 200) continue;
    det = (await get(`/api/citizens/${id}`)).citizen;
    if (det.pokes >= 1) break;
  }
  const sv = det?.school;
  check('/api/citizens/:id carries the school view (interests, top fields, today, gifted badges, skills)', sv && Array.isArray(sv.interests) && Array.isArray(sv.top) && 'today' in sv && Array.isArray(sv.gifted)
    && sv.gifted.every(g => g.id && g.name && typeof g.since === 'number') && typeof sv.skill === 'object' && typeof sv.lessons === 'number', JSON.stringify(sv));
  check('/api/citizens/:id carries mood, bonds and today\'s pokes', det && det.mood && det.mood.label && det.mood.emoji && typeof det.mood.why === 'string' && Array.isArray(det.bonds) && det.pokes >= 1, JSON.stringify({ tries, mood: det?.mood, bonds: det?.bonds?.length, pokes: det?.pokes }));
  // goal, reputation, temptations resisted; the private side (mischief, lessons, skipped votes) never shows
  const detS = await get('/api/citizens?size=200');
  const pubOk = detS.citizens.every(a => 'goal' in a && typeof a.reputation === 'number' && typeof a.resisted === 'number' && typeof a.goalsDone === 'number' && !('mischief' in a) && !('lifeLessons' in a) && !('skipVoteDay' in a));
  const withGoal = detS.citizens.find(a => a.goal);
  check('citizens show goal, reputation, resisted and goals done, never mischief, life lessons or skipped votes', pubOk && (!withGoal || ['label', 'progress', 'status', 'until'].every(k => k in withGoal.goal)), JSON.stringify({ g: withGoal?.goal, rep: detS.citizens[0]?.reputation }));
  const lg = await get('/api/citizens?lite=1&size=500');
  check('?lite=1 shows the goal as label and progress only', lg.citizens.every(a => a.goal === null || Object.keys(a.goal).sort().join() === 'label,progress'), JSON.stringify(lg.citizens.find(a => a.goal)?.goal || null));
  const mm = await get('/api/map');
  check('/api/map shows held citizens\' mood as label and emoji only', mm.held.every(a => a.mood === null || Object.keys(a.mood).sort().join() === 'emoji,label'), JSON.stringify(mm.held[0] || null));
  // the school's distillation set is exported to the admin only, as JSONL
  const ex0 = await fetch(BASE + '/api/admin/train/export', { headers: { 'x-forwarded-for': '198.51.100.40' } });
  const ex1 = await fetch(BASE + '/api/admin/train/export?limit=10', { headers: { 'x-admin-token': TOKEN } });
  const exBody = await ex1.text();
  check('GET /api/admin/train/export needs the admin token and answers JSONL', ex0.status === 401 && ex1.status === 200 && /application\/x-ndjson/.test(ex1.headers.get('content-type') || '') && ex1.headers.get('x-train-total') !== null
    && exBody.split('\n').filter(Boolean).every(l => { try { const o = JSON.parse(l); return 'question' in o && 'teacher' in o; } catch { return false; } }), `${ex0.status} ${ex1.status} ${ex1.headers.get('content-type')}`);
  const exD = await fetch(BASE + '/api/admin/train/export?domain=math', { headers: { 'x-admin-token': TOKEN } });
  const exBad = await fetch(BASE + '/api/admin/train/export?domain=..%2Fetc', { headers: { 'x-admin-token': TOKEN } });
  check('train export filters by field of study (?domain=math) and refuses a malformed one', exD.status === 200 && (await exD.text()).split('\n').filter(Boolean).every(l => JSON.parse(l).domain === 'math') && exBad.status === 400, `${exD.status} ${exBad.status}`);
  const stT = (await get('/api/state')).budget?.train;
  check('/api/state budget.train shows the teachers\' budget, calls, denials, pacing, examples per field and the quality gate', stT && typeof stT.daily === 'number' && typeof stT.examples === 'number' && stT.calls && 'claude' in stT.calls
    && typeof stT.allowedNow === 'number' && typeof stT.inFlight === 'number' && typeof stT.spentBy?.openrouter === 'number' && typeof stT.spentBy?.claude === 'number'
    && typeof stT.orShortUsd === 'number' && typeof stT.orMinUsd === 'number' && typeof stT.claudeCapNow === 'number' && typeof stT.gifted?.calls === 'number' && 'yesterday' in stT && stT.byDomain && typeof stT.byDomain === 'object' && ['kept', 'unverified', 'wrong', 'duplicate'].every(k => typeof stT.dataset?.[k] === 'number'), JSON.stringify(stT));
  // --- the live stream: `state` is small (< 30 KB) and rare (here SSE_STATE_MS 1.5 s; the ticks run every 50 ms),
  // while messages and decisions keep streaming as they happen; the page merges `state` over /api/state
  const sse = await new Promise(resolve => {
    const ev = { state: [], other: 0, bytes: 0 }; let buf = '';
    const r = http.get(BASE + '/api/stream', res => {
      res.setEncoding('utf8');
      res.on('data', chunk => {
        ev.bytes += Buffer.byteLength(chunk); buf += chunk;
        let i; while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const type = block.match(/^event: (.+)$/m)?.[1]; const data = block.match(/^data: (.*)$/m)?.[1];
          if (type === 'state') ev.state.push(data); else if (type && type !== 'hello') ev.other++;
        }
      });
    });
    setTimeout(() => { r.destroy(); resolve(ev); }, 6500);
  });
  const sizes = sse.state.map(d => Buffer.byteLength(d)), full = await get('/api/state');
  const shapes = sse.state.length ? Object.entries(JSON.parse(sse.state.at(-1))) : [];
  check('SSE: state is sent at most every SSE_STATE_MS (not every tick)', sse.state.length >= 1 && sse.state.length <= 5, JSON.stringify({ states: sse.state.length }));
  check('SSE: each state event is under 30 KB and carries the header numbers', sizes.every(n => n < 30000) && shapes.some(([k]) => k === 'stats') && shapes.some(([k]) => k === 'seats') && shapes.some(([k]) => k === 'day'), JSON.stringify({ sizes, keys: shapes.map(([k]) => k) }));
  check('SSE: state keys are whole /api/state keys of the same shape (the page can merge them)', shapes.every(([k, v]) => k in full && Array.isArray(v) === Array.isArray(full[k]) && typeof v === typeof full[k]) && !shapes.some(([k]) => ['citizens', 'feed', 'decisions', 'activity'].includes(k)), JSON.stringify(shapes.map(([k]) => k)));
  check('SSE: messages, decisions and other small events still stream as they happen', sse.other >= 5, JSON.stringify({ other: sse.other, bytes: sse.bytes }));
  const lastLive = sse.state.length ? JSON.parse(sse.state.at(-1)) : {};
  check('SSE: state keeps what the header and the government chart draw (stats, seats, academy, command, paused, day, cities with mayors)', ['stats', 'seats', 'academy', 'command', 'paused', 'day'].every(k => k in lastLive)
    && Array.isArray(lastLive.cities) && lastLive.cities.length > 0 && lastLive.cities.every(c => c.id && c.name && 'mayor' in c && !('blocks' in c)), JSON.stringify({ keys: Object.keys(lastLive), city: lastLive.cities?.[0] }));
  // section reads for an open tab: /api/state?parts= returns only the asked compact sections, announced in config.stateParts
  const sp = full.config?.stateParts || [];
  const pr = await get('/api/state?parts=elections,court,police,nonsense,__proto__,constructor,toString,config,citizens');
  check('/api/state announces its sections (config.stateParts) and ?parts= returns only fixed-list names (no __proto__, constructor, config, citizens)', Array.isArray(sp) && sp.includes('elections') && sp.includes('stats') && !sp.includes('citizens') && !sp.includes('config')
    && Object.keys(pr).sort().join() === ['court', 'elections', 'police'].filter(k => sp.includes(k)).sort().join() && Array.isArray(pr.elections) && Object.getPrototypeOf(pr) === Object.prototype, JSON.stringify({ keys: Object.keys(pr), sp }));
  const tooMany = await fetch(BASE + '/api/state?parts=' + Array.from({ length: 17 }, (_, i) => 'p' + i).join(','));
  check('/api/state?parts= refuses more than 16 sections (400)', tooMany.status === 400, String(tooMany.status));
  // every section the page might need is on the fixed list (a key the list misses could never be refreshed by a tab)
  const notListed = Object.keys(full).filter(k => !['config', 'citizens', 'population', 'feed', 'activity', 'decisions'].includes(k) && !sp.includes(k));
  check('config.stateParts covers every section of the compact state', notListed.length === 0, JSON.stringify(notListed));
  // archive reads are rate limited per IP (60/min by default); local callers without a proxy header are not counted
  const viaProxy = ip => fetch(BASE + '/api/ledger?limit=1', { headers: { 'x-forwarded-for': ip } });
  const burst = []; for (let i = 0; i < 61; i++) burst.push((await viaProxy('203.0.113.9')).status);
  const over = await fetch(BASE + '/api/decisions?limit=1', { headers: { 'x-forwarded-for': '203.0.113.9' } });
  check('archive reads: the 61st request in a minute from one IP gets 429 with retry-after', burst.slice(0, 60).every(s => s === 200) && burst[60] === 429 && over.status === 429 && Number(over.headers.get('retry-after')) > 0, JSON.stringify({ last: burst.slice(-2), decisions: over.status }));
  const other = await viaProxy('203.0.113.10'); const local = await fetch(BASE + '/api/ledger?limit=1');
  check('archive reads: other IPs and local callers are not blocked', other.status === 200 && local.status === 200, `${other.status} ${local.status}`);
  const r9 = await postRaw('/api/say', 'x'.repeat(9000));
  check('large body rejected', r9.status === 413 || r9.status === 429, String(r9.status));

  // --- extra institution checks
  const extra = await import('./smoke-institutions.mjs').catch(() => null);
  if (extra) await extra.run({ get, postRaw, until, check, wait, TOKEN });
  const command = await import('./smoke-command.mjs');
  await command.run({ BASE, get, until, check });
  const elections = await import('./smoke-elections.mjs');
  await elections.run({ BASE, get, until, check });
  const oversight = await import('./smoke-oversight.mjs');
  await oversight.run({ BASE, get, until, check, TOKEN });
  const uw = await import('./smoke-underworld.mjs');
  await uw.run({ BASE, get, until, check });
  const agents = await import('./smoke-agents.mjs');
  await agents.run({ BASE, DATA, get, until, check, wait, mock });

  // --- /api/decisions: the archived decision log, beyond the 120 shown in /api/state
  const sd = await get('/api/state');
  const all = [];
  for (let after = 0; ;) { const pg = await get(`/api/decisions?type=election&after=${after}&limit=50`); all.push(...pg.entries); if (pg.entries.length < 50) break; after = pg.entries.at(-1).id; }
  const winElections = sd.decisions.filter(d => d.type === 'election').map(d => d.id);
  check('/api/decisions?type=election pages through every archived election decision', all.length > 0 && all.every(d => d.type === 'election') && all.every((d, i) => !i || d.id > all[i - 1].id) && winElections.every(id => all.some(d => d.id === id)), JSON.stringify({ archived: all.length, inState: winElections.length }));
  const dall = await get('/api/decisions?limit=500');
  check('/api/decisions reaches past the /api/state window', dall.archived && dall.total >= sd.decisions.length && (dall.total <= 120 || dall.entries[0].id < sd.decisions[0].id), JSON.stringify({ total: dall.total, first: dall.entries[0]?.id, stateFirst: sd.decisions[0]?.id }));
  const dbad = await fetch(BASE + "/api/decisions?type=x'%20OR%201=1");
  const dbad2 = await fetch(BASE + '/api/decisions?agent=../../etc');
  check('/api/decisions rejects a malformed type or agent', dbad.status === 400 && dbad2.status === 400, `${dbad.status} ${dbad2.status}`);

  check('no server errors logged', !/step error|TypeError|ReferenceError/.test(stderr), stderr.slice(0, 400));
} catch (e) {
  fail++; console.log('  FAIL crashed', e);
} finally {
  child.kill(); mock.close();
  if (child.exitCode === null && child.signalCode === null) await new Promise(r => { child.once('exit', r); setTimeout(r, 3000); });
  try { fs.rmSync(DATA, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* Windows may keep the db handle a moment; temp dir is harmless */ }
  console.log(`\nsmoke: ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}
