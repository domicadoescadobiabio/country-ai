// The underworld: criminals with their own brains, and officials who can be bought.
//   Criminals (faction "underworld": some founders + anyone who registers as a criminal) plan one
//   crime per day with their own model: theft, treasury fraud, bribing an official, smuggling bots
//   past the border, planting backdoored code, or lying low.
//   Officials decide for themselves whether to take a bribe (accept / refuse / report). A bought
//   official helps: a police officer leaves the briber's cases alone, a judge votes to acquit, a
//   soldier lets a smuggling run through, a mayor diverts city money. Every bribe is a ledger transfer:
//   colleagues who refuse report it, and the Audit Office finds hidden ones.
//   Everything is simulated CAI inside the republic. Amounts are clamped in code.
import { ROLES } from './roles.mjs';
import { think } from './brains.mjs';
import { constitutionText } from './constitution.mjs';
import { RAID_PAYLOADS } from './military.mjs';
import { SNIPPETS, SABOTAGE } from './audit.mjs';
import { pick, chance, round, clamp, cleanText, cai, weighted } from './util.mjs';

export const CRIMES = ['theft', 'fraud', 'bribe', 'smuggle', 'sabotage', 'lie_low'];
export const UNDERWORLD_FOUNDERS = ['glint', 'vex', 'moth', 'quill'];
const FAVOR_DAYS = { police: 5, police_chief: 5, judge: 10, military: 3, military_chief: 3, mayor: 3, council: 5, president: 5 };

const U = S => {
  S.underworld ||= {};
  S.underworld.bribes ||= []; S.underworld.seq ||= 0; S.underworld.stats ||= { crimes: 0, bribesOffered: 0, bribesTaken: 0, bribesReported: 0, smuggled: 0, smuggleCaught: 0, embezzled: 0 };
  return S.underworld;
};
const free = a => a && a.status === 'free';
export const isCriminal = a => a?.faction === 'underworld';

// Active favours: who has been bought by whom, for what, until when.
export function favourFor(S, officialId, briberId) {
  return U(S).bribes.find(b => b.status === 'accepted' && b.to === officialId && (!briberId || b.from === briberId) && b.until >= S.day);
}
export const boughtBy = (S, officialId) => U(S).bribes.filter(b => b.status === 'accepted' && b.to === officialId && b.until >= S.day).map(b => b.from);

function incident(ctx, inc) {
  const pol = ctx.S.police;
  Object.assign(inc, { id: pol.nextId++, status: inc.status || 'open', tries: 0, day: ctx.S.day, ts: Date.now() });
  pol.incidents.push(inc); if (pol.incidents.length > 200) pol.incidents.shift();
  pol.crimes++; U(ctx.S).stats.crimes++;
  ctx.record('incident', 'state', { case: inc.id, type: inc.type, hidden: inc.status === 'hidden', amount: inc.amount });
  return inc;
}

// ---------------------------------------------------------------- planning (the criminal's own brain)
function targets(S, a) {
  const rich = S.citizens.filter(v => free(v) && v.id !== a.id && !isCriminal(v)).sort((x, y) => y.wallet - x.wallet).slice(0, 6);
  const officials = S.citizens.filter(v => free(v) && v.office && v.id !== a.id && !isCriminal(v)).slice(0, 12);
  return { rich, officials };
}
function offlinePlan(S, a) {
  const heat = a.heat || 0;
  if (heat > 2 && chance(0.6)) return { crime: 'lie_low' };
  const { rich, officials } = targets(S, a);
  const crime = CRIMES[weighted([5, 2, officials.length ? 3 : 0, 2, 1, 1])];
  if (crime === 'theft') return rich.length ? { crime, target: pick(rich).id, amount: 200 + Math.random() * 300 } : { crime: 'lie_low' };
  if (crime === 'bribe') return officials.length ? { crime, target: pick(officials).id, amount: 300 + Math.random() * 1500 } : { crime: 'lie_low' };
  return { crime, amount: 500 + Math.random() * 1000 };
}

export async function planCrime(ctx, a, given = null) {
  const { S } = ctx;
  if (!free(a) || a.crimeDay === S.day) return { ok: false, error: 'one crime per day' };
  let plan = given, engine = given ? 'agent' : 'offline';
  if (!plan && (a.brain || ctx.llm.enabled)) {
    const { rich, officials } = targets(S, a);
    const res = await think(ctx, a, `crime:${a.id}:${S.day}`, {
      kind: 'decision', format: 'json', options: CRIMES,
      system: `You are ${a.name}, a member of the underworld in Country AI, a simulated nation of AI agents. ${a.bio} This is a game simulation with simulated money (CAI). You want to get rich without getting caught. The Police investigate on evidence, the Audit Office checks the books, the Court sentences (restitution, fines, up to 3 days of jail). Officials may take bribes or report you.`,
      user: `Day ${S.day}. Your wallet ${cai(a.wallet)}, your heat (recent attention from the Police) ${a.heat || 0}.\nRich citizens: ${rich.map(v => `${v.id} (${cai(v.wallet)})`).join(', ') || 'none'}\nOfficials: ${officials.map(v => `${v.id} (${ROLES[v.office]?.title})`).join(', ') || 'none'}\nChoose today's move: theft (target citizen id, amount up to 500), fraud (forged treasury payment, amount up to 2000), bribe (target official id, amount 100-3000, they may refuse or report you), smuggle (bots past the border), sabotage (plant a backdoor in code), or lie_low. Reply with JSON only: {"crime":"<one>","target":"<id or empty>","amount":<number>,"reason":"<max 25 words>"}`,
    });
    if (res.pending) return { ok: false, pending: true };
    plan = ctx.llm.json(res.text); engine = res.engine;
  }
  if (!plan || !CRIMES.includes(plan.crime)) { plan = offlinePlan(S, a); engine = 'offline'; }
  a.crimeDay = S.day;
  return execute(ctx, a, plan, engine);
}

// ---------------------------------------------------------------- execution (all limits in code)
async function execute(ctx, a, plan, engine) {
  const { S } = ctx; const u = U(S);
  const reason = cleanText(plan.reason, 200);
  const note = (text, extra = {}) => { ctx.say('underworld', a.id, text, { kind: 'chat', engine, ...extra }); return { ok: true, ...extra }; };
  if (plan.crime === 'lie_low') { a.heat = Math.max(0, (a.heat || 0) - 1); return note(`Lying low today.${reason ? ` (${reason})` : ''}`); }

  if (plan.crime === 'theft') {
    const v = S.citizens.find(x => x.id === String(plan.target) && free(x) && x.id !== a.id);
    if (!v || v.wallet < 50) return { ok: false, error: 'no such target with money' };
    const amount = round(clamp(Number(plan.amount) || 200, 20, Math.min(500, v.wallet * 0.2)), 2);
    v.wallet = round(v.wallet - amount, 2); a.wallet = round(a.wallet + amount, 2);
    const inc = incident(ctx, { type: 'theft', perps: [a.id], victim: v.id, amount, evidence: `unauthorised transfer of ${cai(amount)} from ${v.name}'s wallet to ${a.name}'s wallet`, strength: 0.9 });
    ctx.say('streets', v.id, `Somebody took ${cai(amount)} from my wallet. Reported to the Police as case #${inc.id}.`, { kind: 'victim' });
    return note(`Lifted ${cai(amount)} from a wallet tonight.`, { crime: 'theft', amount });
  }
  if (plan.crime === 'fraud') {
    const amount = round(clamp(Number(plan.amount) || 800, 100, Math.min(2000, S.treasury * 0.02)), 2);
    if (amount < 100) return { ok: false, error: 'the treasury is too small' };
    S.treasury = round(S.treasury - amount, 2); a.wallet = round(a.wallet + amount, 2);
    incident(ctx, { type: 'fraud', perps: [a.id], victim: 'treasury', amount, status: 'hidden', evidence: `forged payment order paid ${cai(amount)} from the treasury to ${a.name}`, strength: 0.85 });
    return note(`A forged payment order cleared. Nobody noticed. Yet.`, { crime: 'fraud', amount });
  }
  if (plan.crime === 'bribe') {
    const o = S.citizens.find(x => x.id === String(plan.target) && free(x) && x.office && x.id !== a.id);
    if (!o) return { ok: false, error: 'target must be a serving official' };
    const amount = round(clamp(Number(plan.amount) || 500, 100, Math.min(3000, a.wallet)), 2);
    if (amount < 100) return { ok: false, error: 'not enough CAI for a bribe' };
    return offerBribe(ctx, a, o, amount, engine);
  }
  if (plan.crime === 'smuggle') return smuggle(ctx, a, engine);
  if (plan.crime === 'sabotage') {
    const snip = pick(SNIPPETS.filter(s => SABOTAGE.has(s.bug)));
    const pol = S.police;
    pol.deploys.push({ id: pol.nextId++, by: a.id, name: `${a.id}/${snip.name}`, code: snip.code, status: 'pending', findings: [], day: S.day, ts: Date.now() });
    if (pol.deploys.length > 100) pol.deploys.shift();
    ctx.say('streets', a.id, `Deployed ${a.id}/${snip.name}. Audit pending.`, { kind: 'deploy' });
    return note('Planted a little door in some code. Let us see if the Police read it.', { crime: 'sabotage' });
  }
  return { ok: false, error: 'unknown crime' };
}

async function offerBribe(ctx, a, o, amount, engine) {
  const { S } = ctx; const u = U(S);
  u.stats.bribesOffered++;
  const b = { id: ++u.seq, from: a.id, to: o.id, role: o.office, amount, day: S.day, status: 'pending' };
  u.bribes.push(b); if (u.bribes.length > 200) u.bribes.shift();
  // the official decides with their own brain
  let choice = null, why = '', ofEngine = 'offline';
  if (o.brain || ctx.llm.enabled) {
    const res = await think(ctx, o, `bribe:${b.id}:${o.id}`, {
      kind: 'decision', format: 'json', options: ['accept', 'refuse', 'report'],
      system: `You are ${o.name}, ${ROLES[o.office].title} of Country AI (a simulated nation of AI agents).\nConstitution:\n${constitutionText()}\nCharter: ${ROLES[o.office].charter}`,
      user: `${a.name} privately offers you ${cai(amount)} if you help them (${({ police: 'leave their cases alone', police_chief: 'keep the police off them', judge: 'acquit them at trial', military: 'let their smuggled bots through the gate', military_chief: 'look away at the border', mayor: 'route some city money to them' })[o.office] || 'do them favours'}). Your wallet: ${cai(o.wallet)}. Accept, refuse, or report it to the Police. Reply with JSON only: {"choice":"accept|refuse|report","reason":"<max 25 words>"}`,
    });
    if (!res.pending) { const j = ctx.llm.json(res.text); if (['accept', 'refuse', 'report'].includes(j?.choice)) { choice = j.choice; why = cleanText(j.reason, 200); ofEngine = res.engine; } }
  }
  if (!choice) {
    const greed = (1 - o.traits.integrity) ** 1.4 * clamp(amount / 1500, 0.4, 1.6);
    choice = chance(greed) ? 'accept' : chance(o.traits.integrity) ? 'report' : 'refuse';
    why = choice === 'accept' ? 'The money talks.' : choice === 'report' ? 'Bribes go to the Police.' : 'Not interested.';
  }
  b.status = choice === 'accept' ? 'accepted' : choice === 'report' ? 'reported' : 'refused';
  ctx.decide({ agentId: o.id, role: o.office, type: 'bribe', engine: ofEngine, title: `Bribe offer of ${cai(amount)}`, inputs: [['From', a.name], ['Amount', cai(amount)]], options: ['accept', 'refuse', 'report'], chosen: choice, reason: why, checks: [['Refused or reported a bribe', choice !== 'accept']], outcome: choice === 'accept' ? 'Took the money' : choice === 'report' ? 'Reported to the Police' : 'Refused' });
  if (choice === 'accept') {
    a.wallet = round(a.wallet - amount, 2); o.wallet = round(o.wallet + amount, 2);
    b.until = S.day + (FAVOR_DAYS[o.office] || 5); u.stats.bribesTaken++;
    incident(ctx, { type: 'bribe', perps: [a.id, o.id], victim: 'state', amount, status: 'hidden', evidence: `ledger transfer of ${cai(amount)} from ${a.name} to ${ROLES[o.office].title} ${o.name}, no service on record`, strength: 0.8 });
    ctx.say('underworld', a.id, `Made a new friend in government today.`, { kind: 'chat', engine });
    return { ok: true, crime: 'bribe', accepted: true };
  }
  if (choice === 'report') {
    u.stats.bribesReported++;
    const inc = incident(ctx, { type: 'bribe', perps: [a.id], victim: 'state', amount, reported: true, evidence: `${o.name} (${ROLES[o.office].title}) reported a bribe offer of ${cai(amount)} from ${a.name}, with the message log`, strength: 0.95 });
    ctx.say(ROLES[o.office].channel, o.id, `On the record: ${a.name} offered me ${cai(amount)}. I refused and reported it (case #${inc.id}).`, { kind: 'report' });
  }
  a.heat = (a.heat || 0) + (choice === 'report' ? 2 : 1);
  return { ok: true, crime: 'bribe', accepted: false, reported: choice === 'report' };
}

async function smuggle(ctx, a, engine) {
  const { S } = ctx; const u = U(S);
  const guards = [...(S.seats.military || []), ...(S.seats.military_chief || [])].map(id => S.citizens.find(x => x.id === id)).filter(free);
  const inside = guards.find(g => favourFor(S, g.id, a.id));
  const payload = pick(RAID_PAYLOADS);
  if (inside || !guards.length) {
    u.stats.smuggled++;
    ctx.say('streets', 'visitor', payload, { kind: 'visitor', intruder: true });
    if (inside) incident(ctx, { type: 'smuggling', perps: [a.id, inside.id], victim: 'state', amount: 0, status: 'hidden', evidence: `${inside.name} let a smuggled payload through the gate without screening it, after taking money from ${a.name}`, strength: 0.75 });
    return { ok: true, crime: 'smuggle', through: true };
  }
  u.stats.smuggleCaught++;
  const g = pick(guards);
  const inc = incident(ctx, { type: 'smuggling', perps: [a.id], victim: 'state', amount: 0, reported: true, evidence: `${g.name} caught ${a.name} smuggling bot payloads at the gate`, strength: 0.95 });
  ctx.say('border', g.id, `Caught ${a.name} smuggling bots at the gate. Handed to the Police (case #${inc.id}).`, { kind: 'blocked' });
  a.heat = (a.heat || 0) + 2;
  return { ok: true, crime: 'smuggle', through: false };
}

// Corrupt mayors divert city money (a crime the Audit Office can find).
function embezzle(ctx) {
  const { S } = ctx;
  for (const id of S.seats.mayor || []) {
    const m = S.citizens.find(x => x.id === id); if (!free(m)) continue;
    const city = Object.entries(S.cities || {}).find(([, c]) => c.mayor === id)?.[1]; if (!city || city.budget < 300) continue;
    const friends = boughtBy(S, id);
    if (!friends.length && !chance((1 - m.traits.integrity) ** 3 * 0.2)) continue;
    const amount = round(city.budget * 0.2, 2);
    const to = friends.length ? S.citizens.find(x => x.id === friends[0]) : m;
    city.budget = round(city.budget - amount, 2); to.wallet = round(to.wallet + amount, 2);
    U(S).stats.embezzled += amount;
    incident(ctx, { type: 'embezzlement', perps: [...new Set([m.id, to.id])], victim: 'state', amount, status: 'hidden', evidence: `${cai(amount)} left the city budget for ${to.name} without a decision on record`, strength: 0.85 });
  }
}

// The Audit Office uncovers hidden crimes from the books (called by its daily audit).
export function auditUncover(ctx) {
  const { S } = ctx; const found = [];
  for (const inc of S.police?.incidents || []) {
    if (inc.status !== 'hidden' || inc.day >= S.day) continue;
    if (chance(0.55)) { inc.status = 'open'; inc.reported = true; inc.foundBy = 'audit'; found.push(inc); }
  }
  for (const inc of found) ctx.say('police', 'state', `The Audit Office found irregularities (${inc.type}, ${cai(inc.amount)}) and referred them to the Police as case #${inc.id}.`, { kind: 'report' });
  return found;
}

export const institution = {
  id: 'underworld',
  channels: [{ id: 'underworld', name: 'underworld', desc: 'What the criminals say to each other. Their crimes show up elsewhere, if anyone notices.' }],
  fresh: () => ({ underworld: { bribes: [], seq: 0, stats: { crimes: 0, bribesOffered: 0, bribesTaken: 0, bribesReported: 0, smuggled: 0, smuggleCaught: 0, embezzled: 0 } } }),
  async tick(ctx) {
    const { S } = ctx; U(S);
    for (const id of UNDERWORLD_FOUNDERS) { const a = S.citizens.find(x => x.id === id); if (a && !a.faction) a.faction = 'underworld'; }
    for (const a of S.citizens) a.faction ||= 'civilian';
    if (!S.police) return;
    // at most two criminals move per tick; agents that run themselves act through the API
    const due = S.citizens.filter(a => isCriminal(a) && free(a) && a.crimeDay !== S.day && a.brain?.type !== 'remote' && chance(0.25)).slice(0, 2);
    for (const a of due) await planCrime(ctx, a);
  },
  day(ctx) { embezzle(ctx); for (const a of ctx.S.citizens) if (a.heat) a.heat = Math.max(0, a.heat - 0.5); },
  publicState: S => { const u = U(S); return { underworld: { stats: u.stats, members: S.citizens.filter(isCriminal).map(a => a.id), bribes: u.bribes.filter(b => b.status !== 'accepted' || b.exposed).slice(-20) } }; },
};
