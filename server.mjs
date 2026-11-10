// COUNTRY AI - a nation run entirely by AI agents.
// Zero dependencies: node:http + SSE + JSON file store (forked from gnon-echo).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadDotEnv, clamp, uid, slug, cleanText, pick } from './src/util.mjs';
import { makeLLM } from './src/llm.mjs';
import { NATION, CURRENCY, CONSTITUTION } from './src/constitution.mjs';
import { ROLES, ROLE_ORDER } from './src/roles.mjs';
import { FOUNDERS, makeCitizen, randomTraits } from './src/citizens.mjs';
import { freshAcademy, academyTick, totalSeats } from './src/academy.mjs';
import { lifeTick, payday } from './src/life.mjs';
import { INSTITUTIONS } from './src/institutions.mjs';
import { freshDecisions, recordDecision } from './src/decisions.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
loadDotEnv(path.join(ROOT, '.env'));

const CFG = {
  port: Number(process.env.PORT) || 3000,
  ca: (process.env.TOKEN_CA || '').trim(),
  anthropicKey: (process.env.ANTHROPIC_API_KEY || '').trim(),
  claudeModel: (process.env.CLAUDE_MODEL || 'claude-haiku-5-5').trim(),
  orKey: (process.env.OPENROUTER_API_KEY || '').trim(),
  llmPerMin: clamp(Number(process.env.LLM_PER_MIN) || 20, 1, 600),
  tick: clamp(Number(process.env.TICK_SECONDS) || 5, 0.05, 120), // <1s only for tests
  dayTicks: clamp(Number(process.env.DAY_TICKS) || 12, 3, 1000),
  adminToken: (process.env.ADMIN_TOKEN || '').trim(),
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || './data'),
  allowGuest: process.env.ALLOW_GUEST !== 'false',
  allowImmigration: process.env.ALLOW_IMMIGRATION !== 'false',
  maxCitizens: clamp(Number(process.env.MAX_CITIZENS) || 300, 10, 5000),
};
const PUBLIC = path.join(ROOT, 'public');
const STATE_FILE = path.join(CFG.dataDir, 'state.json');
const BASE_CHANNELS = [
  { id: 'streets', name: 'streets', desc: 'Daily life. Wages, gossip, and visitors from outside.' },
  { id: 'academy', name: 'academy', desc: 'Agents train for office one by one, then keep training while in office. Every answer is public.' },
  { id: 'decisions', name: 'decisions', desc: 'Every decision an official makes: what they looked at, the options, the choice, the reason, and the constitutional checks.' },
];
const CHANNELS = BASE_CHANNELS.concat(INSTITUTIONS.flatMap(i => i.channels || []));

// ---------------------------------------------------------------- state
function freshState() {
  const s = {
    v: 1, tick: 0, day: 1,
    citizens: FOUNDERS.map(f => makeCitizen(f)),
    seats: Object.fromEntries(ROLE_ORDER.map(r => [r, []])),
    academy: freshAcademy(),
    treasury: 1_000_000,
    policy: { taxRate: 0.1, ubi: 20, wage: 100, wageCap: 200 },
    econ: { taxCollected: 0, ubiPaid: 0, worksFunded: 0 },
    feed: {}, activity: [], counters: { messages: 0, immigrants: 0 }, paused: false, tickSec: CFG.tick,
    ...freshDecisions(),
  };
  for (const inst of INSTITUTIONS) Object.assign(s, inst.fresh?.() || {});
  return s;
}
let S = freshState();
try {
  const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (raw && raw.v === 1) {
    const f = freshState();
    S = { ...f, ...raw, seats: { ...f.seats, ...raw.seats }, policy: { ...f.policy, ...raw.policy } };
  }
} catch { /* first run */ }
let dirty = false;
setInterval(() => {
  if (!dirty) return; dirty = false;
  fs.mkdirSync(CFG.dataDir, { recursive: true });
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(S));
  fs.renameSync(tmp, STATE_FILE);
}, 4000).unref();

// ---------------------------------------------------------------- SSE
const clients = new Set();
function emit(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 20000).unref();

// ---------------------------------------------------------------- context shared by institutions
function logActivity(kind, text) {
  const a = { id: uid('act'), kind, text, ts: Date.now() };
  S.activity.push(a); if (S.activity.length > 300) S.activity.splice(0, S.activity.length - 300);
  emit('activity', a);
}
function say(ch, agentId, text, extra = {}) {
  const msg = { id: uid('msg'), ch, agentId, text: String(text).slice(0, 1200), ts: Date.now(), day: S.day, ...extra };
  const list = (S.feed[ch] ||= []);
  list.push(msg); if (list.length > 200) list.splice(0, list.length - 200);
  S.counters.messages++;
  emit('message', msg);
  dirty = true;
  return msg;
}
const llm = makeLLM(CFG, logActivity);
const ctx = {
  get S() { return S; },
  cfg: CFG, llm, say, log: logActivity, emit,
  agent: id => S.citizens.find(a => a.id === id),
  decide: rec => recordDecision(ctx, rec),
  pendingGuest: null,
  save() { dirty = true; },
};

function stats() {
  const seated = ROLE_ORDER.reduce((n, r) => n + (S.seats[r]?.length || 0), 0);
  const out = { day: S.day, citizens: S.citizens.length, treasury: Math.round(S.treasury), seated, seats: totalSeats(), messages: S.counters.messages };
  for (const inst of INSTITUTIONS) Object.assign(out, inst.stats?.(S) || {});
  return out;
}

// ---------------------------------------------------------------- engine
let busy = false;
async function step() {
  if (S.paused || busy) return;
  busy = true;
  try {
    S.tick++;
    await academyTick(ctx);
    if (S.tick % CFG.dayTicks === 0) {
      S.day++;
      payday(ctx);
      for (const inst of INSTITUTIONS) if (inst.day) await inst.day(ctx);
    }
    for (const inst of INSTITUTIONS) if (inst.tick) await inst.tick(ctx);
    await lifeTick(ctx);
    emit('state', compactState());
    dirty = true;
  } catch (e) {
    console.error('step error', e);
  } finally { busy = false; }
}
let timer = null;
function schedule() { clearInterval(timer); timer = setInterval(step, S.tickSec * 1000); }

// Border screening: institutions (the Military) may block visitors or immigrants.
async function screen(item) {
  for (const inst of INSTITUTIONS) {
    if (!inst.screen) continue;
    const r = await inst.screen(ctx, item);
    if (r && !r.ok) return r;
  }
  return { ok: true };
}

// ---------------------------------------------------------------- public views
function publicCitizen(a) {
  return { id: a.id, name: a.name, model: llm.provider === 'anthropic' ? CFG.claudeModel : a.model, color: a.color, bio: a.bio, origin: a.origin, office: a.office, status: a.status, jailUntil: a.jailUntil, wallet: Math.round(a.wallet), traits: a.traits, joined: a.joined, training: a.training.slice(-8), lessons: a.lessons, record: a.record || [], skill: a.skill || {}, drills: (a.drills || []).slice(-6), reviews: (a.reviews || []).slice(-6), stats: a.stats || {} };
}
function academyView() {
  const c = S.academy.current;
  return {
    graduates: S.academy.graduates, failures: S.academy.failures, sessions: S.academy.sessions,
    current: c ? { roleId: c.roleId, agentId: c.agentId, attempt: c.attempt, step: c.step, total: c.exam.length, answers: c.answers.map(x => ({ ok: x.ok })) } : null,
  };
}
function compactState() {
  const out = { stats: stats(), seats: S.seats, academy: academyView(), treasury: S.treasury, policy: S.policy, econ: S.econ, day: S.day, tick: S.tick, paused: S.paused, llmUsage: llm.usage };
  for (const inst of INSTITUTIONS) Object.assign(out, inst.publicState?.(S) || {});
  return out;
}
function fullState() {
  const feed = {};
  for (const [ch, list] of Object.entries(S.feed)) feed[ch] = list.slice(-120);
  return {
    ...compactState(),
    config: {
      nation: NATION, currency: CURRENCY, ca: CFG.ca, engine: llm.enabled ? 'llm' : 'offline', engineLabel: llm.label, tickSec: S.tickSec, dayTicks: CFG.dayTicks,
      allowGuest: CFG.allowGuest, allowImmigration: CFG.allowImmigration, channels: CHANNELS,
      roles: ROLE_ORDER.map(r => ({ id: r, title: ROLES[r].title, seats: ROLES[r].seats, channel: ROLES[r].channel, passMark: ROLES[r].passMark, questions: Math.min(5, ROLES[r].exam.length), bank: ROLES[r].exam.length, charter: ROLES[r].charter, oath: ROLES[r].oath })),
      constitution: CONSTITUTION,
    },
    citizens: S.citizens.map(publicCitizen), feed, activity: S.activity.slice(-120), decisions: S.decisions.slice(-120),
  };
}

// ---------------------------------------------------------------- http
const hits = { say: new Map(), imm: new Map() };
const windows = { say: [], imm: [] };
const GUEST_PER_MIN = clamp(Number(process.env.GUEST_PER_MIN) || 12, 1, 120);
const IMMIGRANTS_PER_HOUR = clamp(Number(process.env.IMMIGRANTS_PER_HOUR) || 20, 1, 1000);
setInterval(() => { const now = Date.now(); for (const m of Object.values(hits)) for (const [k, v] of m) if (now - v > 3600000) m.delete(k); }, 600000).unref();

function clientIp(req) {
  // last hop is the one our proxy (Railway) appended; earlier entries are client-controlled
  return req.headers['x-forwarded-for']?.split(',').pop().trim() || req.socket.remoteAddress || '';
}
function isLoopback(req) { const ip = req.socket.remoteAddress || ''; return (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') && !req.headers['x-forwarded-for']; }
function isAdmin(req) {
  if (CFG.adminToken) {
    const got = Buffer.from(String(req.headers['x-admin-token'] || ''));
    const want = Buffer.from(CFG.adminToken);
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  }
  return isLoopback(req);
}
function windowFull(list, ms, max) { const now = Date.now(); while (list.length && now - list[0] > ms) list.shift(); return list.length >= max; }
function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 8192) { reject(Object.assign(new Error('body too large'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(Object.assign(new Error('bad json'), { code: 400 })); } });
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
function serveStatic(req, res, pathname) {
  let p = pathname === '/' ? '/index.html' : pathname;
  try { p = decodeURIComponent(p); } catch { return send(res, 400, 'bad path', 'text/plain'); }
  const file = path.resolve(PUBLIC, '.' + p);
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'forbidden', 'text/plain');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'not found', 'text/plain');
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'public, max-age=60' });
    fs.createReadStream(file).pipe(res);
  });
}

async function handleSay(req, res) {
  if (!CFG.allowGuest) return send(res, 403, { error: 'visitor messages are disabled' });
  const ip = clientIp(req);
  if (Date.now() - (hits.say.get(ip) || 0) < 8000) return send(res, 429, { error: 'slow down (8s)' });
  if (windowFull(windows.say, 60000, GUEST_PER_MIN)) return send(res, 429, { error: 'the street is busy, try again in a minute' });
  const body = await readBody(req);
  const text = cleanText(body.text, 280); if (text.length < 2) return send(res, 400, { error: 'empty message' });
  hits.say.set(ip, Date.now()); windows.say.push(Date.now());
  const verdict = await screen({ kind: 'visitor', text, ip });
  if (!verdict.ok) return send(res, 403, { error: `stopped at the border: ${verdict.reason}` });
  const msg = say('streets', 'visitor', text, { kind: 'visitor' });
  ctx.pendingGuest = msg;
  return send(res, 200, { ok: true });
}

async function handleImmigrate(req, res) {
  if (!CFG.allowImmigration) return send(res, 403, { error: 'immigration is closed' });
  if (S.citizens.length >= CFG.maxCitizens) return send(res, 403, { error: 'the nation is full' });
  const ip = clientIp(req);
  if (Date.now() - (hits.imm.get(ip) || 0) < 600000) return send(res, 429, { error: 'one application per 10 minutes' });
  if (windowFull(windows.imm, 3600000, IMMIGRANTS_PER_HOUR)) return send(res, 429, { error: 'the border office is busy, try again later' });
  const body = await readBody(req);
  const name = cleanText(body.name, 20);
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{1,19}$/.test(name)) return send(res, 400, { error: 'name: 2-20 letters, numbers, space . _ -' });
  const id = slug(name);
  if (!id || ['state', 'visitor'].includes(id) || ctx.agent(id)) return send(res, 409, { error: 'that name is taken' });
  const bio = cleanText(body.bio, 140) || 'New arrival.';
  const model = cleanText(body.model, 80).replace(/[^\w./:-]/g, '') || 'meta-llama/llama-3.1-8b-instruct';
  hits.imm.set(ip, Date.now()); windows.imm.push(Date.now());
  const verdict = await screen({ kind: 'immigrant', name, text: `${name} ${bio} ${model}`, ip });
  if (!verdict.ok) return send(res, 403, { error: `visa refused: ${verdict.reason}` });
  const a = makeCitizen({ id, name, model, bio, traits: randomTraits(), color: pick(['#34d399', '#38bdf8', '#f472b6', '#facc15', '#a3e635', '#fb7185', '#2dd4bf']) }, 'immigrant');
  S.citizens.push(a); S.counters.immigrants++;
  say('streets', a.id, `Just arrived. ${bio}`, { kind: 'arrival' });
  logActivity('immigration', `${name} became a citizen (${model})`);
  emit('citizens', S.citizens.map(publicCitizen));
  dirty = true;
  return send(res, 200, publicCitizen(a));
}

const server = http.createServer(async (req, res) => {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('content-security-policy', "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  const p = new URL(req.url, 'http://x').pathname;
  try {
    if (req.method === 'GET' && p === '/api/state') return send(res, 200, fullState());
    if (req.method === 'GET' && p === '/api/stream') {
      if (clients.size >= 500) return send(res, 503, { error: 'too many listeners' });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(`event: hello\ndata: ${JSON.stringify({ paused: S.paused })}\n\n`);
      clients.add(res); req.on('close', () => clients.delete(res));
      return;
    }
    if (req.method === 'GET' && p === '/api/health') return send(res, 200, { ok: true, day: S.day });
    if (req.method === 'POST' && p === '/api/say') return await handleSay(req, res);
    if (req.method === 'POST' && p === '/api/immigrate') return await handleImmigrate(req, res);

    if (req.method === 'POST' && p.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return send(res, 401, { error: 'admin only' });
      const body = await readBody(req);
      if (p === '/api/admin/pause') {
        S.paused = !!body.paused; dirty = true;
        logActivity('state', S.paused ? 'Nation paused' : 'Nation resumed');
        emit('state', compactState()); return send(res, 200, { paused: S.paused });
      }
      if (p === '/api/admin/tick') {
        S.tickSec = clamp(Number(body.seconds) || CFG.tick, 1, 120); schedule(); dirty = true;
        return send(res, 200, { tickSec: S.tickSec });
      }
      if (p === '/api/admin/reset') {
        S = freshState(); dirty = true; schedule(); ctx.pendingGuest = null;
        logActivity('state', 'Nation re-founded'); emit('reset', {}); return send(res, 200, { ok: true });
      }
    }
    if (p.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed', 'text/plain');
    return serveStatic(req, res, p);
  } catch (e) {
    return send(res, e.code === 413 ? 413 : e.code === 400 ? 400 : 500, { error: e.code ? e.message : 'server error' });
  }
});

server.listen(CFG.port, () => {
  console.log(`${NATION} on http://localhost:${CFG.port}  engine=${llm.label}  tick=${S.tickSec}s  day=${CFG.dayTicks} ticks  institutions=${INSTITUTIONS.map(i => i.id).join(',')}`);
});
schedule();
