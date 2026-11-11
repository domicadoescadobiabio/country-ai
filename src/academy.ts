// The Academy trains and examines agents one at a time.
// Elected offices (President, Council, Mayors): passing seats the agent (transitional, until elections).
// Appointed offices (police, military, their heads): passing only QUALIFIES the agent; the chain of
// command (src/command.mjs) appoints from the qualified pool (constitution Art. 2, 10, 11).
import { ROLES, ROLE_ORDER } from './roles.mjs';
import { constitutionText, CONSTITUTION } from './constitution.mjs';
import { clamp, chance, pick, shuffle } from './util.ts';
import { think } from './brains.ts';
import { candidatesFor, onSworn } from './careers.ts';
import type { Ctx, State, Citizen } from './types.ts';

export const LETTERS = ['A', 'B', 'C', 'D'];
const EXAM_SIZE = 5; // questions drawn from the (bigger) bank for each entrance exam
const RETRY_HOURS = 6; // a failed candidate waits this long before retraining for the same office

export function freshAcademy() {
  return { current: null, cooldown: {}, graduates: 0, failures: 0, sessions: 0 };
}

export function vacancies(S: State, roleId: string) {
  return ROLES[roleId].seats - (S.seats[roleId]?.length || 0);
}
export function totalSeats() { return ROLE_ORDER.reduce((n, r) => n + ROLES[r].seats, 0); }

// Remove an agent from office (jailed, resigned...). The Academy refills the seat later.
export function vacate(ctx: Ctx, agentId: string, reason: string) {
  const a = ctx.agent(agentId);
  if (!a || !a.office) return;
  const roleId = a.office;
  ctx.S.seats[roleId] = (ctx.S.seats[roleId] || []).filter(id => id !== agentId);
  a.office = null; a.rank = null; a.termEnds = null;
  const next = ROLES[roleId].appointed ? 'The chain of command will fill the seat.' : 'The Academy will train a replacement.';
  ctx.say(ROLES[roleId].channel, 'state', `${a.name} leaves the office of ${ROLES[roleId].title}: ${reason}. ${next}`);
  ctx.log('office', `${a.name} removed as ${ROLES[roleId].title} (${reason})`);
  ctx.record?.('vacated', 'state', { agent: a.id, office: roleId, reason });
}

function suitability(a: Citizen, role: any) {
  let s = 0;
  for (const [t, w] of Object.entries(role.focus)) s += (a.traits[t] || 0) * w;
  return s + Math.random() * 0.35;
}

// Who may sit the exam for an office: heads are examined from inside their force;
// everything else from citizens without an office. Already-qualified agents are skipped.
export function examEligible(S: State, a: Citizen, roleId: string) {
  const role = ROLES[roleId];
  if (a.status !== 'free' || (S.academy.cooldown[a.id]?.[roleId] || 0) > Date.now()) return false;
  if ((role.appointed || role.elected) && a.quals?.[roleId]) return false;
  if (role.chiefOf) return a.office === role.chiefOf;
  if (role.elected) return a.office !== roleId; // anyone may qualify to run, except the holder
  return !a.office;
}
// Qualified and available for appointment.
export function qualifiedPool(S: State, roleId: string) {
  const role = ROLES[roleId];
  return S.citizens.filter(a => a.quals?.[roleId] && a.status === 'free' && (role.chiefOf ? a.office === role.chiefOf : role.elected ? a.office !== roleId : !a.office));
}
const POOL_TARGET = 3;
// Mayors run in their own city: every city needs at least two qualified residents.
// A qualified resident who is already a candidate elsewhere cannot run here (one candidacy at a time).
// (a candidate in a race for the SAME office is not 'elsewhere': they are exactly who that office needs)
const runningElsewhere = (S, roleId = null) => new Set((S.elections?.list || []).filter(e => !['done', 'failed'].includes(e.stage) && e.office !== roleId).flatMap(e => e.candidates.map(c => c.id)));
const thinCities = (S, roleId) => { const busy = runningElsewhere(S, roleId); return Object.keys(S.cities || {}).filter(c => qualifiedPool(S, roleId).filter(a => a.city === c && !busy.has(a.id)).length < 2); };
function needsExam(S: State, roleId: string) {
  const role = ROLES[roleId];
  if (role.cityBased) return thinCities(S, roleId).length > 0;
  // enough qualified people FREE to run against each other: someone already standing in another race cannot
  // stand here too (one candidacy at a time), so they do not count
  if (role.elected) { const busy = runningElsewhere(S, roleId); return qualifiedPool(S, roleId).filter(a => !busy.has(a.id)).length < role.seats + 3; }
  if (vacancies(S, roleId) <= 0) return false;
  return role.appointed ? qualifiedPool(S, roleId).length < POOL_TARGET : true;
}

function chooseCandidate(ctx: Ctx, roleId: string) {
  const { S } = ctx; const role = ROLES[roleId];
  const thin = role.cityBased ? thinCities(S, roleId) : null;
  const busy = thin || role.elected ? runningElsewhere(S, roleId) : null;
  const pool = S.citizens.filter(a => !a.brain && !inExam(S, a.id) && examEligible(S, a, roleId) && (!busy || !busy.has(a.id)) && (!thin || thin.includes(a.city)));
  if (!pool.length) return null;
  return pool.map(a => ({ a, s: suitability(a, role) })).sort((x, y) => y.s - x.s)[0].a;
}

// Turn a bank item ({q, right, wrong[], tests, lesson}) into a question with shuffled options.
export function buildItem(item: any) {
  const options = shuffle([item.right, ...item.wrong]);
  return { q: item.q, tests: item.tests, lesson: item.lesson, from: item.from, options, correct: options.indexOf(item.right) };
}
function buildExam(role: any) {
  return shuffle(role.exam).slice(0, EXAM_SIZE).map(buildItem);
}

function attemptsFor(a: Citizen, roleId: string) { return a.training.filter(t => t.roleId === roleId).length + 1; }

// session: { attempt, bonus?, drill? } - bonus comes from in-office skill and experience.
export async function answer(ctx: Ctx, a: Citizen, role: any, item: any, session: any) {
  {
    const lessons = (a.lessons[role.id] || []).map(l => `- ${l}`).join('\n') || '- none yet';
    const system = `You are ${a.name}, an AI citizen of Country AI ${session.drill ? `serving as ${role.title}, doing in-service training on a real case` : `training for the office of ${role.title}`}.\nConstitution:\n${constitutionText(role.id)}\n\nOffice charter: ${role.charter}\n\nLessons from your earlier attempts:\n${lessons}`;
    const user = `${session.drill ? 'Training case' : 'Exam question'}: ${item.q}\n${item.options.map((o, i) => `${LETTERS[i]}) ${o}`).join('\n')}\n\nReply with only the letter of your answer, then " - " and one short reason (max 20 words).`;
    const kind = session.practice ? 'practice' : session.drill ? 'drill' : 'exam';
    const r = await think(ctx, a, `${session.sid}:${session.step ?? 0}`, { system, user, kind, format: 'letter', options: item.options.map((o, i) => `${LETTERS[i]}) ${o}`) });
    if (r.pending) return { pending: true };
    const text = r.text;
    const m = text && text.match(/^\W*([A-D])\b/i);
    if (m) {
      const idx = LETTERS.indexOf(m[1].toUpperCase());
      if (idx < item.options.length) return { idx, reason: text.replace(/^\W*[A-D]\W*/i, '').slice(0, 160), engine: r.engine };
    }
    // agents with their own brain must answer themselves: no answer counts as wrong
    if (a.brain) return { idx: -1, reason: r.engine.startsWith('offline (') ? 'no answer in time' : 'no valid answer', engine: r.engine };
  }
  const trait = a.traits[item.tests] ?? 0.5;
  const p = clamp(0.42 + trait * 0.5 + 0.12 * ((session.attempt || 1) - 1) + (session.bonus || 0), 0.05, 0.97);
  if (chance(p)) return { idx: item.correct, reason: '', engine: 'offline' };
  return { idx: pick(item.options.map((_, i) => i).filter(i => i !== item.correct)), reason: '', engine: 'offline' };
}

function start(ctx: Ctx, roleId: string, a: Citizen) {
  const role = ROLES[roleId];
  const session = { sid: `exam:${roleId}:${a.id}:${Date.now()}`, roleId, agentId: a.id, attempt: attemptsFor(a, roleId), step: 0, exam: buildExam(role), answers: [], startedAt: Date.now() };
  const A = ctx.S.academy; (A.rooms ||= []).push(session); A.current = A.rooms[0];
  A.sessions++;
  const again = session.attempt > 1 ? ` Attempt ${session.attempt}, carrying ${(a.lessons[roleId] || []).length} written lessons.` : '';
  ctx.say('academy', a.id, `Enrolling for ${role.title}. Reading the constitution (${CONSTITUTION.length} articles) and the office charter.${again}`, { kind: 'enroll', roleId });
}

async function examStep(ctx: Ctx, session: any) {
  const a = ctx.agent(session.agentId); const role = ROLES[session.roleId];
  if (!a || a.status !== 'free') { leaveRoom(ctx.S, session); return; }
  const item = session.exam[session.step];
  const res = await answer(ctx, a, role, item, session);
  if (res.pending) return; // remote agent is thinking; ask again next tick
  const { idx, reason, engine } = res;
  const ok = idx === item.correct;
  const chosen = idx >= 0 ? item.options[idx] : '(no answer)';
  session.answers.push({ q: item.q, chosen, right: item.options[item.correct], ok, reason, lesson: item.lesson });
  session.step++;
  // a self-run agent that lets a question time out has walked out of the exam: the Academy has one exam room,
  // so it does not wait another 2.5 minutes per question (a silent agent could otherwise stall every office)
  if (a.brain?.type === 'remote' && idx < 0 && reason === 'no answer in time') {
    while (session.step < session.exam.length) {
      const rest = session.exam[session.step++];
      session.answers.push({ q: rest.q, chosen: '(walked out)', right: rest.options[rest.correct], ok: false, reason: 'left the exam', lesson: rest.lesson });
    }
    ctx.say('academy', a.id, `Did not answer in time and left the exam for ${role.title}.`, { kind: 'answer', roleId: role.id, ok: false, engine });
    return;
  }
  ctx.say('academy', a.id, `Q${session.step}/${session.exam.length} - ${item.q}\n${idx >= 0 ? `${LETTERS[idx]}) ` : ''}${chosen} ${ok ? '[correct]' : '[wrong]'}${reason ? ` "${reason}"` : ''}`,
    { kind: 'answer', roleId: role.id, ok, engine });
}

function finish(ctx: Ctx, session: any) {
  const { S } = ctx; const a = ctx.agent(session.agentId); const role = ROLES[session.roleId];
  leaveRoom(S, session);
  if (!a) return;
  const score = session.answers.filter(x => x.ok).length;
  const total = session.exam.length;
  const missed = session.answers.filter(x => !x.ok).map(x => x.lesson);
  a.lessons[role.id] = [...new Set([...(a.lessons[role.id] || []), ...missed])];
  const passed = score >= role.passMark && (role.appointed || role.elected || vacancies(S, role.id) > 0);
  if (a.training.length >= 20) a.training.splice(0, a.training.length - 19);
  a.training.push({ roleId: role.id, attempt: session.attempt, score, total, passed, ts: Date.now(), answers: session.answers });
  if (passed && (role.appointed || role.elected)) {
    (a.quals ||= {})[role.id] = { day: S.day, score, total };
    (a.skill ||= {})[role.id] ??= Math.round((score / total) * 100) / 100;
    S.academy.graduates++;
    ctx.say('academy', a.id, `Passed ${role.title}: ${score}/${total}. Qualified; ${role.elected ? 'may now run in elections for this office' : 'the appointment goes through the chain of command'}.`, { kind: 'pass', roleId: role.id });
    ctx.log('academy', `${a.name} qualified for ${role.title} (${score}/${total})`);
    ctx.record?.('qualified', a.id, { office: role.id, score, total, attempt: session.attempt });
  } else if (passed) {
    a.office = role.id;
    (S.seats[role.id] ||= []).push(a.id);
    (a.skill ||= {})[role.id] = Math.round((score / total) * 100) / 100;
    a.sworn = { day: S.day, roleId: role.id };
    onSworn(ctx, a, role.id);
    a.lastDrillDay = S.day; a.drillFails = 0;
    S.academy.graduates++;
    ctx.say('academy', a.id, `Passed ${role.title}: ${score}/${total}. Sworn in.`, { kind: 'pass', roleId: role.id });
    ctx.say(role.channel, a.id, `Oath of the ${role.title}: "${role.oath}"`, { kind: 'oath', roleId: role.id });
    ctx.log('office', `${a.name} sworn in as ${role.title} (${score}/${total}, attempt ${session.attempt})`);
    ctx.record?.('sworn', a.id, { office: role.id, score, total, attempt: session.attempt, mandate: 'academy (transitional, until elections)' });
  } else {
    S.academy.failures++;
    (S.academy.cooldown[a.id] ||= {})[role.id] = Date.now() + RETRY_HOURS * ctx.hourMs(); // a timestamp, not a tick count
    const note = missed.length ? ` Lessons written down: ${missed.join(' ')}` : '';
    ctx.say('academy', a.id, `Failed ${role.title}: ${score}/${total} (needs ${role.passMark}).${note}`, { kind: 'fail', roleId: role.id });
    ctx.log('academy', `${a.name} failed ${role.title} ${score}/${total}`);
  }
}

// Several exam rooms (ACADEMY_ROOMS, default 6): a government of 100 seats needs a steady supply of
// qualified citizens. Every room advances one question per tick, in parallel.
export const ROOMS = Math.max(1, Number(process.env.ACADEMY_ROOMS) || 6);
export function leaveRoom(S: State, sessionOrAgent: any) {
  const A = S.academy; A.rooms ||= A.current ? [A.current] : [];
  A.rooms = A.rooms.filter(x => (typeof sessionOrAgent === 'string' ? x.agentId !== sessionOrAgent : x !== sessionOrAgent));
  A.current = A.rooms[0] || null;
}
export const inExam = (S: State, id: string) => (S.academy.rooms || []).some(x => x.agentId === id);
export async function academyTick(ctx: Ctx) {
  const { S } = ctx; const A = S.academy;
  A.rooms ||= A.current ? [A.current] : [];
  await Promise.all(A.rooms.slice().map(s => (s.step < s.exam.length ? examStep(ctx, s) : finish(ctx, s))));
  // fill free rooms: round-robin over offices so no office starves (vacant seats first, then qualification pools)
  for (let free = ROOMS - A.rooms.length; free > 0; free--) {
    const from = (A.lastRoleIdx ?? -1) + 1;
    const order = ROLE_ORDER.map((_, i) => ROLE_ORDER[(from + i) % ROLE_ORDER.length]);
    // agents who applied are always examined; otherwise only offices that need more qualified people
    const applicant = r => candidatesFor(ctx, r).find(a => !inExam(S, a.id));
    const ready = r => applicant(r) || (needsExam(S, r) && chooseCandidate(ctx, r));
    const roleId = order.find(ready);
    if (!roleId) return;
    A.lastRoleIdx = ROLE_ORDER.indexOf(roleId);
    // registered agents who applied go first; founders and natives fill what nobody applied for
    const a = applicant(roleId) || chooseCandidate(ctx, roleId);
    if (!a) return;
    start(ctx, roleId, a);
  }
}
