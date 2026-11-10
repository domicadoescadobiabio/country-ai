// The Academy trains agents one at a time, office by office, in constitutional order:
// President first, then Council, then Police, then Military.
import { ROLES, ROLE_ORDER } from './roles.mjs';
import { constitutionText, CONSTITUTION } from './constitution.mjs';
import { clamp, chance, pick, shuffle } from './util.mjs';

const LETTERS = ['A', 'B', 'C', 'D'];
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
  a.office = null;
  ctx.say(ROLES[roleId].channel, 'state', `${a.name} leaves the office of ${ROLES[roleId].title}: ${reason}. The Academy will train a replacement.`);
  ctx.log('office', `${a.name} removed as ${ROLES[roleId].title} (${reason})`);
}

function suitability(a, role) {
  let s = 0;
  for (const [t, w] of Object.entries(role.focus)) s += (a.traits[t] || 0) * w;
  return s + Math.random() * 0.35;
}

function chooseCandidate(ctx, roleId) {
  const { S } = ctx; const role = ROLES[roleId];
  const pool = S.citizens.filter(a => a.status === 'free' && !a.office && !((S.academy.cooldown[a.id]?.[roleId] || 0) > S.tick));
  if (!pool.length) return null;
  return pool.map(a => ({ a, s: suitability(a, role) })).sort((x, y) => y.s - x.s)[0].a;
}

function buildExam(role) {
  return shuffle(role.exam).map(item => {
    const options = shuffle([item.right, ...item.wrong]);
    return { q: item.q, tests: item.tests, lesson: item.lesson, options, correct: options.indexOf(item.right) };
  });
}

function attemptsFor(a, roleId) { return a.training.filter(t => t.roleId === roleId).length + 1; }

async function answer(ctx, a, role, item, session) {
  const { llm } = ctx;
  if (llm.enabled) {
    const lessons = (a.lessons[role.id] || []).map(l => `- ${l}`).join('\n') || '- none yet';
    const system = `You are ${a.name}, an AI citizen of Country AI training for the office of ${role.title}.\nConstitution:\n${constitutionText()}\n\nOffice charter: ${role.charter}\n\nLessons from your earlier attempts:\n${lessons}`;
    const user = `Exam question: ${item.q}\n${item.options.map((o, i) => `${LETTERS[i]}) ${o}`).join('\n')}\n\nReply with only the letter of your answer, then " - " and one short reason (max 20 words).`;
    const text = await llm.ask({ model: a.model, system, user, maxTokens: 60, temperature: 0.3 });
    const m = text && text.match(/^\W*([A-D])\b/i);
    if (m) {
      const idx = LETTERS.indexOf(m[1].toUpperCase());
      if (idx < item.options.length) return { idx, reason: text.replace(/^\W*[A-D]\W*/i, '').slice(0, 160), engine: 'llm' };
    }
  }
  const trait = a.traits[item.tests] ?? 0.5;
  const p = clamp(0.42 + trait * 0.5 + 0.12 * (session.attempt - 1), 0.05, 0.97);
  if (chance(p)) return { idx: item.correct, reason: '', engine: 'offline' };
  return { idx: pick(item.options.map((_, i) => i).filter(i => i !== item.correct)), reason: '', engine: 'offline' };
}

function start(ctx, roleId, a) {
  const role = ROLES[roleId];
  const session = { roleId, agentId: a.id, attempt: attemptsFor(a, roleId), step: 0, exam: buildExam(role), answers: [], startedAt: Date.now() };
  ctx.S.academy.current = session;
  ctx.S.academy.sessions++;
  const again = session.attempt > 1 ? ` Attempt ${session.attempt}, carrying ${(a.lessons[roleId] || []).length} written lessons.` : '';
  ctx.say('academy', a.id, `Enrolling for ${role.title}. Reading the constitution (${CONSTITUTION.length} articles) and the office charter.${again}`, { kind: 'enroll', roleId });
}

async function examStep(ctx, session) {
  const a = ctx.agent(session.agentId); const role = ROLES[session.roleId];
  if (!a || a.status !== 'free') { ctx.S.academy.current = null; return; }
  const item = session.exam[session.step];
  const { idx, reason, engine } = await answer(ctx, a, role, item, session);
  const ok = idx === item.correct;
  session.answers.push({ q: item.q, chosen: item.options[idx], right: item.options[item.correct], ok, reason, lesson: item.lesson });
  session.step++;
  ctx.say('academy', a.id, `Q${session.step}/${session.exam.length} - ${item.q}\n${LETTERS[idx]}) ${item.options[idx]} ${ok ? '[correct]' : '[wrong]'}${reason ? ` "${reason}"` : ''}`,
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
  const passed = score >= role.passMark && vacancies(S, role.id) > 0;
  a.training.push({ roleId: role.id, attempt: session.attempt, score, total, passed, ts: Date.now(), answers: session.answers });
  if (passed) {
    a.office = role.id;
    (S.seats[role.id] ||= []).push(a.id);
    S.academy.graduates++;
    ctx.say('academy', a.id, `Passed ${role.title}: ${score}/${total}. Sworn in.`, { kind: 'pass', roleId: role.id });
    ctx.say(role.channel, a.id, `Oath of the ${role.title}: "${role.oath}"`, { kind: 'oath', roleId: role.id });
    ctx.log('office', `${a.name} sworn in as ${role.title} (${score}/${total}, attempt ${session.attempt})`);
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
  const roleId = ROLE_ORDER.find(r => vacancies(S, r) > 0);
  if (!roleId) return;
  const a = chooseCandidate(ctx, roleId);
  if (a) start(ctx, roleId, a);
}
