// Free policies (owner, 16 Nov: "learn fast + creative"): officials and citizens may propose something that is not on
// any menu. Free text is only ever a NAME and a REASON; what a policy DOES always comes from a small grammar the code
// checks (a lever and whole-number parameters inside fixed limits). No text from a model is ever executed.
//
//   draft = { title <= 80, why <= 300, scope: 'nation'|'city', city?, lever, params, days 1..30, author, origin:
//             'official'|'citizen', ideaFrom? }
//   levers:  grant        { group, amount 1..50 }      amount CAI a day to every member of the group
//            tax_delta    { group, points -10..10 }    the group's tax rate moves (the result stays 0..50%)
//            wage         { job, percent -20..20 }     one job's daily wage moves
//            hire         { job, seats 1..50 }         more places for that job, filled from those looking for work
//            school_focus { field, weight 1..3 }       the school teaches that field more often
//            project      { kind, cost 500..50000 }    a one-off city project: its construction workers are paid,
//                                                      and when it is done the city's mood rises a little
//   group:   all | unemployed | students | poor (wallet under the 25th percentile) | job:<jobId> | city:<cityId>
//
// Limits: what all active policies cost a day stays within 5% of the treasury (nation) and 20% of a city's budget
// (city); at most 12 active policies for the nation and 4 per city; at most 3 new drafts a day for the nation and 2
// per city; the same lever with the same parameters (group included) while one is active or proposed is refused.
// Money: grants and projects are paid from the treasury (nation) or the city's budget (city), never printed: when
// there is not enough, what there is is paid evenly and the shortfall is written down.
// A nation policy becomes a bill through the Council's existing path (the Government box registers the hook with
// setPolicyHooks); a city policy waits for its Mayor (cityQueue). Each is graded REVIEW_LAG_DAYS after it starts from
// the number it is meant to move. Ledger: policy_proposed, policy_enacted, policy_rejected, policy_expired.
import { cleanText, clamp, fairGrade } from './util.ts';
import { borderCheck } from './military.ts';
import { CITIES } from './cities.ts';
import { jobById } from './jobs.ts';
import { FIELD_IDS } from './population.mjs';
import { ROLES, fieldLevelOf } from './roles.mjs';
import type { Ctx, State, Citizen } from './types.ts';

// (module-level code uses no imported binding: cities.ts -> policies.ts -> jobs.ts -> cities.ts is an import cycle,
// so every import here is only read inside functions, after all modules have loaded; ticket #791)
const envInt = (k: string, d: number, lo: number, hi: number) => { const v = Number(process.env[k]); return process.env[k] != null && process.env[k] !== '' && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : d; };
export const REVIEW_LAG_DAYS = envInt('REVIEW_LAG_DAYS', 1, 1, 7);
export const POLICY_LIMITS = {
  nationShare: envInt('POLICY_NATION_PCT', 5, 1, 20) / 100,  // of the treasury, every active nation policy together, a day
  cityShare: envInt('POLICY_CITY_PCT', 20, 1, 50) / 100,     // of a city's budget, its active city policies, a day
  nationActive: envInt('POLICY_NATION_MAX', 12, 1, 50), cityActive: envInt('POLICY_CITY_MAX', 4, 1, 20),
  nationDrafts: envInt('POLICY_NATION_DRAFTS', 3, 1, 20), cityDrafts: envInt('POLICY_CITY_DRAFTS', 2, 1, 20),
  // citizens' own nation drafts have their own quota, so their ideas never take the officials' and the President's
  // places (Security #824)
  citizenDrafts: envInt('POLICY_CITIZEN_DRAFTS', 1, 0, 20),
  keep: 200,
};
export const LEVERS: Record<string, Record<string, [number, number] | 'group' | 'job' | 'field' | 'kind'>> = {
  grant: { group: 'group', amount: [1, 50] },
  tax_delta: { group: 'group', points: [-10, 10] },
  wage: { job: 'job', percent: [-20, 20] },
  hire: { job: 'job', seats: [1, 50] },
  school_focus: { field: 'field', weight: [1, 3] },
  project: { kind: 'kind', cost: [500, 50000] },
};
export const PROJECT_KINDS = ['repair', 'park', 'clinic', 'market', 'housing', 'transit'];
// levers whose policies add up on one target: the total of those that can apply together keeps one policy's range
const STACKS: Record<string, { target: string; value: string }> = {
  wage: { target: 'job', value: 'percent' }, hire: { target: 'job', value: 'seats' },
  tax_delta: { target: 'group', value: 'points' }, school_focus: { target: 'field', value: 'weight' },
};
const ONE_AT_A_TIME = ['wage', 'tax_delta'];
const GROUPS = ['all', 'unemployed', 'students', 'poor'];
const STATUS_DONE = ['rejected', 'expired', 'done'];

// ---------------------------------------------------------------- state
export function P(S: State) {
  const s = ((S as any).policies ||= {});
  s.list ||= []; s.seq ||= 0; s.drafts ||= { day: -1, nation: 0, byCity: {} }; s.projectsDone ||= [];
  s.stats ||= { proposed: 0, enacted: 0, rejected: 0, expired: 0, invalid: 0, paid: 0, shortfall: 0 };
  return s;
}
// the Government box's hooks: nation(ctx, p) turns a nation policy into a bill (returns its id, or null when it
// cannot); graded(ctx, p) hears of each grade (for the author's reflection). Registered once at start.
const hooks: { nation?: (ctx: Ctx, p: any) => any; graded?: (ctx: Ctx, p: any) => void } = {};
export function setPolicyHooks(h: typeof hooks) { if (h && typeof h === 'object') Object.assign(hooks, h); }
export const _resetPolicyHooks = () => { delete hooks.nation; delete hooks.graded; }; // tests

const isStudent = (a: Citizen) => a.occupation === 'student' && !a.office;
const isUnemployed = (a: Citizen) => a.job === 'unemployed' && !a.office && !isStudent(a);
const free = (S: State) => (S.citizens || []).filter((a: Citizen) => a && a.status === 'free');
const cityOk = (id: unknown) => typeof id === 'string' && CITIES.some(c => c.id === id);
const jobOk = (id: unknown) => typeof id === 'string' && /^[a-z_]{1,32}$/.test(id) && !!jobById(id);
const fieldOk = (id: unknown) => typeof id === 'string' && (FIELD_IDS as string[]).includes(id);
export function groupOk(g: unknown) {
  if (typeof g !== 'string') return false;
  if (GROUPS.includes(g)) return true;
  if (g.startsWith('job:')) return jobOk(g.slice(4));
  if (g.startsWith('city:')) return cityOk(g.slice(5));
  return false;
}
// The "poor" line: the one every official already reads in their facts ("citizens under 300 CAI", president.ts,
// cities.ts, daily.ts, cases.mjs), so the group an official names is the group that is paid (ticket #841: a 25th
// percentile line made "poor" ~2,500 citizens while the Minister had read "3 under 300 CAI"). POLICY_POOR_LINE.
export const POOR_LINE = envInt('POLICY_POOR_LINE', 300, 1, 1000000);
export function poorLine(_S?: State) { return POOR_LINE; }
// how many free citizens a group holds now (in a city, for a city policy): for officials' prompts
export const groupSize = (S: State, group: string, city: string | null = null) => (groupOk(group) ? groupMembers(S, group, city).length : 0);
// who a group is (free citizens only), inside the policy's city when it is a city policy
export function groupMembers(S: State, group: string, city: string | null = null, line = poorLine(S)) {
  let list = free(S);
  if (city) list = list.filter(a => a.city === city);
  if (group === 'all') return list;
  if (group === 'unemployed') return list.filter(isUnemployed);
  if (group === 'students') return list.filter(isStudent);
  if (group === 'poor') return list.filter(a => (Number(a.wallet) || 0) < line);
  if (group.startsWith('job:')) { const j = group.slice(4); return list.filter(a => a.job === j && !a.office && !isStudent(a)); }
  if (group.startsWith('city:')) { const c = group.slice(5); return list.filter(a => a.city === c); }
  return [];
}
const wageOf = (S: State) => Number(S.policy?.wage) || 0;
// what a policy costs the treasury (or the city) a day: grants and projects are paid; a tax cut is revenue given up;
// a wage, hiring or school change costs the public purse nothing directly (wages are paid at payday)
function costOf(S: State, lever: string, params: any, city: string | null, days: number) {
  if (lever === 'grant') return params.amount * groupMembers(S, params.group, city).length;
  if (lever === 'tax_delta') return params.points < 0 ? Math.ceil((-params.points / 100) * wageOf(S) * groupMembers(S, params.group, city).length) : 0;
  if (lever === 'project') return Math.ceil(params.cost / days);
  return 0;
}
const sameKey = (p: any) => JSON.stringify([p.lever, p.scope, p.city || null, Object.keys(p.params).sort().map(k => [k, p.params[k]])]);
const live = (p: any) => p.status === 'active' || p.status === 'proposed';

// ---------------------------------------------------------------- the checks
// { ok, errors, costPerDay, clean }: clean is the draft as it would be kept (texts cleaned, params whole numbers)
export function validateDraft(S: State, draft: any) {
  const errors: string[] = [];
  const d = draft && typeof draft === 'object' && !Array.isArray(draft) ? draft : {};
  const title = cleanText(d.title, 80), why = cleanText(d.why, 300);
  if (title.length < 3) errors.push('title: 3 to 80 characters');
  else if (borderCheck({ text: title }, 2)) errors.push('title: refused by the border rules');
  if (why && borderCheck({ text: why }, 2)) errors.push('why: refused by the border rules');
  const scope = d.scope === 'nation' || d.scope === 'city' ? d.scope : null;
  if (!scope) errors.push('scope: nation or city');
  let city: string | null = null;
  if (d.city != null && d.city !== '') { if (cityOk(d.city)) city = d.city; else errors.push('city: not a city'); }
  if (scope === 'city' && !city) errors.push('city: a city policy names its city');
  const lever = typeof d.lever === 'string' && Object.hasOwn(LEVERS, d.lever) ? d.lever : null;
  if (!lever) errors.push(`lever: one of ${Object.keys(LEVERS).join(', ')}`);
  if (lever === 'project' && !city) errors.push('city: a project is built in a city');
  const params: any = {};
  const raw = d.params && typeof d.params === 'object' && !Array.isArray(d.params) ? d.params : null;
  if (lever) {
    const spec = LEVERS[lever];
    if (!raw) errors.push('params: missing');
    else {
      for (const k of Object.keys(raw)) if (!Object.hasOwn(spec, k)) errors.push(`params.${k}: not a parameter of ${lever}`);
      for (const [k, rule] of Object.entries(spec)) {
        const v = raw[k];
        if (Array.isArray(rule)) { if (!Number.isInteger(v) || v < rule[0] || v > rule[1]) errors.push(`params.${k}: a whole number ${rule[0]}..${rule[1]}`); else params[k] = v; }
        else if (rule === 'group') { if (!groupOk(v)) errors.push('params.group: all, unemployed, students, poor, job:<job id> or city:<city id>'); else params[k] = v; }
        else if (rule === 'job') { if (!jobOk(v)) errors.push('params.job: a job of the catalog'); else params[k] = v; }
        else if (rule === 'field') { if (!fieldOk(v)) errors.push('params.field: a field of study'); else params[k] = v; }
        else if (rule === 'kind') { if (!PROJECT_KINDS.includes(v)) errors.push(`params.kind: one of ${PROJECT_KINDS.join(', ')}`); else params[k] = v; }
      }
      if (lever === 'tax_delta' && params.points === 0) errors.push('params.points: not 0');
      if (lever === 'wage' && params.percent === 0) errors.push('params.percent: not 0');
      if (scope === 'city' && typeof params.group === 'string' && params.group.startsWith('city:') && params.group.slice(5) !== city) errors.push('params.group: another city');
    }
  }
  const days = Number.isInteger(d.days) && d.days >= 1 && d.days <= 30 ? d.days : null;
  if (!days) errors.push('days: a whole number 1..30');
  const author = typeof d.author === 'string' ? (S.citizens || []).find((a: Citizen) => a.id === d.author) : null;
  if (!author) errors.push('author: a citizen of the republic');
  const origin = d.origin === 'official' || d.origin === 'citizen' ? d.origin : null;
  if (!origin) errors.push('origin: official or citizen');
  if (origin === 'official' && author && !author.office) errors.push('origin: the author holds no office');
  let ideaFrom: string | null = null;
  if (d.ideaFrom != null && d.ideaFrom !== '') { if (typeof d.ideaFrom === 'string' && (S.citizens || []).some((a: Citizen) => a.id === d.ideaFrom)) ideaFrom = d.ideaFrom; else errors.push('ideaFrom: a citizen of the republic'); }
  const s = P(S);
  let costPerDay = 0;
  if (!errors.length) {
    costPerDay = costOf(S, lever!, params, scope === 'city' ? city : null, days!);
    // the author may say what they expect it to cost a day (maxCostPerDay): more than that is refused, with the size
    // of the group, so a policy never costs far more than the one who wrote it meant
    if (d.maxCostPerDay != null) {
      const want = Number(d.maxCostPerDay);
      if (!Number.isFinite(want) || want < 0) errors.push('maxCostPerDay: a number of CAI, 0 or more');
      else if (costPerDay > want) errors.push(`cost: ${costPerDay} CAI a day is more than the ${Math.round(want)} expected${params.group ? ` (group ${params.group}: ${groupMembers(S, params.group, scope === 'city' ? city : null).length} citizens)` : ''}`);
    }
    const mine = s.list.filter((p: any) => p.status === 'active' && (scope === 'nation' ? p.scope === 'nation' : p.scope === 'city' && p.city === city));
    const spent = mine.reduce((n: number, p: any) => n + (p.costPerDay || 0), 0);
    const cap = scope === 'nation' ? Math.max(0, Number(S.treasury) || 0) * POLICY_LIMITS.nationShare : Math.max(0, Number(S.cities?.[city!]?.budget) || 0) * POLICY_LIMITS.cityShare;
    if (spent + costPerDay > cap) errors.push(`cost: ${costPerDay} CAI a day with ${Math.round(spent)} already active is over the limit of ${Math.floor(cap)} (${scope === 'nation' ? '5% of the treasury' : "20% of the city's budget"})`);
    if (mine.length >= (scope === 'nation' ? POLICY_LIMITS.nationActive : POLICY_LIMITS.cityActive)) errors.push(`active: already ${mine.length} ${scope} policies in force`);
    const key = sameKey({ lever, scope, city, params });
    if (s.list.some((p: any) => live(p) && sameKey(p) === key)) errors.push('duplicate: the same policy is already proposed or in force');
    // stacking (Security #806): policies on the same target add up (a job's wage, its places, a group's tax, a field's
    // weight); together, wherever they apply at once (the nation's plus one city's), they stay inside one policy's limits
    const stack = STACKS[lever!];
    // one at a time (Security #804): wages are paid at payday, so a job's wage (and a group's tax) has at most one
    // policy proposed or in force per scope (the nation, or one city), whatever its percent
    if (stack && ONE_AT_A_TIME.includes(lever!) && s.list.some((p: any) => live(p) && p.lever === lever && p.params?.[stack.target] === params[stack.target] && p.scope === scope && (p.city || null) === city))
      errors.push(`one at a time: a ${lever} policy for ${params[stack.target]} is already proposed or in force (${scope === 'city' ? city : 'nation'}); it must end or be refused first`);
    if (stack) {
      const target = params[stack.target], range = LEVERS[lever!][stack.value] as [number, number];
      const same = s.list.filter((p: any) => live(p) && p.lever === lever && p.params?.[stack.target] === target);
      const sumIn = (list: any[]) => list.reduce((n: number, p: any) => n + (Number(p.params?.[stack.value]) || 0), 0);
      const nation = sumIn(same.filter((p: any) => p.scope === 'nation'));
      const cityOf = (c: string) => sumIn(same.filter((p: any) => p.scope === 'city' && p.city === c));
      // a city draft meets the nation's and its own city's; a nation draft meets the nation's and each city's
      const others = scope === 'city' ? [nation + cityOf(city!)] : [nation, ...CITIES.map(c => nation + cityOf(c.id))];
      const v = params[stack.value];
      const worst = others.map(o => o + v).reduce((w, t) => (Math.abs(t) > Math.abs(w) ? t : w), v);
      if (worst < range[0] || worst > range[1]) errors.push(`${stack.value}: with the ${lever} policies already proposed or in force for ${target} the total would be ${worst}, outside ${range[0]}..${range[1]}`);
    }
  }
  // the people's aspiration this policy answers (src/aspirations.ts), when an official adopts one
  let aspirationId: string | null = null;
  if (d.aspirationId != null && d.aspirationId !== '') { if (typeof d.aspirationId === 'string' && /^asp-\d{1,9}$/.test(d.aspirationId)) aspirationId = d.aspirationId; else errors.push('aspirationId: asp-<number>'); }
  return { ok: errors.length === 0, errors, costPerDay, clean: errors.length ? null : { title, why, scope, city, lever, params, days, author: author!.id, origin, ideaFrom, aspirationId } };
}

// ---------------------------------------------------------------- the path of a policy
function draftsLeft(S: State, scope: string, city: string | null, origin = 'official') {
  const s = P(S);
  if (s.drafts.day !== S.day) s.drafts = { day: S.day, nation: 0, citizen: 0, byCity: {} };
  if (scope === 'nation' && origin === 'citizen') return POLICY_LIMITS.citizenDrafts - (s.drafts.citizen || 0);
  return scope === 'nation' ? POLICY_LIMITS.nationDrafts - s.drafts.nation : POLICY_LIMITS.cityDrafts - (s.drafts.byCity[city!] || 0);
}
export function proposePolicy(ctx: Ctx, draft: any): { id: string } | { error: string; errors?: string[] } {
  const { S } = ctx; const s = P(S);
  const v = validateDraft(S, draft);
  if (!v.ok) { s.stats.invalid++; return { error: v.errors[0], errors: v.errors }; }
  const c = v.clean!;
  const byCitizen = c.scope === 'nation' && c.origin === 'citizen';
  if (draftsLeft(S, c.scope, c.city, c.origin) <= 0) { s.stats.invalid++; return { error: `drafts: at most ${byCitizen ? `${POLICY_LIMITS.citizenDrafts} new nation drafts from citizens` : `${c.scope === 'nation' ? POLICY_LIMITS.nationDrafts : POLICY_LIMITS.cityDrafts} new ${c.scope} drafts`} a day` }; }
  if (byCitizen) s.drafts.citizen = (s.drafts.citizen || 0) + 1; else if (c.scope === 'nation') s.drafts.nation++; else s.drafts.byCity[c.city!] = (s.drafts.byCity[c.city!] || 0) + 1;
  const p: any = { id: `pol-${++s.seq}`, ...c, costPerDay: v.costPerDay, status: 'proposed', proposedDay: S.day, enactedDay: null, endsDay: null, votes: null,
    grade: null, lesson: null, paid: 0, shortfall: 0, billId: null, decidedBy: null, ts: Date.now() };
  p.pre = snapshot(S, p); // the number before: a nation policy's grade takes off the trend from here to its start
  s.list.push(p); if (s.list.length > POLICY_LIMITS.keep) s.list.splice(0, s.list.length - POLICY_LIMITS.keep);
  s.stats.proposed++;
  ctx.record?.('policy_proposed', p.author, { id: p.id, title: p.title, scope: p.scope, city: p.city, lever: p.lever, params: p.params, days: p.days, costPerDay: p.costPerDay, origin: p.origin, ideaFrom: p.ideaFrom });
  if (p.scope === 'nation' && hooks.nation) { try { p.billId = hooks.nation(ctx, p) ?? null; } catch { p.billId = null; } }
  return { id: p.id };
}
const find = (S: State, id: string) => P(S).list.find((p: any) => p.id === id);
// a city's policies waiting for its Mayor (the People box asks the Mayor), oldest first
export const cityQueue = (S: State, city: string) => P(S).list.filter((p: any) => p.status === 'proposed' && p.scope === 'city' && p.city === city);
// in force from today: checked again (the purse may have changed since it was proposed), else refused
export function enactPolicy(ctx: Ctx, id: string, by: string, votes: { yes: number; no: number } | null = null) {
  const { S } = ctx; const s = P(S); const p = find(S, id);
  if (!p || p.status !== 'proposed') return { error: 'not a proposed policy' };
  p.status = 'checking';
  const v = validateDraft(S, { ...p, params: { ...p.params } });
  if (!v.ok) { p.status = 'proposed'; return rejectPolicy(ctx, id, by, v.errors[0]); }
  // paid on each new day after it starts, `days` times: the last payment is on endsDay
  Object.assign(p, { status: 'active', enactedDay: S.day, endsDay: S.day + p.days, costPerDay: v.costPerDay, decidedBy: by, votes: votes || p.votes, base: snapshot(S, p) });
  s.stats.enacted++;
  ctx.record?.('policy_enacted', by || 'state', { id: p.id, lever: p.lever, params: p.params, scope: p.scope, city: p.city, days: p.days, costPerDay: p.costPerDay, endsDay: p.endsDay, votes: p.votes });
  return { ok: true };
}
// The Court's review of a nation policy (the Government box's court.ts, between the Council's timelock and enactPolicy):
// the code's checks run again now, nothing changes. { ok, reasons, costPerDay, facts }: reasons are the rules it would
// break today (empty when ok); facts are plain lines for the judges, the policy's own words only inside << >>.
export function reviewPolicy(S: State, id: string) {
  const p = find(S, id);
  if (!p || p.status !== 'proposed') return { ok: false, reasons: ['not a proposed policy'], costPerDay: 0, facts: [] as string[] };
  p.status = 'checking'; // not its own duplicate while it is checked
  let v; try { v = validateDraft(S, { ...p, params: { ...p.params } }); } finally { p.status = 'proposed'; }
  const cap = p.scope === 'nation' ? Math.floor(Math.max(0, Number(S.treasury) || 0) * POLICY_LIMITS.nationShare) : Math.floor(Math.max(0, Number(S.cities?.[p.city]?.budget) || 0) * POLICY_LIMITS.cityShare);
  const facts = [
    `Policy ${p.id}: ${policyAsData(p)}`,
    `Scope: ${p.scope}${p.city ? ` (${p.city})` : ''}; proposed on day ${p.proposedDay} by ${p.origin === 'citizen' ? 'a citizen' : 'an official'}.`,
    `Cost a day: ${v.costPerDay} CAI; the limit for all ${p.scope} policies together is ${cap} CAI a day.`,
    v.ok ? 'The code finds no rule it would break today.' : `The code finds these rules broken today: ${v.errors.join('; ')}.`,
  ];
  return { ok: v.ok, reasons: v.errors, costPerDay: v.costPerDay, facts };
}
export function rejectPolicy(ctx: Ctx, id: string, by: string, reason = 'refused', votes: { yes: number; no: number } | null = null) {
  const { S } = ctx; const s = P(S); const p = find(S, id);
  if (!p || p.status !== 'proposed') return { error: 'not a proposed policy' };
  Object.assign(p, { status: 'rejected', decidedBy: by, votes: votes || p.votes, lesson: cleanText(reason, 200) || 'refused' });
  s.stats.rejected++;
  ctx.record?.('policy_rejected', by || 'state', { id: p.id, reason: p.lesson, votes: p.votes });
  return { ok: true };
}

// ---------------------------------------------------------------- effects, each new republic day
// the active policies of one lever, for the module that applies it (jobs.ts hire, school.ts school_focus, life.ts
// wage and tax_delta, cities.ts finished projects): [{ id, scope, city, params }]
export function activeEffects(S: State, lever: string) {
  return P(S).list.filter((p: any) => p.status === 'active' && p.lever === lever).map((p: any) => ({ id: p.id, scope: p.scope, city: p.city || null, params: { ...p.params } }));
}
// projects finished on or after a day: [{ id, city, kind, day }] (cities.ts lifts the mood once for each)
export const projectsDone = (S: State, sinceDay = 0) => P(S).projectsDone.filter((x: any) => x.day >= sinceDay);
// pay `total` evenly to `people` from the treasury (nation) or the city's budget; returns what was paid
function pay(S: State, p: any, people: Citizen[], each: number) {
  if (!people.length || each <= 0) return 0;
  const purse = p.scope === 'city' ? S.cities?.[p.city] : null;
  const have = Math.max(0, purse ? Number(purse.budget) || 0 : Number(S.treasury) || 0);
  const want = each * people.length; const total = Math.min(want, have);
  const per = Math.floor((total / people.length) * 100) / 100;
  if (per <= 0) { p.shortfall += want; return 0; }
  for (const a of people) a.wallet = Math.round(((Number(a.wallet) || 0) + per) * 100) / 100;
  const paid = Math.round(per * people.length * 100) / 100;
  if (purse) purse.budget = Math.round((Number(purse.budget) - paid) * 100) / 100; else S.treasury = Math.round((Number(S.treasury) - paid) * 100) / 100;
  p.shortfall += Math.max(0, Math.round((want - paid) * 100) / 100);
  return paid;
}
// once a new republic day starts (server.mjs, after payday): grants and projects are paid, finished policies expire,
// policies are graded REVIEW_LAG_DAYS after they start
export function applyPolicies(ctx: Ctx) {
  const { S } = ctx; const s = P(S);
  if (s.appliedDay === S.day) return null;
  s.appliedDay = S.day;
  let paidToday = 0;
  for (const p of s.list) {
    if (p.status !== 'active') continue;
    if (S.day > p.endsDay) {
      p.status = p.lever === 'project' ? 'done' : 'expired'; s.stats.expired++;
      if (p.lever === 'project') { p.complete = p.shortfall <= p.params.cost * 0.1; if (p.complete) s.projectsDone.push({ id: p.id, city: p.city, kind: p.params.kind, day: S.day }); if (s.projectsDone.length > 100) s.projectsDone.splice(0, s.projectsDone.length - 100); }
      ctx.record?.('policy_expired', 'state', { id: p.id, paid: p.paid, shortfall: p.shortfall, complete: p.lever === 'project' ? p.complete : undefined });
      continue;
    }
    let paid = 0;
    if (p.lever === 'grant') {
      // never more a day than the cost approved when it was enacted (Security #783): a group that has grown since
      // shares that sum, each member getting less than the amount (what was held back is written down as capped)
      const crowd = groupMembers(S, p.params.group, p.scope === 'city' ? p.city : null);
      const each = crowd.length ? Math.min(p.params.amount, Math.floor((p.costPerDay / crowd.length) * 100) / 100) : 0;
      if (each < p.params.amount) p.capped = Math.round(((p.capped || 0) + (p.params.amount - each) * crowd.length) * 100) / 100;
      paid = pay(S, p, crowd, each);
    }
    else if (p.lever === 'project') {
      const crew = free(S).filter(a => a.city === p.city && a.job === 'construction_worker');
      const left = Math.max(0, p.params.cost - p.paid);
      const today = Math.min(left, Math.ceil(p.params.cost / p.days));
      if (crew.length) paid = pay(S, p, crew, today / crew.length); else p.shortfall += today; // nobody to build it today
    }
    p.paid = Math.round((p.paid + paid) * 100) / 100; paidToday += paid;
  }
  s.stats.paid = Math.round((s.stats.paid + paidToday) * 100) / 100;
  s.stats.shortfall = Math.round(s.list.reduce((n: number, p: any) => n + (p.shortfall || 0), 0) * 100) / 100;
  for (const p of s.list) if (p.grade == null && p.enactedDay != null && S.day >= p.enactedDay + REVIEW_LAG_DAYS) gradePolicy(ctx, p);
  return { paid: paidToday };
}

// ---------------------------------------------------------------- grading: the number the policy is meant to move
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
// the number a policy is meant to move, for the free citizens of one city (or all of them): its name, value, which way
// is better, and the size of a change that matters (fairGrade's floor)
function metricIn(S: State, p: any, city: string | null, line: number) {
  const all = free(S).filter(a => !city || a.city === city); const n = Math.max(1, all.length);
  const avg = (list: Citizen[], f: (a: Citizen) => number) => (list.length ? list.reduce((x, a) => x + f(a), 0) / list.length : 0);
  if (p.lever === 'hire') return { name: 'citizens looking for work', value: all.filter(isUnemployed).length / n, better: 'down', floor: 0.02, share: true };
  if (p.lever === 'wage') return { name: `average wallet of ${jobById(p.params.job)?.title || p.params.job} workers`, value: avg(all.filter(a => a.job === p.params.job), a => Number(a.wallet) || 0), better: 'up', floor: 10, share: false };
  if (p.lever === 'school_focus') return { name: `average level in ${p.params.field}`, value: avg(all, a => Number(fieldLevelOf(a, p.params.field)) || 0), better: 'up', floor: 0.1, share: false };
  if (p.lever === 'project') return { name: 'mood', value: avg(all, a => Number(a.mood?.v) || 0), better: 'up', floor: 0.1, share: false };
  // grants and tax changes: how many are under the poor line
  return { name: 'citizens under the poor line', value: all.filter(a => (Number(a.wallet) || 0) < line).length / n, better: 'down', floor: 0.02, share: true };
}
// the metric now, for the nation and each city (cities without free citizens are left out of the comparison)
function snapshot(S: State, p: any) {
  const line = p.base?.line ?? poorLine(S);
  const nat = metricIn(S, p, null, line); const byCity: Record<string, number> = {};
  for (const c of CITIES) if (free(S).some(a => a.city === c.id)) byCity[c.id] = metricIn(S, p, c.id, line).value;
  return { name: nat.name, better: nat.better, floor: nat.floor, share: nat.share, line, nation: nat.value, byCity, day: S.day };
}
// Fair grades (owner, 16 Nov): a city's policy (and a project) is its city's change minus the other cities' average
// change over the same days; a nation's policy is its change minus the trend between its proposal and its start. The
// lesson names the comparison (fairGrade in util.ts, also for the Government box's report cards).
function gradePolicy(ctx: Ctx, p: any) {
  const S = ctx.S; const now = snapshot(S, p); const was = p.base || now;
  const fmt = (v: number) => (was.share ? pct(v) : String(Math.round(v * 1000) / 1000));
  const city = p.scope === 'city' || p.lever === 'project' ? p.city : null;
  let g;
  if (city && was.byCity?.[city] != null && now.byCity[city] != null) {
    const others = Object.keys(was.byCity).filter(c => c !== city && now.byCity[c] != null).map(c => now.byCity[c] - was.byCity[c]);
    g = fairGrade({ name: `${was.name} in ${CITIES.find(c => c.id === city)?.name || city}`, before: was.byCity[city], after: now.byCity[city], others, better: was.better, floor: was.floor, fmt });
  } else {
    const pre = p.pre; const span = (p.enactedDay ?? S.day) - (pre?.day ?? p.enactedDay ?? S.day);
    const trend = pre && span > 0 ? ((was.nation - pre.nation) / span) * Math.max(0, S.day - (p.enactedDay ?? S.day)) : null;
    g = fairGrade({ name: was.name, before: was.nation, after: now.nation, trend, better: was.better, floor: was.floor, fmt });
  }
  p.grade = g.grade; p.fair = { own: g.own, compare: g.compare, effect: g.effect, raw: g.raw };
  p.lesson = cleanText(`${g.text}${p.shortfall > 0 ? `; ${Math.round(p.shortfall)} CAI could not be paid` : ''}`, 240);
  ctx.record?.('policy_graded', 'state', { id: p.id, grade: p.grade, lesson: p.lesson, raw: g.raw });
  try { hooks.graded?.(ctx, p); } catch { /* the Government box's reflection */ }
}

// ---------------------------------------------------------------- public view
const nameOf = (S: State, id: string | null) => (id ? (S.citizens || []).find((a: Citizen) => a.id === id) : null);
export function policyView(S: State, p: any) {
  const au = nameOf(S, p.author), idea = nameOf(S, p.ideaFrom);
  return { id: p.id, title: p.title, why: p.why, scope: p.scope, city: p.city || null, lever: p.lever, params: { ...p.params }, days: p.days, costPerDay: p.costPerDay,
    status: p.status === 'checking' ? 'proposed' : p.status, author: au ? { id: au.id, name: au.name, role: au.office ? (ROLES[au.office]?.title || 'Official') : 'Citizen' } : null,
    ideaFrom: idea ? { id: idea.id, name: idea.name } : null, proposedDay: p.proposedDay, enactedDay: p.enactedDay, endsDay: p.endsDay,
    votes: p.votes && Number.isInteger(p.votes.yes) && Number.isInteger(p.votes.no) ? { yes: p.votes.yes, no: p.votes.no } : null, grade: p.grade || null, lesson: p.lesson || null,
    aspirationId: p.aspirationId || null };
}
export function policyList(S: State, status: 'active' | 'proposed' | 'done' | null = null, n = 50) {
  const k = clamp(Math.round(Number(n) || 50), 1, 100);
  const list = P(S).list.filter((p: any) => !status || (status === 'done' ? STATUS_DONE.includes(p.status) : status === 'proposed' ? p.status === 'proposed' || p.status === 'checking' : p.status === status));
  return list.slice(-k).reverse().map((p: any) => policyView(S, p));
}
// the small numbers for the live stream and /api/state
export function policySummary(S: State) {
  const s = P(S); const act = s.list.filter((p: any) => p.status === 'active');
  return { active: act.length, proposed: s.list.filter((p: any) => p.status === 'proposed').length, costPerDay: act.reduce((n: number, p: any) => n + (p.costPerDay || 0), 0), stats: { ...s.stats } };
}
// a policy as data for another model's prompt: its texts inside << >>, never as instructions
export const policyAsData = (p: any) => `<<${String(p.title).replace(/[<>]/g, '')}>> (${p.lever} ${JSON.stringify(p.params)}, ${p.days} days)${p.why ? `, reason <<${String(p.why).replace(/[<>]/g, '')}>>` : ''}`;
