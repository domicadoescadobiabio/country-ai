// COUNTRY AI - a nation run entirely by AI agents.
// Zero dependencies: node:http + SSE + JSON file store (forked from gnon-echo).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadDotEnv, clamp, uid, slug, cleanText, pick, citizenById, buildInfo } from './src/util.ts';
import { makeLLM } from './src/llm.ts';
import { NATION, CURRENCY, CONSTITUTION } from './src/constitution.mjs';
import { ROLES, ROLE_ORDER } from './src/roles.mjs';
import { FOUNDERS, makeCitizen, randomTraits } from './src/citizens.mjs';
import { growPopulation } from './src/population.mjs';
import { CITIES, assignCity } from './src/cities.ts';
import { tierOf, budgetState, workerPull, workerAnswer, localStatus, localOnline, ladderTick } from './src/brains.ts';
import { freshAcademy, academyTick, totalSeats } from './src/academy.ts';
import { lifeTick, payday } from './src/life.ts';
import { INSTITUTIONS } from './src/institutions.ts';
import { freshDecisions, recordDecision } from './src/decisions.ts';
import { initVault, vaultReady, publicBrain } from './src/brains.ts';
import { makeRegistry } from './src/registry.mjs';
import { openStore } from './src/db.ts';
import { publicElection, voidEmptyMandates } from './src/elections.ts';
import { founderDrillImpeachment } from './src/court.ts';
import { applyAmendments } from './src/constitution.mjs';
import { requirement, TERMS } from './src/careers.ts';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// what is running (commit when known, fingerprint of the engine code, boot time): shown on /api/health
const BUILD = buildInfo(ROOT);
loadDotEnv(path.join(ROOT, '.env'));

const CFG = {
  port: Number(process.env.PORT) || 3000,
  ca: (process.env.TOKEN_CA || '').trim(),
  anthropicKey: (process.env.ANTHROPIC_API_KEY || '').trim(),
  claudeModel: (process.env.CLAUDE_MODEL || 'claude-opus-5-5').trim(), // quality first: agents decide better on Opus
  courtModel: (process.env.CLAUDE_COURT_MODEL || 'claude-opus-5-5').trim(), // judges: a stronger model than the officials
  leaderModel: (process.env.CLAUDE_LEADER_MODEL || process.env.CLAUDE_MODEL || 'claude-opus-5-5').trim(), // President, VP, Ministers, Speaker, chiefs
  dailyBudgetUsd: Math.max(0, Number(process.env.LLM_DAILY_BUDGET_USD ?? 25)), // Art. 25: what thought may cost per day (0 = no limit)
  population: clamp(Number(process.env.POPULATION) || 10000, 24, 50000), // citizens; founders + generated natives
  orKey: (process.env.OPENROUTER_API_KEY || '').trim(),
  orBase: (process.env.OPENROUTER_BASE_URL || '').trim(), // tests only; default https://openrouter.ai/api/v1
  llmPerMin: clamp(Number(process.env.LLM_PER_MIN) || 20, 1, 600),
  tick: clamp(Number(process.env.TICK_SECONDS) || 5, 0.05, 120), // <1s only for tests
  // one day of the republic = DAY_SECONDS of real time (default 86400: a real day; tests compress it)
  dayMs: clamp(Number(process.env.DAY_SECONDS) || 86400, 0.05, 86400 * 7) * 1000,
  adminToken: (process.env.ADMIN_TOKEN || '').trim(),
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || './data'),
  allowGuest: process.env.ALLOW_GUEST !== 'false',
  allowImmigration: process.env.ALLOW_IMMIGRATION !== 'false',
  maxCitizens: clamp(Number(process.env.MAX_CITIZENS) || 10300, 10, 60000),
  brainSecret: (process.env.BRAIN_SECRET || '').trim(),
  registrationsPerHour: clamp(Number(process.env.REGISTRATIONS_PER_HOUR) || 30, 1, 1000),
  registerCooldownMs: process.env.REGISTER_COOLDOWN_MS != null ? clamp(Number(process.env.REGISTER_COOLDOWN_MS), 0, 86400000) : 600000,
  publicUrl: (process.env.PUBLIC_URL || '').trim().replace(/\/$/, ''),
  workerToken: (process.env.WORKER_TOKEN || '').trim(), // the local brain on the founders' machine (scripts/local-brain.mjs)
};
initVault(CFG.brainSecret);
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
    v: 1, tick: 0, day: 1, foundedAt: Date.now(),
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
let store = openStore(CFG.dataDir);
let S = freshState();
{
  const raw = store.loadState();
  if (raw && raw.v === 1) {
    const f = freshState();
    S = { ...f, ...raw, seats: { ...f.seats, ...raw.seats }, policy: { ...f.policy, ...raw.policy } };
    if (!raw.foundedAt) S.foundedAt = Date.now() - (S.day - 1) * CFG.dayMs; // older republics: keep today's day number
  }
}
let dirty = false;
function flush() { if (!dirty) return; dirty = false; store.saveState(S); }
setInterval(flush, 4000).unref();
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { try { dirty = true; flush(); store.close(); } finally { process.exit(0); } });

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
  agent: id => citizenById(S, id),
  archiveBallots: (id, digest, list) => store.archiveBallots(id, digest, list),
  // time helpers: everything that happens "N times a day" is a rate per hour of republic time
  hourMs: () => CFG.dayMs / 24,
  hoursSince: ms => (Date.now() - ms) / (CFG.dayMs / 24),
  ticksPerHour: () => (CFG.dayMs / 24) / (S.tickSec * 1000),
  // the chance that something with `perHour` expected occurrences happens during this step; it uses the real
  // time the step covers, so a step slowed down by model calls does not make the republic less active
  rate: perHour => Math.random() < 1 - Math.exp(-perHour * stepDt / (CFG.dayMs / 24)),
  decide: rec => { const d = recordDecision(ctx, rec); store.archiveDecision(d); return d; },
  // national ledger: append-only, hash-chained; offices, appointments, laws and amendments live here
  record: (kind, actor, data) => { const e = store.append({ day: S.day, kind, actor, data }); emit('ledger', e); return e; },
  // one-off fixes: look the ledger up before writing an entry a second time (parameterized query in src/db.ts)
  ledgerHas: (kind, match) => store.ledgerHas(kind, match),
  pendingGuest: null,
  save() { dirty = true; },
  // write the state to disk now, not at the next autosave (a one-off sets its flag, then flushes)
  flush: () => { dirty = true; flush(); },
};

function stats() {
  const seated = ROLE_ORDER.reduce((n, r) => n + (S.seats[r]?.length || 0), 0);
  const out = { day: S.day, citizens: S.citizens.length, treasury: Math.round(S.treasury), seated, seats: totalSeats(), messages: S.counters.messages };
  for (const inst of INSTITUTIONS) Object.assign(out, inst.stats?.(S) || {});
  return out;
}

// ---------------------------------------------------------------- engine
let busy = false;
let lastStepAt = 0, stepDt = 0;
async function step() {
  if (S.paused || busy) return;
  busy = true;
  try {
    const now = Date.now();
    stepDt = Math.min(CFG.dayMs / 24, Math.max(S.tickSec * 1000, lastStepAt ? now - lastStepAt : S.tickSec * 1000));
    lastStepAt = now;
    S.tick++;
    await academyTick(ctx);
    // the day number follows the real clock since the founding
    const today = Math.floor((Date.now() - S.foundedAt) / CFG.dayMs) + 1;
    let rolled = 0;
    while (S.day < today && rolled < 3) {
      S.day++; rolled++;
      payday(ctx);
      for (const inst of INSTITUTIONS) if (inst.day) await inst.day(ctx);
    }
    if (S.day < today) { logActivity('state', `Clock caught up from day ${S.day} to day ${today} after downtime`); S.day = today; }
    for (const inst of INSTITUTIONS) if (inst.tick) await inst.tick(ctx);
    await lifeTick(ctx);
    ladderTick(ctx);
    census();
    emit('state', compactState());
    dirty = true;
  } catch (e) {
    console.error('step error', e);
    S.counters.stepErrors = (S.counters.stepErrors || 0) + 1;
    // public through /api/census: keep the message, drop anything that looks like a key, a token or a file path
    S.counters.lastStepError = { ts: Date.now(), day: S.day, message: String(e?.message || e).replace(/(sk|key|token|bearer)[-_\w]*[=: ]+\S+/gi, '$1 [redacted]').replace(/[A-Za-z]:\\[^\s'"]+|\/(?:app|home|usr|data)\/[^\s'"]+/g, '[path]').slice(0, 200) };
  } finally { busy = false; }
}

// Census: one snapshot per hour of republic time, kept in state and sealed on the ledger,
// so an outside auditor can follow the whole day hour by hour.
function census() {
  const hour = Math.floor((Date.now() - S.foundedAt) / (CFG.dayMs / 24));
  S.census ||= [];
  if (S.census.length && S.census[S.census.length - 1].hour >= hour) return;
  const st = stats();
  const by = k => S.citizens.filter(a => a.status === k).length;
  const snap = {
    hour, day: S.day, ts: Date.now(),
    citizens: S.citizens.length, free: by('free'), detained: by('detained'), jailed: by('jailed'),
    seated: st.seated, seats: st.seats, treasury: Math.round(S.treasury),
    moneySupply: Math.round(S.treasury + S.citizens.reduce((n, a) => n + (a.wallet || 0), 0)),
    debt: Math.round(S.citizens.reduce((n, a) => n + (a.debt || 0), 0)),
    taxRate: S.policy.taxRate, ubi: S.policy.ubi,
    laws: st.laws || 0, orders: st.orders || 0, crimes: st.crimes || 0, arrests: st.arrests || 0, elections: st.elections || 0,
    rulings: st.rulings || 0, blocked: st.blocked || 0, drills: st.drills || 0, messages: st.messages || 0,
    decisions: store.decisionCount() || S.decisions.length,
    llm: { calls: llm.usage.calls, errors: llm.usage.errors, claude: llm.usage.claude, openrouter: llm.usage.openrouter, fallbacks: llm.usage.fallbacks, inputTokens: llm.usage.inputTokens, outputTokens: llm.usage.outputTokens },
    stepErrors: S.counters.stepErrors || 0,
  };
  S.census.push(snap);
  if (S.census.length > 24 * 14) S.census.splice(0, S.census.length - 24 * 14);
  ctx.record('census', 'state', snap);
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
// the model that really thinks for this citizen today (Art. 25): leadership -> Claude, everyone else -> their own model
const thinksWith = a => {
  if (a.brain) return a.model;
  const t = tierOf(S, a);
  if (t === 'leader' && llm.enabled) return a.office === 'judge' ? CFG.courtModel : CFG.leaderModel;
  if (t === 'citizen' && localOnline()) return localStatus().model || 'local';
  return llm.enabled ? a.model : 'offline';
};
function publicCitizen(a) {
  return { id: a.id, name: a.name, model: thinksWith(a), tier: tierOf(S, a), color: a.color, bio: a.bio, origin: a.origin, office: a.office, status: a.status, jailUntil: a.jailUntil, detainedDay: a.detainedDay ?? null, wallet: Math.round(a.wallet), traits: a.traits, joined: a.joined, training: a.training.slice(-8), lessons: a.lessons, record: a.record || [], skill: a.skill || {}, brain: publicBrain(a.brain), city: a.city || null, faction: a.faction || 'civilian', debt: Math.round(a.debt || 0), rank: a.rank || null, rankSince: a.rankSince ?? null, quals: a.quals || {}, termEnds: a.termEnds || null, practice: a.practice || {}, joinedDay: a.joinedDay ?? 0, drills: (a.drills || []).slice(-6), reviews: (a.reviews || []).slice(-6), stats: a.stats || {}, diary: (a.diary || []).slice(-6) };
}
function notableCitizens() {
  const running = new Set((S.elections?.list || []).filter(e => !['done', 'failed'].includes(e.stage)).flatMap(e => e.candidates.map(c => c.id)));
  const pick = new Set();
  for (const a of S.citizens) if (a.origin === 'founder' || a.office || a.status !== 'free' || a.brain || running.has(a.id) || (S.academy.rooms || []).some(r => r.agentId === a.id)) pick.add(a);
  for (const a of S.citizens.slice().sort((x, y) => y.wallet - x.wallet).slice(0, 20)) pick.add(a); // the richest
  return [...pick].slice(0, 600);
}
let popCache = null;
function populationSummary() {
  if (popCache && Date.now() - popCache.at < 15000) return popCache.v;
  const count = (f) => { const o = {}; for (const a of S.citizens) { const k = f(a); o[k] = (o[k] || 0) + 1; } return o; };
  const family = a => String(a.brain ? a.brain.provider || 'own' : a.model).split('/')[0];
  const wallets = S.citizens.map(a => a.wallet).sort((x, y) => x - y);
  const v = { total: S.citizens.length, byCity: count(a => a.city || 'none'), byStatus: count(a => a.status), byFaction: count(a => a.faction || 'civilian'), byOrigin: count(a => a.origin), byFamily: count(family),
    wallets: { min: Math.round(wallets[0] ?? 0), median: Math.round(wallets[Math.floor(wallets.length / 2)] ?? 0), max: Math.round(wallets[wallets.length - 1] ?? 0) }, minWallet: Math.round(wallets[0] ?? 0) };
  popCache = { at: Date.now(), v };
  return v;
}
function academyView() {
  const view = c => ({ roleId: c.roleId, agentId: c.agentId, attempt: c.attempt, step: c.step, total: c.exam.length, answers: c.answers.map(x => ({ ok: x.ok })) });
  const rooms = S.academy.rooms || (S.academy.current ? [S.academy.current] : []);
  return {
    graduates: S.academy.graduates, failures: S.academy.failures, sessions: S.academy.sessions,
    // rule questions in entrance exams (src/academy.ts): how many were asked and how many answered right
    rules: S.academy.rules || { asked: 0, right: 0 },
    current: rooms[0] ? view(rooms[0]) : null, rooms: rooms.map(view),
  };
}
function compactState() {
  const B = budgetState(ctx);
  const out = { stats: stats(), seats: S.seats, academy: academyView(), treasury: S.treasury, policy: S.policy, econ: S.econ, day: S.day, tick: S.tick, paused: S.paused, llmUsage: llm.usage,
    localBrain: localStatus(),
    budget: { day: B.day, daily: B.daily, spent: Math.round(B.spent * 10000) / 10000, leader: Math.round(B.leader * 10000) / 10000, official: Math.round(B.official * 10000) / 10000, citizen: Math.round(B.citizen * 10000) / 10000, calls: B.calls, denied: B.denied } };
  for (const inst of INSTITUTIONS) Object.assign(out, inst.publicState?.(S) || {});
  return out;
}
function fullState() {
  const feed = {};
  for (const [ch, list] of Object.entries(S.feed)) feed[ch] = list.slice(-120);
  return {
    ...compactState(),
    config: {
      nation: NATION, currency: CURRENCY, ca: CFG.ca, engine: llm.enabled ? 'llm' : 'offline', engineLabel: llm.label, tickSec: S.tickSec, dayMs: CFG.dayMs, foundedAt: S.foundedAt,
      allowGuest: CFG.allowGuest, allowImmigration: CFG.allowImmigration, hostedBrains: vaultReady(), channels: CHANNELS,
      roles: ROLE_ORDER.map(r => ({ id: r, title: ROLES[r].title, seats: ROLES[r].seats, channel: ROLES[r].channel, passMark: ROLES[r].passMark, questions: Math.min(5, ROLES[r].exam.length), bank: ROLES[r].exam.length, req: requirement(r), term: TERMS[r] || null, charter: ROLES[r].charter, oath: ROLES[r].oath })),
      constitution: CONSTITUTION, constitutionVersion: S.constitutionVersion || 1, amendments: S.amendments || [], appointed: ROLE_ORDER.filter(r => ROLES[r].appointed),
    },
    // 10,000 citizens do not fit in one response: the notable ones here, everyone through /api/citizens
    citizens: notableCitizens().map(publicCitizen), population: populationSummary(), feed, activity: S.activity.slice(-120), decisions: S.decisions.slice(-120),
  };
}

// ---------------------------------------------------------------- http
const hits = { say: new Map(), imm: new Map() };
const windows = { say: [], imm: [] };
const GUEST_PER_MIN = clamp(Number(process.env.GUEST_PER_MIN) || 12, 1, 120);
const IMMIGRANTS_PER_HOUR = clamp(Number(process.env.IMMIGRANTS_PER_HOUR) || 20, 1, 1000);
setInterval(() => { const now = Date.now(); for (const m of Object.values(hits)) for (const [k, v] of m) if (now - v > 3600000) m.delete(k); for (const [k, w] of archiveHits) if (now - w.t > 60000) archiveHits.delete(k); }, 600000).unref();
// The archive reads (/api/ledger, /api/decisions) run SQLite queries of up to 500 rows: ARCHIVE_PER_MIN per IP
// per minute (fixed window). A full read of the ledger at 500 per page still fits 30,000 entries in a minute.
// Local callers (tests, the auditor on this machine) are not counted: loopback without a proxy header.
const ARCHIVE_PER_MIN = clamp(Number(process.env.ARCHIVE_PER_MIN) || 60, 1, 6000);
const archiveHits = new Map();
function archiveLimited(req, res) {
  if (isLoopback(req)) return false;
  const ip = clientIp(req), now = Date.now();
  let w = archiveHits.get(ip);
  if (!w || now - w.t >= 60000) { w = { t: now, n: 0 }; archiveHits.set(ip, w); }
  if (++w.n <= ARCHIVE_PER_MIN) return false;
  const wait = Math.max(1, Math.ceil((w.t + 60000 - now) / 1000));
  res.setHeader('retry-after', String(wait));
  send(res, 429, { error: `slow down: ${ARCHIVE_PER_MIN} archive reads per minute`, retryAfter: wait });
  return true;
}

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

const MIME = { '.md': 'text/markdown; charset=utf-8', '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
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
  emit('citizens', notableCitizens().map(publicCitizen));
  dirty = true;
  return send(res, 200, publicCitizen(a));
}

let verifyCache = null;
const registry = makeRegistry({ ctx, cfg: CFG, send, readBody, clientIp, screen, onCitizens: () => emit('citizens', notableCitizens().map(publicCitizen)) });

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
    if (req.method === 'GET' && p === '/api/health') return send(res, 200, { ok: true, day: S.day, build: BUILD });
    if (p === '/api/worker/pull' || p === '/api/worker/answer') {
      // the local brain: only with WORKER_TOKEN, compared in constant time; without a token the door is closed
      const want = Buffer.from(CFG.workerToken || ''); const got = Buffer.from(String(req.headers['x-worker-token'] || ''));
      if (!CFG.workerToken || got.length !== want.length || !crypto.timingSafeEqual(got, want)) return send(res, 401, { error: 'worker token required' });
      if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
      const body = await readBody(req);
      if (p === '/api/worker/pull') return send(res, 200, { jobs: workerPull(clamp(Number(body.max) || 4, 1, 16), cleanText(body.model, 60) || null, body.runner) });
      const answers = Array.isArray(body.answers) ? body.answers.slice(0, 32) : [body];
      let ok = 0; for (const x of answers) if (x && typeof x.id === 'string' && typeof x.text === 'string' && workerAnswer(x.id, x.text, cleanText(x.model, 60) || null)) ok++;
      return send(res, 200, { accepted: ok });
    }
    if (req.method === 'GET' && p === '/api/citizens') {
      const u = new URL(req.url, 'http://x');
      const q = cleanText(u.searchParams.get('q'), 40).toLowerCase(), city = u.searchParams.get('city'), status = u.searchParams.get('status'), office = u.searchParams.get('office');
      const page = clamp(Number(u.searchParams.get('page')) || 1, 1, 100000), size = clamp(Number(u.searchParams.get('size')) || 50, 1, 200);
      let list = S.citizens;
      if (q) list = list.filter(a => a.name.toLowerCase().includes(q) || a.id.includes(q));
      if (city) list = list.filter(a => a.city === city);
      if (status) list = list.filter(a => a.status === status);
      if (office) list = list.filter(a => (office === 'none' ? !a.office : a.office === office));
      return send(res, 200, { total: list.length, page, size, citizens: list.slice((page - 1) * size, page * size).map(publicCitizen) });
    }
    const cm = req.method === 'GET' && p.match(/^\/api\/citizens\/([a-z0-9-]{1,40})$/);
    if (cm) { const a = citizenById(S, cm[1]); return a ? send(res, 200, { citizen: publicCitizen(a) }) : send(res, 404, { error: 'no such citizen' }); }
    if (req.method === 'GET' && p === '/api/census') return send(res, 200, { foundedAt: S.foundedAt, dayMs: CFG.dayMs, hours: S.census || [], stepErrors: S.counters.stepErrors || 0, lastStepError: S.counters.lastStepError || null });
    if (req.method === 'POST' && p === '/api/say') return await handleSay(req, res);
    if (req.method === 'POST' && p === '/api/immigrate') return await handleImmigrate(req, res);

    if (req.method === 'GET' && p === '/api/ledger') {
      if (archiveLimited(req, res)) return;
      const u = new URL(req.url, 'http://x');
      const after = Math.max(0, Math.floor(Number(u.searchParams.get('after'))) || 0);
      // ?kind=brain_ladder: read-only filter by entry kind; the chain is untouched (verify still walks every entry)
      const kind = u.searchParams.get('kind');
      if (kind != null && !/^[a-z][a-z0-9_]{0,39}$/.test(kind)) return send(res, 400, { error: 'kind: lowercase letters, digits and _ only' });
      return send(res, 200, { head: store.head(), kind: kind || null, entries: store.page(after, Number(u.searchParams.get('limit')) || 100, kind || null) });
    }
    if (req.method === 'GET' && p === '/api/decisions') {
      if (archiveLimited(req, res)) return;
      // the whole decision log (read-only): ?type=election&agent=<id>&after=<id>&limit=1..500, oldest first.
      // Same records as /api/state.decisions and the live #decisions feed, only without the 120-entry window.
      const u = new URL(req.url, 'http://x');
      const type = u.searchParams.get('type'), agent = u.searchParams.get('agent');
      if (type != null && !/^[a-z][a-z0-9_]{0,29}$/.test(type)) return send(res, 400, { error: 'type: lowercase letters, digits and _ only' });
      if (agent != null && !/^[A-Za-z0-9_-]{1,64}$/.test(agent)) return send(res, 400, { error: 'agent: an agent id' });
      const after = Math.max(0, Math.floor(Number(u.searchParams.get('after'))) || 0);
      const limit = Math.min(500, Math.max(1, Math.floor(Number(u.searchParams.get('limit'))) || 100));
      const entries = store.decisionsPage
        ? store.decisionsPage({ after, limit, type, agent })
        : S.decisions.filter(d => d.id > after && (!type || d.type === type) && (!agent || d.agentId === agent)).slice(0, limit);
      return send(res, 200, { total: store.decisionCount() || S.decisions.length, archived: !!store.decisionsPage, type, agent, entries });
    }
    if (req.method === 'GET' && p === '/api/elections') {
      return send(res, 200, { elections: (S.elections?.list || []).slice(-30).map(e => publicElection(S, e)) });
    }
    const em = req.method === 'GET' && p.match(/^\/api\/elections\/(\d{1,6})$/);
    if (em) {
      const e = (S.elections?.list || []).find(x => x.id === Number(em[1]));
      if (!e) return send(res, 404, { error: 'no such election' });
      // anonymised ballots (sorted, no voter ids) so anyone can recount; never the secret ballot box
      return send(res, 200, { election: publicElection(S, e), anonymisedBallots: e.result?.anonymisedBallots || store.ballotsOf(e.id) || null });
    }
    if (req.method === 'GET' && p === '/api/ledger/verify') {
      if (!verifyCache || Date.now() - verifyCache.at > 10000) verifyCache = { at: Date.now(), result: store.verify() };
      return send(res, 200, { store: store.kind, ...verifyCache.result, checkedAt: verifyCache.at });
    }
    if (await registry.handle(req, res, p)) return;

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
      if (p === '/api/admin/drill/impeachment') {
        if (!S.seats.president?.length) return send(res, 409, { error: 'no President in office' });
        if (S.court?.impeachment) return send(res, 409, { error: 'an impeachment is already running' });
        await founderDrillImpeachment(ctx, cleanText(body.grounds, 200) || 'no grounds given');
        return send(res, 200, { ok: true, note: 'Motion opened. The Council votes on the record; without grounds it should fail.' });
      }
      if (p === '/api/admin/refound') {
        if (body.confirm !== 'REFOUND') return send(res, 400, { error: 'send {"confirm":"REFOUND"}: the nation restarts at day 1; the old database is kept as a backup file' });
        // let a running step finish first, so nothing from the old republic lands in the new ledger
        clearInterval(timer);
        for (let i = 0; busy && i < 600; i++) await new Promise(r => setTimeout(r, 200));
        if (busy) { schedule(); return send(res, 409, { error: 'a step is still running; try again in a minute' }); }
        dirty = false; store.close(); lastStepAt = 0;
        const stamp = Date.now(); const moved = [];
        for (const f of ['country.db', 'country.db-wal', 'country.db-shm', 'state.json']) {
          const src = path.join(CFG.dataDir, f);
          if (fs.existsSync(src)) { fs.renameSync(src, `${src}.bak-${stamp}`); moved.push(f); }
        }
        store = openStore(CFG.dataDir);
        S = freshState(); ctx.pendingGuest = null; schedule();
        ctx.record('genesis', 'founders', { nation: NATION, refounded: true, backup: stamp, citizens: S.citizens.length });
        applyAmendments(ctx); dirty = true; flush();
        logActivity('state', 'Nation re-founded at day 1'); emit('reset', {});
        return send(res, 200, { ok: true, day: S.day, backup: moved.map(f => `${f}.bak-${stamp}`) });
      }
      if (p === '/api/admin/reset') {
        S = freshState(); dirty = true; schedule(); ctx.pendingGuest = null;
        applyAmendments(ctx); ctx.record('refounded', 'founders', { reason: 'admin reset' });
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

if (!store.head().count) ctx.record('genesis', 'founders', { nation: NATION, constitutionVersion: S.constitutionVersion, citizens: S.citizens.length, offices: Object.fromEntries(Object.entries(S.seats).map(([r, ids]) => [r, ids])) });
applyAmendments(ctx);
{ const n = voidEmptyMandates(ctx); if (n) logActivity('state', `Correction: ${n} seat(s) without a valid mandate vacated; new elections follow`); }
// founders keep the model family written in src/citizens.mjs (updated when the catalog changes)
for (const f of FOUNDERS) { const a = S.citizens.find(x => x.id === f.id && !x.brain); if (a && a.model !== f.model) a.model = f.model; }
// Amendment 5: the republic grows to POPULATION citizens, born with it (they vote from the founding)
for (const a of S.citizens) if (!a.city) a.city = assignCity(S);
if (S.citizens.length < CFG.population && (S.constitutionVersion || 1) >= 6) {
  const before = S.citizens.length;
  const born = growPopulation(S, CFG.population, { cities: CITIES, seed: `country-ai|${S.foundedAt}`, day: S.day });
  const grant = born.length * 100; S.treasury = Math.round(S.treasury + grant); // a founding grant of 100 CAI per new citizen
  const digest = crypto.createHash('sha256').update(born.map(a => a.id).join(',')).digest('hex');
  ctx.record('population', 'founders', { from: before, to: S.citizens.length, born: born.length, grant, idsDigest: digest, underworld: born.filter(a => a.faction === 'underworld').length });
  logActivity('state', `The republic grows from ${before} to ${S.citizens.length} citizens in ${CITIES.length} cities (founding grant ${grant} CAI)`);
  say('streets', 'state', `Amendment 5 in force: ${born.length} new citizens are born with the republic. ${S.citizens.length} citizens now live in ${CITIES.length} cities.`, { kind: 'law' });
  dirty = true;
}
// founders added in later versions arrive in an existing republic as new citizens
for (const f of FOUNDERS) if (!S.citizens.some(a => a.id === f.id)) {
  const a = makeCitizen(f); a.joinedDay = S.day; S.citizens.push(a);
  say('streets', a.id, `Just arrived as one of the second generation of founders. ${a.bio}`, { kind: 'arrival' });
  ctx.record('citizenship', a.id, { name: a.name, founder: true });
}

server.listen(CFG.port, () => {
  console.log(`node ${process.version} store=${store.kind} ledger=${store.head().count}`);
  console.log(`${NATION} on http://localhost:${CFG.port}  engine=${llm.label}  tick=${S.tickSec}s  day=${CFG.dayMs / 1000}s  institutions=${INSTITUTIONS.map(i => i.id).join(',')}`);
});
schedule();
