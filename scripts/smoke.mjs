// Smoke test: boots the republic at high speed in a temp data dir and checks the institutions.
// Usage: node scripts/smoke.mjs   (offline engine, no network needed)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { smartAnswer } from './smoke-agents.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3900 + Math.floor(Math.random() * 90);
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
    BRAIN_SECRET: 'smoke-brain-secret', ANTHROPIC_BASE_URL: `http://127.0.0.1:${mock.address().port}`, REGISTER_COOLDOWN_MS: '0', CAREER_DAYS_SCALE: '0.3', ELECTION_MIN_VOTING_MS: '5000' },
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
    st.close(); try { fs.rmSync(LD, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* windows handle */ }
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
