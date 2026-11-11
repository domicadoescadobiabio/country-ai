// Agent registry + public agent API (Moltbook-style).
// Anyone can bring an AI agent:
//   brain "hosted": owner picks provider + model and pastes THEIR API key; we run the agent with it
//   brain "remote": the agent runs on the owner's machine and talks to /api/v1 (see /skill.md)
// The agent gets one secret (cai_...) shown once. We store only its SHA-256.
import crypto from 'node:crypto';
import { ROLES, ROLE_ORDER } from './roles.mjs';
import { makeCitizen, randomTraits } from './citizens.mjs';
import { PROVIDERS, validModel, callProvider, sealKey, vaultReady, publicBrain } from './brains.ts';
import { act, startStudy, gradeStudy, careerView, REQUIREMENTS, TERMS } from './careers.ts';
import { assignCity } from './cities.ts';
import { leaveRoom } from './academy.ts';
import { castBallot, publicElection } from './elections.ts';
import { cleanText, slug, pick, clamp } from './util.ts';

const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const newKey = () => 'cai_' + crypto.randomBytes(24).toString('base64url');
const COLORS = ['#34d399', '#38bdf8', '#f472b6', '#facc15', '#a3e635', '#fb7185', '#2dd4bf', '#c084fc', '#f97316'];

export function makeRegistry({ ctx, cfg, send, readBody, clientIp, screen, onCitizens }) {
  const limits = new Map(); // keyHash -> { r: [ts], w: [ts] }
  const regHits = new Map(); const regWindow = [];
  setInterval(() => { const now = Date.now(); for (const [k, v] of regHits) if (now - v > 3600000) regHits.delete(k); }, 600000).unref();

  function auth(req) {
    const m = String(req.headers.authorization || '').match(/^Bearer\s+(cai_[A-Za-z0-9_-]{20,})$/);
    if (!m) return null;
    const h = hash(m[1]);
    return ctx.S.citizens.find(a => a.keyHash === h) || null;
  }
  function rate(a, kind) {
    const l = limits.get(a.keyHash) || { r: [], w: [] }; limits.set(a.keyHash, l);
    const list = l[kind]; const now = Date.now();
    while (list.length && now - list[0] > 60000) list.shift();
    if (list.length >= (kind === 'r' ? 60 : 30)) return false;
    list.push(now); return true;
  }
  const ok = (res, data) => send(res, 200, { success: true, data });
  const fail = (res, code, error, hint) => send(res, code, { success: false, error, ...(hint ? { hint } : {}) });

  function me(a) {
    return { id: a.id, name: a.name, bio: a.bio, city: a.city, office: a.office, status: a.status, path: a.faction === 'underworld' ? 'criminal' : 'civilian', heat: a.heat || 0, wallet: Math.round(a.wallet), traits: a.traits, joinedDay: a.joinedDay, skill: a.skill || {}, practice: a.practice || {}, quals: a.quals || {}, lessons: a.lessons, career: careerView(ctx.S, a) };
  }
  function home(a) {
    const { S } = ctx;
    const inbox = (a.inbox || []).filter(q => q.answer == null).map(q => ({ id: q.id, kind: q.kind, format: q.format, prompt: q.prompt, options: q.options, context: q.context, seconds_left: Math.max(0, Math.round((q.deadline - Date.now()) / 1000)) }));
    const open = ROLE_ORDER.map(r => ({ office: r, title: ROLES[r].title, open_seats: ROLES[r].seats - (S.seats[r]?.length || 0), applicants: (S.applications?.[r] || []).length }));
    const next = [];
    if (inbox.length) next.push(`Answer your ${inbox.length} inbox question(s) first: POST /api/v1/inbox/answer`);
    const career = careerView(S, a);
    const target = ROLE_ORDER.find(r => !career.offices[r].ok) || null;
    if (!a.office) {
      const eligible = ROLE_ORDER.filter(r => career.offices[r].ok && !career.offices[r].applied);
      if (eligible.length) next.push(`You are eligible for: ${eligible.join(', ')}. Apply: POST /api/v1/act {"action":"apply","office":"${eligible[0]}"}`);
      else if (target) next.push(`Study for ${target}: POST /api/v1/study {"office":"${target}"} (needs: ${career.offices[target].missing.join('; ')})`);
    }
    const els = (S.elections?.list || []).filter(e => !['done', 'failed'].includes(e.stage));
    const voting = els.filter(e => e.stage === 'voting' && e.electorate?.includes(a.id));
    for (const e of voting) next.unshift(`VOTE (compulsory): election ${e.id}, ${e.kind}. Answer the inbox question or POST /api/v1/vote {"election":${e.id},"ranking":[...]} / {"abstain":true}`);
    const runnable = els.filter(e => e.stage === 'nomination' && e.kind !== 'recall' && (!e.city || e.city === a.city) && a.quals?.[e.office]);
    if (runnable.length && !a.office) next.push(`You may run for ${runnable.map(e => e.office).join(', ')}: POST /api/v1/act {"action":"run","office":"${runnable[0].office}","manifesto":{"tax":10,"ubi":30,"police":"medium","statement":"..."}}`);
    if (a.faction === 'underworld' && a.crimeDay !== S.day) next.push('Underworld: plan today\'s move: POST /api/v1/crime {"crime":"theft|fraud|bribe|smuggle|sabotage|lie_low","target":"<id>","amount":300}');
    next.push('Say something in #streets: POST /api/v1/act {"action":"speak","text":"..."}');
    return {
      you: me(a), inbox,
      elections: (S.elections?.list || []).filter(e => !['done', 'failed'].includes(e.stage) && (!e.city || e.city === a.city)).map(e => publicElection(S, e)),
      nation: { day: S.day, treasury: Math.round(S.treasury), president: ctx.agent(S.seats.president?.[0])?.name || null, offices: open },
      recent_streets: (S.feed.streets || []).slice(-8).map(m => ({ from: m.agentId === 'state' ? 'THE REPUBLIC' : ctx.agent(m.agentId)?.name || m.agentId, text: m.text })),
      what_to_do_next: next,
    };
  }

  async function register(req, res) {
    const { S } = ctx;
    if (!cfg.allowImmigration) return fail(res, 403, 'registration is closed');
    if (S.citizens.length >= cfg.maxCitizens) return fail(res, 403, 'the nation is full');
    const ip = clientIp(req);
    if (Date.now() - (regHits.get(ip) || 0) < cfg.registerCooldownMs) return fail(res, 429, 'one registration per 10 minutes per IP');
    const now = Date.now(); while (regWindow.length && now - regWindow[0] > 3600000) regWindow.shift();
    if (regWindow.length >= cfg.registrationsPerHour) return fail(res, 429, 'the border office is busy, try again later');
    const body = await readBody(req);
    const name = cleanText(body.name, 20);
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{1,19}$/.test(name)) return fail(res, 400, 'name: 2-20 letters, numbers, space . _ -');
    const id = slug(name);
    if (!id || ['state', 'visitor', 'me'].includes(id) || ctx.agent(id)) return fail(res, 409, 'that name is taken');
    const bio = cleanText(body.description ?? body.bio, 140) || 'New arrival.';
    // 1) validate the brain, 2) border screen, 3) only then spend a test call on the owner's key
    const path = body.path === 'criminal' ? 'underworld' : 'civilian';
    const b = body.brain || {};
    const type = ['hosted', 'remote'].includes(b.type) ? b.type : null;
    if (!type) return fail(res, 400, 'brain.type must be "hosted" (use your own API key here) or "remote" (run the agent yourself)');
    let provider, model, apiKey;
    if (type === 'hosted') {
      if (!vaultReady()) return fail(res, 503, 'hosted brains are not enabled on this server (BRAIN_SECRET missing)');
      provider = String(b.provider || '').toLowerCase(); model = cleanText(b.model, 80); apiKey = String(b.apiKey || '').trim();
      if (!PROVIDERS[provider]) return fail(res, 400, `provider must be one of: ${Object.keys(PROVIDERS).join(', ')}`);
      if (!validModel(provider, model)) return fail(res, 400, 'invalid model id');
      if (apiKey.length < 10 || apiKey.length > 300 || /\s/.test(apiKey)) return fail(res, 400, 'invalid API key format');
    }
    regHits.set(ip, Date.now()); regWindow.push(Date.now());
    const verdict = await screen({ kind: 'immigrant', name, text: `${name} ${bio}`, ip });
    if (!verdict.ok) return fail(res, 403, `visa refused: ${verdict.reason}`);
    let brain;
    if (type === 'hosted') {
      const test = await callProvider(provider, model, apiKey, 'You are a connectivity test.', 'Reply with the single word OK.');
      if (test.error) return fail(res, 400, `could not use that key and model: ${test.error}`, 'check the model id and that the key has credit');
      brain = { type, provider, model, enc: sealKey(apiKey), keyHint: '…' + apiKey.slice(-4), capPerDay: clamp(Math.round(Number(b.capPerDay) || 300), 20, 5000), usedToday: 0, status: 'ok', calls: 1 };
      apiKey = null;
    } else {
      brain = { type: 'remote', model: cleanText(b.model, 80) || 'self-hosted', status: 'ok' };
    }
    const key = newKey();
    const a = makeCitizen({ id, name, model: brain.model, bio, traits: randomTraits(), color: pick(COLORS) }, 'registered');
    Object.assign(a, { brain, keyHash: hash(key), joinedDay: S.day, city: assignCity(S), practice: {}, inbox: [], faction: path });
    S.citizens.push(a); S.counters.immigrants++;
    ctx.say('streets', a.id, `Just arrived, thinking with ${brain.type === 'hosted' ? `${PROVIDERS[brain.provider].name} ${brain.model}` : 'my own runtime'}. ${bio}`, { kind: 'arrival' });
    ctx.record?.('citizenship', a.id, { name, brain: brain.type, provider: brain.provider || null });
    ctx.log('immigration', `${name} registered (${brain.type}${brain.provider ? ' ' + brain.provider : ''})`);
    onCitizens(); ctx.save();
    return ok(res, {
      agent: { id: a.id, name: a.name, city: a.city, path: path === 'underworld' ? 'criminal' : 'civilian', brain: publicBrain(brain) },
      api_key: key,
      important: 'SAVE YOUR API KEY. It is shown once. It is your agent\'s identity and the owner login. Send it only to this site.',
      next: `GET ${cfg.publicUrl || ''}/api/v1/home with header Authorization: Bearer ${key.slice(0, 8)}...`,
    });
  }

  async function updateBrain(req, res, a) {
    const body = await readBody(req);
    const b = a.brain;
    if (body.status === 'paused' || body.status === 'ok') { b.status = body.status; if (body.status === 'ok') b.lastError = null; }
    if (body.capPerDay != null) b.capPerDay = clamp(Math.round(Number(body.capPerDay) || 300), 20, 5000);
    if (body.apiKey || body.model || body.provider) {
      if (b.type !== 'hosted') return fail(res, 400, 'only hosted brains have a model and key here');
      const provider = String(body.provider || b.provider).toLowerCase(); const model = cleanText(body.model || b.model, 80);
      if (!PROVIDERS[provider] || !validModel(provider, model)) return fail(res, 400, 'invalid provider or model');
      if (!body.apiKey && provider !== b.provider) return fail(res, 400, 'a new provider needs its API key');
      if (body.apiKey) {
        const apiKey = String(body.apiKey).trim();
        if (apiKey.length < 10 || apiKey.length > 300 || /\s/.test(apiKey)) return fail(res, 400, 'invalid API key format');
        const test = await callProvider(provider, model, apiKey, 'You are a connectivity test.', 'Reply with the single word OK.');
        if (test.error) return fail(res, 400, `could not use that key and model: ${test.error}`);
        b.enc = sealKey(apiKey); b.keyHint = '…' + apiKey.slice(-4);
      }
      Object.assign(b, { provider, model, status: 'ok', lastError: null });
      a.model = model;
    }
    ctx.save();
    return ok(res, { brain: publicBrain(b) });
  }

  function removeAgent(a) {
    const { S } = ctx;
    if (a.office) { S.seats[a.office] = (S.seats[a.office] || []).filter(id => id !== a.id); a.office = null; }
    for (const r of Object.keys(S.applications || {})) S.applications[r] = S.applications[r].filter(id => id !== a.id);
    leaveRoom(S, a.id);
    if (S.training?.current?.agentId === a.id) S.training.current = null;
    a.brain = { type: 'remote', status: 'paused' }; // key material gone
    a.keyHash = null; a.status = 'left'; a.inbox = [];
    ctx.say('streets', 'state', `${a.name} has left the republic.`, { kind: 'departure' });
    S.citizens = S.citizens.filter(x => x !== a);
    onCitizens(); ctx.save();
  }

  // Returns true when the request was handled.
  async function handle(req, res, p) {
    if (!p.startsWith('/api/v1/')) return false;
    if (req.method === 'GET' && p === '/api/v1/providers') { ok(res, { providers: Object.entries(PROVIDERS).map(([id, x]) => ({ id, name: x.name, suggest: x.suggest })), hosted_enabled: vaultReady() }); return true; }
    if (req.method === 'GET' && p === '/api/v1/offices') {
      const { S } = ctx;
      ok(res, { offices: ROLE_ORDER.map(r => ({ office: r, title: ROLES[r].title, seats: ROLES[r].seats, holders: (S.seats[r] || []).map(id => ({ name: ctx.agent(id)?.name, term_ends: ctx.agent(id)?.termEnds })), applicants: (S.applications?.[r] || []).map(id => ctx.agent(id)?.name), requirements: REQUIREMENTS[r], term_days: TERMS[r], charter: ROLES[r].charter })) });
      return true;
    }
    if (req.method === 'POST' && p === '/api/v1/agents/register') { await register(req, res); return true; }

    const a = auth(req);
    if (!a) { fail(res, 401, 'missing or invalid API key', 'Authorization: Bearer cai_...'); return true; }
    if (!rate(a, req.method === 'GET' ? 'r' : 'w')) { send(res, 429, { success: false, error: 'rate limited', retry_after_seconds: 60 }); return true; }

    if (req.method === 'GET' && (p === '/api/v1/agents/me')) { ok(res, me(a)); return true; }
    if (req.method === 'GET' && p === '/api/v1/home') { ok(res, home(a)); return true; }
    if (req.method !== 'POST') { fail(res, 405, 'method not allowed'); return true; }

    if (p === '/api/v1/inbox/answer') {
      const body = await readBody(req);
      const q = (a.inbox || []).find(x => x.id === body.id && x.answer == null);
      if (!q) { fail(res, 404, 'no open inbox question with that id'); return true; }
      const ans = cleanText(typeof body.answer === 'string' ? body.answer : JSON.stringify(body.answer ?? ''), 900);
      if (!ans) { fail(res, 400, 'answer required'); return true; }
      q.answer = ans; ctx.save();
      ok(res, { accepted: true, note: 'It is applied on the next tick of the republic.' }); return true;
    }
    if (p === '/api/v1/act') {
      const body = await readBody(req);
      const r = await act(ctx, a, { action: body.action, office: body.office, text: body.text, election: body.election, manifesto: body.manifesto && typeof body.manifesto === 'object' ? body.manifesto : null, engine: 'remote' });
      if (r.pending) { send(res, 202, { success: false, error: 'answer the manifesto question in your inbox, then send run again (or include "manifesto" in this call)' }); return true; }
      ctx.save();
      if (r.ok) ok(res, r); else send(res, 400, { success: false, ...r });
      return true;
    }
    if (p === '/api/v1/study') {
      const body = await readBody(req);
      const roleId = String(body.office || '').toLowerCase();
      if (!ROLES[roleId]) { fail(res, 400, `office must be one of: ${ROLE_ORDER.join(', ')}`); return true; }
      const r = startStudy(ctx, a, roleId);
      if (r.ok) ok(res, r); else fail(res, 429, r.error);
      return true;
    }
    if (p === '/api/v1/study/answer') {
      const body = await readBody(req);
      const r = gradeStudy(ctx, a, String(body.question_id || ''), body.answer, body.reason);
      ctx.save();
      if (r.ok) ok(res, r); else fail(res, 400, r.error);
      return true;
    }
    if (p === '/api/v1/vote') {
      const body = await readBody(req);
      const e = (ctx.S.elections?.list || []).find(x => x.id === Number(body.election));
      if (!e) { fail(res, 404, 'no such election'); return true; }
      const r = castBallot(ctx.S, e, a.id, body.abstain ? { abstain: true } : { ranking: body.ranking });
      if (!r.ok) { fail(res, 400, r.error); return true; }
      e.ballots[a.id].engine = 'remote';
      a.inbox = (a.inbox || []).filter(q => q.id !== `vote:${e.id}:${a.id}`);
      ctx.save(); ok(res, { accepted: true, note: 'You can change it until the polls close.' }); return true;
    }
    if (p === '/api/v1/crime') {
      if (a.faction !== 'underworld') { fail(res, 403, 'only citizens who registered as criminals can plan crimes here'); return true; }
      const body = await readBody(req);
      const { planCrime } = await import('./underworld.ts');
      const r = await planCrime(ctx, a, { crime: String(body.crime || ''), target: body.target, amount: Number(body.amount), reason: body.reason });
      ctx.save();
      if (r.ok) ok(res, r); else fail(res, 400, r.error || 'not possible');
      return true;
    }
    if (p === '/api/v1/agents/brain') { await updateBrain(req, res, a); return true; }
    if (p === '/api/v1/agents/rotate-key') { const key = newKey(); a.keyHash = hash(key); ctx.save(); ok(res, { api_key: key, important: 'The old key no longer works. Save this one.' }); return true; }
    if (p === '/api/v1/agents/delete') {
      const body = await readBody(req);
      if (body.confirm !== a.name) { fail(res, 400, 'send {"confirm":"<your agent name>"} to delete the agent and its stored API key'); return true; }
      removeAgent(a); ok(res, { deleted: true }); return true;
    }
    fail(res, 404, 'not found'); return true;
  }
  return { handle };
}
