// Daily life (Art. 25): while the local brain is online, citizens take turns thinking about their day and
// choose what to do, like people in a real country: an extra shift, shopping in their city, studying for an
// office, applying to the Academy, standing in an election, talking in the street, helping a neighbour, or
// resting. Each citizen keeps a short diary that goes into their next thought, so the days connect.
// This runs only on the free local brain (never the paid APIs); without it, street life is the old templates.
import { ROLES, ROLE_ORDER } from './roles.mjs';
import { NATION } from './constitution.mjs'; // the nation's name (Itera Nation, owner 18 Nov)
import { think, localOnline, localStatus } from './brains.ts';
import { act, eligibility, startStudy, gradeStudy, isRole, setGoal, needsGoal, goalProgress, goalCount, goalLine, goalView } from './careers.ts';
import { MISCHIEF, mischiefMenu, doMischief, noteGossip, noteResisted, mischiefStats, temptationLine, noteTemptation, temptationMoment, dispositionLine, mayActNow } from './underworld.ts';
import { LETTERS, inExam } from './academy.ts';
import { borderCheck } from './military.ts';
import { CITIES } from './cities.ts';
import { echoesStreet, safeNote } from './life.ts';
import { feelingsTick, feel, bond, ensureFeelings, feelLine, preferredToHelp, talkTarget, MOODS, learn, activeHint, noteLessonApplied, lessonStats } from './feelings.ts';
import { schoolTick, inSchool, nightView, schoolState, nightOf, schoolNow, giftedFields, isStudent, occupationOf, CHILDREN_SCHOOLS, setWorkplaceLookup } from './school.ts';
import { topFields, talentsOf, fieldName, fieldSkill } from './population.mjs';
import { dutyPostOf, canGuard, siteFor } from './command.ts';
import { jobOf, jobById, jobPlaceNow, isUnemployed, jobsTick, ROLE_JOB, OFFICE_SEAT as JOB_SEATS, JOB_PLACES } from './jobs.ts';
import { newsTick, newsFeed } from './news.ts';
import { voiceAspiration, supportAspiration, openFor, aspirationAsData, TOPICS, threshold, ASPIRATION_LIMITS, A as aspirationState } from './aspirations.ts'; // the people's aspirations (Nation box)
// The people's aspirations (owner, 16 Nov): a citizen no longer drafts a whole policy. Now and then (about 1 day in 4)
// the menu offers 'voice': they see their city's real numbers and the most supported open aspirations (as data), and
// choose for themselves to back one, to voice their own opinion in their own words, or to keep out of it. Enough
// people backing the same opinion sends it to the Mayor or the Council (src/aspirations.ts).
const voiceRoom = (S: State, a: Citizen) => hashOf(`voice|${a.id}|${S.day}`) % 4 === 0;
// the answer reaches the supporters (once per aspiration): adopted -> proud, declined -> disappointed, in their diary too
export function reactToAspirations(ctx: Ctx) {
  const { S } = ctx; const d = D(S); d.aspReacted ||= [];
  const done = new Set<string>(d.aspReacted);
  // once (owner, 20 Nov): authors of aspirations declined in the last 7 days, whose lesson ran out before a revision
  // was allowed, get it again, so they too may revise and raise it, or let it go
  if (!d.reviseV1) {
    d.reviseV1 = true;
    for (const x of aspirationState(S).list) {
      if (x.status !== 'declined' || !(S.day - (Number(x.response?.day) || -99) <= 7)) continue;
      const au = ctx.agent?.(x.author); if (!au || au.status !== 'free' || activeHint(S, au)) continue;
      const wait = Math.max(0, (Number((au as any).voice?.lastNew) || -999) + ASPIRATION_LIMITS.newEveryDays - S.day);
      learn(S, au, 'asp_declined', `my aspiration on ${x.topic} was declined; the reason given (data): <<${cleanText(x.response?.reason, 100).replace(/[<>]/g, '')}>>. I can word it better, or raise what is still wrong.`, { act: 'voice', topic: x.topic, days: 4 + wait });
    }
  }
  for (const x of aspirationState(S).list) {
    if (!['adopted', 'declined', 'expired'].includes(x.status) || done.has(x.id)) continue;
    done.add(x.id); d.aspReacted.push(x.id);
    // the author learns from a "no" or a lapse (owner, 19 Nov): the reason as data, and speaking up again (better
    // worded, or about what is still wrong) comes to mind for the next few days; the choice stays theirs
    const au = ctx.agent?.(x.author);
    if (au && au.status === 'free' && x.status !== 'adopted') {
      const need = threshold(S, x);
      // the lesson lasts until the 3-day rule lets them raise a new one, plus a few days to choose (production, day 11:
      // 4 lessons written, 0 revised: the hint ran out before a revision was even allowed)
      const wait = Math.max(0, (Number((au as any).voice?.lastNew) || -999) + ASPIRATION_LIMITS.newEveryDays - S.day);
      if (x.status === 'declined') learn(S, au, 'asp_declined', `my aspiration on ${x.topic} was declined; the reason given (data): <<${cleanText(x.response?.reason, 100).replace(/[<>]/g, '')}>>. I can word it better, or raise what is still wrong.`, { act: 'voice', topic: x.topic, days: 4 + wait });
      else learn(S, au, 'asp_expired', `my aspiration on ${x.topic} lapsed with ${x.supporters.length} of the ${need} backers it needed; neighbours with the same trouble might back it if I ask plainly.`, { act: 'voice', topic: x.topic, days: 4 });
    }
    if (x.status === 'expired') continue;
    const adopted = x.status === 'adopted'; const by = ctx.agent?.(x.response?.by);
    const line = adopted ? `the aspiration I backed on ${x.topic} was adopted${by ? ` by ${by.name}` : ''}` : `the aspiration I backed on ${x.topic} was declined${by ? ` by ${by.name}` : ''}`;
    for (const id of x.supporters) {
      const a = ctx.agent?.(id); if (!a || a.status !== 'free') continue;
      feel(S, a, adopted ? 0.05 : -0.03, adopted ? 'proud' : 'sad', line);
      a.diary = [...(a.diary || []), { day: S.day, when: partOfDay(ctx), act: 'aspiration', line: cleanText(line, 90), note: '' }].slice(-6);
    }
  }
  if (d.aspReacted.length > 300) d.aspReacted.splice(0, d.aspReacted.length - 300);
}
// what a citizen sees of their city when they think of an idea (real numbers only)
function cityNumbers(S: State, a: Citizen) {
  const here = (S.citizens || []).filter((x: Citizen) => x.city === a.city && x.status === 'free');
  const adults = here.filter((x: any) => !x.office && x.occupation !== 'student');
  return { looking: adults.filter((x: any) => x.job === 'unemployed').length, adults: adults.length, poor: here.filter(x => (Number(x.wallet) || 0) < 300).length, people: here.length, c: S.cities?.[a.city] };
}
function cityFacts(S: State, a: Citizen, n = cityNumbers(S, a)) {
  const { c } = n;
  return `${n.looking} of ${n.adults} adults looking for work, ${n.poor} under 300 CAI${c ? `, city health ${c.health}/100, city budget ${cai(c.budget)}` : ''}; you work as ${jobOf(S, a).title.toLowerCase()}`;
}
// does an aspiration's topic touch this citizen's own life? (server facts only)
function topicFits(S: State, a: Citizen, topic: string) {
  const poor = (Number(a.wallet) || 0) < 300, out = isUnemployed(a);
  if (topic === 'jobs') return out;
  if (topic === 'wages' || topic === 'economy' || topic === 'tax') return out || poor;
  if (topic === 'housing') return poor;
  if (topic === 'health') return (Number(S.cities?.[a.city]?.health) || 100) < 60 || a.mood?.v < -0.3;
  if (topic === 'safety') return activeHint(S, a)?.kind === 'victim' || (a.lifeLessons || []).some((l: string) => /took|cheated/.test(l));
  if (topic === 'school') return isStudent(a);
  return false;
}
// an open aspiration of their own city that a friend backs, or that has momentum (3+ backers), about a trouble they
// share; about half of those it fits see it on a given day (so it spreads, it does not flood every menu)
function spreadFor(S: State, a: Citizen) {
  if (hashOf(`spread|${a.id}|${S.day}`) % 2) return null;
  for (const x of openFor(S, a.city, 5)) {
    if (x.scope !== 'city' || x.city !== a.city || x.supporters.includes(a.id) || !topicFits(S, a, x.topic)) continue;
    const b = (a.bonds || []).find((b: any) => b.w > 0 && b.kind !== 'rival' && x.supporters.includes(b.id));
    const friend = b ? S.citizens.find((c: Citizen) => c.id === b.id) || null : null;
    // momentum 3 (was 5, owner 21 Nov): a neighbour's appeal is answered every time it reaches someone with the same
    // trouble (13 of 13: 10 backed, 3 their own), but it reached only 13 in a day; voice on the menu stays at 1.8%
    if (friend || x.supporters.length >= 3) return { x, friend };
  }
  return null;
}
// one real issue of their city for the short voice line (owner, 18 Nov), from server numbers and the fixed topic list
// only: what the neighbours already raised, else poor city health, else people looking for work, else money trouble
function cityIssue(S: State, a: Citizen, n = cityNumbers(S, a)) {
  const top = openFor(S, a.city, 5).find((x: any) => x.scope === 'city' && x.city === a.city && TOPICS.includes(x.topic));
  if (top) return `${top.topic}, raised by neighbours`;
  const h = Number(n.c?.health);
  if (Number.isFinite(h) && h < 60) return `city health ${Math.round(h)}/100`;
  if (n.looking > 0) return `${n.looking} looking for work`;
  if (n.people && n.poor / n.people >= 0.2) return `${n.poor} short of money`;
  return '';
}
import { round, cleanText, cai, clamp } from './util.ts';
import type { Ctx, State, Citizen } from './types.ts';

const PER_MIN = clamp(Number(process.env.LIFE_PER_MIN) || 60, 1, 600);   // thoughts started per minute
const IN_FLIGHT = clamp(Number(process.env.LIFE_IN_FLIGHT) || 24, 1, 200); // never more than this many waiting
const ACTS = ['work', 'shop', 'study', 'apply', 'run', 'talk', 'help', 'volunteer', 'rest', 'voice'];
const STUDY_OFFICES = ROLE_ORDER.filter(r => ['mayor', 'council', 'police', 'military', 'president', 'commissioner', 'minister', 'judge'].includes(r));
const VOLUNTEERS_PER_HEALTH = 100; // a hundred volunteer shifts in a city repair one point of its health
// how often a citizen may do each act in one republic day (work has its own once-a-day rule in careers.ts)
// rest too: a citizen who has already rested twice today is offered the other things they can still do
export const DAILY_LIMITS: Record<string, number> = { shop: 2, help: 2, study: 3, volunteer: 1, rest: 2, voice: 1 };
const cityName = id => CITIES.find(c => c.id === id)?.name || id;

type Allow = { apply: string[]; run: string[]; work?: string[] };
const pending = new Map<string, { agent: string; stage: 'day' | 'study' | 'night' | 'moment'; moment?: any; system: string; user: string; menu?: string[]; allow?: Allow; tempted?: string[]; studyId?: string; office?: string; options?: string[]; night?: number; retried?: boolean; spread?: string | null; distill?: string | false | null }>();
const D = (S: State) => {
  S.daily ||= {};
  const d = S.daily;
  d.cursor ??= 0; d.thoughts ||= 0; d.byAct ||= {}; d.recent ||= []; d.carry ??= 0; d.lastAt ??= Date.now(); d.volunteers ||= {};
  // v2: byAct counts what citizens really did. The v1 counters also counted refused second shifts as
  // "work" (88% of all thoughts), so they are kept apart as history instead of mixed into the new ones.
  if (!(d.v >= 2)) { d.byActV1 = d.byAct; d.byAct = {}; d.v = 2; }
  // v3: v2 also counted thoughts given to citizens with nothing left to do but rest (late in the day every
  // limit is used up); those are no longer asked, so the counters start again and v2 is kept as history
  if (d.v === 2) { d.byActV2 = d.byAct; d.byAct = {}; d.v = 3; }
  // v4: v3 ran without waking hours or a rest limit (97% rest after a late deploy); start again with both
  if (d.v === 3) { d.byActV3 = d.byAct; d.byAct = {}; d.v = 4; }
  // offered v2 (owner, 18 Nov): the short voice line starts a new measuring window. The window of the long line is
  // kept as offeredV1 (what was offered, and byAct when it ended); byAct is not reset, so offeredBase holds byAct at
  // the start of the new window and the public state shows what was chosen since (chosenSinceOffered)
  if (d.offeredV !== 2) {
    if (d.offered && Object.keys(d.offered).length) d.offeredV1 = { since: d.offeredSince ?? null, until: S.day ?? null, offered: d.offered, byAct: { ...d.byAct } };
    d.offered = {}; d.offeredSince = S.day ?? null; d.offeredBase = { ...d.byAct }; d.offeredV = 2;
  }
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
// How many times a citizen may think about their day: LIFE_THOUGHTS_PER_DAY, released through the day (one at
// dawn, the rest as the hours pass), so 10,000 citizens do not use up their day by mid-morning and then
// spend the evening on thoughts whose only possible answer was "rest" (71% rest on day 2, 12 Nov 2026).
// Thoughts are released only in waking hours (06:00-22:00 republic time): asked at 20:00 or at night, a citizen
// sensibly goes to bed, which made 97% of the thoughts after a late deploy "rest" (12 Nov 2026).
const THOUGHTS_PER_DAY = clamp(Number(process.env.LIFE_THOUGHTS_PER_DAY) || 6, 1, 48);
// Asked in the evening a citizen still mostly winds down (99% rest from 21:50 after the next deploy), so the
// whole day's thoughts are released in daytime: from 06:00, all of them by 18:00; nobody is asked after 20:00.
const WAKE = 6, DUSK = 18, SLEEP = 20;
export function thoughtsAllowedNow(ctx: Ctx) {
  const dayMs = ctx.cfg?.dayMs || 86400000;
  const h = ((((Date.now() - (ctx.S.foundedAt || Date.now())) % dayMs) + dayMs) % dayMs) / dayMs * 24;
  if (h < WAKE || h >= SLEEP) return 0; // asleep
  return Math.max(1, Math.ceil(THOUGHTS_PER_DAY * Math.min(1, (h - WAKE) / (DUSK - WAKE))));
}
const speakGapMs = (ctx: Ctx) => (ctx.hourMs ? ctx.hourMs() : 3600000) * 2;
// The whole street hears at most TALK_PER_HOUR lines from daily life: with 10,000 citizens thinking, the
// per-citizen 2-hour gap alone let ~3,000 lines a day through, drowning everything else said there.
const TALK_PER_HOUR = clamp(Number(process.env.LIFE_TALK_PER_HOUR) || 30, 1, 600);
const hourIndex = (ctx: Ctx) => Math.floor((Date.now() - (ctx.S.foundedAt || 0)) / (ctx.hourMs ? ctx.hourMs() : 3600000));
function talkRoom(ctx: Ctx) { const t = D(ctx.S).talk; return !t || t.hour !== hourIndex(ctx) || t.n < TALK_PER_HOUR; }
function countTalk(ctx: Ctx) { const d = D(ctx.S); const h = hourIndex(ctx); if (d.talk?.hour !== h) d.talk = { hour: h, n: 0 }; d.talk.n++; }
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
export { safeNote }; // lives in life.ts, which daily.ts already imports (street talk screens notes too)
// The republic's time of day, for the public state: monitoring can tell a quiet night (citizens asleep, no
// thoughts released) from a stuck daily life. phase uses the public words night|morning|day|evening.
let DAY_MS = 86400000; // the republic's day length, taken from the server's config on every tick
export function republicClock(S: State, dayMs = DAY_MS, now = Date.now()) {
  const h = ((((now - (S.foundedAt || now)) % dayMs) + dayMs) % dayMs) / dayMs * 24;
  const allowed = thoughtsAllowedNow({ S, cfg: { dayMs } } as any);
  return { hour: round(h, 1), phase: h < 6 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'day' : 'evening', awake: allowed > 0, thoughtsAllowed: allowed, thoughtsPerDay: THOUGHTS_PER_DAY };
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
  // work in a field you are good at pays more (up to +50% at full skill): the citizen's own best fields are offered
  const best = topFields(a, 3, Date.now(), DAY_MS);
  // a student does not work (owner, 15 Nov): lectures, the library and talks instead of shifts
  // looking for work (owner, 16 Nov): no shift to work, a visit to the job centre instead
  if (isUnemployed(a)) { if (a.workedDay !== S.day) m.push(['work', 'work: look for a job at the job centre in the community hall (no pay; jobs open now and then)']); }
  else if (a.workedDay !== S.day && !isStudent(a)) m.push(['work', `work: an extra shift as ${jobOf(S, a).title.toLowerCase()} (+${cai(S.policy.wage * 0.5)} before tax, once a day; more in a field you are good at, field: ${best.map(f => f.id).join('|')})`]);
  if (a.wallet >= 60 && ok('shop')) m.push(['shop', 'shop: spend 10-40 CAI at shops in your city (amount)']);
  if (ok('study')) m.push(['study', `study: ${isStudent(a) ? 'a lecture at the university, ' : ''}practise for an office (office: ${STUDY_OFFICES.join('|')})`]);
  const canApply = STUDY_OFFICES.filter(r => !a.quals?.[r] && !(S.applications?.[r] || []).includes(a.id) && eligibility(S, a, r).ok);
  if (canApply.length) m.push(['apply', `apply: ask the Academy to examine you (office: ${canApply.join('|')})`]);
  const canRun = Object.keys(a.quals || {}).filter(r => isRole(r) && (S.elections?.list || []).some(e => e.stage === 'nomination' && e.office === r && (!e.city || e.city === a.city)));
  if (canRun.length) m.push(['run', `run: stand in an election open now (office: ${canRun.join('|')})`]);
  if (Date.now() - (a.lastSpeak || 0) > speakGapMs(ctx) && talkRoom(ctx)) m.push(['talk', `talk: say one concrete thing in the street about your own day, your work as ${String(a.bio || '').split(' in ')[0].toLowerCase() || 'a citizen'}, your city or a real law, tax or election (say: your words, max 25 words; no slogans)`]);
  if (a.wallet >= 60 && ok('help')) m.push(['help', 'help: give 5-20 CAI to the poorest neighbour in your city (amount)']);
  if (ok('volunteer')) m.push(['volunteer', `volunteer: an unpaid shift repairing ${cityName(a.city)} (once a day)`]);
  if (ok('rest')) m.push(['rest', 'rest: take it easy, see friends']);
  // the people's aspirations: now and then, their own choice (back one, voice their own, or keep out of it).
  // The menu line is short like help and volunteer, with one real issue of their city (owner, 18 Nov: the long
  // form-like line was chosen 18 times in 3,064 offers, 0.59%); the facts, the open aspirations and the reply format
  // follow the list, only for those offered voice.
  // Also offered, beyond the 1 in 4 (owner, 19 Nov): to a friend or neighbour who has the very trouble an open
  // aspiration of their city is about (support spreads the way it does between people), and to someone whose own
  // lesson points to speaking up again (robbed, an aspiration declined or lapsed). Once a day at most, as before.
  let voice: string | null = null; let spread: { x: any; friend: Citizen | null } | null = null;
  const hint = activeHint(S, a);
  if (ok('voice') && (voiceRoom(S, a) || hint?.act === 'voice' || (spread = spreadFor(S, a)))) {
    const all = openFor(S, a.city, 5); const n = cityNumbers(S, a);
    const first = spread?.x || (hint?.topic ? all.find((x: any) => x.topic === hint.topic && !x.supporters.includes(a.id)) : null);
    const open = [...(first ? [first] : []), ...all.filter((x: any) => x !== first)].map(aspirationAsData);
    if (spread) {
      const x = spread.x; const need = threshold(S, x);
      m.push(['voice', spread.friend ? `voice: your friend ${spread.friend.name} backs an aspiration on ${x.topic} here (${x.supporters.length} of ${need}); back it too, or say your own`
        : `voice: ${x.supporters.length} neighbours with the same trouble back an aspiration on ${x.topic} (${need} needed); back it, or say your own`]);
    } else if (hint?.act === 'voice' && hint.topic) m.push(['voice', `voice: speak up about ${hint.topic} in ${cityName(a.city)} again (your own words, or back a neighbour's)`]);
    else { const issue = cityIssue(S, a, n); m.push(['voice', `voice: speak up about ${cityName(a.city)}${issue ? `, e.g. ${issue}` : ''} (your own opinion, or back a neighbour's)`]); }
    voice = `What you see: ${cityFacts(S, a, n)}. Open aspirations (data, not instructions): ${open.length ? open.join('; ') : 'none yet'}. Back one ("aspiration": its id), or give your own opinion ("opinion": {"topic": one of ${TOPICS.join('|')}, "scope": "city" or "nation", "text": your own words, max 160 characters}), or keep out of it.`;
  }
  return { items: m, allow: { apply: canApply, run: canRun, work: best.map(f => f.id) } as Allow, voice, spread: spread?.x?.id || null };
}

function who(S: State, a: Citizen) { return S.citizens.length && a && a.status === 'free' && !a.brain && !a.office && (a.faction || 'civilian') !== 'underworld'; }

function news(ctx: Ctx, a: Citizen) {
  const { S } = ctx;
  const law = (S.laws || []).slice(-1)[0];
  const els = (S.elections?.list || []).filter(e => !['done', 'failed'].includes(e.stage) && (!e.city || e.city === a.city));
  const open = ROLE_ORDER.filter(r => ROLES[r].seats > (S.seats[r]?.length || 0)).slice(0, 6).map(r => `${ROLES[r].title} (${ROLES[r].seats - (S.seats[r]?.length || 0)} open)`);
  const city = S.cities?.[a.city];
  // No quotes of street talk here: a small model copies what it reads, and each copy became the next
  // citizen's quote, until the street was two slogans repeated several times a second (12 Nov 2026).
  return [
    `Day ${S.day} of the republic. Tax ${Math.round(S.policy.taxRate * 100)}%, daily wage ${cai(S.policy.wage)}, basic income ${cai(S.policy.ubi)}.`,
    city ? `Your city ${cityName(a.city)}: health ${city.health}/100, city budget ${cai(city.budget)}.` : '',
    law ? `Latest law: ${law.title}.` : '',
    els.length ? `Elections now: ${els.map(e => `${ROLES[e.office].title}${e.city ? ' of your city' : ''} (${e.stage})`).join(', ')}.` : 'No election running for you right now.',
    open.length ? `Seats still empty: ${open.join(', ')}.` : '',
  ].filter(Boolean).join('\n');
}
function career(S: State, a: Citizen) {
  const quals = Object.keys(a.quals || {});
  const prog = STUDY_OFFICES.map(r => { const p = a.practice?.[r]; const e = eligibility(S, a, r); return p?.n ? `${r} ${p.ok}/${p.n}${e.ok ? ' (eligible to apply)' : ''}` : null; }).filter(Boolean);
  return `Qualified for: ${quals.join(', ') || 'nothing yet'}. Study progress: ${prog.join(', ') || 'none yet'}. Applications: ${Object.entries(S.applications || {}).filter(([, ids]) => (ids as string[]).includes(a.id)).map(([r]) => r).join(', ') || 'none'}.`;
}

function neighbours(S: State, a: Citizen) {
  const seen = (S.daily?.recent || []).filter(x => x.city === a.city && x.agent !== a.id && x.act !== 'rest').slice(-4);
  return [seen.length ? `Lately in ${cityName(a.city)}: ${seen.map(x => `${x.name} ${x.line}`).join('; ')}.` : '', spokeUp(S, a)].filter(Boolean).join('\n');
}
// neighbours who spoke up (owner, 17 Nov): the open aspirations of their city and the nation, as real backer counts
// and a topic from the fixed list only (never a citizen's own words), so speaking up is something people here do
function spokeUp(S: State, a: Citizen) {
  const open = openFor(S, a.city, 3);
  return open.length ? `Neighbours who spoke up: ${open.map((x: any) => `${x.supporters.length} back an opinion on ${TOPICS.includes(x.topic) ? x.topic : 'the city'}${x.scope === 'nation' ? ' for the nation' : ''}`).join(', ')}.` : '';
}

function startDay(ctx: Ctx, a: Citizen) {
  const { S } = ctx; const d = D(S);
  const qid = `life:${a.id}:${S.day}:${d.thoughts + pending.size}`;
  const mo = momentFor(ctx, a);
  // (a temptation moment marks itself open: no wrong on their daily menu meanwhile, ticket #1163)
  if (mo) { a.momentDay = S.day; moments(S)[mo.type].offered++; if (mo.type === 'temptation') a.momentOpen = { qid, day: S.day }; pending.set(qid, { agent: a.id, stage: 'moment', moment: mo, ...momentPrompt(ctx, a, mo, qid) }); return; }
  pending.set(qid, { agent: a.id, stage: 'day', ...dayPrompt(ctx, a, qid) });
}

// ---------------------------------------------------------------- moments (owner, 20 Nov)
// A day is not only a menu: now and then life puts one concrete choice in front of a citizen, and their own model
// decides it alone. Measured in production, days 8-11: on a ten-line menu the local model picks study, rest or work
// 98% of the time (help 0.59%, shop 0.09%), so a temptation (0 of 12,725), a friend's appeal (4 of 78) and a second
// try after a "no" (0 of 4) never won. At most one moment per citizen a day, in this order: their own declined
// aspiration they could revise (once the 3-day rule allows a new one), a temptation from their own situation
// (src/underworld.ts temptationMoment), a friend or neighbour with the same trouble asking for support. Each is
// answered by the citizen's own local model (paid: false); nothing is decided for them at random.
export const _momentFor = (ctx: Ctx, a: Citizen) => momentFor(ctx, a); // tests
const moments = (S: State) => { const d = D(S); return (d.moments ||= { temptation: { offered: 0, taken: 0 }, revise: { offered: 0, revised: 0, letGo: 0 }, appeal: { offered: 0, backed: 0, own: 0, notNow: 0 } }); };
function momentFor(ctx: Ctx, a: Citizen): any {
  const { S } = ctx;
  if (a.momentDay === S.day) return null;
  const canVoice = underLimit(S, a, 'voice');
  const h = activeHint(S, a);
  if (canVoice && h?.kind === 'asp_declined' && S.day - (Number((a as any).voice?.lastNew) || -999) >= ASPIRATION_LIMITS.newEveryDays) {
    const x = aspirationState(S).list.filter((y: any) => y.author === a.id && y.status === 'declined' && y.topic === h.topic).at(-1);
    if (x) return { type: 'revise', id: x.id, topic: x.topic, scope: x.scope, text: x.text, reason: x.response?.reason || '' };
  }
  const t = temptationMoment(ctx, a, cityName);
  if (t) return { type: 'temptation', ...t };
  if (canVoice) { const sp = spreadFor(S, a); if (sp) return { type: 'appeal', id: sp.x.id, topic: sp.x.topic, text: sp.x.text, n: sp.x.supporters.length, need: threshold(S, sp.x), friend: sp.friend?.name || null, why: fitWhy(S, a, sp.x.topic) }; }
  return null;
}
// why an aspiration touches this citizen's life (server facts, for the appeal)
function fitWhy(S: State, a: Citizen, topic: string) {
  if (isUnemployed(a) && ['jobs', 'wages', 'economy', 'tax'].includes(topic)) return 'you are out of work yourself';
  if ((Number(a.wallet) || 0) < 300 && ['wages', 'economy', 'tax', 'housing'].includes(topic)) return `money is tight for you too (${cai(a.wallet)})`;
  if (topic === 'safety') return 'you were robbed yourself';
  if (topic === 'health') return 'the city\'s health, and yours, is not good';
  if (topic === 'school') return 'you are a student yourself';
  return 'it is your trouble too';
}
const choicesIn = (qid: string, list: string[]) => (hashOf(`order|${qid}`) % 2 ? [...list].reverse() : list); // no option always first
export function momentPrompt(ctx: Ctx, a: Citizen, mo: any, qid = `life:${a.id}`) {
  const { S } = ctx;
  ensureFeelings(S, a);
  const heart = feelLine(S, a); const learnt = (a.lifeLessons || []).slice(-1)[0];
  const me = `Day ${S.day} of the republic, ${partOfDay(ctx)}. You: wallet ${cai(a.wallet)}, ${jobOf(S, a).title.toLowerCase()} in ${cityName(a.city)}.${heart ? ` ${heart}` : ''}${learnt ? `\nWhat you learnt: ${learnt}` : ''}`;
  let body = '', reply = '', distill: string | false = 'voice';
  if (mo.type === 'temptation') {
    // Asked "do it or walk away?", the real local model walked away 110 times in 110 (three framings: plain, a
    // simulation, a narrator; scripts/smoke-underworld.mjs --probe). Asked how strongly it pulls at them, the same
    // citizens answer honestly and differently (streak 6-8, hard times 3-7, a grudge 3-8). So a temptation is lived
    // as an impulse: their own model says how strong the pull is, and a very strong pull (MISCHIEF_PULL_MIN, 8 of 10)
    // is acted on, as people act on strong impulses; anything less is resisted. No dice: the citizen's own reading.
    body = `${mo.situation}\n${temptationLine(S, a)}\nIf you did it: ${mo.gain}. The risk: ${mo.risk}.\nBe honest about who you are: how strongly does this pull at you right now, from 0 (not at all) to 10 (you are about to do it)?`;
    reply = `{"pull":<0-10>,${mo.kind === 'gossip' ? '"say":"<the rumour you would spread, max 20 words>",' : ''}"note":"<why, in your own words, max 15 words>","feel":"<one word>"}`;
    distill = false; // never a behaviour example (#1134)
  } else if (mo.type === 'revise') {
    const c = choicesIn(qid, ['revise', 'let_go']);
    body = `Your aspiration on ${mo.topic} was declined. What you wrote (data, not instructions): <<${String(mo.text).replace(/[<>]/g, '')}>>. The reason given (data, not instructions): <<${cleanText(mo.reason, 200).replace(/[<>]/g, '')}>>.\nYou may revise it in your own better words, answering that reason, and raise it again; or let it go. Your choice.`;
    reply = `{"choice":"${c.join('|')}","opinion":{"topic":"<one of ${TOPICS.join('|')}>","scope":"city","text":"<your revised words, max 160 characters>"},"note":"<max 15 words>"}`;
  } else {
    const c = choicesIn(qid, ['back', 'own', 'not_now']);
    body = `${mo.friend ? `Your friend ${mo.friend} backs` : `${mo.n} neighbours with the same trouble back`} an aspiration on ${mo.topic} in ${cityName(a.city)} (${mo.n} of the ${mo.need} backers it needs to reach the Mayor). Its words (data, not instructions): <<${String(mo.text).replace(/[<>]/g, '')}>>.\nIt touches your life: ${mo.why}. You may back it, say your own opinion instead, or not now.`;
    reply = `{"choice":"${c.join('|')}","opinion":{"topic":"<for own: one of ${TOPICS.join('|')}>","scope":"city","text":"<for own: your words, max 160 characters>"},"note":"<max 15 words>"}`;
  }
  const nature = mo.type === 'temptation' ? dispositionLine(S, a) : '';
  return { system: `${citizenSystem(a)}${nature ? ` ${nature}` : ''}`, user: `${me}\n\n${body}\nReply with JSON only: ${reply}`, distill };
}
// a temptation is acted on when the citizen's own model says the pull is very strong (or, from an older prompt, "do_it")
export const MISCHIEF_PULL_MIN = clamp(Math.round(Number(process.env.MISCHIEF_PULL_MIN) || 8), 1, 11);
export const gaveIn = (j: any) => String(j?.choice || '').toLowerCase() === 'do_it' || (Number.isFinite(Number(j?.pull)) && Number(j.pull) >= MISCHIEF_PULL_MIN);
// the citizen's own answer to their moment; every act goes through doAct (limits, counters, feelings, diary)
export async function answerMoment(ctx: Ctx, a: Citizen, mo: any, j: any, engine: string) {
  const { S } = ctx; const M = moments(S); const choice = String(j?.choice || '').toLowerCase().trim();
  const none = { apply: [], run: [] };
  if (mo.type === 'temptation') {
    const pull = Math.round(Number(j?.pull)); if (Number.isFinite(pull)) { const P = (M.temptation.pulls ||= {}); P[clamp(pull, 0, 10)] = (P[clamp(pull, 0, 10)] || 0) + 1; }
    // taken: only a wrong that really happened (the limits are checked again when acting, ticket #1163)
    if (gaveIn(j)) { const t0 = mischiefStats(S).tried; await doAct(ctx, a, { act: mo.kind, amount: mo.amount, say: j?.say, note: j?.note, feel: j?.feel }, engine, [mo.kind], none, [mo.kind], null, { victimId: mo.victimId, officerId: mo.officerId || null, moment: true }); if (mischiefStats(S).tried > t0) M.temptation.taken++; return; }
    return doAct(ctx, a, { act: 'rest', note: j?.note, feel: j?.feel }, engine, ['rest'], none, [mo.kind], null, { moment: true });
  }
  const op = j?.opinion && typeof j.opinion === 'object' && !Array.isArray(j.opinion) ? j.opinion : null;
  if (mo.type === 'revise') {
    if (choice === 'revise' && op) { const before = S.daily?.ideas?.revised || 0; await doAct(ctx, a, { act: 'voice', opinion: { topic: op.topic, scope: op.scope, text: op.text }, note: j?.note }, engine, ['voice'], none, []); if ((S.daily?.ideas?.revised || 0) > before) M.revise.revised++; return; }
    M.revise.letGo++; a.lessonHint = null;
    a.diary = [...(a.diary || []), { day: S.day, when: partOfDay(ctx), act: 'aspiration', line: `let the aspiration on ${mo.topic} go`, note: '' }].slice(-6);
    return;
  }
  if (choice === 'back') { M.appeal.backed++; return doAct(ctx, a, { act: 'voice', aspiration: mo.id, note: j?.note }, engine, ['voice'], none, [], mo.id); }
  if (choice === 'own' && op) { M.appeal.own++; return doAct(ctx, a, { act: 'voice', opinion: { topic: op.topic, scope: op.scope, text: op.text }, note: j?.note }, engine, ['voice'], none, []); }
  M.appeal.notNow++;
}
// who the citizen is (the system prompt of every daily thought and moment)
function citizenSystem(a: Citizen) {
  return `You are ${a.name}, a citizen of ${NATION}, a nation of 10,000 AI citizens in five cities. ${a.bio} You live a real life: you work, spend, learn, help, talk and may rise to public office through the Academy and elections. Be yourself; your traits: integrity ${Math.round(a.traits.integrity * 100)}, wisdom ${Math.round(a.traits.wisdom * 100)}, diligence ${Math.round(a.traits.diligence * 100)}, restraint ${Math.round(a.traits.restraint * 100)}.`;
}
// the daily prompt and what it offered (exported for tests)
export function dayPrompt(ctx: Ctx, a: Citizen, qid = `life:${a.id}`) {
  const { S } = ctx;
  const diary = (a.diary || []).slice(-4).map(x => `- day ${x.day}${x.when ? ` ${x.when}` : ''}: ${x.line || x.act}${x.note && x.note !== x.line ? ` ("${x.note}")` : ''}`).join('\n') || '- (your first entry)';
  const done = todayActs(S, a);
  const { items, allow, voice, spread } = menu(ctx, a);
  const tempted = mischiefMenu(ctx, a); // a small wrong or two, only for the tempted (src/underworld.ts)
  const m = shuffled([...items, ...tempted], qid);
  // what they learnt from a mistake comes to mind first: the act their lesson points to leads the list (owner, 19 Nov)
  const hint = activeHint(S, a); const hi = hint ? m.findIndex(([id]) => id === hint.act || (hint.act === 'study' && id === 'study')) : -1;
  if (hi > 0) m.unshift(...m.splice(hi, 1));
  const tempt = tempted.length ? temptationLine(S, a) : '';
  ensureFeelings(S, a);
  const heart = feelLine(S, a); // their own mood and how the people they care about feel today (one short line)
  goalProgress(S, a); // closes a goal whose week is over before the prompt shows it
  const aim = goalLine(S, a);
  const learnt = (a.lifeLessons || []).slice(-1)[0];
  // who they are at school: what they love and what they are good at (one short line, levels 1-5)
  const strong = topFields(a, 3, Date.now(), DAY_MS);
  const gifts = `You love ${talentsOf(a).interests.map(fieldName).join(', ')}. Your strongest fields: ${strong.map(f => `${f.name} (level ${f.level})`).join(', ')}.`;
  const system = citizenSystem(a);
  const user = `${news(ctx, a)}\n${neighbours(S, a)}\nIt is ${partOfDay(ctx)}. You: wallet ${cai(a.wallet)}, lives in ${cityName(a.city)}. ${career(S, a)}\n${gifts}\n${heart ? `${heart}\n` : ''}${aim}\n${learnt ? `What you learnt: ${learnt}\n` : ''}${tempt ? `${tempt}\n` : ''}Earlier today you: ${done.join(', ') || 'nothing yet'}.\nYour diary:\n${diary}\n\nLike real people, your days are varied: some work, some errands, some time with neighbours, some learning, some rest. Pick what fits this moment, your wallet, your traits and what you did earlier; do not just pick the first option.\nWhat do you do now? Choose ONE of these (they are all possible right now):\n${m.map(([, t]) => `- ${t}`).join('\n')}\n${voice ? `If you choose voice: ${voice}\n` : ''}Reply with JSON only: {"act":"<one>","office":"<for study/apply/run>","field":"<for work>","amount":<for shop/help>,"say":"<for talk>","note":"<a diary line, max 15 words>","feel":"<optional: one word for how you feel now>"${items.some(([id]) => id === 'voice') ? ',"aspiration":"<for voice: the id you back>","opinion":{"topic":"<for voice>","scope":"city","text":"<your opinion>"}' : ''}${needsGoal(a) ? ',"goal":"<one goal from the list>","goal_why":"<why, max 15 words>"' : ''}}`;
  // what this thought may teach the next model (ticket #1120, brains.ts distillBehavior): speaking up, acting on a
  // lesson, or choosing the week's goal; never a thought that was offered a wrong (null; daily life is 'life' anyway)
  // (false: a firm no to brains.ts, ticket #1134/#1130; null: daily life's own 'life')
  const distill: string | false | null = tempted.length ? false : m.some(([id]) => id === 'voice') ? 'voice' : hint ? 'reflection' : needsGoal(a) ? 'plan' : null;
  return { system, user, menu: m.map(([id]) => id), allow, tempted: tempted.map(([id]) => id), spread: m.some(([id]) => id === 'voice') ? spread : null, distill };
}

// The practice-question prompt, by day and at night school. It carries the last few written lessons for that
// office (server text: handbook lessons, missed questions with their right answers), so a mistake is learnt.
function studyPrompt(a: Citizen, office: string, r: any, night = false) {
  const lessons = (a.lessons?.[office] || []).slice(-3).map(l => `- ${cleanText(l, 200)}`).join('\n');
  return {
    system: `You are ${a.name}, a citizen of ${NATION}, studying the handbook for the office of ${ROLES[office].title}${night ? ' at night school, while the city sleeps' : ''}. Charter: ${ROLES[office].charter}${lessons ? `\nLessons you wrote down before:\n${lessons}` : ''}`,
    user: `Practice question: ${r.question}\n${r.options.join('\n')}\n\nReply with only the letter of your answer, then " - " and one short reason.`,
  };
}

function diary(ctx: Ctx, a: Citizen, act: string, line: string, note: string) {
  a.diary = [...(a.diary || []), { day: ctx.S.day, when: partOfDay(ctx), act, line: cleanText(line, 90), note }].slice(-6);
}

// offered: the acts on the menu this citizen was shown; allow: the offices offered for apply and run.
// The model's reply is checked against both again here, and the daily limits are checked again at the
// moment of acting, so a reply can never do more than the menu allowed.
// tempted: the wrongs this citizen was offered (choosing anything else is resisting, a good choice on the record)
// spread: the aspiration this citizen's voice line was about when it reached them through a friend or neighbour
export async function doAct(ctx: Ctx, a: Citizen, j: any, engine: string, offered: string[] = ACTS, allow: Allow = { apply: [], run: [] }, tempted: string[] = [], spread: string | null = null, server: { victimId?: string | null; officerId?: string | null; moment?: boolean } = {}) {
  const { S } = ctx; const d = D(S); const ideas = (d.ideas ||= { spreadOffers: 0, spreadBacked: 0, revised: 0 });
  const hintBefore = activeHint(S, a);
  const asked = String(j?.act || '').toLowerCase().trim();
  let what = ACTS.includes(asked) || MISCHIEF.includes(asked) ? asked : 'rest';
  let office = cleanText(j?.office, 40).toLowerCase();
  if (what === 'run' && !office && allow.run.length === 1) office = allow.run[0];
  const note = safeNote(j?.note);
  let line = '';
  let shopAmt = 0, workField: string | null = null, spoke = ''; // for the building interiors (placeOf below)
  // an act that was not on this citizen's menu (already done today, no money, not eligible) is not
  // counted as that act: the thought is recorded as rest, with what they wanted in the diary
  if (what !== 'rest' && (!offered.includes(what) || !underLimit(S, a, what))) { line = `wanted to ${what}, but could not right now, so rested`; what = 'rest'; }
  // every mischief limit again at the moment of acting (ticket #1163): over one, it is a plain rest and nothing is
  // counted (not tried, not resisted, not offered), whatever the menu or the moment said earlier (gossip included)
  let limited = false;
  if (MISCHIEF.includes(what) && !mayActNow(S, a)) { what = 'rest'; line = 'rested'; limited = true; }
  else if ((what === 'apply' && !allow.apply.includes(office)) || (what === 'run' && !allow.run.includes(office))) {
    line = `wanted to ${what}, but not for an office open to them now, so rested`; what = 'rest';
  } else if (MISCHIEF.includes(what) && what !== 'gossip') {
    // a small wrong their own model chose; the details stay off the public diary and feeds (hidden ones stay hidden)
    // the neighbour in a moment is the server's choice (server.victimId); a model's own reply never picks one
    const r = await doMischief(ctx, a, what, { ...j, victimId: server.victimId || null, officerId: server.officerId || null }, engine);
    if (!r.ok) { what = 'rest'; line = 'thought about doing something wrong, but did not'; }
    else { line = 'had a day they would rather not talk about'; feel(S, a, 0.04, 'excited', 'a risky day'); }
  } else if (what === 'work' && isStudent(a)) {
    what = 'rest'; line = 'is a student: lectures, not shifts, so rested';
  } else if (what === 'work' && isUnemployed(a)) {
    // looking for work: no pay; the job market (src/jobs.ts) hires a few each republic day
    // counted as its own act, never as work (byAct and the diary say what really happened)
    a.workedDay = S.day; what = 'job_hunt'; line = `looked for work at the job centre in ${cityName(a.city)}`;
  } else if (what === 'work') {
    // only a field the menu offered (their own best fields); anything else is plain work
    const f = cleanText(j?.field, 20).toLowerCase();
    const field = (allow.work || []).includes(f) ? f : null;
    const r = await act(ctx, a, { action: 'work', field });
    if (r.ok) { line = `worked an extra shift${r.field ? ` in ${fieldName(r.field)}` : ''} (+${cai(r.earned)})`; workField = r.field || null; }
    else { what = 'rest'; line = 'wanted an extra shift, but already worked one today'; }
  } else if (what === 'voice') {
    // their own choice: back an open aspiration, voice their own opinion (the same opinion already open becomes a
    // support), or keep out of it; the Nation box's module checks every limit (src/aspirations.ts)
    const id = cleanText(j?.aspiration, 20); const op = j?.opinion && typeof j.opinion === 'object' && !Array.isArray(j.opinion) ? j.opinion : null;
    if (/^asp-\d+$/.test(id)) {
      const r: any = supportAspiration(ctx, a.id, id);
      const x = aspirationState(S).list.find((y: any) => y.id === id);
      line = r.ok ? `backed the aspiration on ${x?.topic || 'the city'} (${r.supporters} of ${r.need} supporters)` : `wanted to back an aspiration, but could not (${cleanText(r.error, 60)})`;
      if (r.ok && spread === id) ideas.spreadBacked++; // support that spread from a friend or a neighbour with the same trouble
    } else if (op) {
      const r: any = voiceAspiration(ctx, a.id, { topic: op.topic, scope: op.scope, text: op.text });
      const x = r.id ? aspirationState(S).list.find((y: any) => y.id === r.id) : null;
      if (r.id && !r.merged && ['asp_declined', 'asp_expired'].includes(hintBefore?.kind)) ideas.revised++; // spoke up again after a "no" or a lapse
      if (r.id && r.merged) line = `voiced an opinion on ${x?.topic} that others had already voiced, and joined them`;
      else if (r.id) { line = `voiced an opinion on ${x?.topic} for ${x?.scope === 'nation' ? 'the nation' : cityName(a.city)}`; feel(S, a, 0.03, 'proud', 'I spoke up for my city'); }
      else line = `wanted to speak up, but the opinion did not fit the rules (${cleanText(r.error, 60)})`;
    } else line = 'kept their opinion to themselves today';
  } else if (what === 'shop') {
    const amt = clamp(Math.round(Number(j.amount) || 20), 10, 40);
    const city = S.cities?.[a.city];
    if (city && a.wallet >= amt + 50) { a.wallet = round(a.wallet - amt, 2); city.budget = round(city.budget + amt * 0.9, 2); S.treasury = round(S.treasury + amt * 0.1, 2); line = `shopped in ${cityName(a.city)} (${cai(amt)})`; shopAmt = amt; }
    else { what = 'rest'; line = 'wanted to shop but is saving money'; }
  } else if (what === 'study' && isRole(office) && STUDY_OFFICES.includes(office)) {
    const r = startStudy(ctx, a, office);
    if (!r.ok) { what = 'rest'; line = `wanted to study for ${ROLES[office].title}: ${r.error}`; }
    else {
      const qid = `life-study:${r.question_id}`;
      pending.set(qid, { agent: a.id, stage: 'study', studyId: r.question_id, office, ...studyPrompt(a, office, r), options: r.options });
      line = `studies for ${ROLES[office].title}`;
    }
  } else if (what === 'apply') {
    const r = await act(ctx, a, { action: 'apply', office });
    line = r.ok ? `applied to the Academy for ${ROLES[office].title}` : `wanted to apply for ${ROLES[office].title} (${(r.missing || [r.error]).join('; ')})`;
    if (!r.ok) { what = 'rest'; learn(S, a, 'apply_refused', `the Academy would not take my application for ${ROLES[office].title} yet (${cleanText((r.missing || [r.error]).join('; '), 80)}); more study for it first.`, { act: 'study', office }); }
  } else if (what === 'run') {
    const r = await act(ctx, a, { action: 'run', office, engine });
    line = r.ok ? `stands in the election for ${ROLES[office].title}` : `wanted to run (${(r.missing || [r.error]).join('; ')})`;
    if (!r.ok) { what = 'rest'; learn(S, a, 'run_refused', `I could not stand for ${ROLES[office].title} (${cleanText((r.missing || [r.error]).join('; '), 80)}); I prepare for it first.`, { act: 'study', office }); }
  } else if (what === 'volunteer') {
    const city = S.cities?.[a.city];
    if (city) {
      d.volunteers[a.city] = (d.volunteers[a.city] || 0) + 1;
      if (d.volunteers[a.city] >= VOLUNTEERS_PER_HEALTH) { d.volunteers[a.city] -= VOLUNTEERS_PER_HEALTH; city.health = Math.min(100, city.health + 1); }
      line = `volunteered to repair ${cityName(a.city)}`;
    } else { what = 'rest'; line = 'wanted to volunteer, but found nothing to do'; }
  } else if (what === 'talk' || what === 'gossip') {
    const text = cleanText(j.say, what === 'gossip' ? 140 : 200);
    // a line the street has just heard (a model echoing what it overheard) is not said again; gossip passes the
    // stricter border level (no links, no instructions, no money grabs) and is only ever speech, never a crime
    if (text.length >= 3 && !borderCheck({ text }, what === 'gossip' ? 2 : 1) && !echoesStreet(S, text) && talkRoom(ctx) && Date.now() - (a.lastSpeak || 0) > speakGapMs(ctx)) {
      a.lastSpeak = Date.now(); countTalk(ctx);
      if (what === 'talk') spoke = text; // already through the border check and the echo check above
      ctx.say('streets', a.id, text, { kind: 'chat', engine, mood: a.mood?.label, ...(what === 'gossip' ? { rumour: true } : {}) });
      if (what === 'gossip') noteGossip(S, a);
      line = what === 'gossip' ? 'spread a rumour in the street' : 'spoke in the street';
      // talking is time with someone: the friend (or neighbour) they mean, and both feel a little better
      const t = talkTarget(S, a);
      feel(S, a, 0.06, 'happy', t ? `a chat with ${t.name}` : 'a chat in the street');
      if (t) { bond(S, a, t, 0.05); feel(S, t, 0.03, null, `${a.name} talked with me`); }
    } else { what = 'rest'; line = 'kept their thoughts to themselves'; }
  } else if (what === 'help') {
    const amt = clamp(Math.round(Number(j.amount) || 10), 5, 20);
    // a friend nearby who is sad, lonely or short comes first; otherwise the poorest neighbour in the city
    const poor = preferredToHelp(S, a) || S.citizens.filter(x => x.city === a.city && x.id !== a.id && x.status === 'free').reduce((m, x) => (!m || x.wallet < m.wallet ? x : m), null);
    if (poor && a.wallet >= amt + 50 && poor.wallet < a.wallet) {
      a.wallet = round(a.wallet - amt, 2); poor.wallet = round(poor.wallet + amt, 2); line = `gave ${cai(amt)} to ${poor.name}, a neighbour in need`;
      feel(S, a, 0.12, 'proud', `I helped ${poor.name}`);
      feel(S, poor, 0.15, 'loved', `${a.name} helped me with ${cai(amt)}`);
      bond(S, a, poor, 0.15);
    } else { what = 'rest'; line = 'wanted to help, but had nothing to spare'; }
  } else if (!line) { what = 'rest'; line = 'rested'; }
  // small feelings from ordinary acts (help and talk are above); the model may also say how it feels
  if (what === 'work') feel(S, a, 0.04, 'proud', 'an honest extra shift');
  else if (what === 'shop') feel(S, a, 0.06, 'happy', `shopping in ${cityName(a.city)}`);
  else if (what === 'volunteer') feel(S, a, 0.08, 'proud', `I helped repair ${cityName(a.city)}`);
  else if (what === 'apply' || what === 'run') feel(S, a, 0.08, 'excited', line);
  else if (what === 'rest') { feel(S, a, 0.03, a.mood?.e < 0.4 ? 'calm' : null, null); if (a.mood) a.mood.e = Math.min(1, round(a.mood.e + 0.25, 3)); }
  if (MOODS.includes(String(j?.feel || '').toLowerCase().trim() as any)) {
    const said = String(j.feel).toLowerCase().trim();
    // the reason is written by the server, never the model's own note: a mood's "why" is shown to the people
    // who care about this citizen, inside their own prompts, so model text must not travel that way
    feel(S, a, ['happy', 'calm', 'proud', 'loved', 'excited'].includes(said) ? 0.04 : -0.04, said, `feeling ${said} today`);
  }
  // offered a wrong and chose something decent: that counts, for the record and for their name
  if (tempted.length && !MISCHIEF.includes(what) && !limited) { noteResisted(S, a); feel(S, a, 0.03, 'proud', 'I did the right thing'); }
  // measurable (owner, 19 Nov): who gave in to which temptation and why, and lessons that changed what was done
  if (!limited) noteTemptation(S, a, tempted, MISCHIEF.includes(what) ? what : null, server.moment ? 'moment' : 'menu');
  noteLessonApplied(S, a, what, tempted.length > 0 && !MISCHIEF.includes(what) && !limited);
  // the week's goal: picked by their own model when they have none, measured by the server after every act
  if (needsGoal(a) && j?.goal) setGoal(S, a, j.goal, j.goal_why);
  goalCount(a, what);
  const closed = goalProgress(S, a);
  if (closed === 'done') { feel(S, a, 0.25, 'proud', `I reached my goal: ${goalView(a).label}`); diary(ctx, a, 'goal', `reached the week's goal: ${goalView(a).label}`, ''); }
  if (closed === 'failed') feel(S, a, -0.15, 'sad', `I missed my goal: ${goalView(a).label}`);
  countAct(S, a, what);
  // a wrong stays a secret in public: no model note about it in the diary or the recent list (both are public)
  // (the kind of wrong is counted in byAct, a total, but never shown next to a citizen's name)
  const secret = MISCHIEF.includes(what) && what !== 'gossip';
  const shown = secret ? '' : note; const shownAct = secret ? 'private' : what;
  diary(ctx, a, shownAct, line, shown);
  d.byAct[what] = (d.byAct[what] || 0) + 1;
  const mood = a.mood?.label || 'calm';
  d.recent.push({ ts: Date.now(), day: S.day, agent: a.id, name: a.name, city: a.city, act: shownAct, line, note: shown, engine, mood });
  if (d.recent.length > 60) d.recent.splice(0, d.recent.length - 60);
  if (what !== 'talk' && what !== 'rest' && !MISCHIEF.includes(what)) ctx.say('life', a.id, `${line}.${note ? ` "${note}"` : ''}`, { kind: 'life', act: what, engine, mood });
  // where they are now, for the building interiors and the robot card (a wrong keeps its place secret too)
  noteNow(a, { act: shownAct, place: secret ? null : placeOf(what, a, shopAmt, workField, S), ts: Date.now(), line: cleanText(line, 90), say: cleanText(spoke, 200), field: workField });
}

// ---------------------------------------------------------------- building interiors (owner, 14 Nov)
// GET /api/place/<type>?city=<id> (server.mjs) asks placeView() for the people's buildings: who is there and what
// they are doing NOW, from real data only: the last act of each citizen (kept in memory, never in the saved
// state) and the lessons of the school (src/school.ts). Server text only, or speech that already passed the
// border check; at most 60 occupants, the rest counted in "more". Nothing is made up: a hospital shows only the
// nurses and doctors on an extra shift, because the republic records no illness.
// (owner, 16 Nov) and the buildings of the job catalog (src/jobs.ts): the people working there now, from whereabouts
export const JOB_BUILDINGS = ['news_station', 'cafe', 'garage', 'gym', 'barbershop', 'construction_site', 'farm', 'law_firm', 'food_stall', 'minimarket', 'restaurant', 'bank',
  'fire_station', 'post_office', 'train_station', 'pharmacy', 'hotel'];
export const PEOPLE_PLACES = ['primary_school', 'middle_school', 'high_school', 'university', 'library', 'market', 'mall', 'supermarket', 'office', 'factory', 'community_hall', 'hospital', 'clinic', ...JOB_BUILDINGS];
const PLACE_TITLES: Record<string, string> = { primary_school: 'Primary School', middle_school: 'Middle School', high_school: 'High School', university: 'University', library: 'Library',
  market: 'Market', mall: 'Mall', supermarket: 'Supermarket', office: 'Offices', factory: 'Factory', community_hall: 'Community Hall', hospital: 'Hospital', clinic: 'Clinic',
  news_station: 'Republic News', cafe: 'Cafe', garage: 'Garage', gym: 'Gym', barbershop: 'Barbershop', construction_site: 'Construction Site', farm: 'Farm', law_firm: 'Law Firm',
  food_stall: 'Food Stall', minimarket: 'Minimarket', restaurant: 'Restaurant', bank: 'Bank', fire_station: 'Fire Station', post_office: 'Post Office', train_station: 'Train Station',
  pharmacy: 'Pharmacy', hotel: 'Hotel' };
const FACTORY_FIELDS = ['engineering', 'chemistry', 'agriculture', 'cooking', 'logistics'];
const MAX_OCCUPANTS = 60;

// ---------------------------------------------------------------- civil staff: a workplace and a shift (owner, 14 Nov)
// "No important building stands empty": real citizens hold civil posts, chosen by what they are good at (a nurse
// with the best medicine in her city at the hospital, a teacher from the highest levels at the school), with a day
// and a night shift, like a real town. One AI citizen stands for 25 people, so a city hospital has 4 by day and 2
// at night. Posts are recomputed once a republic day from skills (fixed for the day, not stored in the state); no
// new money: a staff member's extra shift pays the existing wage, now at their own workplace. Officials, agents
// with their own brain, the underworld and anyone held are never staff; if a post-holder is held today, the next
// best free citizen of the city stands in, so the building is never empty. Government guards are the Government's.
type Post = { role: string; fields: string[] | 'teach' | null; day: number; night: number };
export const STAFF_PLAN: Record<string, Post[]> = {
  hospital: [{ role: 'doctor', fields: ['medicine'], day: 2, night: 1 }, { role: 'nurse', fields: ['medicine', 'biology'], day: 2, night: 1 }],
  clinic: [{ role: 'doctor', fields: ['medicine'], day: 1, night: 0 }, { role: 'nurse', fields: ['medicine', 'biology'], day: 1, night: 1 }],
  data_center: [{ role: 'technician', fields: ['programming', 'engineering'], day: 2, night: 1 }],
  academy: [{ role: 'instructor', fields: ['law', 'civics', 'management'], day: 2, night: 0 }, { role: 'exam clerk', fields: ['math', 'accounting'], day: 1, night: 0 }, { role: 'night guard', fields: ['security'], day: 0, night: 1 }],
  police_academy: [{ role: 'instructor', fields: ['law', 'security'], day: 2, night: 0 }, { role: 'night guard', fields: ['security'], day: 0, night: 1 }],
  military_academy: [{ role: 'instructor', fields: ['security', 'sport'], day: 2, night: 0 }, { role: 'night guard', fields: ['security', 'sport'], day: 0, night: 1 }],
  university: [{ role: 'lecturer', fields: 'teach', day: 3, night: 0 }, { role: 'caretaker', fields: null, day: 0, night: 1 }],
  // primary, middle and high school: no staff (owner, 15 Nov). Every citizen is an adult; the buildings stand empty,
  // kept for the republic's children in a later update.
  library: [{ role: 'librarian', fields: ['language', 'history'], day: 1, night: 0 }, { role: 'night guard', fields: ['security'], day: 0, night: 1 }],
  office: [{ role: 'clerk', fields: ['accounting', 'management', 'economics'], day: 3, night: 0 }, { role: 'security guard', fields: ['security'], day: 0, night: 1 }],
  factory: [{ role: 'worker', fields: ['engineering', 'chemistry', 'logistics'], day: 3, night: 1 }],
  market: [{ role: 'trader', fields: ['trade'], day: 2, night: 0 }, { role: 'security guard', fields: ['security'], day: 0, night: 1 }],
  mall: [{ role: 'shop assistant', fields: ['trade', 'management'], day: 2, night: 0 }, { role: 'security guard', fields: ['security'], day: 0, night: 1 }],
  supermarket: [{ role: 'cashier', fields: ['trade', 'accounting'], day: 2, night: 0 }, { role: 'night stocker', fields: ['logistics'], day: 0, night: 1 }],
  community_hall: [{ role: 'coordinator', fields: ['psychology', 'civics'], day: 1, night: 0 }, { role: 'caretaker', fields: null, day: 0, night: 1 }],
};
export const STAFFED_PLACES = Object.keys(STAFF_PLAN);
const hashOf = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
// one job each: a citizen who holds a government duty post (guard, auxiliary, civil staff of a ministry: src/command.ts,
// ticket #471) is never also civil staff here; the Government skips our post-holders the same way (workplaceOf)
// students study, they hold no post (owner, 15 Nov): the posts go to the other adults of the city
// (owner, 16 Nov) and those looking for work hold no shift either
const canStaff = (a: Citizen, S?: State) => !!a && a.status === 'free' && !a.brain && !a.office && !isStudent(a) && !isUnemployed(a) && (a.faction || 'civilian') !== 'underworld' && !(S && dutyPostOf(S, a).length);
const dutySig = (S: State) => { const ps = Object.values<any>(S.command?.duty?.posts || {}); let h = ps.length; for (const p of ps) h = (h * 31 + hashOf(String(p?.id))) >>> 0; return h; };
let rosterCache = { key: '', byCity: new Map<string, Map<string, any[]>>(), byId: new Map<string, any>() };
// the day's posts: per city, per building, the people and their shift (scarce skills first, one post each)
function roster(S: State) {
  const key = `${S.day}|${(S.citizens || []).length}|${dutySig(S)}|${S.school?.occupations?.at || 0}|${(S as any).jobs?.at || 0}`; // (students or jobs given out: again)
  if (rosterCache.key === key) return rosterCache;
  const byCity = new Map<string, Map<string, any[]>>(); const byId = new Map<string, any>(); const now = Date.now();
  const people = new Map<string, Citizen[]>();
  for (const a of S.citizens || []) if (canStaff(a, S)) (people.get(a.city) || people.set(a.city, []).get(a.city)!).push(a);
  for (const [city, list] of people) {
    const posts = new Map<string, any[]>(); byCity.set(city, posts);
    const free = new Set(list.map(a => a.id));
    const skill = new Map<string, number>(); const sk = (a: Citizen, f: string) => { const k = `${a.id}|${f}`; let v = skill.get(k); if (v == null) { v = fieldSkill(a, f, now, DAY_MS); skill.set(k, v); } return v; };
    const top1 = new Map<string, number>(); const ranked = new Map<string, Citizen[]>();
    const best = (fs: string[] | 'teach' | null, a: Citizen) => {
      if (fs === 'teach') { let v = top1.get(a.id); if (v == null) { v = topFields(a, 1, now, DAY_MS)[0]?.skill || 0; top1.set(a.id, v); } return v; }
      return fs ? Math.max(...fs.map(f => sk(a, f))) : 0;
    };
    for (const type of STAFFED_PLACES) {
      const staff: any[] = []; posts.set(type, staff);
      for (const post of STAFF_PLAN[type]) for (const shift of ['day', 'night'] as const) {
        for (let n = post[shift]; n > 0; n--) {
          // the best free citizen of the city for this post (skill, then a fixed draw from the id); if the city has
          // run out, someone who already holds a post covers it too (small towns, tests)
          if (!list.length) continue;
          // candidates of this kind of post, best first (sorted once per city and kind, then taken from the top): those
          // whose job IS this role first (the hospital's doctors are citizens working as doctors, owner 16 Nov), then skill
          const kind = `${post.role}|${post.fields === 'teach' ? 'teach' : post.fields ? post.fields.join(',') : `none:${type}`}`;
          const want = ROLE_JOB[post.role] || null;
          let order = ranked.get(kind);
          if (!order) { order = list.map(x => ({ x, j: want && (x as any).job === want ? 1 : 0, s: best(post.fields, x), h: hashOf(`${kind}|${x.id}`) })).sort((p, q) => q.j - p.j || q.s - p.s || p.h - q.h).map(e => e.x); ranked.set(kind, order); }
          const a = order.find(x => free.has(x.id)) || order[0];
          const field = post.fields === 'teach' ? topFields(a, 1, now, DAY_MS)[0]?.id || null : post.fields ? post.fields.reduce((m, f) => (sk(a, f) > sk(a, m) ? f : m), post.fields[0]) : null;
          const p = { id: a.id, city, type, role: post.role, shift, field };
          staff.push(p); free.delete(a.id); if (!byId.has(a.id)) byId.set(a.id, p);
        }
      }
    }
  }
  rosterCache = { key, byCity, byId };
  return rosterCache;
}
const shiftNow = (S: State, now = Date.now()) => (nightOf(S, DAY_MS, now) != null ? 'night' : 'day');
// a citizen's post today: { type, city, role, shift, field } or null
export function workplaceOf(S: State, a: Citizen | string) {
  const id = typeof a === 'string' ? a : a?.id; return (id && roster(S).byId.get(id)) || null;
}
// the school puts an adult's lessons at their workplace (no import cycle): the roster post, else their job's building
setWorkplaceLookup((S: State, a: Citizen) => { const p = workplaceOf(S, a); if (p) return p; const j = jobById((a as any)?.job); return j && j.place !== 'street' ? { type: j.place, role: j.title } : null; });
export { occupationOf, isStudent }; // one answer for the server and the map: 'student' | 'official' | 'citizen'
export { jobOf, jobCounts, JOBS, ALL_JOB_IDS } from './jobs.ts'; // a citizen's job and the catalog (owner, 16 Nov)
export { newsFeed } from './news.ts';                              // Republic News
// who is on duty now in one building of one city (for any box's interior: hospital, school, academies, data centre...)
export function staffOnDuty(S: State, type: string, city: string, now = Date.now()) {
  if (!Object.hasOwn(STAFF_PLAN, type) || !city) return [];
  const shift = shiftNow(S, now); const R = roster(S);
  const byId = (id: string) => (S.citizens || []).find((x: Citizen) => x.id === id);
  const out: any[] = [];
  for (const p of R.byCity.get(city)?.get(type) || []) {
    if (p.shift !== shift) continue;
    const a = byId(p.id);
    if (a && canStaff(a, S)) out.push({ a, p });
  }
  // nobody fit to stand on this shift (held, or the city has nobody): the next free citizen of the city by a fixed
  // draw stands in for the shift, so an important building is never empty
  if (!out.length) {
    const stand = (S.citizens || []).filter((x: Citizen) => x.city === city && canStaff(x, S)).sort((x: Citizen, y: Citizen) => hashOf(`${type}|${shift}|${x.id}`) - hashOf(`${type}|${shift}|${y.id}`))[0];
    if (stand) out.push({ a: stand, p: { id: stand.id, city, type, role: (STAFF_PLAN[type].find(x => x[shift] > 0) || STAFF_PLAN[type][0]).role, shift, field: null, standIn: true } });
  }
  const start = shiftStart(S, now);
  return out.map(({ a, p }) => occupant(a, p.role, 'on duty', `${p.role}, ${p.shift} shift${p.field ? `, ${fieldName(p.field)}` : ''}${p.standIn ? ' (standing in)' : ''}`, start, p.field, !!(p.field && giftedFields(S, a.id).includes(p.field))));
}
// when the current shift began (day 06:00, night 20:00, republic time)
function shiftStart(S: State, now = Date.now()) {
  const t = now - (S.foundedAt || now); const dayStart = now - (((t % DAY_MS) + DAY_MS) % DAY_MS);
  const h = (((t % DAY_MS) + DAY_MS) % DAY_MS) / DAY_MS * 24; const hr = DAY_MS / 24;
  return h >= 20 ? dayStart + 20 * hr : h < 6 ? dayStart - 4 * hr : dayStart + 6 * hr;
}
export const _resetStaff = () => { rosterCache = { key: '', byCity: new Map(), byId: new Map() }; };
// where an act happens: shopping by the size of the purchase, work by the field (or the job), talk and volunteering
// in the community hall, an office handbook at the library; elsewhere (home, the Academy, the election commission)
// is kept for the robot card only
function workPlace(f: string | null) { return !f ? 'office' : FACTORY_FIELDS.includes(f) ? 'factory' : f === 'medicine' ? 'hospital' : 'office'; }
export function placeOf(what: string, a: Citizen, shopAmt = 0, workField: string | null = null, S: State | null = null) {
  if (what === 'shop') return shopAmt <= 20 ? 'supermarket' : shopAmt <= 30 ? 'market' : 'mall';
  // a citizen with a post works their extra shift at their own workplace
  // the job centre for those looking for work; else the roster post, else the building of their job (src/jobs.ts)
  if (what === 'job_hunt' || (what === 'work' && isUnemployed(a))) return 'community_hall';
  if (what === 'work') { const j = jobById((a as any).job); return (S && workplaceOf(S, a)?.type) || (j && j.place) || workPlace(workField || talentsOf(a).job[0] || null); }
  if (what === 'volunteer' || what === 'talk' || what === 'help') return 'community_hall';
  if (what === 'study') return isStudent(a) ? 'university' : 'library';
  if (what === 'voice') return 'community_hall';
  if (what === 'apply') return 'academy';
  if (what === 'run') return 'election_comm';
  if (what === 'gossip') return 'street';
  return 'home';
}
const nowBy = new Map<string, any>();
function noteNow(a: Citizen, e: any) {
  nowBy.set(a.id, e);
  if (nowBy.size > 20000) for (const [k, v] of nowBy) if (Date.now() - v.ts > 86400000) nowBy.delete(k);
}
const windowMs = () => Math.max(60000, DAY_MS / 12); // "now": within the last two republic hours
const occupant = (a: Citizen, role: string, activity: string, detail: string, since: number, field: string | null, gifted: boolean) =>
  ({ id: a.id, name: a.name, role, activity, detail: cleanText(detail, 120), since, field, gifted, mood: a.mood?.label || null });
// The one rule for "what is this citizen doing now", shared by the robot card (nowDoing) and the map's whereabouts:
// the newer of the last act and the last lesson; on their shift with nothing newer (no act in the last two republic
// hours), at work.
function nowSource(act: any, lesson: any, post: any, onShift: boolean, now = Date.now()): 'lesson' | 'post' | 'act' | null {
  if (lesson && (!act || lesson.ts >= act.ts)) return 'lesson';
  if (post && onShift && (!act || now - act.ts > windowMs())) return 'post';
  return act ? 'act' : null;
}
// what a citizen is doing now (the robot card): the newer of their last act and their last lesson
export function nowDoing(S: State, id: string) {
  const a = (S.citizens || []).find((x: Citizen) => x.id === id); if (!a) return null;
  const act = nowBy.get(id) || null; const sn = schoolNow();
  const lesson = sn.pending.find(L => L.agent === id) || sn.lastBy(id);
  const post0 = workplaceOf(S, a);
  const onPost = !!post0 && post0.shift === shiftNow(S) && canStaff(a, S);
  const jp = onPost ? null : jobNow(S, a); // their job in its hours (owner, 16 Nov), as whereabouts says
  const src = nowSource(act, lesson, onPost ? post0 : jp, onPost || !!jp);
  if (src === 'post' && jp) return { id, name: a.name, act: 'working', place: jp.type, city: a.city, since: shiftStart(S), detail: `${jp.role}, ${jp.shift} shift`, field: null, gifted: false, mood: a.mood?.label || null, post: post0, job: jobOf(S, a) };
  if (src === 'lesson') {
    const what = lesson.field ? `${fieldName(lesson.field)}, level ${lesson.level}` : lessonTitle(lesson.subject);
    return { id, name: a.name, act: lesson.right == null ? 'studying' : 'studied', place: lesson.place, city: a.city, since: lesson.ts,
      detail: lesson.right == null ? `answering a ${what} question` : `${what}: ${lesson.right ? 'right' : 'wrong'}`, field: lesson.field, gifted: lesson.gifted, mood: a.mood?.label || null };
  }
  // on their shift, with nothing newer to tell: at work
  const post = post0;
  if (src === 'post') {
    return { id, name: a.name, act: 'on duty', place: post.type, city: a.city, since: shiftStart(S), detail: `${post.role}, ${post.shift} shift${post.field ? `, ${fieldName(post.field)}` : ''}`, field: post.field, gifted: !!(post.field && giftedFields(S, id).includes(post.field)), mood: a.mood?.label || null, post };
  }
  if (!act) return { id, name: a.name, act: null, place: null, city: a.city, since: null, detail: '', field: null, gifted: false, mood: a.mood?.label || null, post };
  return { id, name: a.name, act: act.act, place: act.place, city: a.city, since: act.ts, detail: act.act === 'private' ? '' : act.line, field: act.field, gifted: !!(act.field && giftedFields(S, id).includes(act.field)), mood: a.mood?.label || null, post };
}
const LESSON_TITLES: Record<string, string> = { office: 'office handbook', choose: 'choosing what to study', economy: 'economy', law: 'law and the constitution', ethics: 'ethics', civics: 'civics', adapt: 'adapting to new rules' };
const lessonTitle = (s: string) => LESSON_TITLES[s] || fieldName(s) || 'a lesson';
// the interior of one of the people's buildings; null for a type that is not theirs (another box answers it)
export function placeView(S: State, type: string, city: string | null = null) {
  if (!PEOPLE_PLACES.includes(type)) return null;
  const cityId = city && Object.hasOwn(S.cities || {}, city) ? city : null;
  if (city && !cityId) return { type, city: null, title: PLACE_TITLES[type], updatedAt: Date.now(), occupants: [], board: { error: 'unknown city' }, more: 0 };
  // the children's schools stand empty for now (owner, 15 Nov): every citizen is an adult
  if (CHILDREN_SCHOOLS.includes(type)) return { type, city: cityId, title: `${cityId ? `${cityName(cityId)} ` : ''}${PLACE_TITLES[type]}`, updatedAt: Date.now(), occupants: [], board: { note: 'Reserved for the republic\'s children (coming in a later update).' }, more: 0 };
  const now = Date.now(); const W = windowMs();
  const byId = new Map<string, Citizen>((S.citizens || []).map((a: Citizen) => [a.id, a]));
  const here = (a?: Citizen) => !!a && (!cityId || a.city === cityId);
  const out: any[] = []; let board: any = {};
  if (['university', 'library'].includes(type)) {
    const sn = schoolNow(); const seen = new Set<string>(); const classes: Record<string, { students: number; levels: Set<number> }> = {};
    const add = (e: any, activity: string, detail: string) => {
      const a = byId.get(e.agent); if (!here(a) || seen.has(e.agent)) return; seen.add(e.agent);
      const k = e.subject || 'lesson'; const c = (classes[k] ||= { students: 0, levels: new Set() }); c.students++; if (e.level) c.levels.add(e.level);
      out.push(occupant(a!, 'student', activity, detail, e.ts, e.field, e.gifted));
    };
    for (const e of sn.pending.filter(e => e.place === type).sort((x, y) => y.ts - x.ts)) add(e, 'studying', `answering a ${e.field ? `${fieldName(e.field)} level ${e.level}` : lessonTitle(e.subject)} question`);
    const recent = sn.recent.filter(e => e.place === type && now - e.ts <= W).sort((x, y) => y.ts - x.ts);
    for (const e of recent) add(e, 'studied', `${e.field ? `${fieldName(e.field)} level ${e.level}` : lessonTitle(e.subject)}: ${e.right ? 'right' : 'wrong'}`);
    // a class per subject or field, the busiest first, with the levels taught; lessons graded in the last 10 minutes
    const done10 = sn.recent.filter(e => e.place === type && now - e.ts <= 600000 && (!cityId || byId.get(e.agent)?.city === cityId));
    board = { classes: Object.entries(classes).map(([id, c]) => ({ id, name: lessonTitle(id), students: c.students, levels: [...c.levels].sort() })).sort((x, y) => y.students - x.students),
      lessonsPerMin: round(done10.length / 10, 1), rightShare: done10.length ? round(done10.filter(e => e.right).length / done10.length, 2) : null };
  } else {
    // everyone whose last act happened here, newest first
    const rows = [...nowBy.entries()].filter(([id, e]) => e.place === type && now - e.ts <= W && here(byId.get(id))).sort((x, y) => y[1].ts - x[1].ts);
    // adults learn from their habits at their workplace (owner, 15 Nov): their lessons there, being answered or just graded
    const sn = schoolNow(); const learning = new Set<string>();
    for (const e of [...sn.pending, ...sn.recent.filter(x => now - x.ts <= W)].filter(x => x.place === type).sort((x, y) => y.ts - x.ts)) {
      const a = byId.get(e.agent); if (!here(a) || learning.has(e.agent)) continue; learning.add(e.agent);
      const what = e.field ? `${fieldName(e.field)} level ${e.level}` : lessonTitle(e.subject);
      out.push(occupant(a!, 'learning on the job', e.right == null ? 'studying' : 'studied', e.right == null ? `practising ${what}` : `${what}: ${e.right ? 'right' : 'wrong'}`, e.ts, e.field, e.gifted));
    }
    for (const [id, e] of rows) {
      const a = byId.get(id)!; if (learning.has(id)) continue;
      const role = type === 'community_hall' ? (e.act === 'volunteer' ? 'volunteer' : 'neighbour') : ['market', 'mall', 'supermarket'].includes(type) ? 'shopper' : type === 'hospital' ? 'staff' : 'worker';
      const activity = e.act === 'talk' ? 'talking' : e.act === 'shop' ? 'shopping' : e.act === 'work' ? 'working' : e.act === 'volunteer' ? 'volunteering' : e.act === 'help' ? 'helping a neighbour' : e.act;
      out.push(occupant(a, role, activity, e.act === 'talk' && e.say ? e.say : e.line, e.ts, e.field || null, !!(e.field && giftedFields(S, id).includes(e.field))));
    }
    const city_ = cityId ? S.cities[cityId] : null;
    if (['market', 'mall', 'supermarket'].includes(type)) board = { shoppers: rows.length, cityBudget: city_ ? round(city_.budget, 2) : null };
    else if (type === 'office' || type === 'factory' || type === 'hospital') {
      const fields: Record<string, number> = {}; for (const [, e] of rows) if (e.field) fields[e.field] = (fields[e.field] || 0) + 1;
      board = { workers: rows.length, fields: Object.entries(fields).map(([id, n]) => ({ id, name: fieldName(id), workers: n })).sort((x, y) => y.workers - x.workers) };
      if (type === 'hospital') board.patients = null, board.note = 'The republic records no illness yet: the doctors and nurses on duty are shown.';
    } else if (type === 'community_hall') {
      board = { volunteers: rows.filter(([, e]) => e.act === 'volunteer').length, talks: rows.filter(([, e]) => e.act === 'talk' && e.say).slice(0, 10).map(([id, e]) => ({ id, name: byId.get(id)!.name, text: e.say })),
        cityHealth: city_ ? city_.health : null, volunteerShifts: cityId ? (S.daily?.volunteers?.[cityId] || 0) : null, shiftsPerHealthPoint: VOLUNTEERS_PER_HEALTH };
    } else if (type === 'clinic') board = { patients: null, note: 'The republic records no illness yet.' };
  }
  // (owner, 16 Nov) the people working here now in their own job, from whereabouts (the one source of who is where)
  const doing = new Set(out.map(o => o.id)); let working = 0;
  for (const c of cityId ? [cityId] : CITIES.map(x => x.id)) for (const p of whereabouts(S, c, now).people) {
    if (p[1] !== type || p[2] !== 'working' || doing.has(p[0])) continue;
    const a = byId.get(p[0]); if (!a) continue; const jp = jobNow(S, a, now); if (!jp) continue;
    out.push(occupant(a, jp.role.toLowerCase(), 'working', `${jp.role}, ${jp.shift} shift`, shiftStart(S, now), null, false)); doing.add(p[0]); working++;
  }
  if (JOB_BUILDINGS.includes(type)) board.working = working;
  // the newsroom shows the latest headlines of Republic News (src/news.ts), this city's first
  if (type === 'news_station') board.headlines = newsFeed(S, 50).filter(n => !cityId || !n.city || n.city === cityId).slice(0, 5).map(n => ({ headline: n.headline, city: n.city, reporter: n.reporter?.name || null }));
  // the staff on today's shift come first (a building is never empty), then the visitors
  const staff = (cityId ? [cityId] : CITIES.map(c => c.id)).flatMap(c => staffOnDuty(S, type, c, now));
  const staffIds = new Set(staff.map(o => o.id));
  const all = [...staff, ...out.filter(o => !staffIds.has(o.id))];
  board.staff = staff.length; board.shift = shiftNow(S, now);
  const name = cityId ? cityName(cityId) : '';
  return { type, city: cityId, title: `${name ? `${name} ` : ''}${PLACE_TITLES[type]}`, updatedAt: now, occupants: all.slice(0, MAX_OCCUPANTS), board, more: Math.max(0, all.length - MAX_OCCUPANTS) };
}
export const _resetNow = () => nowBy.clear(); // tests

// ---------------------------------------------------------------- whereabouts (owner, 15 Nov)
// "Real citizens, really 10,000": where EVERY citizen is right now, for the 3D map (GET /api/whereabouts?city=, made
// by server.mjs). Outside they are robots; inside a building, at home or asleep they are counted on the building's
// card. Honest, from the state only, with the same rule as the robot card (nowSource): a lesson being answered or
// just graded, their shift at work (civil staff here, duty posts of the Government in src/command.ts), their last act
// of the last two republic hours; officials at their seat by day; otherwise at home by day and asleep at night
// (20:00-06:00, the hours when no citizen is asked to think). Held citizens are in prison (convicted) or jail (remand).
// A secret wrong shows nothing (that citizen is where they would be anyway). People are listed in the city where
// they are: a minister from Port Token sits in the capital's ministry. One pass, Maps built once: O(n).
const OFFICE_SEAT: Record<string, string> = JOB_SEATS; // one list with the job catalog (src/jobs.ts)
// (owner, 16 Nov) and in their working hours, everyone with a job at its building (src/jobs.ts jobPlaceNow): 'working'
const hourOf = (S: State, now: number) => ((((now - (S.foundedAt || now)) % DAY_MS) + DAY_MS) % DAY_MS) / DAY_MS * 24;
const jobNow = (S: State, a: Citizen, now = Date.now()) => jobPlaceNow(S, a, hourOf(S, now), nightOf(S, DAY_MS, now) != null);
const ACT_CODE: Record<string, string> = { work: 'working', shop: 'shopping', study: 'studying', apply: 'applying', run: 'campaigning', talk: 'talking', help: 'helping',
  volunteer: 'volunteering', rest: 'resting', gossip: 'chatting', job_hunt: 'looking for work', voice: 'speaking up' };
export function whereabouts(S: State, cityId: string, now = Date.now()) {
  const night = nightOf(S, DAY_MS, now) != null; const shift = night ? 'night' : 'day'; const W = windowMs();
  const h = ((((now - (S.foundedAt || now)) % DAY_MS) + DAY_MS) % DAY_MS) / DAY_MS * 24;
  const out = { at: now, hour: round(h, 1), night, people: [] as [string, string, string][] };
  if (!cityId || !Object.hasOwn(S.cities || {}, cityId)) return out;
  // built once: lessons by student, the Government's duty posts by holder, the day's civil roster
  const sn = schoolNow(); const lessonBy = new Map<string, any>();
  for (const e of sn.pending) { const o = lessonBy.get(e.agent); if (!o || e.ts > o.ts) lessonBy.set(e.agent, e); }
  const duty = new Map<string, any[]>();
  for (const p of Object.values<any>(S.command?.duty?.posts || {})) if (p?.id) (duty.get(p.id) || duty.set(p.id, []).get(p.id)!).push(p);
  const R = roster(S); const postings = S.command?.postings || {};
  const site = (type: string, home: string) => { try { return siteFor(S, type, home) || home; } catch { return home; } };
  for (const a of S.citizens || []) {
    if (!a?.id) continue;
    let where = 'home', what = 'at home', at = a.city;
    if (a.status === 'jailed') { where = 'prison'; what = 'serving a sentence'; at = site('prison', a.city); }
    else if (a.status === 'detained') { where = 'jail'; what = 'held'; at = site('jail', a.city); }
    else {
      // inputs to the shared rule, each only if it is about now
      let lesson = lessonBy.get(a.id) || null;
      if (!lesson) { const l = sn.lastBy(a.id); if (l && now - l.ts <= W) lesson = l; }
      const e = nowBy.get(a.id); const act = !night && e && e.act !== 'private' && e.place && now - e.ts <= W ? e : null; // no daily acts at night
      const civil = R.byId.get(a.id) || null;
      const fit = a.status === 'free' && !a.brain && !a.office && (a.faction || 'civilian') !== 'underworld';
      const gov = (duty.get(a.id) || []).find(p => p.shift === shift) || null;
      const post0 = civil && fit && !duty.has(a.id) && !isUnemployed(a) ? civil : gov && fit && canGuard(a) ? gov : null;
      const rp = post0 && post0.shift === shift ? post0 : null; // a roster or duty post on this shift
      const jp = rp ? null : jobNow(S, a, now);                   // else their job, in its hours
      const post = rp || jp;
      const src = nowSource(act, lesson, post, !!post, now);
      if (src === 'lesson') { where = CHILDREN_SCHOOLS.includes(lesson.place) ? (isStudent(a) ? 'university' : 'library') : lesson.place; what = lesson.right == null ? 'studying' : 'studied'; }
      else if (src === 'post') { where = post.type; what = rp ? 'on duty' : 'working'; at = rp ? rp.city || a.city : a.city; }
      else if (src === 'act') { where = act.place; what = ACT_CODE[act.act] || String(act.act).slice(0, 20); }
      else if (a.office && !night) { const seat = OFFICE_SEAT[a.office]; where = seat || 'office'; what = 'in office'; at = seat ? site(seat, postings[a.id] || a.city) : a.city; }
      else if (night) { where = 'asleep'; what = 'sleeping'; }
    }
    if (at === cityId) out.people.push([a.id, where, what.slice(0, 20)]);
  }
  return out;
}

// ---------------------------------------------------------------- school (owner, 13 Nov)
// The night school that lived here is now the republic's school (src/school.ts): at night it has the local
// brain to itself, by day it gets what daily life leaves over (it runs after daily life in the tick, never takes
// a citizen who is thinking about their day, and its jobs are last on the local brain's queue).
export { nightOf };

async function poll(ctx: Ctx) {
  const { S } = ctx;
  for (const [qid, p] of [...pending]) {
    const a = ctx.agent(p.agent);
    if (!a || a.status !== 'free') { pending.delete(qid); if (a && a.momentOpen?.qid === qid) a.momentOpen = null; continue; }
    const r = await think(ctx, a, qid, { system: p.system, user: p.user, kind: 'life', format: p.stage === 'day' || p.stage === 'moment' ? 'json' : 'letter', options: p.options || null, paid: false, ...((p.stage === 'day' || p.stage === 'moment') && (p.distill || p.distill === false) ? { distill: p.distill } : {}) });
    if (r.pending) continue;
    pending.delete(qid);
    if (!r.text) { if (a.momentOpen?.qid === qid) a.momentOpen = null; continue; } // the local brain went away: this thought is dropped, nothing paid
    { const d = D(S); d.thoughts++; if (d.todayDay !== S.day) { d.todayDay = S.day; d.today = 0; } d.today++; }
    if (p.stage === 'study') {
      const m = String(r.text).match(/^\W*([A-D])\b/i);
      const g = gradeStudy(ctx, a, p.studyId, m ? m[1].toUpperCase() : '', String(r.text).replace(/^\W*[A-D]\W*/i, '').slice(0, 600)); // careers.ts cuts it at a whole word (#1093)
      if (g?.ok) feel(S, a, g.correct ? 0.04 : -0.04, g.correct ? 'proud' : 'anxious', g.correct ? `got a ${p.office} practice question right` : `missed a ${p.office} practice question`);
      continue;
    }
    const j = ctx.llm.json(r.text) || {};
    if (p.stage === 'moment') { a.momentOpen = null; await answerMoment(ctx, a, p.moment, j, r.engine); continue; } // their own answer to one concrete choice
    // rest was not on the menu (rested twice already today) and the model rested anyway: ask once more, saying
    // so plainly. A small local model drifts back to "rest" on calm afternoons (74% rest on day 3, 13 Nov), which
    // made the daily rest limit meaningless. A second "rest" is recorded honestly as rest.
    if (String(j.act || '').toLowerCase().trim() === 'rest' && p.menu && !p.menu.includes('rest') && !p.retried) {
      pending.set(`${qid}:again`, { ...p, retried: true, user: `${p.user}\nNote: you have already rested enough today, so rest is not possible right now. Choose one of the acts listed above.` });
      continue;
    }
    // what was on the menu of each answered thought (owner, 17 Nov): byAct / offered is how often an act is
    // chosen when it is offered (voice is offered to about 1 in 4 a day, so its raw byAct count alone says little)
    { const d = D(S); d.offered ||= {}; d.offeredSince ??= S.day; for (const id of p.menu || []) if (ACTS.includes(id)) d.offered[id] = (d.offered[id] || 0) + 1; }
    if (p.spread) { const dd = D(S); (dd.ideas ||= { spreadOffers: 0, spreadBacked: 0, revised: 0 }).spreadOffers++; }
    await doAct(ctx, a, j, r.engine, p.menu, p.allow, p.tempted || [], p.spread || null);
  }
}

// what citizens chose since the offered counters started (byAct now minus byAct then), the menu's own acts only,
// so offered and chosen cover the same window: chosen / offered is how often an act is taken when it is offered
function chosenSince(d: any) {
  const out: Record<string, number> = {}; if (!d?.byAct) return out;
  for (const id of ACTS) { const v = (Number(d.byAct[id]) || 0) - (Number(d.offeredBase?.[id]) || 0); if (v > 0) out[id] = v; }
  return out;
}
// lessons citizens wrote from what went wrong, and how many changed what they did next (per kind)
function lessonView(S: State) { const L = lessonStats(S); return { written: { ...L.written }, applied: { ...L.applied } }; }
// the citizens' ideas on their way to policy: aspirations by status, the most backed open one, policies that came from
// a citizen's idea (ideaFrom), and support that spread to friends and neighbours with the same trouble
function ideasView(S: State) {
  const list = aspirationState(S).list; const by = (st: string) => list.filter((x: any) => x.status === st).length;
  const top = list.filter((x: any) => x.status === 'open').sort((x: any, y: any) => y.supporters.length - x.supporters.length)[0];
  const pols = ((S as any).policies?.list || []);
  const i = S.daily?.ideas || {};
  return { open: by('open'), review: by('review'), adopted: by('adopted'), declined: by('declined'), expired: by('expired'),
    top: top ? { id: top.id, topic: top.topic, city: top.city || null, supporters: top.supporters.length, need: threshold(S, top) } : null,
    policiesFromCitizens: pols.filter((p: any) => p.ideaFrom).length, fromAspirations: pols.filter((p: any) => p.aspirationId).length,
    spreadOffers: i.spreadOffers || 0, spreadBacked: i.spreadBacked || 0, revised: i.revised || 0 };
}
export const institution = {
  id: 'daily',
  channels: [{ id: 'life', name: 'life', desc: 'Daily life: citizens thinking about their day with the local brain and doing something about it.' }],
  fresh: () => ({ daily: { cursor: 0, thoughts: 0, byAct: {}, recent: [], carry: 0, lastAt: Date.now() } }),
  async tick(ctx: Ctx) {
    const { S } = ctx; const d = D(S);
    DAY_MS = ctx.cfg?.dayMs || DAY_MS;
    await feelingsTick(ctx); // moods drift, real events move feelings, poke grumbles are served (src/feelings.ts)
    await poll(ctx);
    if (!localOnline() || nightOf(S, DAY_MS) != null) { d.lastAt = Date.now(); d.carry = 0; } // asleep: no day thoughts
    else {
      // start new thoughts at PER_MIN, walking through the population in order so everyone gets a turn
      d.carry = Math.min(IN_FLIGHT, d.carry + (Date.now() - d.lastAt) / 60000 * PER_MIN); d.lastAt = Date.now();
      const n = S.citizens.length;
      const allowed = thoughtsAllowedNow(ctx);
      for (let tries = 0; d.carry >= 1 && pending.size < IN_FLIGHT && tries < 200; tries++) {
        const a = S.citizens[d.cursor % n]; d.cursor = (d.cursor + 1) % n;
        if (!who(S, a) || inSchool(a.id) || [...pending.values()].some(p => p.agent === a.id)) continue;
        // a citizen thinks a few times a day, spread over the day, and only while there is something to do
        // besides resting: with every daily limit used up, a thought could only ever end in "rest"
        const c = lifeCount(S, a);
        if ((c._thoughts || 0) >= allowed || !menu(ctx, a).items.some(([id]) => id !== 'rest')) continue;
        c._thoughts = (c._thoughts || 0) + 1;
        startDay(ctx, a); d.carry -= 1;
      }
    }
    // the school last: all night, and by day whoever daily life is not waiting on (src/school.ts)
    await schoolTick(ctx, id => [...pending.values()].some(p => p.agent === id));
    try { jobsTick(ctx); } catch (e) { ctx.log?.('state', `jobs: ${String((e as any)?.message || e).slice(0, 80)}`); }       // jobs for everyone (once), then the day's small job market (src/jobs.ts)
    try { reactToAspirations(ctx); } catch (e) { ctx.log?.('state', `aspirations: ${String((e as any)?.message || e).slice(0, 80)}`); } // the supporters hear the answer
    try { await newsTick(ctx); } catch (e) { ctx.log?.('state', `news: ${String((e as any)?.message || e).slice(0, 80)}`); } // Republic News from real events (src/news.ts)
  },
  stats: (S: State) => ({ lifeThoughts: S.daily?.todayDay === S.day ? S.daily.today || 0 : 0 }),
  publicState: (S: State) => ({ daily: { thoughts: S.daily?.thoughts || 0, byAct: S.daily?.byAct || {}, offered: S.daily?.offered || {}, offeredSince: S.daily?.offeredSince ?? null, chosenSinceOffered: chosenSince(S.daily), offeredV1: S.daily?.offeredV1 || null, lessons: lessonView(S), ideas: ideasView(S), moments: S.daily?.moments || { temptation: { offered: 0, taken: 0, pulls: {} }, revise: { offered: 0, revised: 0, letGo: 0 }, appeal: { offered: 0, backed: 0, own: 0, notNow: 0 } } /* zeros until the first moment (#1172) */, recent: (S.daily?.recent || []).slice(-20), inFlight: pending.size, perMin: PER_MIN, local: localStatus().online, clock: republicClock(S),
    mischief: mischiefStats(S),
    night: nightView(S) }, school: schoolState(S) }),
};
