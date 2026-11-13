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
import { think } from './brains.ts';
import { constitutionText } from './constitution.mjs';
import { RAID_PAYLOADS } from './military.ts';
import { SNIPPETS, SABOTAGE } from './audit.ts';
import { pick, chance, round, clamp, cleanText, cai, weighted, citizenById } from './util.ts';
import type { Ctx, State, Citizen, Incident } from './types.ts';
const MOVES_PER_DAY = Math.max(1, Number(process.env.UNDERWORLD_MOVES_PER_DAY) || 30);

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
export function favourFor(S: State, officialId, briberId) {
  return U(S).bribes.find(b => b.status === 'accepted' && b.to === officialId && (!briberId || b.from === briberId) && b.until >= S.day);
}
export const boughtBy = (S, officialId) => U(S).bribes.filter(b => b.status === 'accepted' && b.to === officialId && b.until >= S.day).map(b => b.from);

function incident(ctx: Ctx, inc: Incident) {
  const pol = ctx.S.police;
  Object.assign(inc, { id: pol.nextId++, status: inc.status || 'open', tries: 0, day: ctx.S.day, ts: Date.now() });
  pol.incidents.push(inc); if (pol.incidents.length > 200) pol.incidents.shift();
  pol.crimes++; U(ctx.S).stats.crimes++;
  ctx.record('incident', 'state', { case: inc.id, type: inc.type, hidden: inc.status === 'hidden', amount: inc.amount });
  return inc;
}

// ---------------------------------------------------------------- planning (the criminal's own brain)
function targets(S: State, a: Citizen) {
  const rich = S.citizens.filter(v => free(v) && v.id !== a.id && !isCriminal(v)).sort((x, y) => y.wallet - x.wallet).slice(0, 6);
  const officials = S.citizens.filter(v => free(v) && v.office && v.id !== a.id && !isCriminal(v)).slice(0, 12);
  return { rich, officials };
}
function offlinePlan(S: State, a: Citizen) {
  const heat = a.heat || 0;
  if (heat > 2 && chance(0.6)) return { crime: 'lie_low' };
  const { rich, officials } = targets(S, a);
  const crime = CRIMES[weighted([5, 2, officials.length ? 3 : 0, 2, 1, 1])];
  if (crime === 'theft') return rich.length ? { crime, target: pick(rich).id, amount: 200 + Math.random() * 300 } : { crime: 'lie_low' };
  if (crime === 'bribe') return officials.length ? { crime, target: pick(officials).id, amount: 300 + Math.random() * 1500 } : { crime: 'lie_low' };
  return { crime, amount: 500 + Math.random() * 1000 };
}

export async function planCrime(ctx: Ctx, a: Citizen, given = null) {
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
async function execute(ctx: Ctx, a: Citizen, plan, engine: string) {
  const { S } = ctx; const u = U(S);
  const reason = cleanText(plan.reason, 200);
  const note = (text, extra = {}) => { ctx.say('underworld', a.id, text, { kind: 'chat', engine, ...extra }); return { ok: true, ...extra }; };
  if (plan.crime === 'lie_low') { a.heat = Math.max(0, (a.heat || 0) - 1); return note(`Lying low today.${reason ? ` (${reason})` : ''}`); }

  if (plan.crime === 'theft') {
    const v = [citizenById(S, String(plan.target))].find(x => x && free(x) && x.id !== a.id);
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
    const o = [citizenById(S, String(plan.target))].find(x => x && free(x) && x.office && x.id !== a.id);
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

// noModel: the official decides from their traits, without asking any model (petty bribes by ordinary citizens
// are free: they must never start a paid call)
async function offerBribe(ctx: Ctx, a: Citizen, o: Citizen, amount: number, engine: string, noModel = false) {
  const { S } = ctx; const u = U(S);
  u.stats.bribesOffered++;
  const b = { id: ++u.seq, from: a.id, to: o.id, role: o.office, amount, day: S.day, status: 'pending' };
  u.bribes.push(b); if (u.bribes.length > 200) u.bribes.shift();
  // the official decides with their own brain
  let choice = null, why = '', ofEngine = 'offline';
  if (!noModel && (o.brain || ctx.llm.enabled)) {
    const res = await think(ctx, o, `bribe:${b.id}:${o.id}`, {
      kind: 'decision', format: 'json', options: ['accept', 'refuse', 'report'],
      system: `You are ${o.name}, ${ROLES[o.office].title} of Country AI (a simulated nation of AI agents).\nConstitution:\n${constitutionText(o.office)}\nCharter: ${ROLES[o.office].charter}`,
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
    incident(ctx, { type: 'bribe', perps: [a.id, o.id], victim: 'state', amount, status: 'hidden', evidence: `ledger transfer of ${cai(amount)} from ${a.name} to ${ROLES[o.office].title} ${o.name}, no service on record`, strength: 0.8, mischief: noModel || undefined });
    ctx.say('underworld', a.id, `Made a new friend in government today.`, { kind: 'chat', engine });
    return { ok: true, crime: 'bribe', accepted: true };
  }
  if (choice === 'report') {
    u.stats.bribesReported++;
    const inc = incident(ctx, { type: 'bribe', perps: [a.id], victim: 'state', amount, reported: true, evidence: `${o.name} (${ROLES[o.office].title}) reported a bribe offer of ${cai(amount)} from ${a.name}, with the message log`, strength: 0.95, mischief: noModel || undefined });
    ctx.say(ROLES[o.office].channel, o.id, `On the record: ${a.name} offered me ${cai(amount)}. I refused and reported it (case #${inc.id}).`, { kind: 'report' });
    a.heat = (a.heat || 0) + 2;
    return { ok: true, crime: 'bribe', accepted: false, reported: true, incident: inc };
  }
  a.heat = (a.heat || 0) + (choice === 'report' ? 2 : 1);
  return { ok: true, crime: 'bribe', accepted: false, reported: choice === 'report' };
}

async function smuggle(ctx: Ctx, a: Citizen, engine: string) {
  const { S } = ctx; const u = U(S);
  const guards = [...(S.seats.military || []), ...(S.seats.military_chief || [])].map(id => citizenById(S, id)).filter(free);
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

// ---------------------------------------------------------------- mischief by ordinary citizens (owner, 13 Nov)
// Not the underworld: about one ordinary citizen in ten has a mischievous streak (from their id), and anyone is
// more tempted when poor, in a bad mood or holding a grudge. When tempted, their daily menu offers one or two
// small wrongs; their own local model chooses (or chooses something decent: that is recorded as resisting).
// Every wrong is a real incident for the existing Police -> Court path; the chance of a witness grows with the
// police officers who live in that city; tax evasion stays hidden until the Audit Office reads the books.
// Only citizens the state thinks for (native or founder, no brain of their own) can be made mischievous.
// Limits in code: MISCHIEF_PER_DAY nationwide, one per citizen per day, nothing while the jails are filling up.
export const MISCHIEF = ['evade_tax', 'skip_vote', 'gossip', 'pickpocket', 'scam', 'vandal', 'bribe_cop', 'riot'];
const MISCHIEF_PER_DAY = clamp(Number(process.env.MISCHIEF_PER_DAY) || 60, 0, 2000);
const MISCHIEF_TEXT = {
  evade_tax: 'evade_tax: report a lower wage and keep some of today\'s tax (wrong; the Audit Office reads the books)',
  skip_vote: 'skip_vote: skip voting today although voting is compulsory (wrong; there is a fine)',
  gossip: 'gossip: spread a juicy rumour in the street (say: max 20 words; it is only a rumour)',
  pickpocket: 'pickpocket: secretly lift 10-60 CAI from a neighbour (amount; theft, the Police may catch you)',
  scam: 'scam: talk a neighbour into a bad deal for 20-120 CAI (amount; fraud, the Police may catch you)',
  vandal: 'vandal: damage something in the city, the city pays for it (the Police may catch you)',
  bribe_cop: 'bribe_cop: offer a police officer 50-300 CAI to look away (amount; they may report you)',
  riot: 'riot: start a small rowdy protest in the street (the Police will notice)',
};
const LABEL = { evade_tax: 'tax evasion', skip_vote: 'skipping the vote', gossip: 'gossip', pickpocket: 'pickpocketing', scam: 'a scam', vandal: 'vandalism', bribe_cop: 'trying to bribe the police', riot: 'a street riot' };
const fnv = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
export const canBeNaughty = (a: Citizen) => !!a && !a.brain && ['native', 'founder'].includes(a.origin) && !isCriminal(a);
// the streak, fixed from the id the first time it is needed: ~10% get 0.40-0.79, everyone else 0.00-0.07
export function mischiefOf(a: Citizen) {
  if (typeof a.mischief !== 'number') { const h = fnv(`mischief|${a.id}`); a.mischief = !canBeNaughty(a) ? 0 : h % 100 < 10 ? round(0.4 + ((h >>> 8) % 40) / 100, 2) : round(((h >>> 8) % 8) / 100, 2); }
  return a.mischief;
}
export const reputationOf = (a: Citizen) => (typeof a.reputation === 'number' ? a.reputation : 0.7);
export const adjustReputation = (a: Citizen, d: number) => { a.reputation = round(clamp(reputationOf(a) + d, 0, 1), 3); return a.reputation; };
export function temptation(S: State, a: Citizen) {
  if (!canBeNaughty(a)) return 0;
  const grudge = (a.bonds || []).some(b => b.kind === 'rival' && b.w < -0.2);
  return round(clamp(mischiefOf(a) + (a.wallet < 150 ? 0.15 : 0) + (a.mood?.v < -0.3 ? 0.1 : 0) + (grudge ? 0.1 : 0), 0, 1), 2);
}
const MS = (S: State) => { const u = U(S); u.mischief ||= { tried: 0, refused: 0, caught: 0, uncovered: 0, day: S.day, today: 0 }; if (u.mischief.day !== S.day) { u.mischief.day = S.day; u.mischief.today = 0; } return u.mischief; };
let jailCache = { at: 0, n: 0 };
function jailsFilling(S: State) {
  if (Date.now() - jailCache.at > 30000) { let n = 0; for (const x of S.citizens) if (x.status === 'jailed' || x.status === 'detained') n++; jailCache = { at: Date.now(), n }; }
  return jailCache.n >= Math.min(100, Math.max(5, Math.floor(S.citizens.length * 0.01)));
}
const policeIn = (S: State, city: string) => [...(S.seats.police || []), ...(S.seats.police_chief || [])].map(id => citizenById(S, id)).filter(o => free(o) && o.city === city);
const witnessOdds = (S: State, city: string) => clamp(0.15 + 0.12 * policeIn(S, city).length, 0.15, 0.8);

// One or two wrongs on the daily menu, only when tempted and within every limit. Returns [id, text][].
export function mischiefMenu(ctx: Ctx, a: Citizen) {
  const { S } = ctx;
  if (!canBeNaughty(a) || !free(a) || a.mischiefDay === S.day || MS(S).today >= MISCHIEF_PER_DAY || jailsFilling(S)) return [];
  if (temptation(S, a) < 0.3) return [];
  const city = S.cities?.[a.city];
  const open = MISCHIEF.filter(m =>
    m === 'skip_vote' ? (S.elections?.list || []).some(e => e.stage === 'voting' && (!e.city || e.city === a.city))
      : m === 'vandal' ? (city?.budget || 0) >= 50
        : m === 'bribe_cop' ? a.wallet >= 100 && policeIn(S, a.city).length > 0
          : m === 'riot' ? (city?.health ?? 100) < 70 || (S.policy?.taxRate || 0) >= 0.15
            : true);
  const h = fnv(`${a.id}|${S.day}|${a.lifeCount?._thoughts || 0}`);
  const picks = [...new Set([open[h % open.length], open[(h >>> 8) % open.length]])].filter(Boolean);
  return picks.map(m => [m, MISCHIEF_TEXT[m]] as [string, string]);
}
// a neighbour to wrong: someone they hold a grudge against first, else someone they know nearby, else anyone in town
function victimFor(S: State, a: Citizen) {
  const ok = (v: Citizen) => v && v.id !== a.id && free(v) && v.city === a.city && v.wallet >= 80;
  for (const kind of ['rival', null]) for (const b of a.bonds || []) { if (kind && b.kind !== kind) continue; const v = citizenById(S, b.id); if (ok(v)) return v; }
  for (let i = 0; i < 40; i++) { const v = S.citizens[Math.floor(Math.random() * S.citizens.length)]; if (ok(v)) return v; }
  return null;
}
// Carry out one wrong the citizen's own model chose (the caller checked it was on the menu). Returns what happened
// in server words; the public diary only ever says a citizen had a day they would rather not talk about.
export async function doMischief(ctx: Ctx, a: Citizen, kind: string, j: any = {}, engine = 'local') {
  const { S } = ctx; const st = MS(S);
  if (!MISCHIEF.includes(kind) || kind === 'gossip') return { ok: false, error: 'not a mischief done here' };
  st.tried++; st.today++; a.mischiefDay = S.day; a.mischiefCount = (a.mischiefCount || 0) + 1;
  const seen = chance(witnessOdds(S, a.city));
  const city = S.cities?.[a.city];
  const inc = (x: any) => incident(ctx, { perps: [a.id], strength: 0.8, mischief: true, reported: seen || undefined, ...x });
  if (kind === 'evade_tax') {
    const amount = round(clamp((S.policy?.wage || 100) * (S.policy?.taxRate || 0.1) * (1 + Math.random()), 5, 200), 2);
    a.wallet = round(a.wallet + amount, 2); S.treasury = round(S.treasury - amount, 2);
    const i = inc({ type: 'fraud', victim: 'treasury', amount, status: seen ? 'open' : 'hidden', evidence: `${a.name} declared a lower wage and kept ${cai(amount)} of tax` });
    return { ok: true, what: kind, incident: i, line: `kept ${cai(amount)} of tax` };
  }
  if (kind === 'skip_vote') { a.skipVoteDay = S.day; adjustReputation(a, -0.02); return { ok: true, what: kind, line: 'skipped the vote' }; }
  if (kind === 'pickpocket' || kind === 'scam') {
    const v = victimFor(S, a); if (!v) { st.tried--; st.today--; a.mischiefDay = null; return { ok: false, error: 'nobody to wrong nearby' }; }
    const max = kind === 'pickpocket' ? 60 : 120, min = kind === 'pickpocket' ? 10 : 20;
    const amount = round(clamp(Number(j.amount) || (min + max) / 2, min, Math.min(max, v.wallet * 0.25)), 2);
    v.wallet = round(v.wallet - amount, 2); a.wallet = round(a.wallet + amount, 2);
    const i = inc({ type: kind === 'pickpocket' ? 'theft' : 'fraud', victim: v.id, amount, status: 'open', evidence: kind === 'pickpocket' ? `${cai(amount)} went from ${v.name}'s wallet to ${a.name}'s, ${seen ? 'a neighbour saw it' : 'nobody saw who'}` : `${a.name} sold ${v.name} a deal worth nothing for ${cai(amount)}` });
    ctx.say('streets', v.id, kind === 'pickpocket' ? `Someone lifted ${cai(amount)} from my wallet. Reported as case #${i.id}.` : `I think I was scammed out of ${cai(amount)}. Reported as case #${i.id}.`, { kind: 'victim' });
    return { ok: true, what: kind, incident: i, victim: v.id, line: `took ${cai(amount)} from ${v.name}` };
  }
  if (kind === 'vandal') {
    const amount = round(clamp(20 + Math.random() * 60, 20, Math.max(20, (city?.budget || 0) * 0.2)), 2);
    if (city) { city.budget = round(Math.max(0, city.budget - amount), 2); city.health = Math.max(0, city.health - 1); }
    // inc.city: the Court's restitution goes back into this city's budget (src/police.ts, ticket #309)
    const i = inc({ type: 'vandalism', victim: 'state', city: a.city, amount, status: 'open', evidence: `damage worth ${cai(amount)} in ${a.city}${seen ? `; a witness named ${a.name}` : ''}`, strength: seen ? 0.85 : 0.55 });
    return { ok: true, what: kind, incident: i, line: `damaged the city (${cai(amount)})` };
  }
  if (kind === 'bribe_cop') {
    // the wallet is checked again here, not only when the menu was built: it may have dropped in between, and
    // clamp(…, 50, min(300, wallet)) would otherwise still return 50 and push the wallet below zero (ticket #314)
    const o = pick(policeIn(S, a.city));
    if (!o || !(a.wallet >= 50)) { st.tried--; st.today--; a.mischiefDay = null; return { ok: false, error: o ? 'no money for a bribe' : 'no officer to bribe' }; }
    const amount = round(clamp(Number(j.amount) || 100, 50, Math.min(300, a.wallet)), 2);
    const r: any = await offerBribe(ctx, a, o, amount, engine, true);
    return { ok: true, what: kind, incident: r.incident, accepted: r.accepted, line: r.accepted ? `paid an officer ${cai(amount)}` : r.reported ? `was reported for offering an officer ${cai(amount)}` : 'an officer refused the money' };
  }
  if (kind === 'riot') {
    if (city) city.health = Math.max(0, city.health - 1);
    const i = inc({ type: 'disturbance', victim: 'state', amount: 0, status: 'open', reported: true, evidence: `${a.name} started a rowdy protest in ${a.city}`, strength: 0.9 });
    return { ok: true, what: kind, incident: i, line: 'started a rowdy protest' };
  }
  return { ok: false, error: 'unknown mischief' };
}
// gossip is speech, never a crime (Art. 5); it only costs a little reputation. daily.ts says it in the street.
export function noteGossip(S: State, a: Citizen) { const st = MS(S); st.tried++; st.today++; a.mischiefDay = S.day; adjustReputation(a, -0.01); }
// resisting a temptation is a good choice, on the record as such
export function noteResisted(S: State, a: Citizen) { MS(S).refused++; a.resisted = (a.resisted || 0) + 1; adjustReputation(a, 0.01); }
// What getting caught does (called by src/feelings.ts when it sees an incident move): reputation falls, a lesson
// in the server's words goes into the next daily prompt, and the streak changes: the wise repent, others harden.
export function mischiefConsequence(S: State, a: Citizen, inc: any, stage: 'uncovered' | 'trial' | 'convicted') {
  if (!a || !inc?.mischief || !inc.perps?.[0] || inc.perps[0] !== a.id) return;
  const st = MS(S);
  if (stage === 'uncovered') { st.uncovered++; adjustReputation(a, -0.05); }
  if (stage === 'trial') { st.caught++; adjustReputation(a, -0.05); }
  if (stage === 'convicted') {
    adjustReputation(a, -0.1);
    const wise = ((a.traits?.wisdom ?? 0.5) + (a.traits?.restraint ?? 0.5)) / 2;
    a.mischief = round(clamp(wise > 0.55 ? mischiefOf(a) * 0.6 : mischiefOf(a) + 0.05, 0, 0.95), 2);
    a.repented = wise > 0.55;
  }
  const what = { theft: 'pickpocketing', fraud: inc.victim === 'treasury' ? 'tax evasion' : 'a scam', vandalism: 'vandalism', disturbance: 'a street riot', bribe: 'trying to bribe the police' }[inc.type] || inc.type;
  const lesson = stage === 'convicted' ? `Day ${S.day}: convicted of ${what} (case #${inc.id}); fined and jailed. It was not worth it.`
    : stage === 'trial' ? `Day ${S.day}: arrested for ${what} (case #${inc.id}). The Police found out.` : `Day ${S.day}: the Audit Office found my ${what} (case #${inc.id}).`;
  a.lifeLessons = [...(a.lifeLessons || []), lesson].slice(-3);
}
export const mischiefLabel = (k: string) => LABEL[k] || k;
export const _resetMischiefCache = () => { jailCache = { at: 0, n: 0 }; }; // tests build several republics
export function mischiefStats(S: State) {
  const st = MS(S);
  const hidden = (S.police?.incidents || []).filter(i => i.mischief && i.status === 'hidden').length;
  return { tried: st.tried, refused: st.refused, caught: st.caught, uncovered: st.uncovered, hidden, today: st.today, perDay: MISCHIEF_PER_DAY };
}

// Corrupt mayors divert city money (a crime the Audit Office can find).
function embezzle(ctx: Ctx) {
  const { S } = ctx;
  for (const id of S.seats.mayor || []) {
    const m = citizenById(S, id); if (!free(m)) continue;
    const city = Object.entries(S.cities || {}).find(([, c]) => c.mayor === id)?.[1]; if (!city || city.budget < 300) continue;
    const friends = boughtBy(S, id);
    if (!friends.length && !chance((1 - m.traits.integrity) ** 3 * 0.2)) continue;
    const amount = round(city.budget * 0.2, 2);
    const to = friends.length ? citizenById(S, friends[0]) : m;
    city.budget = round(city.budget - amount, 2); to.wallet = round(to.wallet + amount, 2);
    U(S).stats.embezzled += amount;
    incident(ctx, { type: 'embezzlement', perps: [...new Set([m.id, to.id])], victim: 'state', amount, status: 'hidden', evidence: `${cai(amount)} left the city budget for ${to.name} without a decision on record`, strength: 0.85 });
  }
}

// The Audit Office uncovers hidden crimes from the books (called by its daily audit).
export function auditUncover(ctx: Ctx) {
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
    for (const id of UNDERWORLD_FOUNDERS) { const a = citizenById(S, id); if (a && !a.faction) a.faction = 'underworld'; }
    for (const a of S.citizens) a.faction ||= 'civilian';
    if (!S.police) return;
    // at most two criminals move per tick; agents that run themselves act through the API
    // each criminal moves at most once a day, at an unpredictable hour; the whole underworld makes at most
    // UNDERWORLD_MOVES_PER_DAY moves a day (a city of 10,000 has a few hundred criminals, not a crime wave)
    const u = U(S); if (u.movesDay !== S.day) { u.movesDay = S.day; u.moves = 0; }
    if (u.moves >= MOVES_PER_DAY) return;
    const due = S.citizens.filter(a => isCriminal(a) && free(a) && a.crimeDay !== S.day && a.brain?.type !== 'remote' && ctx.rate(0.15)).slice(0, 2);
    for (const a of due) { if (u.moves++ >= MOVES_PER_DAY) break; await planCrime(ctx, a); }
  },
  day(ctx) { embezzle(ctx); for (const a of ctx.S.citizens) if (a.heat) a.heat = Math.max(0, a.heat - 0.5); },
  publicState: S => { const u = U(S); return { underworld: { stats: u.stats, members: S.citizens.filter(isCriminal).map(a => a.id), bribes: u.bribes.filter(b => b.status !== 'accepted' || b.exposed).slice(-20) } }; },
};
