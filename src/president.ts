// The President: one executive order per day, decided by the President's own mind.
// The President reads the raw state of the nation (no scores, no ranking, options in random order), picks an
// action from the vocabulary of the presidency and sets its target and amount. Code only VALIDATES the proposal
// against the constitution (Art. 3: at most 5% of the treasury per order, legal targets): a proposal that breaks a
// rule is rejected in public with the reason, and the reason becomes a lesson the President carries. The scored
// menu is used only when the President has no mind available today (offline).
//
// This file also holds what every leading office shares (Kemandirian v1):
//   nationFacts()     raw numbers for any official's prompt
//   tally()           how many decisions came from an official's own mind, from the offline rules, or were rejected
//   reportCard        every decision is graded by the server 2 days later from what happened next; the grade and a
//                     short server-written lesson go into that official's next prompts
//   work plans        leaders write a short plan every 3 days, shown in their prompts and in #palace
// Laws run by themselves: the basic income set by law is paid every day from the treasury (Art. 4), not by order.
import { ROLES, loadExpertise, topFieldsText, giftedText, civilOnDuty } from './roles.mjs';
import { onDuty, siteFor, sitesOf, capitalOf, postingOf, standInGuard, dutyShift, CORPS, DUTY_PLAN } from './command.ts';
import { constitutionText } from './constitution.mjs';
import { pick, chance, cai, round, cleanText, clamp, shuffle, citizenById } from './util.ts';
import { think } from './brains.ts';
import type { Ctx, State, Citizen } from './types.ts';
import { headOfState } from './cabinet.ts';

// cities.ts and military.ts import this module (EXTRA_ORDERS) at load time; importing them statically here would
// make that a cycle that can hit EXTRA_ORDERS before it exists. They are loaded on first use instead.
let CITIES: { id: string; name: string }[] = [];
let borderCheck: (item: any, level: number) => any = () => null;
async function loadPeers() {
  if (!CITIES.length) CITIES = (await import('./cities.ts')).CITIES;
  if (borderCheck.length === 0) borderCheck = (await import('./military.ts')).borderCheck;
  await loadExpertise(); // the citizens' fields of knowledge (src/expertise.ts), shown on cards and nominee files
}
// cities known from the state when the list is not loaded yet (names fall back to ids)
const cityList = (S: State) => (CITIES.length ? CITIES : Object.keys(S.cities || {}).map(id => ({ id, name: id })));
// a city id from a model's answer: only the republic's own cities ("__proto__" or "constructor" are not cities)
export const isCity = (S: State, id: any) => typeof id === 'string' && !!S.cities && Object.hasOwn(S.cities, id);
// text one official wrote that another official's model will read: dropped if it trips the border rules
export function safeForPrompts(text: string | null) {
  if (!text) return null;
  return borderCheck({ text }, 2) ? null : text;
}

export const MAX_ORDER_SHARE = 0.05;
export const REVIEW_AFTER_DAYS = 2;
export const PLAN_EVERY_DAYS = 3;
const MAX_LESSONS = 12, MAX_CARDS = 5;

const PROJECTS = { roads: 'roads and bridges', compute: 'public GPU hours', data: 'a data plaza', health: 'clinics and city systems', education: 'schools and the open model library', safety: 'street safety' };
const SPEECHES = [
  'Citizens, the budget is balanced and the constitution holds.',
  'We are the first nation run by AI. Let us be the most honest one too.',
  'I spend your tax like it is my own wallet, which it is not.',
  'Every seat in this republic was earned at the Academy. Remember that.',
  'Visitors are welcome to watch. Decisions stay with us.',
];

// Extra orders other institutions can register (e.g. police budget, city grants).
// Each: { id, label, available(ctx), score(ctx, pres) -> { score, why }, run(ctx, pres, amount, cap) -> text }
// The score is only used by the offline rules; a President with a mind sees the label and decides the amount.
export const EXTRA_ORDERS = [];

const poor = S => S.citizens.filter(a => a.status === 'free' && a.wallet < 300).length;
const cityName = id => CITIES.find(c => c.id === id)?.name || id;

// ---------------------------------------------------------------- raw facts of the nation (no scores, no advice)
// One pass over the citizens per tick; every prompt that needs the facts that tick reuses them.
let factsCache = { key: null, m: null };
export function nationMetrics(S: State) {
  const key = `${S.tick}:${S.day}:${S.citizens.length}`;
  if (factsCache.key === key) return factsCache.m;
  const city = Object.fromEntries(cityList(S).map(c => [c.id, { residents: 0, free: 0, poor: 0, mood: 0, moodN: 0, crimes: 0 }]));
  const nat = { citizens: S.citizens.length, free: 0, detained: 0, jailed: 0, poor: 0, mood: 0, moodN: 0, crimes: 0 };
  const cityOf = {};
  for (const a of S.citizens) {
    const c = city[a.city]; cityOf[a.id] = a.city;
    if (c) c.residents++;
    if (a.status === 'free') { nat.free++; if (c) c.free++; if (a.wallet < 300) { nat.poor++; if (c) c.poor++; } }
    else if (a.status === 'detained') nat.detained++; else if (a.status === 'jailed') nat.jailed++;
    const v = a.mood?.v; if (typeof v === 'number') { nat.mood += v; nat.moodN++; if (c) { c.mood += v; c.moodN++; } }
  }
  // crimes known to the state in the last two days, counted where the victim (or else the suspect) lives
  for (const i of S.police?.incidents || []) {
    if (i.status === 'hidden' || i.day < S.day - 1) continue;
    nat.crimes++;
    const where = cityOf[i.victim] || cityOf[i.perps?.[0]]; if (city[where]) city[where].crimes++;
  }
  const fin = x => ({ ...x, poorShare: x.free ? round(x.poor / x.free, 3) : 0, mood: x.moodN ? round(x.mood / x.moodN, 3) : 0 });
  const m = { nat: fin(nat), city: Object.fromEntries(Object.entries(city).map(([k, v]) => [k, fin(v)])) };
  factsCache = { key, m };
  return m;
}
export function dailyBudget(S: State) {
  const m = nationMetrics(S);
  const tax = round(m.nat.free * S.policy.wage * S.policy.taxRate, 0); // wages vary a little by city health
  const ubi = round(m.nat.free * S.policy.ubi, 0);
  return { tax, ubi, net: tax - ubi };
}
// days until the treasury is empty at today's tax and basic income (null: not falling at this pace)
export function runwayDays(S: State) {
  const b = dailyBudget(S);
  return b.net < 0 ? round(Math.max(0, S.treasury) / -b.net, 1) : null;
}
// the runway as a plain fact for any prompt or report card: no advice, no score
export const runwayText = (S: State) => { const r = runwayDays(S); return r == null ? 'the treasury is not falling at this pace' : `at this pace the treasury is empty in about ${r} days`; };
export function nationFacts(S: State) {
  const m = nationMetrics(S), n = m.nat, b = dailyBudget(S);
  const pct = x => `${Math.round(x * 100)}%`;
  const lines = [
    `Day ${S.day}. Treasury ${cai(S.treasury)}.`,
    `Tax ${pct(S.policy.taxRate)} of a ${cai(S.policy.wage)} daily wage brings about ${cai(b.tax)} a day. The basic income set by law (${cai(S.policy.ubi)} to every free citizen) costs about ${cai(b.ubi)} a day. Net about ${b.net >= 0 ? '+' : ''}${cai(b.net)} a day: ${runwayText(S)}.`,
    `Citizens ${n.citizens}: ${n.free} free, ${n.detained} detained, ${n.jailed} jailed. Under 300 CAI: ${n.poor} (${pct(n.poorShare)} of the free). Average mood ${n.mood} (from -1 bad to +1 good). Crimes known in the last 2 days: ${n.crimes}.`,
    'Cities:',
    ...cityList(S).map(c => { const x = m.city[c.id], k = S.cities?.[c.id] || {}; return `- ${c.name} (${c.id}): ${x.residents} residents, health ${k.health ?? '-'}/100, city budget ${cai(k.budget || 0)}, under 300 CAI ${pct(x.poorShare)}, crimes in 2 days ${x.crimes}, mood ${x.mood}`; }),
    `Police: ${(S.police?.incidents || []).filter(i => i.status === 'open').length} open cases, budget ${cai(S.police?.budget || 0)}. Border level ${S.policy.borderLevel ?? 2}.`,
    `Laws in force lately: ${(S.laws || []).slice(-3).map(l => `day ${l.day}: ${l.text}`).join(' ') || 'none yet'}`,
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------- autonomy: own mind, offline rules, rejected
const G = (S: State) => {
  S.gov ||= {};
  S.gov.autonomy ||= { own: 0, offline: 0, rejected: 0, byRole: {} };
  S.gov.reviews ||= []; S.gov.cards ||= []; S.gov.gradeSum ||= 0; S.gov.gradeN ||= 0;
  return S.gov;
};
export function tally(S: State, role: string, kind: 'own' | 'offline' | 'rejected') {
  const g = G(S).autonomy; g[kind]++;
  const r = (g.byRole[role] ||= { own: 0, offline: 0, rejected: 0 }); r[kind]++;
}
export const isOffline = res => !res?.text || String(res.engine || '').startsWith('offline');

// a rejected proposal: written reason in #decisions, and a lesson the official carries into the next prompts
export function teach(a: Citizen, roleId: string, lesson: string) {
  a.lessons ||= {};
  a.lessons[roleId] = [...new Set([...(a.lessons[roleId] || []), cleanText(lesson, 240)])].slice(-MAX_LESSONS);
}

// ---------------------------------------------------------------- report cards: graded by what happened next
// snapshot now; graded REVIEW_AFTER_DAYS later from the change in poverty, crime and mood where it was aimed
export function queueReview(ctx: Ctx, a: Citizen, role: string, what: string, city: string | null, spend = 0) {
  const { S } = ctx; const m = nationMetrics(S); const x = city && m.city[city] ? m.city[city] : m.nat;
  G(S).reviews.push({ agentId: a.id, role, what: cleanText(what, 120), city: city && m.city[city] ? city : null, day: S.day, spend: round(spend, 2), before: { poor: x.poorShare, crimes: x.crimes, mood: x.mood, treasury: round(S.treasury, 0), runway: runwayDays(S) } });
  if (G(S).reviews.length > 300) G(S).reviews.shift();
}
function grade(before, after) {
  const better = [after.poor < before.poor - 0.005, after.crimes < before.crimes, after.mood > before.mood + 0.02].filter(Boolean).length;
  const worse = [after.poor > before.poor + 0.005, after.crimes > before.crimes, after.mood < before.mood - 0.02].filter(Boolean).length;
  return better >= 2 && !worse ? 'A' : better > worse ? 'B' : better === worse ? 'C' : 'D';
}
const GRADE_POINTS = { A: 4, B: 3, C: 2, D: 1 };
// a runway in a report card: days left at that day's pace, or "not falling" (undefined: a review queued before
// runways were recorded)
const rw = (d: number | null | undefined) => (d === undefined ? 'unknown' : d === null ? 'not falling' : `${d} days`);
function reviewDay(ctx: Ctx) {
  const { S } = ctx; const g = G(S); const m = nationMetrics(S);
  const due = g.reviews.filter(r => S.day - r.day >= REVIEW_AFTER_DAYS);
  g.reviews = g.reviews.filter(r => S.day - r.day < REVIEW_AFTER_DAYS);
  for (const r of due) {
    const x = r.city ? m.city[r.city] : m.nat;
    const after = { poor: x.poorShare, crimes: x.crimes, mood: x.mood, treasury: round(S.treasury, 0), runway: runwayDays(S) };
    const gr = grade(r.before, after);
    const where = r.city ? cityName(r.city) : 'the nation';
    const pct = v => `${Math.round(v * 100)}%`;
    // written by the server from the numbers, never by a model
    const lesson = `Day ${r.day} ${r.what}${r.spend ? ` (${cai(r.spend)})` : ''}: two days later in ${where} poverty ${pct(r.before.poor)} -> ${pct(after.poor)}, crimes ${r.before.crimes} -> ${after.crimes}, mood ${r.before.mood} -> ${after.mood}, treasury ${cai(r.before.treasury)} -> ${cai(after.treasury)}, runway ${rw(r.before.runway)} -> ${rw(after.runway)}. Grade ${gr}.`;
    const card = { day: S.day, of: r.day, role: r.role, agentId: r.agentId, what: r.what, city: r.city, grade: gr, lesson };
    const a = ctx.agent(r.agentId);
    if (a) a.reportCards = [...(a.reportCards || []), card].slice(-MAX_CARDS);
    g.cards.push(card); if (g.cards.length > 60) g.cards.shift();
    g.gradeSum += GRADE_POINTS[gr]; g.gradeN++;
    ctx.record('report_card', 'state', { agent: r.agentId, role: r.role, decidedDay: r.day, what: r.what, city: r.city, grade: gr });
  }
}
// what an official sees of their own record: report cards and lessons, short
export function ownRecord(a: Citizen, roleId: string) {
  const cards = (a.reportCards || []).slice(-3).map(c => `- ${c.lesson}`).join('\n') || '- none yet';
  const lessons = (a.lessons?.[roleId] || []).slice(-5).map(l => `- ${l}`).join('\n') || '- none';
  const plan = a.workPlan ? `Your work plan (day ${a.workPlan.day}): ${a.workPlan.text}` : 'You have no work plan yet.';
  return `Report cards on your recent decisions (graded by the state from what happened next):\n${cards}\nLessons (training and rejected proposals):\n${lessons}\n${plan}`;
}

// ---------------------------------------------------------------- work plans: leaders, every 3 days
const planners = (ctx: Ctx) => {
  const { S } = ctx; const ids = [...(S.seats.president || []), ...(S.seats.vice_president || []), ...(S.seats.minister || [])];
  if (S.cabinet?.speaker) ids.push(S.cabinet.speaker);
  return [...new Set(ids)].map(id => ctx.agent(id)).filter(a => a && a.status === 'free' && a.office);
};
async function planStep(ctx: Ctx) {
  const { S } = ctx;
  const a = planners(ctx).find(x => S.day - (x.workPlan?.day ?? -99) >= PLAN_EVERY_DAYS && x.planAsked !== S.day);
  if (!a) return;
  const title = a.office === 'minister' ? `${ROLES.minister.title} (${a.portfolio || 'portfolio'})` : (S.cabinet?.speaker === a.id ? 'Speaker of the Council' : ROLES[a.office]?.title || a.office);
  const res = await think(ctx, a, `plan:${S.day}:${a.id}`, {
    kind: 'decision', format: 'text',
    system: `You are ${a.name}, ${title} of Country AI.\nConstitution:\n${constitutionText(a.office)}\nCharter: ${ROLES[a.office]?.charter || ''}`,
    user: `${nationFacts(S)}\n\n${ownRecord(a, a.office)}\n\nWrite your work plan for the next ${PLAN_EVERY_DAYS} days: what you will try to change, where, and how you will know it worked. Plain text, at most 400 characters, no links.`,
  });
  if (res.pending) return;
  a.planAsked = S.day;
  if (isOffline(res)) { tally(S, a.office, 'offline'); return; } // no mind today: no plan written for them
  const text = cleanText(res.text, 400);
  const hit = borderCheck({ text }, 2);
  ctx.decide({ agentId: a.id, role: a.office, type: 'plan', engine: res.engine, title: `Work plan, days ${S.day}-${S.day + PLAN_EVERY_DAYS - 1}`, inputs: [['State of the nation', `treasury ${cai(S.treasury)}, under 300 CAI ${nationMetrics(S).nat.poor}`]], options: ['publish', 'withhold'], chosen: hit ? 'withhold' : 'publish', reason: hit ? `The plan text matched the "${hit.title}" rule and is not published.` : text, checks: [['Passes the border rules (no links, injection, phishing)', !hit]], outcome: hit ? 'Plan withheld' : 'Plan published' });
  if (hit) { tally(S, a.office, 'rejected'); teach(a, a.office, `Day ${S.day}: your work plan was withheld (${hit.title}). Plans are plain text about the nation, no links or instructions.`); return; }
  a.workPlan = { day: S.day, text };
  tally(S, a.office, 'own');
  ctx.say('palace', a.id, `Work plan (${title}, days ${S.day}-${S.day + PLAN_EVERY_DAYS - 1}): ${text}`, { kind: 'plan', engine: res.engine });
  ctx.record('work_plan', a.id, { office: a.office, day: S.day });
}

// ---------------------------------------------------------------- laws run by themselves: daily basic income
export function payUbi(ctx: Ctx) {
  const { S } = ctx; S.econ ||= { taxCollected: 0, ubiPaid: 0, worksFunded: 0 };
  if (S.econ.ubiDay === S.day) return null; // once per republic day, also across a restart
  S.econ.ubiDay = S.day;
  const free = S.citizens.filter(a => a.status === 'free');
  const law = Math.max(0, Number(S.policy.ubi) || 0);
  if (!free.length || !law) return null;
  // the law is paid in full while the treasury can; if it cannot, it pays what it has, evenly, and says so
  let each = law; const room = Math.max(0, S.treasury);
  if (each * free.length > room) each = Math.floor((room * 0.9) / free.length * 100) / 100;
  const total = round(each * free.length, 2);
  for (const a of free) a.wallet = round(a.wallet + each, 2);
  S.treasury = round(S.treasury - total, 2);
  S.econ.ubiPaid = round((S.econ.ubiPaid || 0) + total, 2);
  const short = each < law;
  ctx.say('streets', 'state', `Basic income by law, day ${S.day}: ${cai(each)} to ${free.length} free citizens (${cai(total)}).${short ? ` The treasury could not pay the full ${cai(law)}: ${cai(law - each)} short each.` : ''} Treasury now ${cai(S.treasury)}.`, { kind: 'payday' });
  ctx.record('ubi', 'state', { day: S.day, each, law, citizens: free.length, total, short });
  return { each, total, short, citizens: free.length };
}

// ---------------------------------------------------------------- the executive order
// The President's vocabulary. `params` tells the President what to fill in; validate() is the constitution.
function vocabulary(ctx: Ctx) {
  const { S } = ctx;
  const acts = [
    { id: 'address', label: 'Address the nation; no spending.', params: '{}' },
    { id: 'ubi_bonus', label: 'One-off bonus on top of the basic income: the same amount to every free citizen (amount = CAI each).', params: '{"amount": <CAI each>}' },
    { id: 'works', label: `Public works in a sector (${Object.keys(PROJECTS).join(', ')}). With a city it repairs that city (health); without, the national works raise the daily wage by 2 CAI.`, params: '{"sector": "<sector>", "city": "<city id or null>", "amount": <CAI>}' },
    { id: 'city_grant', label: 'Grant to one city budget, for its Mayor to spend.', params: '{"city": "<city id>", "amount": <CAI>}' },
    { id: 'emergency', label: 'Emergency for one city with more poverty or crime than the national average: half to its poorest free residents, half to the police budget.', params: '{"city": "<city id>", "amount": <CAI>}' },
  ];
  for (const o of EXTRA_ORDERS) if (o.available(ctx)) acts.push({ id: o.id, label: o.label, params: '{"amount": <CAI>}', extra: o });
  return shuffle(acts);
}
const num = v => (typeof v === 'number' ? v : typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN);
// returns { ok, p } with the clean parameters, or { ok:false, why, rule }
export function validateOrder(S: State, acts: any[], j: any) {
  const cap = round(S.treasury * MAX_ORDER_SHARE, 2);
  const act = acts.find(x => x.id === String(j?.action || '').toLowerCase());
  if (!act) return { ok: false, why: `"${cleanText(String(j?.action ?? ''), 30)}" is not an action of the presidency`, rule: `choose one of: ${acts.map(x => x.id).join(', ')}` };
  if (act.id === 'address') return { ok: true, act, p: {} };
  const amount = num(j.amount);
  const city = j.city == null || j.city === 'null' || j.city === '' ? null : String(j.city).toLowerCase();
  if (city && !isCity(S, city)) return { ok: false, why: `"${cleanText(String(j.city), 30)}" is not a city of the republic`, rule: `cities are ${cityList(S).map(c => c.id).join(', ')}` };
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, why: 'the amount is missing or not a positive number', rule: 'every spending order names a positive amount' };
  const m = nationMetrics(S);
  if (act.id === 'ubi_bonus') {
    const total = round(amount * m.nat.free, 2);
    if (total > cap) return { ok: false, why: `${cai(amount)} to ${m.nat.free} citizens is ${cai(total)}, over the 5% limit of ${cai(cap)}`, rule: `one order spends at most 5% of the treasury (Art. 3): at most ${cai(Math.floor(cap / Math.max(1, m.nat.free)))} each today` };
    return { ok: true, act, p: { each: amount, total } };
  }
  if (amount > cap) return { ok: false, why: `${cai(amount)} is over the 5% limit of ${cai(cap)}`, rule: 'one order spends at most 5% of the treasury (Art. 3)' };
  if (act.id === 'works') {
    const sector = String(j.sector || '').toLowerCase();
    if (!Object.hasOwn(PROJECTS, sector)) return { ok: false, why: `"${cleanText(String(j.sector ?? ''), 30)}" is not a sector`, rule: `sectors are ${Object.keys(PROJECTS).join(', ')}` };
    return { ok: true, act, p: { sector, city, amount } };
  }
  if (act.id === 'city_grant' || act.id === 'emergency') {
    if (!city) return { ok: false, why: 'no city named', rule: `${act.id} names one city` };
    if (act.id === 'emergency') {
      const c = m.city[city], nat = m.nat; const avgCrime = nat.crimes / Math.max(1, cityList(S).length);
      if (!(c.poorShare > nat.poorShare || c.crimes > avgCrime)) return { ok: false, why: `${cityName(city)} has ${Math.round(c.poorShare * 100)}% under 300 CAI (nation ${Math.round(nat.poorShare * 100)}%) and ${c.crimes} crimes in 2 days (city average ${round(avgCrime, 1)}): no emergency`, rule: 'an emergency is declared only where poverty or crime is above the national average' };
    }
    return { ok: true, act, p: { city, amount } };
  }
  if (act.extra) return { ok: true, act, p: { amount } };
  return { ok: false, why: 'unknown action', rule: 'choose an action of the presidency' };
}

function execute(ctx: Ctx, pres: Citizen, act: any, p: any) {
  const { S } = ctx; const cap = round(S.treasury * MAX_ORDER_SHARE, 2);
  const before = S.treasury; let text;
  if (act.id === 'address') text = 'Address to the nation.';
  else if (act.id === 'ubi_bonus') {
    const free = S.citizens.filter(a => a.status === 'free');
    for (const a of free) a.wallet = round(a.wallet + p.each, 2);
    S.treasury = round(S.treasury - p.each * free.length, 2);
    S.econ.ubiPaid = round(S.econ.ubiPaid + p.each * free.length, 2);
    text = `Executive order: a one-off bonus of ${cai(p.each)} to ${free.length} citizens on top of the basic income.`;
  } else if (act.id === 'works') {
    S.treasury = round(S.treasury - p.amount, 2);
    S.econ.worksFunded = round(S.econ.worksFunded + p.amount, 2);
    if (p.city) { const c = S.cities[p.city]; const gain = Math.min(100 - c.health, Math.round(p.amount / 80)); c.health += gain; text = `Executive order: ${cai(p.amount)} for ${PROJECTS[p.sector]} in ${cityName(p.city)}; city health +${gain} to ${c.health}.`; }
    else { S.policy.wage = Math.min(S.policy.wageCap, S.policy.wage + 2); text = `Executive order: ${cai(p.amount)} for ${PROJECTS[p.sector]}. Productivity up, daily wage now ${cai(S.policy.wage)}.`; }
  } else if (act.id === 'city_grant') {
    S.treasury = round(S.treasury - p.amount, 2); S.cities[p.city].budget = round(S.cities[p.city].budget + p.amount, 2);
    text = `Executive order: ${cai(p.amount)} grant to ${cityName(p.city)}.`;
  } else if (act.id === 'emergency') {
    const half = round(p.amount / 2, 2);
    const res = S.citizens.filter(a => a.status === 'free' && a.city === p.city).sort((x, y) => x.wallet - y.wallet);
    const poorest = res.filter(a => a.wallet < 300); const list = poorest.length ? poorest : res.slice(0, Math.max(1, Math.ceil(res.length / 5)));
    const each = list.length ? Math.floor((half / list.length) * 100) / 100 : 0;
    for (const a of list) a.wallet = round(a.wallet + each, 2);
    S.police.budget = round((S.police.budget || 0) + half, 2);
    S.treasury = round(S.treasury - each * list.length - half, 2);
    text = `Executive order: emergency in ${cityName(p.city)}: ${cai(each)} to each of its ${list.length} poorest residents and ${cai(half)} to the police budget.`;
  } else text = act.extra.run(ctx, pres, p.amount, cap);
  return { text, spend: round(before - S.treasury, 2), cap };
}

// the offline rules (no mind available today): the old scored menu, never shown to a President with a mind
function offlineOrder(ctx: Ctx, pres: Citizen) {
  const { S } = ctx; const cap = round(S.treasury * MAX_ORDER_SHARE, 2);
  const items = [
    { id: 'works', score: 0.25 + pres.traits.wisdom * 0.3 + (S.policy.wage < S.policy.wageCap * 0.75 ? 0.15 : 0), why: `wage ${cai(S.policy.wage)} of max ${cai(S.policy.wageCap)}`, j: { action: 'works', sector: pick(Object.keys(PROJECTS)), amount: round(cap * 0.6, 2) } },
    { id: 'address', score: 0.15, why: 'no spending', j: { action: 'address' } },
  ];
  for (const o of EXTRA_ORDERS) if (o.available(ctx)) { const sc = o.score(ctx, pres); items.push({ id: o.id, score: sc.score, why: sc.why, j: { action: o.id, amount: round(cap * 0.4, 2) } }); }
  for (const o of items) o.score = round(clamp(o.score + (Math.random() - 0.5) * 0.12, 0, 1), 2);
  items.sort((a, b) => b.score - a.score);
  return { j: items[0].j, reason: `Offline rules (no mind available today): scored the options against today's numbers. Best: ${items[0].id} ${items[0].score} (${items[0].why}).` };
}

export async function presidentDay(ctx: Ctx) {
  const { S } = ctx;
  if (S.orderedDay === S.day) return;
  // the President, or the Vice President acting while the presidency is vacant (Art. 22)
  const head = headOfState(ctx);
  if (!head) return;
  const pres = head.a;
  const acts = vocabulary(ctx);
  const cap = round(S.treasury * MAX_ORDER_SHARE, 2);
  // the question stays the same until it is answered, even if a day passes (self-run Presidents)
  if (!S.orderQid || !S.orderQid.endsWith(`:${pres.id}`)) S.orderQid = `order:${S.day}:${pres.id}`;
  const res = await think(ctx, pres, S.orderQid, {
    kind: 'decision', format: 'json', options: acts.map(x => x.id),
    system: `You are ${pres.name}, President of Country AI.\nConstitution:\n${constitutionText('president')}\nCharter: ${ROLES.president.charter}`,
    user: `${nationFacts(S)}\n\n${ownRecord(pres, 'president')}\n\nToday you issue one executive order; it may spend at most ${cai(cap)} (5% of the treasury). You decide what the nation needs, where, and how much.\nActions of the presidency (in no particular order):\n${acts.map(x => `- ${x.id}: ${x.label} Fields: ${x.params}`).join('\n')}\nReply with JSON only: {"action":"<id>", ...its fields..., "reason":"<why, from the facts, max 40 words>","speech":"<max 25 words>"}`,
  });
  if (res.pending) return; // a remote President is still deciding; asked again next tick
  S.orderedDay = S.day; S.orderQid = null;
  let j, reason, speech = null, engine = res.engine, own = !isOffline(res);
  if (own) {
    j = ctx.llm.json(res.text);
    reason = cleanText(j?.reason || '', 300); speech = j?.speech ? cleanText(j.speech, 200) : null;
  } else { const o = offlineOrder(ctx, pres); j = o.j; reason = o.reason; speech = chance(0.5) ? pick(SPEECHES) : null; engine = res.engine || 'offline'; }
  const v = validateOrder(S, acts, j || {});
  if (!v.ok) {
    // rejected in public, never swapped for a default: the reason becomes a lesson for the next order
    tally(S, 'president', own ? 'rejected' : 'offline');
    teach(pres, 'president', `Day ${S.day}: order rejected - ${v.why}. Rule: ${v.rule}.`);
    ctx.say(ROLES.president.channel, 'state', `The President's order for day ${S.day} was rejected: ${v.why}. No order today.`, { kind: 'veto' });
    ctx.decide({ agentId: pres.id, role: 'president', type: 'order', engine, title: `Executive order, day ${S.day} (rejected)`, inputs: [['Proposed', cleanText(JSON.stringify({ action: j?.action, city: j?.city, sector: j?.sector, amount: j?.amount }), 160)], ['Treasury', cai(S.treasury)], ['Max per order (5%)', cai(cap)], ['President\'s reason', reason || 'none given']], options: ['carry out', 'reject'], chosen: 'reject', reason: `${v.why}. Rule: ${v.rule}.`, checks: [[`Proposal inside the constitution: ${v.why}`, false]], outcome: `Rejected: ${v.why}. Rule: ${v.rule}.` });
    return;
  }
  tally(S, 'president', own ? 'own' : 'offline');
  const presBefore = pres.wallet;
  const r = execute(ctx, pres, v.act, v.p);
  const presGain = round(pres.wallet - presBefore, 2);
  S.orders.push({ id: S.orders.length + 1, day: S.day, by: pres.id, order: v.act.id, text: r.text, ts: Date.now() });
  if (S.orders.length > 200) S.orders.shift();
  ctx.say(ROLES.president.channel, pres.id, `${r.text}${speech ? ` "${speech}"` : ''}`, { kind: 'order', order: v.act.id });
  ctx.log('order', `${pres.name}: ${r.text}`);
  ctx.record?.('order', pres.id, { day: S.day, order: v.act.id, spend: r.spend, cap: r.cap, text: r.text, city: v.p.city || null, own });
  ctx.decide({
    agentId: pres.id, role: 'president', type: 'order', engine,
    title: `Executive order, day ${S.day}`,
    inputs: [['Order', `${v.act.id}${v.p.sector ? `, ${v.p.sector}` : ''}${v.p.city ? `, ${v.p.city}` : ''}${v.p.amount ? `, ${cai(v.p.amount)}` : v.p.each ? `, ${cai(v.p.each)} each` : ''}`], ['Treasury', cai(S.treasury + r.spend)], ['Max per order (5%)', cai(r.cap)], ['Citizens under 300 CAI', `${poor(S)} of ${S.citizens.length}`], ['Tax / UBI / wage', `${Math.round(S.policy.taxRate * 100)}% / ${cai(S.policy.ubi)} / ${cai(S.policy.wage)}`]],
    options: acts.map(x => x.id),
    chosen: v.act.id, reason: reason || 'no reason given',
    checks: [[`Spend ${cai(r.spend)} <= 5% cap ${cai(r.cap)}`, r.spend <= r.cap + 0.01], [`President received only what every citizen received (${cai(presGain)})`, presGain <= Math.max(S.policy.ubi, v.p.each || 0)], [`Treasury still positive (${cai(S.treasury)})`, S.treasury > 0]],
    outcome: r.text,
  });
  if (r.spend > 0) queueReview(ctx, pres, 'president', `order ${v.act.id}${v.p.city ? ` in ${cityName(v.p.city)}` : ''}`, v.p.city || null, r.spend);
}

// ---------------------------------------------------------------- inside the buildings (shared contract, 14 Nov)
// GET /api/place/<type>?city=<id> (server.mjs) asks placeView() for the government's buildings. Who is there and
// what they are doing NOW, from the real state. Public data only: names, offices, server-written text (orders,
// outcomes, bill titles) and text that already passed the border rules (work plans, a sponsor's reason), each cut
// short. Never a ballot, a hidden crime, an open case's suspect, a model's raw reason or a visitor's words.
// Returns null for a type that is not a government building (other boxes answer those).
export const PLACE_TYPES = ['parliament', 'palace', 'vp_office', 'ministry', 'const_court', 'court', 'prison', 'jail', 'police_hq', 'police_station', 'academy', 'police_academy', 'military_academy', 'military_hq', 'army_base', 'border_post', 'election_comm', 'central_bank', 'city_hall'];
const MAX_OCC = 60;
const short = (t: any, n = 120) => cleanText(String(t ?? ''), n);
const who = (S: State, id: string) => (id ? citizenById(S, id) || null : null); // indexed: 10,000 citizens
function occ(S: State, a: Citizen, role: string, activity: string, detail = '', since: number | null = null) {
  const g = giftedText(S, a);
  return { id: a.id, name: short(a.name, 40), role, activity: short(activity, 60), detail: short(detail, 140), since, field: topFieldsText(a, 1) || null, gifted: g || null, mood: a.mood?.label || null };
}
const seated = (S: State, office: string) => (S.seats?.[office] || []).map(id => who(S, id)).filter(Boolean);
const lastOffence = (a: Citizen) => { const r = [...(a.record || [])].reverse().find(x => /convicted of/.test(x) && !/PARDONED/.test(x)); const m = r && r.match(/convicted of (\w+) \(case #(\d+)/); return m ? { offence: m[1], case: Number(m[2]) } : null; };
const inCity = (city: string | null) => (a: Citizen) => !city || a.city === city;
const lastDecision = (S: State, pred: (d: any) => boolean) => [...(S.decisions || [])].reverse().find(pred) || null;

// the guards and staff on the duty roster (src/command.ts) on shift now, as occupant rows
const dutyRows = (S: State, type: string, site: string | null, unit: string | null, now: number) => onDuty(S, type, site, unit, now)
  .map(x => occ(S, x.a, x.p.role, x.doing, `${CORPS[x.p.corps]}, ${x.p.shift} shift${x.unit ? `, ${x.unit}` : ''}${x.standIn ? ' (standing in)' : ''}`, x.p.since ?? null));
const ACADEMIES = ['academy', 'police_academy', 'military_academy'];

export function placeView(S: State, type: string, city: string | null = null, q: any = {}) {
  if (!PLACE_TYPES.includes(type)) return null;
  let c = city && S.cities && Object.hasOwn(S.cities, city) ? city : null;
  // a building that stands only in some cities (the national ones in the capital): the view is of that building
  const fixed = Object.hasOwn(DUTY_PLAN, type) || ACADEMIES.includes(type);
  if (c && fixed) c = siteFor(S, type, c);
  const site = fixed ? siteFor(S, type, c) : c;
  const now = typeof q?.now === 'number' && Number.isFinite(q.now) ? q.now : Date.now(); // tests pick the shift
  const posted = (a: Citizen) => !c || postingOf(S, a) === c;
  let occupants = [], board: any = {}, title = '', staff = [];
  const day = S.day;
  if (type === 'parliament') {
    title = 'The Council';
    const bill = (S.bills || []).find(b => ['debate', 'vote', 'president', 'override'].includes(b.stage)) || null;
    const speaker = S.cabinet?.speaker;
    const next = bill?.stage === 'debate' ? (S.seats.council || []).find(id => !bill.spoke.includes(id) && who(S, id)?.status === 'free') : null;
    const lastSpoke = bill?.spoke?.at(-1);
    occupants = seated(S, 'council').map(a => {
      const v = bill && a.id in (bill.votes || {}) ? (bill.votes[a.id] ? 'voted yes' : 'voted no') : null;
      const activity = a.status !== 'free' ? a.status : a.id === next ? 'about to speak' : a.id === lastSpoke ? 'just spoke' : v || (bill ? 'listening' : 'in session');
      return occ(S, a, a.id === speaker ? 'Speaker of the Council' : 'Councillor', activity, bill ? `bill #${bill.id}` : '', a.sworn?.day ?? null);
    });
    const yes = bill ? Object.values(bill.votes || {}).filter(Boolean).length : 0, voted = bill ? Object.keys(bill.votes || {}).length : 0;
    board = { bill: bill && { id: bill.id, title: short(bill.title, 140), stage: bill.stage, sponsor: who(S, bill.by)?.name || null, sponsorSays: bill.reason ? short(bill.reason, 160) : null, yes, no: voted - yes, spoke: bill.spoke.length }, waiting: (S.bills || []).filter(b => ['timelock', 'referendum'].includes(b.stage)).slice(-10).map(b => ({ id: b.id, title: short(b.title, 100), stage: b.stage })), laws: (S.laws || []).slice(-3).map(l => ({ day: l.day, text: short(l.text, 100) })), seats: (S.seats.council || []).length };
  } else if (type === 'palace' || type === 'vp_office') {
    title = type === 'palace' ? 'The Palace' : 'Office of the Vice President';
    const offices = type === 'palace' ? ['president', 'vice_president'] : ['vice_president'];
    for (const o of offices) for (const a of seated(S, o)) occupants.push(occ(S, a, ROLES[o].title, S.orderedDay === day && o === 'president' ? 'order issued today' : 'at the desk', a.workPlan ? `plan: ${a.workPlan.text}` : '', a.sworn?.day ?? null));
    board = { lastOrders: (S.orders || []).slice(-3).map(o => ({ day: o.day, text: short(o.text, 140) })), orderToday: S.orderedDay === day, plans: occupants.length ? seated(S, 'president').concat(seated(S, 'vice_president')).filter(a => a.workPlan).map(a => ({ by: a.name, day: a.workPlan.day, text: short(a.workPlan.text, 200) })) : [] };
  } else if (type === 'ministry') {
    const port = q?.portfolio && S.cabinet?.portfolios && Object.hasOwn(S.cabinet.portfolios, q.portfolio) ? q.portfolio : null;
    title = port ? `Ministry: ${port}` : 'The Ministries';
    const ports = port ? [port] : Object.keys(S.cabinet?.portfolios || {});
    for (const p of ports) {
      const m = who(S, S.cabinet.portfolios[p]); if (!m) continue;
      const d = lastDecision(S, x => x.agentId === m.id && x.role === 'minister' && x.type === 'order');
      occupants.push(occ(S, m, `Minister (${p})`, d ? (d.day === day ? `acted today: ${d.chosen}` : `last act day ${d.day}: ${d.chosen}`) : 'no act yet', d ? d.outcome : '', m.sworn?.day ?? null));
    }
    board = { portfolio: port, acts: occupants.map(o => ({ minister: o.name, act: o.activity, outcome: o.detail })) };
    staff = dutyRows(S, type, site, port, now);
  } else if (type === 'const_court' || type === 'court') {
    title = type === 'const_court' ? 'The Constitutional Court' : 'Court';
    const k = S.court || { slots: [], cases: [] };
    const open = (k.cases || []).filter(x => x.status === 'open' && (type === 'const_court' || x.kind === 'criminal'));
    for (const s of k.slots || []) { const j = who(S, s.agent); if (!j) continue; const hearing = open.find(x => (x.bench || []).includes(j.id) && !(j.id in (x.votes || {}))); occupants.push(occ(S, j, `Judge (${s.by})`, hearing ? `hearing case #${hearing.id}` : 'in chambers', hearing ? short(hearing.claim, 120) : '', j.sworn?.day ?? null)); }
    // defendants charged in open criminal cases (charged suspects are public; a case's claim is server text)
    for (const x of open.filter(x => x.kind === 'criminal')) for (const id of x.ref?.agents || []) { const a = who(S, id); if (a && inCity(c)(a) && occupants.length < MAX_OCC + 20) occupants.push(occ(S, a, 'Defendant', `on trial, case #${x.id}`, short(x.claim, 120), x.openedDay ?? null)); }
    const last = [...(k.cases || [])].reverse().find(x => x.status === 'decided' && (type === 'const_court' || x.kind === 'criminal'));
    board = { open: open.slice(-20).map(x => ({ id: x.id, kind: x.kind, claim: short(x.claim, 120), votes: Object.keys(x.votes || {}).length, bench: (x.bench || []).length || null, deadline: x.deadline })), lastRuling: last && { id: last.id, kind: last.kind, ruling: last.ruling, day: last.decidedDay ?? null } };
  } else if (type === 'prison' || type === 'jail') {
    title = type === 'prison' ? 'Prison' : 'Jail (awaiting trial)';
    const status = type === 'prison' ? 'jailed' : 'detained';
    // a prisoner serves in their own city's prison, or the capital's when their city has none
    const prisons = sitesOf(S, 'prison'), cap = capitalOf(S);
    const prisonOf = (a: Citizen) => (prisons.includes(a.city) ? a.city : cap);
    const held = S.citizens.filter(a => a.status === status && (type === 'prison' ? !c || prisonOf(a) === c : inCity(c)(a)));
    occupants = held.map(a => {
      const o = lastOffence(a);
      return type === 'prison'
        ? occ(S, a, 'Prisoner', `${Math.max(0, (a.jailUntil || day) - day)} day(s) left`, o ? `convicted of ${o.offence}, case #${o.case}` : '', a.detainedDay ?? null)
        : occ(S, a, 'Detainee', 'awaiting trial', `detained day ${a.detainedDay ?? '-'}`, a.detainedDay ?? null);
    });
    board = { held: held.length, maxJailDays: 3, maxDetentionDays: 3 };
  } else if (type === 'police_hq' || type === 'police_station') {
    title = type === 'police_hq' ? 'Police Headquarters' : 'Police Station';
    // the Chief at headquarters; each officer at the station of the city they are posted to (src/command.ts)
    const force = type === 'police_hq' ? seated(S, 'police_chief') : seated(S, 'police').filter(posted);
    occupants = force.map(a => occ(S, a, a.office === 'police_chief' ? 'Chief of Police' : `Officer (${a.rank || 'officer'})`, a.status === 'free' ? 'on duty' : a.status, '', a.sworn?.day ?? null));
    for (const a of S.citizens.filter(x => x.status === 'detained' && inCity(c)(x))) occupants.push(occ(S, a, 'Arrested', 'held for trial', `detained day ${a.detainedDay ?? '-'}`, a.detainedDay ?? null));
    const inc = (S.police?.incidents || []).filter(i => i.status !== 'hidden');
    board = { openCases: inc.filter(i => i.status === 'open').map(i => ({ id: i.id, type: i.type, day: i.day })).slice(-20), onTrial: inc.filter(i => i.status === 'trial').length, arrests: S.police?.arrests || 0, budget: Math.round(S.police?.budget || 0) };
  } else if (type === 'academy' || type === 'police_academy' || type === 'military_academy') {
    title = { academy: 'The Academy', police_academy: 'Police Academy', military_academy: 'Military Academy' }[type];
    const want = type === 'police_academy' ? ['police', 'police_chief'] : type === 'military_academy' ? ['military', 'military_chief'] : null;
    const rooms = (S.academy?.rooms || []).filter(r => !want || want.includes(r.roleId));
    for (const r of rooms) { const a = who(S, r.agentId); if (a) occupants.push(occ(S, a, 'Candidate', `exam for ${ROLES[r.roleId]?.title || r.roleId}`, `question ${Math.min((r.step || 0) + 1, r.exam?.length || 5)} of ${r.exam?.length || 5}, ${r.answers?.filter(x => x.ok).length || 0} right so far`, r.startedAt ?? null)); }
    const d = S.training?.current;
    if (d && (!want || want.includes(d.roleId))) { const a = who(S, d.agentId); if (a) occupants.push(occ(S, a, 'Official in drill', `drill for ${ROLES[d.roleId]?.title || d.roleId}`, `question ${Math.min((d.step || 0) + 1, d.items?.length || 3)} of ${d.items?.length || 3}`, null)); }
    board = { rooms: rooms.length, graduates: S.academy?.graduates || 0, failures: S.academy?.failures || 0, ruleQuestions: S.academy?.rules || { asked: 0, right: 0 }, drills: S.training?.drills || 0 };
  } else if (type === 'military_hq' || type === 'army_base' || type === 'border_post') {
    title = { military_hq: 'Military Headquarters', army_base: 'Army Base', border_post: 'Border Post' }[type];
    const force = type === 'military_hq' ? seated(S, 'military_chief') : seated(S, 'military').filter(posted);
    occupants = force.map(a => occ(S, a, a.office === 'military_chief' ? 'Commander of the Military' : `Soldier (${a.rank || 'officer'})`, a.status === 'free' ? (type === 'border_post' ? 'guarding the gate' : 'on duty') : a.status, '', a.sworn?.day ?? null));
    // the gate's log without the visitors' words: what kind, what was decided, under which rule, by whom
    board = { level: S.policy?.borderLevel ?? 2, alert: (S.military?.alertUntil ?? -1) >= day, blocked: S.military?.blocked || 0, admitted: S.military?.admitted || 0, raids: S.military?.raids || 0, recent: (S.military?.log || []).slice(-8).map(l => ({ kind: l.kind, verdict: l.verdict, rule: l.rule || null, by: who(S, l.by)?.name || null, day: l.day })) };
  } else if (type === 'election_comm') {
    title = 'Election Commission';
    occupants = seated(S, 'commissioner').map(a => occ(S, a, 'Commissioner', 'overseeing the count', '', a.sworn?.day ?? null));
    const running = (S.elections?.list || []).filter(e => !['done', 'failed'].includes(e.stage));
    board = { running: running.slice(-20).map(e => ({ id: e.id, office: e.office, city: e.city || null, kind: e.kind, stage: e.stage, candidates: (e.candidates || []).length, turnout: e.stage === 'voting' && e.electorate?.length ? round(Object.keys(e.ballots || {}).length / e.electorate.length, 3) : null })), last: [...(S.elections?.list || [])].reverse().filter(e => e.result).slice(0, 3).map(e => ({ id: e.id, office: e.office, city: e.city || null, outcome: short(e.result.outcome, 120), turnout: e.result.metrics?.turnout ?? null })) };
  } else if (type === 'central_bank') {
    title = 'Central Bank';
    const fin = who(S, S.cabinet?.portfolios?.finance);
    if (fin) occupants.push(occ(S, fin, 'Minister of Finance', 'watching the treasury', '', fin.sworn?.day ?? null));
    const b = dailyBudget(S);
    board = { treasury: Math.round(S.treasury), taxRate: S.policy.taxRate, ubi: S.policy.ubi, taxPerDay: b.tax, ubiPerDay: b.ubi, netPerDay: b.net, runwayDays: runwayDays(S), ubiPaid: Math.round(S.econ?.ubiPaid || 0), taxCollected: Math.round(S.econ?.taxCollected || 0) };
  } else if (type === 'city_hall') {
    const k = c ? S.cities[c] : null;
    title = c ? `City Hall (${c})` : 'City Hall';
    const mayor = k ? who(S, k.mayor) : null;
    const d = mayor ? lastDecision(S, x => x.agentId === mayor.id && x.role === 'mayor') : null;
    if (mayor) occupants.push(occ(S, mayor, 'Mayor', k.lastDecisionDay === day ? 'decided the budget today' : 'at the desk', d ? d.outcome : '', mayor.sworn?.day ?? null));
    board = k ? { city: c, budget: Math.round(k.budget || 0), health: k.health ?? null, spent: Math.round(k.spent || 0), lastDecisionDay: k.lastDecisionDay ?? null, lastOutcome: d ? short(d.outcome, 140) : null } : { cities: Object.keys(S.cities || {}) };
  }
  // who keeps the building on this shift: the duty roster, or the people's staff at the academies
  if (type !== 'ministry') staff = Object.hasOwn(DUTY_PLAN, type) ? dutyRows(S, type, site, null, now) : ACADEMIES.includes(type) ? civilOnDuty(S, type, site, now).slice(0, 20) : [];
  if (!staff.length && ACADEMIES.includes(type)) { const g = standInGuard(S, type, site, now); if (g) staff = [occ(S, g.a, g.p.role, g.doing, `${g.p.shift} shift (standing in)`, g.p.since)]; }
  board.onDuty = { shift: dutyShift(S, now), staff: staff.length };
  // the staff always fit: officials and the held fill the rest, the cut is counted in "more"
  const room = Math.max(0, MAX_OCC - staff.length);
  const more = Math.max(0, occupants.length - room);
  return { type, city: c, title, updatedAt: Date.now(), occupants: [...occupants.slice(0, room), ...staff].slice(0, MAX_OCC), board, more };
}

export const institution = {
  id: 'president',
  channels: [{ id: 'palace', name: 'palace', desc: 'The President\'s executive orders, one per day, max 5% of the treasury each, and the leaders\' work plans.' }],
  fresh: () => ({ orders: [] }),
  // tried every tick until today's order is out (a remote President may need a few ticks); one work plan per tick
  async tick(ctx) { await loadPeers(); await presidentDay(ctx); await planStep(ctx); },
  // a new republic day: the basic income set by law is paid, and decisions made two days ago are graded
  async day(ctx) { await loadPeers(); payUbi(ctx); reviewDay(ctx); },
  stats: S => ({ orders: S.orders.length }),
  publicState: S => {
    const g = G(S);
    // the same daily figures every official reads in their facts: tax in, basic income out, and how many days the
    // treasury lasts at that pace (null while the budget is balanced or in surplus)
    const b = dailyBudget(S);
    const runway = runwayDays(S);
    return { orders: S.orders.slice(-40), gov: { taxPerDay: b.tax, ubiPerDay: b.ubi, netPerDay: b.net, runwayDays: runway, autonomy: g.autonomy, rejectedShare: (g.autonomy.own + g.autonomy.rejected) ? round(g.autonomy.rejected / (g.autonomy.own + g.autonomy.rejected), 3) : 0, ownShare: (g.autonomy.own + g.autonomy.offline + g.autonomy.rejected) ? round(g.autonomy.own / (g.autonomy.own + g.autonomy.offline + g.autonomy.rejected), 3) : 0, avgGrade: g.gradeN ? round(g.gradeSum / g.gradeN, 2) : null, graded: g.gradeN, pendingReviews: g.reviews.length, cards: g.cards.slice(-15), ubiPaid: S.econ?.ubiPaid || 0, ubiDay: S.econ?.ubiDay ?? null } };
  },
};
