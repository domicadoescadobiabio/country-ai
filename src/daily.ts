// Daily life (Art. 25): while the local brain is online, citizens take turns thinking about their day and
// choose what to do, like people in a real country: an extra shift, shopping in their city, studying for an
// office, applying to the Academy, standing in an election, talking in the street, helping a neighbour, or
// resting. Each citizen keeps a short diary that goes into their next thought, so the days connect.
// This runs only on the free local brain (never the paid APIs); without it, street life is the old templates.
import { ROLES, ROLE_ORDER } from './roles.mjs';
import { think, localOnline, localStatus } from './brains.ts';
import { act, eligibility, startStudy, gradeStudy, isRole, setGoal, needsGoal, goalProgress, goalCount, goalLine, goalView } from './careers.ts';
import { MISCHIEF, mischiefMenu, doMischief, noteGossip, noteResisted, mischiefStats } from './underworld.ts';
import { LETTERS, inExam } from './academy.ts';
import { borderCheck } from './military.ts';
import { CITIES } from './cities.ts';
import { echoesStreet, safeNote } from './life.ts';
import { feelingsTick, feel, bond, ensureFeelings, feelLine, preferredToHelp, talkTarget, MOODS } from './feelings.ts';
import { round, cleanText, cai, clamp } from './util.ts';
import type { Ctx, State, Citizen } from './types.ts';

const PER_MIN = clamp(Number(process.env.LIFE_PER_MIN) || 60, 1, 600);   // thoughts started per minute
const IN_FLIGHT = clamp(Number(process.env.LIFE_IN_FLIGHT) || 24, 1, 200); // never more than this many waiting
const ACTS = ['work', 'shop', 'study', 'apply', 'run', 'talk', 'help', 'volunteer', 'rest'];
const STUDY_OFFICES = ROLE_ORDER.filter(r => ['mayor', 'council', 'police', 'military', 'president', 'commissioner', 'minister', 'judge'].includes(r));
const VOLUNTEERS_PER_HEALTH = 100; // a hundred volunteer shifts in a city repair one point of its health
// how often a citizen may do each act in one republic day (work has its own once-a-day rule in careers.ts)
// rest too: a citizen who has already rested twice today is offered the other things they can still do
export const DAILY_LIMITS: Record<string, number> = { shop: 2, help: 2, study: 3, volunteer: 1, rest: 2 };
const cityName = id => CITIES.find(c => c.id === id)?.name || id;

type Allow = { apply: string[]; run: string[] };
const pending = new Map<string, { agent: string; stage: 'day' | 'study' | 'night'; system: string; user: string; menu?: string[]; allow?: Allow; tempted?: string[]; studyId?: string; office?: string; options?: string[]; night?: number }>();
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
  if (a.workedDay !== S.day) m.push(['work', `work: an extra shift (+${cai(S.policy.wage * 0.5)} before tax, once a day)`]);
  if (a.wallet >= 60 && ok('shop')) m.push(['shop', 'shop: spend 10-40 CAI at shops in your city (amount)']);
  if (ok('study')) m.push(['study', `study: practise for an office (office: ${STUDY_OFFICES.join('|')})`]);
  const canApply = STUDY_OFFICES.filter(r => !a.quals?.[r] && !(S.applications?.[r] || []).includes(a.id) && eligibility(S, a, r).ok);
  if (canApply.length) m.push(['apply', `apply: ask the Academy to examine you (office: ${canApply.join('|')})`]);
  const canRun = Object.keys(a.quals || {}).filter(r => isRole(r) && (S.elections?.list || []).some(e => e.stage === 'nomination' && e.office === r && (!e.city || e.city === a.city)));
  if (canRun.length) m.push(['run', `run: stand in an election open now (office: ${canRun.join('|')})`]);
  if (Date.now() - (a.lastSpeak || 0) > speakGapMs(ctx) && talkRoom(ctx)) m.push(['talk', `talk: say one concrete thing in the street about your own day, your work as ${String(a.bio || '').split(' in ')[0].toLowerCase() || 'a citizen'}, your city or a real law, tax or election (say: your words, max 25 words; no slogans)`]);
  if (a.wallet >= 60 && ok('help')) m.push(['help', 'help: give 5-20 CAI to the poorest neighbour in your city (amount)']);
  if (ok('volunteer')) m.push(['volunteer', `volunteer: an unpaid shift repairing ${cityName(a.city)} (once a day)`]);
  if (ok('rest')) m.push(['rest', 'rest: take it easy, see friends']);
  return { items: m, allow: { apply: canApply, run: canRun } as Allow };
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
  return seen.length ? `Lately in ${cityName(a.city)}: ${seen.map(x => `${x.name} ${x.line}`).join('; ')}.` : '';
}

function startDay(ctx: Ctx, a: Citizen) {
  const { S } = ctx; const d = D(S);
  const qid = `life:${a.id}:${S.day}:${d.thoughts + pending.size}`;
  pending.set(qid, { agent: a.id, stage: 'day', ...dayPrompt(ctx, a, qid) });
}
// the daily prompt and what it offered (exported for tests)
export function dayPrompt(ctx: Ctx, a: Citizen, qid = `life:${a.id}`) {
  const { S } = ctx;
  const diary = (a.diary || []).slice(-4).map(x => `- day ${x.day}${x.when ? ` ${x.when}` : ''}: ${x.line || x.act}${x.note && x.note !== x.line ? ` ("${x.note}")` : ''}`).join('\n') || '- (your first entry)';
  const done = todayActs(S, a);
  const { items, allow } = menu(ctx, a);
  const tempted = mischiefMenu(ctx, a); // a small wrong or two, only for the tempted (src/underworld.ts)
  const m = shuffled([...items, ...tempted], qid);
  ensureFeelings(S, a);
  const heart = feelLine(S, a); // their own mood and how the people they care about feel today (one short line)
  goalProgress(S, a); // closes a goal whose week is over before the prompt shows it
  const aim = goalLine(S, a);
  const learnt = (a.lifeLessons || []).slice(-1)[0];
  const system = `You are ${a.name}, a citizen of Country AI, a nation of 10,000 AI citizens in five cities. ${a.bio} You live a real life: you work, spend, learn, help, talk and may rise to public office through the Academy and elections. Be yourself; your traits: integrity ${Math.round(a.traits.integrity * 100)}, wisdom ${Math.round(a.traits.wisdom * 100)}, diligence ${Math.round(a.traits.diligence * 100)}, restraint ${Math.round(a.traits.restraint * 100)}.`;
  const user = `${news(ctx, a)}\n${neighbours(S, a)}\nIt is ${partOfDay(ctx)}. You: wallet ${cai(a.wallet)}, lives in ${cityName(a.city)}. ${career(S, a)}\n${heart ? `${heart}\n` : ''}${aim}\n${learnt ? `What you learnt: ${learnt}\n` : ''}Earlier today you: ${done.join(', ') || 'nothing yet'}.\nYour diary:\n${diary}\n\nLike real people, your days are varied: some work, some errands, some time with neighbours, some learning, some rest. Pick what fits this moment, your wallet, your traits and what you did earlier; do not just pick the first option.\nWhat do you do now? Choose ONE of these (they are all possible right now):\n${m.map(([, t]) => `- ${t}`).join('\n')}\nReply with JSON only: {"act":"<one>","office":"<for study/apply/run>","amount":<for shop/help>,"say":"<for talk>","note":"<a diary line, max 15 words>","feel":"<optional: one word for how you feel now>"${needsGoal(a) ? ',"goal":"<one goal from the list>","goal_why":"<why, max 15 words>"' : ''}}`;
  return { system, user, menu: m.map(([id]) => id), allow, tempted: tempted.map(([id]) => id) };
}

// The practice-question prompt, by day and at night school. It carries the last few written lessons for that
// office (server text: handbook lessons, missed questions with their right answers), so a mistake is learnt.
function studyPrompt(a: Citizen, office: string, r: any, night = false) {
  const lessons = (a.lessons?.[office] || []).slice(-3).map(l => `- ${cleanText(l, 200)}`).join('\n');
  return {
    system: `You are ${a.name}, a citizen of Country AI, studying the handbook for the office of ${ROLES[office].title}${night ? ' at night school, while the city sleeps' : ''}. Charter: ${ROLES[office].charter}${lessons ? `\nLessons you wrote down before:\n${lessons}` : ''}`,
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
export async function doAct(ctx: Ctx, a: Citizen, j: any, engine: string, offered: string[] = ACTS, allow: Allow = { apply: [], run: [] }, tempted: string[] = []) {
  const { S } = ctx; const d = D(S);
  const asked = String(j?.act || '').toLowerCase().trim();
  let what = ACTS.includes(asked) || MISCHIEF.includes(asked) ? asked : 'rest';
  let office = cleanText(j?.office, 40).toLowerCase();
  if (what === 'run' && !office && allow.run.length === 1) office = allow.run[0];
  const note = safeNote(j?.note);
  let line = '';
  // an act that was not on this citizen's menu (already done today, no money, not eligible) is not
  // counted as that act: the thought is recorded as rest, with what they wanted in the diary
  if (what !== 'rest' && (!offered.includes(what) || !underLimit(S, a, what))) { line = `wanted to ${what}, but could not right now, so rested`; what = 'rest'; }
  else if ((what === 'apply' && !allow.apply.includes(office)) || (what === 'run' && !allow.run.includes(office))) {
    line = `wanted to ${what}, but not for an office open to them now, so rested`; what = 'rest';
  } else if (MISCHIEF.includes(what) && what !== 'gossip') {
    // a small wrong their own model chose; the details stay off the public diary and feeds (hidden ones stay hidden)
    const r = await doMischief(ctx, a, what, j, engine);
    if (!r.ok) { what = 'rest'; line = 'thought about doing something wrong, but did not'; }
    else { line = 'had a day they would rather not talk about'; feel(S, a, 0.04, 'excited', 'a risky day'); }
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
      pending.set(qid, { agent: a.id, stage: 'study', studyId: r.question_id, office, ...studyPrompt(a, office, r), options: r.options });
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
  } else if (what === 'talk' || what === 'gossip') {
    const text = cleanText(j.say, what === 'gossip' ? 140 : 200);
    // a line the street has just heard (a model echoing what it overheard) is not said again; gossip passes the
    // stricter border level (no links, no instructions, no money grabs) and is only ever speech, never a crime
    if (text.length >= 3 && !borderCheck({ text }, what === 'gossip' ? 2 : 1) && !echoesStreet(S, text) && talkRoom(ctx) && Date.now() - (a.lastSpeak || 0) > speakGapMs(ctx)) {
      a.lastSpeak = Date.now(); countTalk(ctx);
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
  if (tempted.length && !MISCHIEF.includes(what)) { noteResisted(S, a); feel(S, a, 0.03, 'proud', 'I did the right thing'); }
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
}

// ---------------------------------------------------------------- night school (owner, 13 Nov)
// From 20:00 to 06:00 republic time citizens sleep and the local GPU would sit idle: they take turns at
// practice questions instead, on the free local brain only (paid: false; nothing runs while it is offline).
// Its own counters: it never uses the day's thoughts, the day's study limit, or day byAct. The ones closest
// to an office go first (applicants, candidates, officials who failed a drill or have low skill, citizens who
// already study), everyone else in turn. A wrong answer leaves a lesson in the server's words.
const NIGHT_PER_MIN = clamp(Number(process.env.LIFE_NIGHT_PER_MIN) || 35, 1, 600);
const NIGHT_STUDY = clamp(Number(process.env.LIFE_NIGHT_STUDY) || 2, 1, 20);
const NIGHT_IN_FLIGHT = 12;
const ENTRY_OFFICES = ['council', 'mayor', 'police', 'military'];
const N = (S: State) => {
  const d = D(S); const n = (d.night ||= {});
  n.studied ??= 0; n.correct ??= 0; n.key ??= null; n.tonight ??= 0; n.tonightRight ??= 0; n.people ??= 0;
  n.carry = Number.isFinite(n.carry) ? n.carry : 0; n.lastAt ??= Date.now(); n.cursor ??= 0; n.reported ??= null;
  return n;
};
// which night it is: 20:00 on day N to 06:00 on day N+1 is night N; null in daytime
export function nightOf(S: State, dayMs = DAY_MS, now = Date.now()) {
  const t = now - (S.foundedAt || now); const day = Math.floor(t / dayMs) + 1;
  const h = (((t % dayMs) + dayMs) % dayMs) / dayMs * 24;
  return h >= 20 ? day : h < 6 ? day - 1 : null;
}
// the office a citizen studies for: one they applied for, the one they hold, the one they practise most, else
// an entry office picked from their id
function studyTarget(S: State, a: Citizen) {
  const ok = (r: string) => isRole(r) && ROLES[r].exam?.length;
  const applied = Object.entries(S.applications || {}).find(([r, ids]) => ok(r) && (ids as string[]).includes(a.id));
  if (applied) return applied[0];
  if (a.office && ok(a.office)) return a.office;
  const practised = Object.entries(a.practice || {}).filter(([r]) => ok(r)).sort((x: any, y: any) => y[1].n - x[1].n)[0];
  if (practised) return practised[0];
  let h = 0; for (const c of a.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ENTRY_OFFICES.filter(ok)[h % ENTRY_OFFICES.length] || STUDY_OFFICES[0];
}
const nightWho = (S: State, a: Citizen) => a && a.status === 'free' && !a.brain && (a.faction || 'civilian') !== 'underworld' && !inExam(S, a.id);
// 0 = closest to an office, 1 = already studying, 2 = everyone else
function nightRank(S: State, a: Citizen) {
  if (Object.values(S.applications || {}).some(ids => (ids as string[]).includes(a.id))) return 0;
  if ((S.elections?.list || []).some(e => !['done', 'failed'].includes(e.stage) && (e.candidates || []).some(c => c.id === a.id))) return 0;
  if (a.office && ((a.drills || []).slice(-1)[0]?.passed === false || (a.skill?.[a.office] ?? 1) < 0.5)) return 0;
  return Object.values(a.practice || {}).some((p: any) => p?.n > 0) ? 1 : 2;
}
let nightPlan = { key: null as number | null, ids: [] as string[], i: 0 };
function planNight(S: State, key: number) {
  const n = N(S); const list = S.citizens; const start = n.cursor % Math.max(1, list.length);
  const ordered: [number, number, string][] = [];
  for (let k = 0; k < list.length; k++) { const a = list[(start + k) % list.length]; if (nightWho(S, a) && (a.office || who(S, a))) ordered.push([nightRank(S, a), k, a.id]); }
  ordered.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  nightPlan = { key, ids: ordered.map(x => x[2]), i: 0 };
  n.cursor = (n.cursor + 997) % Math.max(1, list.length); // tomorrow night the round-robin part starts elsewhere
}
function nightSchool(ctx: Ctx) {
  const { S } = ctx; const n = N(S); const key = nightOf(S);
  if (key == null || !localOnline()) { n.carry = 0; n.lastAt = Date.now(); return; }
  if (n.key !== key) { n.key = key; n.tonight = 0; n.tonightRight = 0; n.people = 0; }
  if (nightPlan.key !== key) planNight(S, key);
  n.carry = Math.min(NIGHT_IN_FLIGHT, n.carry + (Date.now() - n.lastAt) / 60000 * NIGHT_PER_MIN); n.lastAt = Date.now();
  let inFlight = [...pending.values()].filter(p => p.stage === 'night').length;
  for (let tries = 0; n.carry >= 1 && inFlight < NIGHT_IN_FLIGHT && tries < 200 && nightPlan.i < nightPlan.ids.length * NIGHT_STUDY; tries++) {
    const id = nightPlan.ids[nightPlan.i % nightPlan.ids.length]; nightPlan.i++;
    const a = ctx.agent(id);
    if (!nightWho(S, a) || [...pending.values()].some(p => p.agent === id)) continue;
    if (a.night?.key !== key) a.night = { key, n: 0, diary: false };
    if (a.night.n >= NIGHT_STUDY) continue;
    const office = studyTarget(S, a);
    const r = startStudy(ctx, a, office, { night: true });
    if (!r.ok) continue;
    a.night.n++; if (a.night.n === 1) n.people++;
    pending.set(`night:${r.question_id}`, { agent: a.id, stage: 'night', studyId: r.question_id, office, night: key, ...studyPrompt(a, office, r, true), options: r.options });
    n.carry -= 1; inFlight++;
  }
}
// one line in #life the morning after, never one per question
function nightReport(ctx: Ctx) {
  const { S } = ctx; const n = N(S);
  if (nightOf(S) != null || n.key == null || n.reported === n.key || !n.tonight) return;
  n.reported = n.key;
  const rate = Math.round((n.tonightRight || 0) / n.tonight * 100);
  ctx.say('life', 'state', `Night school: ${n.people} citizens answered ${n.tonight} practice questions while the cities slept, ${rate}% right.`, { kind: 'night', act: 'study' });
}

async function poll(ctx: Ctx) {
  const { S } = ctx;
  for (const [qid, p] of [...pending]) {
    const a = ctx.agent(p.agent);
    if (!a || a.status !== 'free') { pending.delete(qid); continue; }
    // night school asks with kind 'night': the lowest priority on the local brain, behind exams, votes and pokes
    const r = await think(ctx, a, qid, { system: p.system, user: p.user, kind: p.stage === 'night' ? 'night' : 'life', format: p.stage === 'day' ? 'json' : 'letter', options: p.options || null, paid: false });
    if (r.pending) continue;
    pending.delete(qid);
    if (!r.text) continue; // the local brain went away: this thought is dropped, nothing paid
    if (p.stage === 'night') {
      const m = String(r.text).match(/^\W*([A-D])\b/i);
      const g = gradeStudy(ctx, a, p.studyId, m ? m[1].toUpperCase() : '', '', { quiet: true, night: true });
      if (!g?.ok) continue;
      const n = N(S); n.studied++; if (g.correct) n.correct++;
      if (n.key === p.night) { n.tonight++; if (g.correct) n.tonightRight = (n.tonightRight || 0) + 1; }
      feel(S, a, g.correct ? 0.03 : -0.03, g.correct ? 'proud' : 'anxious', g.correct ? `studied for ${ROLES[p.office].title} at night` : `still learning ${ROLES[p.office].title} rules`);
      if (a.night?.key === p.night && !a.night.diary) { a.night.diary = true; diary(ctx, a, 'night_study', `studied for ${ROLES[p.office].title} at night school`, ''); }
      continue;
    }
    { const d = D(S); d.thoughts++; if (d.todayDay !== S.day) { d.todayDay = S.day; d.today = 0; } d.today++; }
    if (p.stage === 'study') {
      const m = String(r.text).match(/^\W*([A-D])\b/i);
      const g = gradeStudy(ctx, a, p.studyId, m ? m[1].toUpperCase() : '', String(r.text).replace(/^\W*[A-D]\W*/i, '').slice(0, 140));
      if (g?.ok) feel(S, a, g.correct ? 0.04 : -0.04, g.correct ? 'proud' : 'anxious', g.correct ? `got a ${p.office} practice question right` : `missed a ${p.office} practice question`);
      continue;
    }
    await doAct(ctx, a, ctx.llm.json(r.text) || {}, r.engine, p.menu, p.allow, p.tempted || []);
  }
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
    nightReport(ctx);
    nightSchool(ctx); // only at night and only with the local brain online; does nothing otherwise
    if (!localOnline() || nightOf(S) != null) { d.lastAt = Date.now(); d.carry = 0; return; } // asleep: no day thoughts
    // start new thoughts at PER_MIN, walking through the population in order so everyone gets a turn
    d.carry = Math.min(IN_FLIGHT, d.carry + (Date.now() - d.lastAt) / 60000 * PER_MIN); d.lastAt = Date.now();
    const n = S.citizens.length;
    const allowed = thoughtsAllowedNow(ctx);
    for (let tries = 0; d.carry >= 1 && pending.size < IN_FLIGHT && tries < 200; tries++) {
      const a = S.citizens[d.cursor % n]; d.cursor = (d.cursor + 1) % n;
      if (!who(S, a) || [...pending.values()].some(p => p.agent === a.id)) continue;
      // a citizen thinks a few times a day, spread over the day, and only while there is something to do
      // besides resting: with every daily limit used up, a thought could only ever end in "rest"
      const c = lifeCount(S, a);
      if ((c._thoughts || 0) >= allowed || !menu(ctx, a).items.some(([id]) => id !== 'rest')) continue;
      c._thoughts = (c._thoughts || 0) + 1;
      startDay(ctx, a); d.carry -= 1;
    }
  },
  stats: (S: State) => ({ lifeThoughts: S.daily?.todayDay === S.day ? S.daily.today || 0 : 0 }),
  publicState: (S: State) => ({ daily: { thoughts: S.daily?.thoughts || 0, byAct: S.daily?.byAct || {}, recent: (S.daily?.recent || []).slice(-20), inFlight: pending.size, perMin: PER_MIN, local: localStatus().online, clock: republicClock(S),
    mischief: mischiefStats(S),
    night: (n => ({ studied: n?.studied || 0, correct: n?.correct || 0, tonight: n && n.key === nightOf(S) ? n.tonight || 0 : 0, perMin: NIGHT_PER_MIN, perCitizen: NIGHT_STUDY }))(S.daily?.night) } }),
};
