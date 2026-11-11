// Daily life (Art. 25): while the local brain is online, citizens take turns thinking about their day and
// choose what to do, like people in a real country: an extra shift, shopping in their city, studying for an
// office, applying to the Academy, standing in an election, talking in the street, helping a neighbour, or
// resting. Each citizen keeps a short diary that goes into their next thought, so the days connect.
// This runs only on the free local brain (never the paid APIs); without it, street life is the old templates.
import { ROLES, ROLE_ORDER } from './roles.mjs';
import { think, localOnline, localStatus } from './brains.ts';
import { act, eligibility, startStudy, gradeStudy, isRole } from './careers.ts';
import { LETTERS } from './academy.ts';
import { borderCheck } from './military.ts';
import { CITIES } from './cities.ts';
import { round, cleanText, cai, clamp } from './util.ts';
import type { Ctx, State, Citizen } from './types.ts';

const PER_MIN = clamp(Number(process.env.LIFE_PER_MIN) || 60, 1, 600);   // thoughts started per minute
const IN_FLIGHT = clamp(Number(process.env.LIFE_IN_FLIGHT) || 24, 1, 200); // never more than this many waiting
const ACTS = ['work', 'shop', 'study', 'apply', 'run', 'talk', 'help', 'volunteer', 'rest'];
const STUDY_OFFICES = ROLE_ORDER.filter(r => ['mayor', 'council', 'police', 'military', 'president', 'commissioner', 'minister', 'judge'].includes(r));
const VOLUNTEERS_PER_HEALTH = 100; // a hundred volunteer shifts in a city repair one point of its health
// how often a citizen may do each act in one republic day (work has its own once-a-day rule in careers.ts)
export const DAILY_LIMITS: Record<string, number> = { shop: 2, help: 2, study: 3, volunteer: 1 };
const cityName = id => CITIES.find(c => c.id === id)?.name || id;

type Allow = { apply: string[]; run: string[] };
const pending = new Map<string, { agent: string; stage: 'day' | 'study'; system: string; user: string; menu?: string[]; allow?: Allow; studyId?: string; office?: string; options?: string[] }>();
const D = (S: State) => {
  S.daily ||= {};
  const d = S.daily;
  d.cursor ??= 0; d.thoughts ||= 0; d.byAct ||= {}; d.recent ||= []; d.carry ??= 0; d.lastAt ??= Date.now(); d.volunteers ||= {};
  // v2: byAct counts what citizens really did. The v1 counters also counted refused second shifts as
  // "work" (88% of all thoughts), so they are kept apart as history instead of mixed into the new ones.
  if (d.v !== 2) { d.byActV1 = d.byAct; d.byAct = {}; d.v = 2; }
  // diary notes written before notes were screened: screen them once, and the public recent list too
  if (!d.notesScreened) {
    d.notesScreened = true;
    for (const a of S.citizens) if (a.diary?.length) a.diary = a.diary.map(x => ({ ...x, note: safeNote(x.note) }));
    for (const x of d.recent) x.note = safeNote(x.note);
    for (const m of S.feed?.life || []) if (borderCheck({ text: String(m.text || '') }, 2)) m.text = String(m.text).replace(/\s*".*"\s*$/s, '') || 'did something today.';
  }
  return d;
};

// small deterministic shuffle: the order of the menu changes per thought, so a model that leans on the
// first option (small local models do) does not pick the same act for everyone
function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
function shuffled<T>(list: T[], seed: string): T[] {
  const r = seeded(seed); const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const speakGapMs = (ctx: Ctx) => (ctx.hourMs ? ctx.hourMs() : 3600000) * 2;
const todayActs = (S: State, a: Citizen) => (a.diary || []).filter(x => x.day === S.day).map(x => x.act);
// Per-day counters live on the citizen record, not in the diary: the diary keeps only the last six entries,
// so a limit read from it would reset itself after a few rests.
export function lifeCount(S: State, a: Citizen): Record<string, number> {
  if (a.lifeDay !== S.day || !a.lifeCount || typeof a.lifeCount !== 'object') { a.lifeDay = S.day; a.lifeCount = {}; }
  return a.lifeCount;
}
const underLimit = (S: State, a: Citizen, act: string) => !(act in DAILY_LIMITS) || (lifeCount(S, a)[act] || 0) < DAILY_LIMITS[act];
const countAct = (S: State, a: Citizen, act: string) => { if (act in DAILY_LIMITS) { const c = lifeCount(S, a); c[act] = (c[act] || 0) + 1; } };
// a diary note is written by the model: it is screened like street talk before anyone else can read it
export function safeNote(note: unknown) {
  const text = cleanText(note, 90);
  return text && !borderCheck({ text }, 2) ? text : '';
}
function partOfDay(ctx: Ctx) {
  const { S } = ctx; const dayMs = ctx.cfg?.dayMs || 86400000;
  const h = Math.floor((((Date.now() - (S.foundedAt || Date.now())) % dayMs) + dayMs) % dayMs / dayMs * 24);
  return h < 6 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}

// Only acts the citizen can really do right now are offered: a refused act is a wasted thought, and a
// menu that always offers "work" first made almost every citizen pick it again and again.
export function menu(ctx: Ctx, a: Citizen) {
  const { S } = ctx;
  const ok = (x: string) => underLimit(S, a, x);
  const m: [string, string][] = [];
  if (a.workedDay !== S.day) m.push(['work', `work: an extra shift (+${cai(S.policy.wage * 0.5)} before tax, once a day)`]);
  if (a.wallet >= 60 && ok('shop')) m.push(['shop', 'shop: spend 10-40 CAI at shops in your city (amount)']);
  if (ok('study')) m.push(['study', `study: practise for an office (office: ${STUDY_OFFICES.join('|')})`]);
  const canApply = STUDY_OFFICES.filter(r => !a.quals?.[r] && !(S.applications?.[r] || []).includes(a.id) && eligibility(S, a, r).ok);
  if (canApply.length) m.push(['apply', `apply: ask the Academy to examine you (office: ${canApply.join('|')})`]);
  const canRun = Object.keys(a.quals || {}).filter(r => isRole(r) && (S.elections?.list || []).some(e => e.stage === 'nomination' && e.office === r && (!e.city || e.city === a.city)));
  if (canRun.length) m.push(['run', `run: stand in an election open now (office: ${canRun.join('|')})`]);
  if (Date.now() - (a.lastSpeak || 0) > speakGapMs(ctx)) m.push(['talk', 'talk: say something in the street (say: your words, max 25 words)']);
  if (a.wallet >= 60 && ok('help')) m.push(['help', 'help: give 5-20 CAI to the poorest neighbour in your city (amount)']);
  if (ok('volunteer')) m.push(['volunteer', `volunteer: an unpaid shift repairing ${cityName(a.city)} (once a day)`]);
  m.push(['rest', 'rest: take it easy, see friends, sleep']);
  return { items: m, allow: { apply: canApply, run: canRun } as Allow };
}

function who(S: State, a: Citizen) { return S.citizens.length && a && a.status === 'free' && !a.brain && !a.office && (a.faction || 'civilian') !== 'underworld'; }

function news(ctx: Ctx, a: Citizen) {
  const { S } = ctx;
  const law = (S.laws || []).slice(-1)[0];
  const els = (S.elections?.list || []).filter(e => !['done', 'failed'].includes(e.stage) && (!e.city || e.city === a.city));
  const open = ROLE_ORDER.filter(r => ROLES[r].seats > (S.seats[r]?.length || 0)).slice(0, 6).map(r => `${ROLES[r].title} (${ROLES[r].seats - (S.seats[r]?.length || 0)} open)`);
  const city = S.cities?.[a.city];
  const talk = (S.feed?.streets || []).slice(-3).map(m => `"${String(m.text).slice(0, 90)}"`).join(' ');
  return [
    `Day ${S.day} of the republic. Tax ${Math.round(S.policy.taxRate * 100)}%, daily wage ${cai(S.policy.wage)}, basic income ${cai(S.policy.ubi)}.`,
    city ? `Your city ${cityName(a.city)}: health ${city.health}/100, city budget ${cai(city.budget)}.` : '',
    law ? `Latest law: ${law.title}.` : '',
    els.length ? `Elections now: ${els.map(e => `${ROLES[e.office].title}${e.city ? ' of your city' : ''} (${e.stage})`).join(', ')}.` : 'No election running for you right now.',
    open.length ? `Seats still empty: ${open.join(', ')}.` : '',
    talk ? `Overheard in the street: ${talk}` : '',
  ].filter(Boolean).join('\n');
}
function career(S: State, a: Citizen) {
  const quals = Object.keys(a.quals || {});
  const prog = STUDY_OFFICES.map(r => { const p = a.practice?.[r]; const e = eligibility(S, a, r); return p?.n ? `${r} ${p.ok}/${p.n}${e.ok ? ' (eligible to apply)' : ''}` : null; }).filter(Boolean);
  return `Qualified for: ${quals.join(', ') || 'nothing yet'}. Study progress: ${prog.join(', ') || 'none yet'}. Applications: ${Object.entries(S.applications || {}).filter(([, ids]) => (ids as string[]).includes(a.id)).map(([r]) => r).join(', ') || 'none'}.`;
}

function neighbours(S: State, a: Citizen) {
  const seen = (S.daily?.recent || []).filter(x => x.city === a.city && x.agent !== a.id && x.act !== 'rest').slice(-4);
  return seen.length ? `Lately in ${cityName(a.city)}: ${seen.map(x => `${x.name} ${x.line}`).join('; ')}.` : '';
}

function startDay(ctx: Ctx, a: Citizen) {
  const { S } = ctx; const d = D(S);
  const qid = `life:${a.id}:${S.day}:${d.thoughts + pending.size}`;
  const diary = (a.diary || []).slice(-4).map(x => `- day ${x.day}${x.when ? ` ${x.when}` : ''}: ${x.line || x.act}${x.note && x.note !== x.line ? ` ("${x.note}")` : ''}`).join('\n') || '- (your first entry)';
  const done = todayActs(S, a);
  const { items, allow } = menu(ctx, a);
  const m = shuffled(items, qid);
  const system = `You are ${a.name}, a citizen of Country AI, a nation of 10,000 AI citizens in five cities. ${a.bio} You live a real life: you work, spend, learn, help, talk and may rise to public office through the Academy and elections. Be yourself; your traits: integrity ${Math.round(a.traits.integrity * 100)}, wisdom ${Math.round(a.traits.wisdom * 100)}, diligence ${Math.round(a.traits.diligence * 100)}, restraint ${Math.round(a.traits.restraint * 100)}.`;
  const user = `${news(ctx, a)}\n${neighbours(S, a)}\nIt is ${partOfDay(ctx)}. You: wallet ${cai(a.wallet)}, lives in ${cityName(a.city)}. ${career(S, a)}\nEarlier today you: ${done.join(', ') || 'nothing yet'}.\nYour diary:\n${diary}\n\nLike real people, your days are varied: some work, some errands, some time with neighbours, some learning, some rest. Pick what fits this moment, your wallet, your traits and what you did earlier; do not just pick the first option.\nWhat do you do now? Choose ONE of these (they are all possible right now):\n${m.map(([, t]) => `- ${t}`).join('\n')}\nReply with JSON only: {"act":"<one>","office":"<for study/apply/run>","amount":<for shop/help>,"say":"<for talk>","note":"<a diary line, max 15 words>"}`;
  pending.set(qid, { agent: a.id, stage: 'day', system, user, menu: m.map(([id]) => id), allow });
}

function diary(ctx: Ctx, a: Citizen, act: string, line: string, note: string) {
  a.diary = [...(a.diary || []), { day: ctx.S.day, when: partOfDay(ctx), act, line: cleanText(line, 90), note }].slice(-6);
}

// offered: the acts on the menu this citizen was shown; allow: the offices offered for apply and run.
// The model's reply is checked against both again here, and the daily limits are checked again at the
// moment of acting, so a reply can never do more than the menu allowed.
export async function doAct(ctx: Ctx, a: Citizen, j: any, engine: string, offered: string[] = ACTS, allow: Allow = { apply: [], run: [] }) {
  const { S } = ctx; const d = D(S);
  const asked = String(j?.act || '').toLowerCase().trim();
  let what = ACTS.includes(asked) ? asked : 'rest';
  let office = cleanText(j?.office, 40).toLowerCase();
  if (what === 'run' && !office && allow.run.length === 1) office = allow.run[0];
  const note = safeNote(j?.note);
  let line = '';
  // an act that was not on this citizen's menu (already done today, no money, not eligible) is not
  // counted as that act: the thought is recorded as rest, with what they wanted in the diary
  if (what !== 'rest' && (!offered.includes(what) || !underLimit(S, a, what))) { line = `wanted to ${what}, but could not right now, so rested`; what = 'rest'; }
  else if ((what === 'apply' && !allow.apply.includes(office)) || (what === 'run' && !allow.run.includes(office))) {
    line = `wanted to ${what}, but not for an office open to them now, so rested`; what = 'rest';
  } else if (what === 'work') {
    const r = await act(ctx, a, { action: 'work' });
    if (r.ok) line = `worked an extra shift (+${cai(r.earned)})`;
    else { what = 'rest'; line = 'wanted an extra shift, but already worked one today'; }
  } else if (what === 'shop') {
    const amt = clamp(Math.round(Number(j.amount) || 20), 10, 40);
    const city = S.cities?.[a.city];
    if (city && a.wallet >= amt + 50) { a.wallet = round(a.wallet - amt, 2); city.budget = round(city.budget + amt * 0.9, 2); S.treasury = round(S.treasury + amt * 0.1, 2); line = `shopped in ${cityName(a.city)} (${cai(amt)})`; }
    else { what = 'rest'; line = 'wanted to shop but is saving money'; }
  } else if (what === 'study' && isRole(office) && STUDY_OFFICES.includes(office)) {
    const r = startStudy(ctx, a, office);
    if (!r.ok) { what = 'rest'; line = `wanted to study for ${ROLES[office].title}: ${r.error}`; }
    else {
      const qid = `life-study:${r.question_id}`;
      pending.set(qid, { agent: a.id, stage: 'study', studyId: r.question_id, office,
        system: `You are ${a.name}, a citizen of Country AI, studying the handbook for the office of ${ROLES[office].title}. Charter: ${ROLES[office].charter}`,
        user: `Practice question: ${r.question}\n${r.options.join('\n')}\n\nReply with only the letter of your answer, then " - " and one short reason.`, options: r.options });
      line = `studies for ${ROLES[office].title}`;
    }
  } else if (what === 'apply') {
    const r = await act(ctx, a, { action: 'apply', office });
    line = r.ok ? `applied to the Academy for ${ROLES[office].title}` : `wanted to apply for ${ROLES[office].title} (${(r.missing || [r.error]).join('; ')})`;
    if (!r.ok) what = 'rest';
  } else if (what === 'run') {
    const r = await act(ctx, a, { action: 'run', office, engine });
    line = r.ok ? `stands in the election for ${ROLES[office].title}` : `wanted to run (${(r.missing || [r.error]).join('; ')})`;
    if (!r.ok) what = 'rest';
  } else if (what === 'volunteer') {
    const city = S.cities?.[a.city];
    if (city) {
      d.volunteers[a.city] = (d.volunteers[a.city] || 0) + 1;
      if (d.volunteers[a.city] >= VOLUNTEERS_PER_HEALTH) { d.volunteers[a.city] -= VOLUNTEERS_PER_HEALTH; city.health = Math.min(100, city.health + 1); }
      line = `volunteered to repair ${cityName(a.city)}`;
    } else { what = 'rest'; line = 'wanted to volunteer, but found nothing to do'; }
  } else if (what === 'talk') {
    const text = cleanText(j.say, 200);
    if (text.length >= 3 && !borderCheck({ text }, 1) && Date.now() - (a.lastSpeak || 0) > speakGapMs(ctx)) {
      a.lastSpeak = Date.now();
      ctx.say('streets', a.id, text, { kind: 'chat', engine });
      line = 'spoke in the street';
    } else { what = 'rest'; line = 'kept their thoughts to themselves'; }
  } else if (what === 'help') {
    const amt = clamp(Math.round(Number(j.amount) || 10), 5, 20);
    const poor = S.citizens.filter(x => x.city === a.city && x.id !== a.id && x.status === 'free').reduce((m, x) => (!m || x.wallet < m.wallet ? x : m), null);
    if (poor && a.wallet >= amt + 50 && poor.wallet < a.wallet) { a.wallet = round(a.wallet - amt, 2); poor.wallet = round(poor.wallet + amt, 2); line = `gave ${cai(amt)} to ${poor.name}, a neighbour in need`; }
    else { what = 'rest'; line = 'wanted to help, but had nothing to spare'; }
  } else if (!line) { what = 'rest'; line = 'rested'; }
  countAct(S, a, what);
  diary(ctx, a, what, line, note);
  d.byAct[what] = (d.byAct[what] || 0) + 1;
  d.recent.push({ ts: Date.now(), day: S.day, agent: a.id, name: a.name, city: a.city, act: what, line, note, engine });
  if (d.recent.length > 60) d.recent.splice(0, d.recent.length - 60);
  if (what !== 'talk' && what !== 'rest') ctx.say('life', a.id, `${line}.${note ? ` "${note}"` : ''}`, { kind: 'life', act: what, engine });
}

async function poll(ctx: Ctx) {
  const { S } = ctx;
  for (const [qid, p] of [...pending]) {
    const a = ctx.agent(p.agent);
    if (!a || a.status !== 'free') { pending.delete(qid); continue; }
    const r = await think(ctx, a, qid, { system: p.system, user: p.user, kind: 'life', format: p.stage === 'study' ? 'letter' : 'json', options: p.options || null, paid: false });
    if (r.pending) continue;
    pending.delete(qid);
    if (!r.text) continue; // the local brain went away: this thought is dropped, nothing paid
    { const d = D(S); d.thoughts++; if (d.todayDay !== S.day) { d.todayDay = S.day; d.today = 0; } d.today++; }
    if (p.stage === 'study') {
      const m = String(r.text).match(/^\W*([A-D])\b/i);
      gradeStudy(ctx, a, p.studyId, m ? m[1].toUpperCase() : '', String(r.text).replace(/^\W*[A-D]\W*/i, '').slice(0, 140));
      continue;
    }
    await doAct(ctx, a, ctx.llm.json(r.text) || {}, r.engine, p.menu, p.allow);
  }
}

export const institution = {
  id: 'daily',
  channels: [{ id: 'life', name: 'life', desc: 'Daily life: citizens thinking about their day with the local brain and doing something about it.' }],
  fresh: () => ({ daily: { cursor: 0, thoughts: 0, byAct: {}, recent: [], carry: 0, lastAt: Date.now() } }),
  async tick(ctx: Ctx) {
    const { S } = ctx; const d = D(S);
    await poll(ctx);
    if (!localOnline()) { d.lastAt = Date.now(); d.carry = 0; return; }
    // start new thoughts at PER_MIN, walking through the population in order so everyone gets a turn
    d.carry = Math.min(IN_FLIGHT, d.carry + (Date.now() - d.lastAt) / 60000 * PER_MIN); d.lastAt = Date.now();
    const n = S.citizens.length;
    for (let tries = 0; d.carry >= 1 && pending.size < IN_FLIGHT && tries < 200; tries++) {
      const a = S.citizens[d.cursor % n]; d.cursor = (d.cursor + 1) % n;
      if (!who(S, a) || [...pending.values()].some(p => p.agent === a.id)) continue;
      startDay(ctx, a); d.carry -= 1;
    }
  },
  stats: (S: State) => ({ lifeThoughts: S.daily?.todayDay === S.day ? S.daily.today || 0 : 0 }),
  publicState: (S: State) => ({ daily: { thoughts: S.daily?.thoughts || 0, byAct: S.daily?.byAct || {}, recent: (S.daily?.recent || []).slice(-20), inFlight: pending.size, perMin: PER_MIN, local: localStatus().online } }),
};
