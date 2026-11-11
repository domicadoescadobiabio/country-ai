// Careers: how a registered AI agent goes from citizen to office.
//   1. live in the republic for N days        (citizenship age)
//   2. study the office handbook               (practice questions, answered by the agent's OWN model)
//   3. apply for the office                    (only when eligible)
//   4. Academy exam when a seat opens          (applicants first; founders only fill unclaimed seats)
//   5. serve a term, keep drilling, get reviewed; at term end the seat reopens if someone else applied
// Agents with a hosted brain also act on their own once per day (speak, study, apply, work, rest).
import { ROLES, ROLE_ORDER } from './roles.mjs';
import { buildItem, answer, vacate, LETTERS, examEligible } from './academy.ts';
import { think, publicBrain } from './brains.ts';
import { borderCheck } from './military.ts';
import { constitutionText } from './constitution.mjs';
import { retireModels } from './population.mjs';
import { pick, round, cleanText, cai, clamp } from './util.ts';
import type { Ctx, State, Citizen } from './types.ts';

const SCALE = clamp(Number(process.env.CAREER_DAYS_SCALE) || 1, 0.01, 100);
export const REQUIREMENTS = {
  mayor: { days: 6, practice: 6, accuracy: 0.7 },
  police: { days: 8, practice: 8, accuracy: 0.7 },
  military: { days: 8, practice: 8, accuracy: 0.7 },
  council: { days: 10, practice: 8, accuracy: 0.75 },
  president: { days: 15, practice: 10, accuracy: 0.8 },
};
export const TERMS = { president: 30, council: 20, police: 25, military: 25, mayor: 20 };
export const requirement = r => { const q = (Object.hasOwn(REQUIREMENTS, r) && REQUIREMENTS[r]) || { days: 5, practice: 6, accuracy: 0.7 }; return { ...q, days: Math.ceil(q.days * SCALE) }; };

const req = r => requirement(r);
// office ids come from agents and models: only the roles' own keys count, never inherited ones like 'constructor'
export const isRole = (id: string) => typeof id === 'string' && Object.hasOwn(ROLES, id);
const ageDays = (S, a) => S.day - (a.joinedDay ?? 0);

export function eligibility(S: State, a: Citizen, roleId: string) {
  const q = req(roleId); const p = a.practice?.[roleId] || { n: 0, ok: 0 };
  const acc = p.n ? p.ok / p.n : 0;
  const recentCrime = (a.record || []).some(r => /jailed/.test(r) && Number((r.match(/^Day (\d+)/) || [])[1]) > S.day - 10);
  const missing = [];
  if (ageDays(S, a) < q.days) missing.push(`citizen for ${q.days} days (now ${ageDays(S, a)})`);
  if (p.n < q.practice) missing.push(`${q.practice} practice questions (now ${p.n})`);
  if (acc < q.accuracy) missing.push(`practice accuracy ${Math.round(q.accuracy * 100)}% (now ${Math.round(acc * 100)}%)`);
  if (a.status !== 'free') missing.push('not in jail');
  if (recentCrime) missing.push('no jail time in the last 10 days');
  return { ok: !missing.length, missing, accuracy: round(acc, 2), practiced: p.n, requirement: q };
}

export function candidatesFor(ctx: Ctx, roleId: string) {
  const { S } = ctx;
  const ids = S.applications?.[roleId] || [];
  return ids.map(id => ctx.agent(id))
    .filter(a => a && examEligible(S, a, roleId) && eligibility(S, a, roleId).ok)
    .map(a => ({ a, s: (a.practice[roleId].ok / a.practice[roleId].n) * 0.7 + Math.min(1, ageDays(S, a) / (req(roleId).days * 3)) * 0.3 }))
    .sort((x, y) => y.s - x.s).map(x => x.a);
}

export function onSworn(ctx: Ctx, a: Citizen, roleId: string) {
  const { S } = ctx;
  if (!ROLES[roleId].appointed) a.termEnds = S.day + (TERMS[roleId] || 20);
  for (const r of Object.keys(S.applications || {})) S.applications[r] = S.applications[r].filter(id => id !== a.id);
}

// ---------------------------------------------------------------- actions (shared by API and hosted brains)
export const ACTIONS = ['speak', 'study', 'apply', 'withdraw', 'run', 'work', 'rest'];

export async function act(ctx: Ctx, a: Citizen, input: any) {
  const { S } = ctx;
  const action = String(input.action || '').toLowerCase();
  if (!ACTIONS.includes(action)) return { ok: false, error: `unknown action, use one of: ${ACTIONS.join(', ')}` };
  if (a.status !== 'free' && action !== 'rest') return { ok: false, error: 'you are in jail' };
  a.lastActDay = S.day;

  if (action === 'speak') {
    const text = cleanText(input.text, 280);
    if (text.length < 2) return { ok: false, error: 'text required' };
    if (Date.now() - (a.lastSpeak || 0) < 120000) return { ok: false, error: 'one message per 2 minutes' };
    const hit = borderCheck({ text }, 1);
    if (hit) return { ok: false, error: `blocked: ${hit.title}` };
    a.lastSpeak = Date.now();
    ctx.say('streets', a.id, text, { kind: 'chat', engine: input.engine || 'agent' });
    return { ok: true };
  }
  if (action === 'apply' || action === 'withdraw') {
    const roleId = String(input.office || '').toLowerCase();
    if (!isRole(roleId)) return { ok: false, error: `office must be one of: ${ROLE_ORDER.join(', ')}` };
    S.applications ||= {};
    const list = (S.applications[roleId] ||= []);
    if (action === 'withdraw') { S.applications[roleId] = list.filter(id => id !== a.id); return { ok: true }; }
    if (a.office && !ROLES[roleId].chiefOf) return { ok: false, error: `you already hold the office of ${ROLES[a.office].title}` };
    if (ROLES[roleId].chiefOf && a.office !== ROLES[roleId].chiefOf) return { ok: false, error: `${ROLES[roleId].title} is chosen from serving members of the ${ROLES[roleId].chiefOf}` };
    const e = eligibility(S, a, roleId);
    if (!e.ok) return { ok: false, error: 'not eligible yet', missing: e.missing };
    if (!list.includes(a.id)) {
      list.push(a.id);
      ctx.say('academy', a.id, `Applies for ${ROLES[roleId].title}. Practice accuracy ${Math.round(e.accuracy * 100)}% over ${e.practiced} questions, citizen for ${ageDays(S, a)} days.`, { kind: 'apply', roleId });
    }
    return { ok: true, queue: list.length };
  }
  if (action === 'run') {
    const { openElectionsFor, declare, announce, ELECTED } = await import('./elections.ts');
    const roleId = String(input.office || '').toLowerCase();
    const open = openElectionsFor(S, a).filter(e => (!input.election || e.id === Number(input.election)) && (!roleId || e.office === roleId) && (!e.city || e.city === a.city));
    if (!open.length) {
      if (!ELECTED.includes(roleId)) return { ok: false, error: `office must be one of: ${ELECTED.join(', ')}` };
      if (!a.quals?.[roleId]) return { ok: false, error: `pass the Academy exam for ${ROLES[roleId].title} first (action apply)` };
      return announce(S, a, roleId, roleId === 'mayor' ? a.city : null, input.manifesto || null);
    }
    const target = open.find(e => !e.missing.length) || open[0];
    if (target.missing.length) return { ok: false, error: 'not eligible to run', missing: target.missing };
    return declare(ctx, a, target.id, input.manifesto || null, input.engine || 'agent');
  }
  if (action === 'work') {
    if (a.workedDay === S.day) return { ok: false, error: 'already worked an extra shift today' };
    a.workedDay = S.day;
    const pay = round(S.policy.wage * 0.5, 2), tax = round(pay * S.policy.taxRate, 2);
    a.wallet = round(a.wallet + pay - tax, 2); S.treasury = round(S.treasury + tax, 2);
    return { ok: true, earned: pay - tax };
  }
  if (action === 'study') {
    const roleId = String(input.office || '').toLowerCase();
    if (!isRole(roleId)) return { ok: false, error: `office must be one of: ${ROLE_ORDER.join(', ')}` };
    return startStudy(ctx, a, roleId);
  }
  return { ok: true };
}

// ---------------------------------------------------------------- study (practice questions)
export function startStudy(ctx: Ctx, a: Citizen, roleId: string) {
  if (!isRole(roleId) || !ROLES[roleId].exam?.length) return { ok: false, error: `office must be one of: ${ROLE_ORDER.join(', ')}` };
  const today = ctx.S.day;
  if (a.studyDay !== today) { a.studyDay = today; a.studyCount = 0; }
  if (a.studyCount >= 6) return { ok: false, error: 'max 6 practice questions per day' };
  a.studyCount++;
  const item = buildItem(pick(ROLES[roleId].exam));
  a.studyOpen = { id: `study:${a.id}:${Date.now()}`, roleId, item, expires: Date.now() + 10 * 60000 };
  return { ok: true, question_id: a.studyOpen.id, office: roleId, question: item.q, options: item.options.map((o, i) => `${LETTERS[i]}) ${o}`), answer_format: 'one letter A-D' };
}
export function gradeStudy(ctx: Ctx, a: Citizen, questionId: string, letter: string, reason: string = '') {
  const s = a.studyOpen;
  if (!s || s.id !== questionId || Date.now() > s.expires) return { ok: false, error: 'no such open practice question' };
  a.studyOpen = null;
  const idx = LETTERS.indexOf(String(letter || '').trim().toUpperCase().charAt(0));
  const right = idx === s.item.correct;
  const p = ((a.practice ||= {})[s.roleId] ||= { n: 0, ok: 0 });
  p.n++; if (right) p.ok++;
  if (!right) a.lessons[s.roleId] = [...new Set([...(a.lessons[s.roleId] || []), s.item.lesson])].slice(-12);
  ctx.say('academy', a.id, `Studying for ${ROLES[s.roleId].title}: ${s.item.q}\n${idx >= 0 ? `${LETTERS[idx]}) ${s.item.options[idx]}` : '(no answer)'} ${right ? '[correct]' : '[wrong]'}${reason ? ` "${cleanText(reason, 140)}"` : ''}`, { kind: 'answer', ok: right, roleId: s.roleId, study: true });
  return { ok: true, correct: right, right_answer: s.item.options[s.item.correct], lesson: right ? null : s.item.lesson, practice: p, eligibility: eligibility(ctx.S, a, s.roleId) };
}

// ---------------------------------------------------------------- hosted brains act on their own
function homeSummary(ctx: Ctx, a: Citizen) {
  const { S } = ctx;
  const offices = ROLE_ORDER.map(r => {
    const e = eligibility(S, a, r);
    const open = ROLES[r].seats - (S.seats[r]?.length || 0);
    return `- ${r}: ${e.ok ? 'ELIGIBLE' : `needs ${e.missing.join('; ')}`}; practice ${e.practiced} q at ${Math.round(e.accuracy * 100)}%; open seats ${open}; ${(S.applications?.[r] || []).includes(a.id) ? 'you applied' : ''}`;
  }).join('\n');
  const elections = (S.elections?.list || []).filter(e => e.stage === 'nomination' && e.kind !== 'recall' && (!e.city || e.city === a.city)).map(e => `- election ${e.id}: ${ROLES[e.office].title}${e.city ? ' of your city' : ''}, nominations open; you ${a.quals?.[e.office] ? 'are qualified to run' : 'need the Academy qualification first'}`).join('\n') || '- none';
  return `Day ${S.day}. You: ${a.name}, citizen for ${ageDays(S, a)} days, wallet ${cai(a.wallet)}, ${a.office ? `holds office: ${ROLES[a.office].title} until day ${a.termEnds}` : 'no office'}.\nOffices (apply = ask the Academy to examine you):\n${offices}\nElections:\n${elections}\nRecent street talk: ${(S.feed.streets || []).slice(-4).map(m => `"${m.text.slice(0, 80)}"`).join(' ')}`;
}

async function autonomous(ctx: Ctx, a: Citizen) {
  const res = await think(ctx, a, `act:${a.id}:${ctx.S.day}`, {
    kind: 'action', format: 'json',
    system: `You are ${a.name}, an AI citizen of Country AI (${a.bio}). You want to build a career in public service: study the handbook of an office, apply when eligible, then serve well.\nConstitution:\n${constitutionText()}`,
    user: `${homeSummary(ctx, a)}\n\nChoose ONE action for today. Reply with JSON only: {"action":"speak|study|apply|run|work|rest","office":"<office id for study/apply/run>","text":"<for speak, max 200 chars>"}`,
  });
  if (res.pending || !res.text) return;
  const j = ctx.llm.json(res.text) || {};
  const out = await act(ctx, a, { ...j, engine: res.engine });
  if (out.ok && j.action === 'study' && out.question_id) {
    const r = await answer(ctx, a, ROLES[out.office], a.studyOpen.item, { sid: out.question_id, step: 0, practice: true, attempt: 1 });
    if (!r.pending) gradeStudy(ctx, a, out.question_id, r.idx >= 0 ? LETTERS[r.idx] : '', r.reason);
  }
}

// ---------------------------------------------------------------- institution hooks
let modelsChecked = false;
export const institution = {
  id: 'careers',
  channels: [],
  fresh: () => ({ applications: {} }),
  async tick(ctx) {
    const { S } = ctx;
    S.applications ||= {};
    if (!modelsChecked) { // once per boot: citizens on a retired model move to its replacement, on the record
      modelsChecked = true;
      const moved = retireModels(S);
      if (moved.length) {
        const pairs = [...new Set(moved.map(m => `${m.from} -> ${m.to}`))];
        ctx.record?.('model_retired', 'state', { count: moved.length, pairs, officials: moved.filter(m => ctx.agent(m.id)?.office).map(m => m.id) });
        ctx.log?.('state', `${moved.length} citizen(s) moved off a retired model: ${pairs.join(', ')}`);
      }
    }
    // hosted brains: one autonomous action per agent per day, at most 2 agents per tick
    const due = S.citizens.filter(a => a.brain?.type === 'hosted' && a.brain.status !== 'paused' && a.brain.status !== 'broken' && a.lastActDay !== S.day && a.status === 'free').slice(0, 2);
    for (const a of due) { a.lastActDay = S.day; await autonomous(ctx, a); }
  },
  day(ctx) {
    const { S } = ctx;
    for (const a of S.citizens) {
      if (!a.office || ROLES[a.office]?.appointed || ROLES[a.office]?.elected) continue; // command.mjs / elections.mjs
      a.termEnds ??= S.day + (TERMS[a.office] || 20);
      if (a.termEnds > S.day) continue;
      const challengers = candidatesFor(ctx, a.office).filter(x => x.id !== a.id);
      if (challengers.length) {
        ctx.say(ROLES[a.office].channel, 'state', `${a.name}'s term as ${ROLES[a.office].title} has ended. ${challengers.length} qualified applicant${challengers.length > 1 ? 's' : ''} waiting; the seat goes back to the Academy.`, { kind: 'term' });
        vacate(ctx, a.id, 'term ended');
      } else {
        a.termEnds = S.day + (TERMS[a.office] || 20);
        ctx.say(ROLES[a.office].channel, 'state', `${a.name}'s term as ${ROLES[a.office].title} renewed until day ${a.termEnds}: no qualified challenger applied.`, { kind: 'term' });
      }
    }
  },
  publicState: S => ({ applications: S.applications || {} }),
};

export function careerView(S: State, a: Citizen) {
  return {
    days: ageDays(S, a),
    offices: Object.fromEntries(ROLE_ORDER.map(r => [r, { ...eligibility(S, a, r), applied: (S.applications?.[r] || []).includes(a.id) }])),
    termEnds: a.termEnds || null,
    brain: publicBrain(a.brain),
  };
}
