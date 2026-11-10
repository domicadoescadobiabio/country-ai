// In-service training: officials never stop training.
// - Drill every DRILL_EVERY days: 1 question from the office's bank + 2 case studies built from
//   what really happened in the republic (src/cases.mjs). Skill moves with every drill; correct
//   answers slowly raise the trait they test; wrong answers become written lessons.
// - Performance review every REVIEW_EVERY days: activity, clean constitutional checks, and an
//   office-specific measure, graded A-D and published.
// - Accountability: two failed drills in a row, or grade D with low skill, means recall:
//   the seat goes vacant and the Academy trains a replacement.
import { ROLES } from './roles.mjs';
import { answer, buildItem, vacate, LETTERS } from './academy.mjs';
import { caseStudies } from './cases.mjs';
import { pick, round, clamp } from './util.mjs';

const DRILL_EVERY = 2;
const REVIEW_EVERY = 4;
const DRILL_PASS = 2; // of 3

const T = S => (S.training ||= { current: null, drills: 0, passed: 0, recalls: 0, reviews: 0 });
const officials = S => S.citizens.filter(a => a.office && a.status === 'free');

function start(ctx, a) {
  const role = ROLES[a.office];
  const bank = role.exam.filter(q => !(a.drills || []).slice(-2).some(d => d.items?.some(x => x.q === q.q)));
  const items = [buildItem({ ...pick(bank.length ? bank : role.exam), from: 'office handbook' }), ...caseStudies(ctx, role.id, 2).map(buildItem)];
  T(ctx.S).current = { sid: `drill:${a.id}:${Date.now()}`, agentId: a.id, roleId: role.id, step: 0, items, answers: [] };
  ctx.say('academy', a.id, `In-service drill for ${role.title} ${a.name} (day ${ctx.S.day}). ${items.length} questions, ${items.length - 1} built from real events in the republic. Current skill ${Math.round((a.skill?.[role.id] ?? 0.6) * 100)}.`, { kind: 'drill', roleId: role.id });
}

async function step(ctx, cur) {
  const a = ctx.agent(cur.agentId); const role = ROLES[cur.roleId];
  if (!a || a.status !== 'free' || a.office !== cur.roleId) { T(ctx.S).current = null; return; }
  const item = cur.items[cur.step];
  const skill = a.skill?.[role.id] ?? 0.6;
  const bonus = (skill - 0.5) * 0.3 + Math.min(0.1, (a.drills?.length || 0) * 0.01);
  const res = await answer(ctx, a, role, item, { sid: cur.sid, step: cur.step, attempt: 1, bonus, drill: true });
  if (res.pending) return;
  const { idx, reason, engine } = res;
  const ok = idx === item.correct;
  const chosen = idx >= 0 ? item.options[idx] : '(no answer)';
  cur.answers.push({ q: item.q, from: item.from, chosen, right: item.options[item.correct], ok, reason, tests: item.tests, lesson: item.lesson });
  cur.step++;
  ctx.say('academy', a.id, `Drill ${cur.step}/${cur.items.length}${item.from ? ` (case: ${item.from})` : ''} - ${item.q}\n${idx >= 0 ? `${LETTERS[idx]}) ` : ''}${chosen} ${ok ? '[correct]' : `[wrong, right: ${item.options[item.correct]}]`}${reason ? ` "${reason}"` : ''}`,
    { kind: 'answer', roleId: role.id, ok, engine, drill: true });
}

function finish(ctx, cur) {
  const { S } = ctx; const a = ctx.agent(cur.agentId); const role = ROLES[cur.roleId];
  T(S).current = null;
  if (!a) return;
  const score = cur.answers.filter(x => x.ok).length, total = cur.answers.length;
  const before = a.skill?.[role.id] ?? 0.6;
  const after = round(clamp(before * 0.6 + (score / total) * 0.4, 0, 1), 2);
  (a.skill ||= {})[role.id] = after;
  for (const x of cur.answers) if (x.ok && a.traits[x.tests] != null) a.traits[x.tests] = round(Math.min(0.98, a.traits[x.tests] + 0.01), 2);
  const missed = cur.answers.filter(x => !x.ok).map(x => x.lesson);
  a.lessons[role.id] = [...new Set([...(a.lessons[role.id] || []), ...missed])].slice(-12);
  const passed = score >= DRILL_PASS;
  a.drillFails = passed ? 0 : (a.drillFails || 0) + 1;
  a.lastDrillDay = S.day;
  a.drills = [...(a.drills || []), { day: S.day, roleId: role.id, score, total, passed, skillBefore: before, skill: after, items: cur.answers }].slice(-10);
  T(S).drills++; if (passed) T(S).passed++;
  ctx.say('academy', a.id, `Drill result: ${score}/${total} ${passed ? 'passed' : 'FAILED'}. Skill ${Math.round(before * 100)} -> ${Math.round(after * 100)}.${missed.length ? ` New lessons: ${missed.join(' ')}` : ''}`, { kind: passed ? 'pass' : 'fail', roleId: role.id, drill: true });
  if (a.drillFails >= 2) recall(ctx, a, `failed in-service training twice in a row (skill ${Math.round(after * 100)})`);
}

function recall(ctx, a, why) {
  const role = ROLES[a.office];
  if (role.elected) { // Art. 15: the people decide
    ctx.decide({ agentId: 'state', role: 'state', type: 'recall', title: `Recall vote triggered for ${role.title} ${a.name}`, inputs: [['Reason', why]], options: ['Dismiss by the state', 'Recall vote of the people'], chosen: 'Recall vote of the people', reason: 'Art. 15: an elected official is not dismissed by the state; the voters decide.', checks: [['Elected office goes to the voters', true]], outcome: 'Recall vote opened' });
    import('./elections.mjs').then(m => m.startRecall(ctx, a, why));
    a.drillFails = 0;
    return;
  }
  ctx.decide({
    agentId: 'state', role: 'state', type: 'recall',
    title: `Recall of ${role.title} ${a.name}`,
    inputs: [['Reason', why], ['Skill', String(Math.round((a.skill?.[role.id] ?? 0) * 100))], ['Recent drills', (a.drills || []).slice(-3).map(d => `${d.score}/${d.total}`).join(', ') || 'none']],
    options: ['Keep in office', 'Recall and retrain a replacement'],
    chosen: 'Recall and retrain a replacement',
    reason: 'Art. 2: no agent may hold office without the training for it. Failing it in office counts the same.',
    checks: [['Rule applied the same to every office', true]],
    outcome: `${role.title} seat vacant, Academy will train a replacement`,
  });
  T(ctx.S).recalls++;
  vacate(ctx, a.id, why);
}

// ---------------------------------------------------------------- performance reviews
function failedChecks(S, a, since) {
  return S.decisions.filter(d => d.agentId === a.id && d.day > since && d.checks.some(c => !c[1])).length;
}
const KPI = {
  president: (S, a, w) => ({ label: 'executive orders issued per day', value: Math.min(1, (w.orders || 0) / Math.max(1, w.days)) }),
  council: (S, a, w) => ({ label: 'votes cast on bills', value: Math.min(1, (w.votes || 0) / 3) }),
  police: (S, a, w) => {
    const inc = (S.police?.incidents || []).filter(i => i.solvedBy === a.id || i.status === 'cold');
    const solved = inc.filter(i => i.solvedBy === a.id).length;
    return { label: `cases solved vs cold (${solved}/${inc.length || 0}) + audits`, value: Math.min(1, (inc.length ? solved / inc.length : 0.5) * 0.6 + Math.min(1, (w.audits || 0) / 3) * 0.4) };
  },
  judge: (S, a, w) => { const n = (S.court?.cases || []).filter(c => a.id in (c.votes || {}) && c.openedDay > S.day - w.days).length; return { label: 'court cases decided', value: Math.min(1, n / 2 + 0.4) }; },
  mayor: (S, a, w) => ({ label: 'city budget decisions per day', value: Math.min(1, (w.orders || 0) / Math.max(1, w.days)) }),
  military: (S, a, w) => ({ label: 'gate decisions made', value: Math.min(1, ((w.blocks || 0) + (w.admits || 0) + (w.pass || 0)) / 2 + 0.4) }),
};

function review(ctx, a) {
  const { S } = ctx; const role = ROLES[a.office];
  const snap = a.reviewSnap || { day: a.sworn?.day ?? S.day - REVIEW_EVERY, stats: {} };
  const w = { days: Math.max(1, S.day - snap.day) };
  for (const [k, v] of Object.entries(a.stats || {})) w[k] = v - (snap.stats[k] || 0);
  const kpi = (KPI[role.id] || KPI[role.force] || KPI.council)(S, a, w);
  const fails = failedChecks(S, a, snap.day);
  const skill = a.skill?.[role.id] ?? 0.6;
  const score = round(kpi.value * 0.4 + (fails ? 0 : 0.3) + skill * 0.3, 2);
  const grade = score >= 0.8 ? 'A' : score >= 0.65 ? 'B' : score >= 0.5 ? 'C' : 'D';
  a.reviews = [...(a.reviews || []), { day: S.day, roleId: role.id, grade, score, kpi: `${kpi.label}: ${Math.round(kpi.value * 100)}`, failedChecks: fails, skill }].slice(-10);
  a.reviewSnap = { day: S.day, stats: { ...(a.stats || {}) } };
  T(S).reviews++;
  ctx.say('academy', 'state', `Performance review, ${role.title} ${a.name}: grade ${grade} (${Math.round(score * 100)}). ${kpi.label} ${Math.round(kpi.value * 100)}, failed constitutional checks ${fails}, skill ${Math.round(skill * 100)}.`, { kind: 'review', roleId: role.id });
  if (grade === 'D' && skill < 0.45) recall(ctx, a, `grade D in review with skill ${Math.round(skill * 100)}`);
}

export const institution = {
  id: 'training',
  channels: [],
  fresh: () => ({ training: { current: null, drills: 0, passed: 0, recalls: 0, reviews: 0 } }),
  async tick(ctx) {
    const { S } = ctx; const t = T(S);
    if (S.academy.current) return; // entrance exams first, same classroom
    if (t.current) return t.current.step < t.current.items.length ? step(ctx, t.current) : finish(ctx, t.current);
    const due = officials(S).filter(a => S.day - (a.lastDrillDay ?? a.sworn?.day ?? 0) >= DRILL_EVERY).sort((x, y) => (x.lastDrillDay ?? 0) - (y.lastDrillDay ?? 0))[0];
    if (due) start(ctx, due);
  },
  day(ctx) {
    for (const a of officials(ctx.S)) {
      const last = a.reviewSnap?.day ?? a.sworn?.day ?? 0;
      if (ctx.S.day - last >= REVIEW_EVERY && a.office) review(ctx, a);
    }
  },
  stats: S => ({ drills: T(S).drills }),
  publicState: S => { const t = T(S); return { training: { drills: t.drills, passed: t.passed, recalls: t.recalls, reviews: t.reviews, current: t.current ? { agentId: t.current.agentId, roleId: t.current.roleId, step: t.current.step, total: t.current.items.length, answers: t.current.answers.map(x => ({ ok: x.ok })) } : null } }; },
};
