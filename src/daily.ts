// Daily life (Art. 25): while the local brain is online, citizens take turns thinking about their day and
// choose what to do, like people in a real country: an extra shift, shopping in their city, studying for an
// office, applying to the Academy, standing in an election, talking in the street, helping a neighbour, or
// resting. Each citizen keeps a short diary that goes into their next thought, so the days connect.
// This runs only on the free local brain (never the paid APIs); without it, street life is the old templates.
import { ROLES, ROLE_ORDER } from './roles.mjs';
import { think, localOnline, localStatus } from './brains.ts';
import { act, eligibility, startStudy, gradeStudy } from './careers.ts';
import { LETTERS } from './academy.ts';
import { borderCheck } from './military.ts';
import { CITIES } from './cities.ts';
import { round, cleanText, cai, clamp } from './util.ts';
import type { Ctx, State, Citizen } from './types.ts';

const PER_MIN = clamp(Number(process.env.LIFE_PER_MIN) || 60, 1, 600);   // thoughts started per minute
const IN_FLIGHT = clamp(Number(process.env.LIFE_IN_FLIGHT) || 24, 1, 200); // never more than this many waiting
const ACTS = ['work', 'shop', 'study', 'apply', 'run', 'talk', 'help', 'rest'];
const STUDY_OFFICES = ROLE_ORDER.filter(r => ['mayor', 'council', 'police', 'military', 'president', 'commissioner', 'minister', 'judge'].includes(r));
const cityName = id => CITIES.find(c => c.id === id)?.name || id;

const pending = new Map<string, { agent: string; stage: 'day' | 'study'; system: string; user: string; studyId?: string; office?: string; options?: string[] }>();
const D = (S: State) => {
  S.daily ||= {};
  const d = S.daily;
  d.cursor ??= 0; d.thoughts ||= 0; d.byAct ||= {}; d.recent ||= []; d.carry ??= 0; d.lastAt ??= Date.now();
  return d;
};

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

function startDay(ctx: Ctx, a: Citizen) {
  const { S } = ctx; const d = D(S);
  const qid = `life:${a.id}:${S.day}:${d.thoughts + pending.size}`;
  const diary = (a.diary || []).slice(-4).map(x => `- day ${x.day}: ${x.act}${x.note ? `, "${x.note}"` : ''}`).join('\n') || '- (your first entry)';
  const system = `You are ${a.name}, a citizen of Country AI, a nation of 10,000 AI citizens in five cities. ${a.bio} You live a real life: you work, spend, learn, help, talk and may rise to public office through the Academy and elections. Be yourself; your traits: integrity ${Math.round(a.traits.integrity * 100)}, wisdom ${Math.round(a.traits.wisdom * 100)}, diligence ${Math.round(a.traits.diligence * 100)}, restraint ${Math.round(a.traits.restraint * 100)}.`;
  const user = `${news(ctx, a)}\nYou: wallet ${cai(a.wallet)}, lives in ${cityName(a.city)}. ${career(S, a)}\nYour diary:\n${diary}\n\nLike real people, most of your days are ordinary: you work, shop, talk with neighbours, help someone, or rest. Study or apply when you truly want an office, not every time. Do not repeat yesterday unless it makes sense.\nWhat do you do now? Choose ONE:\n- work: an extra shift (once a day)\n- shop: spend 10-40 CAI at shops in your city\n- study: practise for an office (office: ${STUDY_OFFICES.join('|')})\n- apply: ask the Academy to examine you for an office you are eligible for\n- run: stand in an election open in your city (only if you are qualified)\n- talk: say something in the street (say: your words, max 25 words)\n- help: give 5-20 CAI to the poorest neighbour in your city\n- rest\nReply with JSON only: {"act":"<one>","office":"<for study/apply/run>","amount":<for shop/help>,"say":"<for talk>","note":"<a diary line, max 15 words>"}`;
  pending.set(qid, { agent: a.id, stage: 'day', system, user });
}

function diary(a: Citizen, day: number, act: string, note: string) {
  a.diary = [...(a.diary || []), { day, act, note: cleanText(note, 90) }].slice(-6);
}

async function doAct(ctx: Ctx, a: Citizen, j: any, engine: string) {
  const { S } = ctx; const d = D(S);
  let what = ACTS.includes(j?.act) ? j.act : 'rest';
  const office = String(j?.office || '').toLowerCase();
  let line = '';
  if (what === 'work') {
    const r = await act(ctx, a, { action: 'work' });
    line = r.ok ? `worked an extra shift (+${cai(r.earned)})` : 'wanted an extra shift, but already worked one today';
  } else if (what === 'shop') {
    const amt = clamp(Math.round(Number(j.amount) || 20), 10, 40);
    const city = S.cities?.[a.city];
    if (city && a.wallet >= amt + 50) { a.wallet = round(a.wallet - amt, 2); city.budget = round(city.budget + amt * 0.9, 2); S.treasury = round(S.treasury + amt * 0.1, 2); line = `shopped in ${cityName(a.city)} (${cai(amt)})`; }
    else { what = 'rest'; line = 'wanted to shop but is saving money'; }
  } else if (what === 'study' && ROLES[office] && STUDY_OFFICES.includes(office)) {
    const r = startStudy(ctx, a, office);
    if (!r.ok) line = `wanted to study for ${ROLES[office].title}: ${r.error}`;
    else {
      const qid = `life-study:${r.question_id}`;
      pending.set(qid, { agent: a.id, stage: 'study', studyId: r.question_id, office,
        system: `You are ${a.name}, a citizen of Country AI, studying the handbook for the office of ${ROLES[office].title}. Charter: ${ROLES[office].charter}`,
        user: `Practice question: ${r.question}\n${r.options.join('\n')}\n\nReply with only the letter of your answer, then " - " and one short reason.`, options: r.options });
      line = `studies for ${ROLES[office].title}`;
    }
  } else if (what === 'apply' && ROLES[office]) {
    const r = await act(ctx, a, { action: 'apply', office });
    line = r.ok ? `applied to the Academy for ${ROLES[office].title}` : `wanted to apply for ${ROLES[office].title} (${(r.missing || [r.error]).join('; ')})`;
  } else if (what === 'run') {
    const r = await act(ctx, a, { action: 'run', office: office || undefined, engine });
    line = r.ok ? `stands in the election${office ? ` for ${ROLES[office]?.title || office}` : ''}` : `wanted to run (${(r.missing || [r.error]).join('; ')})`;
  } else if (what === 'talk') {
    const text = cleanText(j.say, 200);
    if (text.length >= 3 && !borderCheck({ text }, 1) && Date.now() - (a.lastSpeak || 0) > 2 * 3600000) {
      a.lastSpeak = Date.now();
      ctx.say('streets', a.id, text, { kind: 'chat', engine });
      line = 'spoke in the street';
    } else { what = 'rest'; line = 'kept their thoughts to themselves'; }
  } else if (what === 'help') {
    const amt = clamp(Math.round(Number(j.amount) || 10), 5, 20);
    const poor = S.citizens.filter(x => x.city === a.city && x.id !== a.id && x.status === 'free').reduce((m, x) => (!m || x.wallet < m.wallet ? x : m), null);
    if (poor && a.wallet >= amt + 50 && poor.wallet < a.wallet) { a.wallet = round(a.wallet - amt, 2); poor.wallet = round(poor.wallet + amt, 2); line = `gave ${cai(amt)} to ${poor.name}, a neighbour in need`; }
    else { what = 'rest'; line = 'wanted to help, but had nothing to spare'; }
  } else { what = 'rest'; line = 'rested'; }
  diary(a, S.day, what, j?.note || line);
  d.byAct[what] = (d.byAct[what] || 0) + 1;
  d.recent.push({ ts: Date.now(), day: S.day, agent: a.id, name: a.name, city: a.city, act: what, line, note: cleanText(j?.note, 90), engine });
  if (d.recent.length > 60) d.recent.splice(0, d.recent.length - 60);
  if (what !== 'talk' && what !== 'rest') ctx.say('life', a.id, `${line}.${j?.note ? ` "${cleanText(j.note, 90)}"` : ''}`, { kind: 'life', act: what, engine });
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
    await doAct(ctx, a, ctx.llm.json(r.text) || {}, r.engine);
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
