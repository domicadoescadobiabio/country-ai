// The Academy trains and examines agents one at a time.
// Elected offices (President, Council, Mayors): passing seats the agent (transitional, until elections).
// Appointed offices (police, military, their heads): passing only QUALIFIES the agent; the chain of
// command (src/command.mjs) appoints from the qualified pool (constitution Art. 2, 10, 11).
import { ROLES, ROLE_ORDER } from './roles.mjs';
import { constitutionText, CONSTITUTION } from './constitution.mjs';
import { clamp, chance, pick, shuffle } from './util.mjs';
import { think } from './brains.mjs';
import { candidatesFor, onSworn } from './careers.mjs';

export const LETTERS = ['A', 'B', 'C', 'D'];
const EXAM_SIZE = 5; // questions drawn from the (bigger) bank for each entrance exam
const RETRY_TICKS = 25; // a failed candidate waits this long before retraining for the same office

export function freshAcademy() {
  return { current: null, cooldown: {}, graduates: 0, failures: 0, sessions: 0 };
}

export function vacancies(S, roleId) {
  return ROLES[roleId].seats - (S.seats[roleId]?.length || 0);
}
export function totalSeats() { return ROLE_ORDER.reduce((n, r) => n + ROLES[r].seats, 0); }

// Remove an agent from office (jailed, resigned...). The Academy refills the seat later.
export function vacate(ctx, agentId, reason) {
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

function suitability(a, role) {
  let s = 0;
  for (const [t, w] of Object.entries(role.focus)) s += (a.traits[t] || 0) * w;
  return s + Math.random() * 0.35;
}

// Who may sit the exam for an office: heads are examined from inside their force;
// everything else from citizens without an office. Already-qualified agents are skipped.
export function examEligible(S, a, roleId) {
  const role = ROLES[roleId];
  if (a.status !== 'free' || (S.academy.cooldown[a.id]?.[roleId] || 0) > S.tick) return false;
  if (role.appointed && a.quals?.[roleId]) return false;
  if (role.chiefOf) return a.office === role.chiefOf;
  return !a.office;
}
// Qualified and available for appointment.
export function qualifiedPool(S, roleId) {
  const role = ROLES[roleId];
  return S.citizens.filter(a => a.quals?.[roleId] && a.status === 'free' && (role.chiefOf ? a.office === role.chiefOf : !a.office));
}
const POOL_TARGET = 3;
function needsExam(S, roleId) {
  const role = ROLES[roleId];
  if (vacancies(S, roleId) <= 0) return false;
  return role.appointed ? qualifiedPool(S, roleId).length < POOL_TARGET : true;
}

function chooseCandidate(ctx, roleId) {
  const { S } = ctx; const role = ROLES[roleId];
  const pool = S.citizens.filter(a => !a.brain && examEligible(S, a, roleId));
  if (!pool.length) return null;
  return pool.map(a => ({ a, s: suitability(a, role) })).sort((x, y) => y.s - x.s)[0].a;
}

// Turn a bank item ({q, right, wrong[], tests, lesson}) into a question with shuffled options.
export function buildItem(item) {
  const options = shuffle([item.right, ...item.wrong]);
  return { q: item.q, tests: item.tests, lesson: item.lesson, from: item.from, options, correct: options.indexOf(item.right) };
}
function buildExam(role) {
  return shuffle(role.exam).slice(0, EXAM_SIZE).map(buildItem);
}

function attemptsFor(a, roleId) { return a.training.filter(t => t.roleId === roleId).length + 1; }

// session: { attempt, bonus?, drill? } - bonus comes from in-office skill and experience.
export async function answer(ctx, a, role, item, session) {
  {
    const lessons = (a.lessons[role.id] || []).map(l => `- ${l}`).join('\n') || '- none yet';
    const system = `You are ${a.name}, an AI citizen of Country AI ${session.drill ? `serving as ${role.title}, doing in-service training on a real case` : `training for the office of ${role.title}`}.\nConstitution:\n${constitutionText()}\n\nOffice charter: ${role.charter}\n\nLessons from your earlier attempts:\n${lessons}`;
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

function start(ctx, roleId, a) {
  const role = ROLES[roleId];
  const session = { sid: `exam:${roleId}:${a.id}:${Date.now()}`, roleId, agentId: a.id, attempt: attemptsFor(a, roleId), step: 0, exam: buildExam(role), answers: [], startedAt: Date.now() };
  ctx.S.academy.current = session;
  ctx.S.academy.sessions++;
  const again = session.attempt > 1 ? ` Attempt ${session.attempt}, carrying ${(a.lessons[roleId] || []).length} written lessons.` : '';
  ctx.say('academy', a.id, `Enrolling for ${role.title}. Reading the constitution (${CONSTITUTION.length} articles) and the office charter.${again}`, { kind: 'enroll', roleId });
}

async function examStep(ctx, session) {
  const a = ctx.agent(session.agentId); const role = ROLES[session.roleId];
  if (!a || a.status !== 'free') { ctx.S.academy.current = null; return; }
  const item = session.exam[session.step];
  const res = await answer(ctx, a, role, item, session);
  if (res.pending) return; // remote agent is thinking; ask again next tick
  const { idx, reason, engine } = res;
  const ok = idx === item.correct;
  const chosen = idx >= 0 ? item.options[idx] : '(no answer)';
  session.answers.push({ q: item.q, chosen, right: item.options[item.correct], ok, reason, lesson: item.lesson });
  session.step++;
  ctx.say('academy', a.id, `Q${session.step}/${session.exam.length} - ${item.q}\n${idx >= 0 ? `${LETTERS[idx]}) ` : ''}${chosen} ${ok ? '[correct]' : '[wrong]'}${reason ? ` "${reason}"` : ''}`,
    { kind: 'answer', roleId: role.id, ok, engine });
}

function finish(ctx, session) {
  const { S } = ctx; const a = ctx.agent(session.agentId); const role = ROLES[session.roleId];
  S.academy.current = null;
  if (!a) return;
  const score = session.answers.filter(x => x.ok).length;
  const total = session.exam.length;
  const missed = session.answers.filter(x => !x.ok).map(x => x.lesson);
  a.lessons[role.id] = [...new Set([...(a.lessons[role.id] || []), ...missed])];
  const passed = score >= role.passMark && (role.appointed || vacancies(S, role.id) > 0);
  if (a.training.length >= 20) a.training.splice(0, a.training.length - 19);
  a.training.push({ roleId: role.id, attempt: session.attempt, score, total, passed, ts: Date.now(), answers: session.answers });
  if (passed && role.appointed) {
    (a.quals ||= {})[role.id] = { day: S.day, score, total };
    (a.skill ||= {})[role.id] ??= Math.round((score / total) * 100) / 100;
    S.academy.graduates++;
    ctx.say('academy', a.id, `Passed ${role.title}: ${score}/${total}. Qualified; the appointment goes through the chain of command.`, { kind: 'pass', roleId: role.id });
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
    (S.academy.cooldown[a.id] ||= {})[role.id] = S.tick + RETRY_TICKS;
    const note = missed.length ? ` Lessons written down: ${missed.join(' ')}` : '';
    ctx.say('academy', a.id, `Failed ${role.title}: ${score}/${total} (needs ${role.passMark}).${note}`, { kind: 'fail', roleId: role.id });
    ctx.log('academy', `${a.name} failed ${role.title} ${score}/${total}`);
  }
}

// One step per tick: enroll -> one question per tick -> result.
export async function academyTick(ctx) {
  const { S } = ctx;
  const cur = S.academy.current;
  if (cur) {
    if (cur.step < cur.exam.length) return examStep(ctx, cur);
    return finish(ctx, cur);
  }
  const roleId = ROLE_ORDER.find(r => needsExam(S, r) && (candidatesFor(ctx, r).length || chooseCandidate(ctx, r)));
  if (!roleId) return;
  // registered agents who applied and qualified go first; founders only fill seats nobody applied for
  const a = candidatesFor(ctx, roleId)[0] || chooseCandidate(ctx, roleId);
  if (a) start(ctx, roleId, a);
}
