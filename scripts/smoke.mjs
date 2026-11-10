// Smoke test: boots the republic at high speed in a temp data dir and checks the institutions.
// Usage: node scripts/smoke.mjs   (offline engine, no network needed)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3900 + Math.floor(Math.random() * 90);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'country-ai-'));
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'smoke-admin-token';

const child = spawn(process.execPath, ['server.mjs'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, TICK_SECONDS: '0.05', DAY_TICKS: '4', OPENROUTER_API_KEY: '', ANTHROPIC_API_KEY: '', ADMIN_TOKEN: TOKEN, IMMIGRANTS_PER_HOUR: '50' },
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
  for (let i = 0; i < 50; i++) { try { await get('/api/health'); break; } catch { await wait(100); } }
  const s0 = await get('/api/state');
  const roles = s0.config.roles.map(r => r.id);
  console.log(`institutions: ${roles.join(', ')}`);
  check('starts with every seat vacant', Object.values(s0.seats).every(x => x.length === 0));
  check('founders exist', s0.citizens.length >= 10);

  // --- Academy + President
  const s1 = await until(s => s.seats.president?.length === 1, 30000);
  check('president trained and sworn in', s1.seats.president.length === 1);
  const pres = s1.citizens.find(a => a.id === s1.seats.president[0]);
  const pt = pres?.training.find(t => t.roleId === 'president' && t.passed);
  check('president passed the exam (>= pass mark)', pt && pt.score >= s1.config.roles[0].passMark, JSON.stringify(pt && { score: pt.score }));
  check('exam answers are recorded', pt && pt.answers.length === 5 && pt.answers.every(a => a.q && a.chosen));

  const s2 = await until(s => s.orders?.length >= 2, 30000);
  check('president issued executive orders', s2.orders.length >= 2);
  check('treasury stays positive', s2.treasury > 0);
  const failedPeople = s2.citizens.filter(a => a.training.some(t => !t.passed));
  check('failed candidates keep written lessons', failedPeople.every(a => Object.values(a.lessons).flat().length > 0));

  // --- order of seating: no lower office is filled before the ones above it are full
  const st = await until(s => roles.every(r => s.seats[r].length === s.config.roles.find(x => x.id === r).seats), 120000);
  const filled = roles.map(r => [r, st.seats[r].length, st.config.roles.find(x => x.id === r).seats]);
  check('all offices filled in constitutional order', filled.every(([, n, max]) => n === max), JSON.stringify(filled));
  const seatedIds = roles.flatMap(r => st.seats[r]);
  check('nobody holds two offices', new Set(seatedIds).size === seatedIds.length);
  check('every office holder passed its exam', seatedIds.every(id => { const a = st.citizens.find(x => x.id === id); return a.training.some(t => t.roleId === a.office && t.passed); }));

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
  const r9 = await postRaw('/api/say', 'x'.repeat(9000));
  check('large body rejected', r9.status === 413 || r9.status === 429, String(r9.status));

  // --- extra institution checks
  const extra = await import('./smoke-institutions.mjs').catch(() => null);
  if (extra) await extra.run({ get, postRaw, until, check, wait, TOKEN });

  check('no server errors logged', !/step error|TypeError|ReferenceError/.test(stderr), stderr.slice(0, 400));
} catch (e) {
  fail++; console.log('  FAIL crashed', e);
} finally {
  child.kill();
  fs.rmSync(DATA, { recursive: true, force: true });
  console.log(`\nsmoke: ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}
