// The Academy trains and examines agents one at a time.
// Elected offices (President, Council, Mayors): passing seats the agent (transitional, until elections).
// Appointed offices (police, military, their heads): passing only QUALIFIES the agent; the chain of
// command (src/command.mjs) appoints from the qualified pool (constitution Art. 2, 10, 11).
import { ROLES, ROLE_ORDER, ruleQuestions, fieldQuestionFor, topFieldsText, giftedText, giftedFor, OFFICE_FIELDS, examPlan, HANDBOOK, fieldSkillOf } from './roles.mjs';
import { constitutionText, CONSTITUTION, NATION } from './constitution.mjs';
import { clamp, chance, pick, shuffle } from './util.ts';
import { think } from './brains.ts';
import { candidatesFor, onSworn } from './careers.ts';
import { caseStudies } from './cases.mjs';
import type { Ctx, State, Citizen } from './types.ts';

export const LETTERS = ['A', 'B', 'C', 'D'];
// a failed candidate waits before sitting the same office again: 12 republic hours after the first failure,
// doubling after each further one (12, 24, 48, at most 96 hours); the lessons they missed are written down
export const RETRY_HOURS = 12;
export const retryHours = (attempt: number) => RETRY_HOURS * Math.min(8, 2 ** Math.max(0, (attempt || 1) - 1));
const SEEN_MAX = 150; // question fingerprints kept per citizen (about a dozen exams), so no exam repeats a question

export function freshAcademy() {
  return { current: null, cooldown: {}, graduates: 0, failures: 0, sessions: 0 };
}
// pass rates the owner can read: per office (all exams and first attempts) and per kind of question
const STATS = (S: State) => {
  const A = S.academy; A.stats ||= { byRole: {}, byKind: {} };
  A.stats.byRole ||= {}; A.stats.byKind ||= {};
  return A.stats;
};

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
  // the offices a citizen has held stay on their card (candidate cards show offices held, not exams passed; #935)
  a.officeHistory = [...new Set([...(a.officeHistory || []), roleId])].slice(-12);
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
  const role = ROLES[roleId]; if (!role || !Object.hasOwn(ROLES, roleId)) return false; // unknown office id
  if (a.status !== 'free' || (S.academy.cooldown[a.id]?.[roleId] || 0) > Date.now()) return false;
  if ((role.appointed || role.elected) && a.quals?.[roleId]) return false;
  if (role.chiefOf) return a.office === role.chiefOf;
  if (role.elected) return a.office !== roleId; // anyone may qualify to run, except the holder
  return !a.office;
}
// Qualified and available for appointment.
export function qualifiedPool(S: State, roleId: string) {
  const role = ROLES[roleId]; if (!role || !Object.hasOwn(ROLES, roleId)) return [];
  return S.citizens.filter(a => a.quals?.[roleId] && a.status === 'free' && (role.chiefOf ? a.office === role.chiefOf : role.elected ? a.office !== roleId : !a.office));
}
const POOL_TARGET = 3;
// Mayors run in their own city: every city needs at least two qualified residents.
// A qualified resident who is already a candidate elsewhere cannot run here (one candidacy at a time).
// (a candidate in a race for the SAME office is not 'elsewhere': they are exactly who that office needs)
const runningElsewhere = (S, roleId = null) => new Set((S.elections?.list || []).filter(e => !['done', 'failed'].includes(e.stage) && e.office !== roleId).flatMap(e => e.candidates.map(c => c.id)));
const thinCities = (S, roleId) => { const busy = runningElsewhere(S, roleId); return Object.keys(S.cities || {}).filter(c => qualifiedPool(S, roleId).filter(a => a.city === c && !busy.has(a.id)).length < 2); };
function needsExam(S: State, roleId: string) {
  const role = ROLES[roleId]; if (!role || !Object.hasOwn(ROLES, roleId)) return false;
  if (role.cityBased) return thinCities(S, roleId).length > 0;
  // enough qualified people FREE to run against each other: someone already standing in another race cannot
  // stand here too (one candidacy at a time), so they do not count
  // enough qualified people who can really stand against each other: not holding another seat (judges and
  // officials in mid-term may not run), able to pay the deposit, and not standing in a race for another office
  if (role.elected) { const busy = runningElsewhere(S, roleId); return qualifiedPool(S, roleId).filter(a => !busy.has(a.id) && (!a.office || a.office === roleId) && a.wallet >= 100).length < role.seats + 3; }
  if (vacancies(S, roleId) <= 0) return false;
  return role.appointed ? qualifiedPool(S, roleId).length < POOL_TARGET : true;
}

function chooseCandidate(ctx: Ctx, roleId: string) {
  const { S } = ctx; const role = ROLES[roleId]; if (!role || !Object.hasOwn(ROLES, roleId)) return null;
  const thin = role.cityBased ? thinCities(S, roleId) : null;
  const busy = thin || role.elected ? runningElsewhere(S, roleId) : null;
  const pool = S.citizens.filter(a => !a.brain && !inExam(S, a.id) && examEligible(S, a, roleId) && (!busy || !busy.has(a.id)) && (!role.elected || (!a.office && a.wallet >= 100)) && (!thin || thin.includes(a.city)));
  if (!pool.length) return null;
  // the state's talent programme: the gifted in a field this office works in are a little likelier to be examined
  return pool.map(a => ({ a, s: suitability(a, role) + (giftedFor(S, a, OFFICE_FIELDS[roleId]) ? 0.15 : 0) })).sort((x, y) => y.s - x.s)[0].a;
}

// Turn a bank item ({q, right, wrong[], tests, lesson}) into a question with shuffled options.
export function buildItem(item: any) {
  const options = shuffle([item.right, ...item.wrong]);
  return { q: item.q, tests: item.tests, lesson: item.lesson, from: item.from, kind: item.kind || kindOf(item), field: item.field || null, options, correct: options.indexOf(item.right) };
}
export const kindOf = (item: any) => (item?.from === 'rule question' ? 'rule' : String(item?.from || '').startsWith('field:') ? 'field' : item?.from === 'office handbook' || !item?.from ? 'handbook' : 'case');
// a short fingerprint of a question's text (the same scenario never comes back to the same citizen)
const fp = (q: string) => { let h = 2166136261; const s = String(q); for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36); };
// Each entrance exam (owner, 15 Nov): the office's tier sets the length and the pass mark (src/roles.mjs
// EXAM_TIERS). Rule questions with fresh numbers and near-miss options make up at least 40%; then questions from
// the fields the office works in (src/expertise.ts), case studies from what really happened (src/cases.mjs), and
// handbook scenarios for the rest. Every question appears once per exam and never one this citizen already had
// in an earlier exam; when a source runs dry, fresh rule questions fill the gap, so the length never shrinks.
export function buildExam(ctx: Ctx | { S: State }, role: any, a: Citizen | null = null) {
  const plan = examPlan(role.id);
  const seen = new Set<string>(a?.examSeen || []); const used = new Set<string>();
  const out: any[] = [];
  const take = (it: any, kind: string) => { if (!it || typeof it.q !== 'string' || out.length >= plan.size) return false; const k = fp(it.q); if (seen.has(k) || used.has(k)) return false; used.add(k); out.push({ ...it, kind }); return true; };
  const freshRules = (n: number) => { for (let tries = 0; n > 0 && tries < n * 8 + 8; tries++) for (const it of ruleQuestions(role.id, Math.min(n, 6))) if (n > 0 && take(it, 'rule')) n--; };
  freshRules(plan.rules);
  for (let n = plan.field, tries = 0; n > 0 && tries < plan.field * 4; tries++) if (take(fieldQuestionFor(role.id), 'field')) n--;
  let cases: any[] = []; try { cases = caseStudies(ctx, role.id, plan.cases + 2) || []; } catch { cases = []; }
  for (let n = plan.cases, i = 0; n > 0 && i < cases.length; i++) if (take(cases[i], 'case')) n--;
  const bank = Object.hasOwn(HANDBOOK, role.id) ? HANDBOOK[role.id] : role.exam || [];
  for (const it of shuffle(bank)) take({ ...it, from: 'office handbook' }, 'handbook');
  freshRules(plan.size - out.length);
  if (a) a.examSeen = [...(a.examSeen || []), ...used].slice(-SEEN_MAX);
  return shuffle(out).map(buildItem);
}
// the pass mark of an exam: the tier's mark, scaled if the exam came out shorter than planned
export const passMarkFor = (roleId: string, n: number) => { const p = examPlan(roleId); return Math.ceil(p.pass * n / p.size); };

function attemptsFor(a: Citizen, roleId: string) { return a.training.filter(t => t.roleId === roleId).length + 1; }

// The offline answer (no model in reach): the chance of the right letter. An entrance exam leans on what the
// citizen really knows: the trait the question tests, and their skill in the field it asks (a field question)
// or in the fields the office works in (everything else), each kind with its own base (a rule question needs
// the rule and the arithmetic, so it starts lower than a handbook scenario); a later attempt carries written
// lessons. In-service drills keep their own formula (src/training.ts; their recall rule is the owner's).
const OFFLINE_BASE: Record<string, number> = { handbook: 0.31, case: 0.25, rule: 0.17, field: 0.13 };
const AVG_SKILL = 0.38; // the people's average skill in an office's core fields (owner's figure: 0.34-0.43)
export function offlineChance(a: Citizen, item: any, session: any) {
  const trait = a.traits?.[item.tests] ?? 0.5;
  if (session.drill || session.practice || !item.kind) return clamp(0.42 + trait * 0.5 + 0.12 * ((session.attempt || 1) - 1) + (session.bonus || 0), 0.05, 0.97);
  const fields = item.kind === 'field' && item.field ? [item.field] : OFFICE_FIELDS[session.roleId] || [];
  const skills = fields.map(f => fieldSkillOf(a, f)).filter(v => v != null) as number[];
  const skill = skills.length ? Math.max(...skills) : AVG_SKILL;
  return clamp((OFFLINE_BASE[item.kind] ?? 0.3) + trait * 0.3 + skill * 0.4 + 0.03 * ((session.attempt || 1) - 1) + (session.bonus || 0), 0.05, 0.95);
}

// session: { attempt, bonus?, drill? } - bonus comes from in-office skill and experience.
export async function answer(ctx: Ctx, a: Citizen, role: any, item: any, session: any) {
  {
    const lessons = (a.lessons[role.id] || []).map(l => `- ${l}`).join('\n') || '- none yet';
    const system = `You are ${a.name}, an AI citizen of ${NATION} ${session.drill ? `serving as ${role.title}, doing in-service training on a real case` : `training for the office of ${role.title}`}.\nConstitution:\n${constitutionText(role.id)}\n\nOffice charter: ${role.charter}\n\nLessons from your earlier attempts:\n${lessons}`;
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
  if (chance(offlineChance(a, item, session))) return { idx: item.correct, reason: '', engine: 'offline' };
  return { idx: pick(item.options.map((_, i) => i).filter(i => i !== item.correct)), reason: '', engine: 'offline' };
}

function start(ctx: Ctx, roleId: string, a: Citizen) {
  const role = ROLES[roleId];
  const exam = buildExam(ctx, role, a);
  const session = { sid: `exam:${roleId}:${a.id}:${Date.now()}`, roleId, agentId: a.id, attempt: attemptsFor(a, roleId), step: 0, exam, pass: passMarkFor(roleId, exam.length), tier: examPlan(roleId).tier, answers: [], startedAt: Date.now() };
  const A = ctx.S.academy; (A.rooms ||= []).push(session); A.current = A.rooms[0];
  A.sessions++;
  const again = session.attempt > 1 ? ` Attempt ${session.attempt}, carrying ${(a.lessons[roleId] || []).length} written lessons.` : '';
  const top = topFieldsText(a, 3); const g = giftedText(ctx.S, a);
  ctx.say('academy', a.id, `Enrolling for ${role.title}: ${exam.length} questions, ${session.pass} to pass. Reading the constitution (${CONSTITUTION.length} articles) and the office charter.${again}${top ? ` Strongest fields: ${top}.` : ''}${g ? ` Gifted in ${g}.` : ''}`, { kind: 'enroll', roleId });
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
  session.answers.push({ q: item.q, kind: item.kind || kindOf(item), chosen, right: item.options[item.correct], ok, reason, lesson: item.lesson });
  session.step++;
  // generated rule questions are counted apart, so a rise in failures can be traced to them (and tuned)
  if (item.from === 'rule question') { const r = (ctx.S.academy.rules ||= { asked: 0, right: 0 }); r.asked++; if (ok) r.right++; }
  const k = (STATS(ctx.S).byKind[item.kind || kindOf(item)] ||= { asked: 0, right: 0 }); k.asked++; if (ok) k.right++;
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
  // the session's own pass mark (the tier's, set when it began); a 5-question session begun before the tiers
  // keeps the old mark of 4
  const mark = session.pass ?? 4;
  const passed = score >= mark && (role.appointed || role.elected || vacancies(S, role.id) > 0);
  if (a.training.length >= 20) a.training.splice(0, a.training.length - 19);
  a.training.push({ roleId: role.id, attempt: session.attempt, score, total, pass: mark, passed, ts: Date.now(), answers: session.answers });
  const st = (STATS(S).byRole[role.id] ||= { sessions: 0, passed: 0, first: 0, firstPassed: 0 });
  st.sessions++; if (passed) st.passed++; if (session.attempt === 1) { st.first++; if (passed) st.firstPassed++; }
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
    const wait = retryHours(session.attempt);
    (S.academy.cooldown[a.id] ||= {})[role.id] = Date.now() + wait * ctx.hourMs(); // a timestamp, not a tick count
    const note = missed.length ? ` Lessons written down: ${missed.join(' ')}` : '';
    ctx.say('academy', a.id, `Failed ${role.title}: ${score}/${total} (needs ${mark}). May sit it again in ${wait} hours.${note}`, { kind: 'fail', roleId: role.id });
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
