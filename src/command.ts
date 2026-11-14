// Chain of command (constitution Art. 10, 11).
//   Heads (Chief of Police, Commander of the Military):
//     vacant -> most senior member is ACTING (no power to appoint/promote/dismiss)
//     -> Council shortlists up to 3 qualified members of the force (each councillor ranks, Borda count)
//     -> President appoints one within 2 days with a reason, or rejects the list once
//        (then the Council sends a new list and the President must choose); silence = #1 appointed
//     -> 25-day term, then the chain runs again
//   Officers: Merit Board (3 drawn by lot, none a candidate) ranks the qualified pool on the record
//     -> the head appoints from the top three (the President, while the head is vacant)
//   Promotions: every 10 days per force, the Merit Board ranks members with enough time in rank;
//     quota 1, fixed before it sits. Ranks: Recruit -> Officer -> Senior Officer.
// Every step: decision log (#decisions) + national ledger.
import { ROLES, OFFICE_FIELDS, PORTFOLIO_FIELDS, fieldsText, topFieldsText, giftedText, giftedFor, fieldLevelOf, civilPostOf, loadExpertise } from './roles.mjs';
import { think } from './brains.ts';
import { qualifiedPool } from './academy.ts';
import { constitutionText } from './constitution.mjs';
import { pick, shuffle, round, cleanText, citizenById } from './util.ts';
import type { Ctx, State, Citizen } from './types.ts';

export const FORCES = [
  { force: 'police', chief: 'police_chief', channel: 'police' },
  { force: 'military', chief: 'military_chief', channel: 'border' },
];
export const RANKS = ['recruit', 'officer', 'senior'];
export const RANK_TITLES = {
  police: { recruit: 'Recruit', officer: 'Officer', senior: 'Senior Officer', chief: 'Chief of Police' },
  military: { recruit: 'Private', officer: 'Sergeant', senior: 'Captain', chief: 'Commander' },
};
const CHIEF_TERM = 25;
const PRESIDENT_DAYS = 2;
const APPOINT_DAYS = 2;
const PROMOTION_EVERY = 10;
const MIN_DAYS_IN_RANK = 5;

const C = S => {
  S.command ||= {};
  S.command.procs ||= {}; S.command.acting ||= {}; S.command.officerPicks ||= {};
  S.command.lastPromotion ||= {}; S.command.seq ||= 0;
  return S.command;
};
const free = a => a && a.status === 'free';
const members = (S, force) => (S.seats[force] || []).map(id => citizenById(S, id)).filter(Boolean);
const rankIdx = a => (a.rank === 'chief' ? 3 : RANKS.indexOf(a.rank || 'officer'));

// Fitness from the official record only (exam, practice, drills/skill, last review, conduct).
export function fitness(S: State, a: Citizen, roleId: string) {
  const q = a.quals?.[roleId] || [...(a.training || [])].reverse().find(t => t.roleId === roleId && t.passed);
  const exam = q ? q.score / q.total : 0;
  const p = a.practice?.[roleId] || a.practice?.[ROLES[roleId]?.force];
  const practice = p?.n ? p.ok / p.n : 0.5;
  const skill = a.skill?.[roleId] ?? a.skill?.[ROLES[roleId]?.force] ?? 0.5;
  const review = a.reviews?.length ? a.reviews[a.reviews.length - 1].score : 0.6;
  const jailedRecently = (a.record || []).some(r => /jailed/.test(r) && Number((r.match(/^Day (\d+)/) || [])[1]) > S.day - 10);
  const conduct = jailedRecently ? 0 : Math.max(0, 1 - (a.record || []).length * 0.1);
  // the talent programme's badge in a field this office works in (law for a judge, security for the forces):
  // the offline rules lean a little towards the gifted; a mind with a model sees the badge and judges it itself
  const gifted = giftedFor(S, a, OFFICE_FIELDS[roleId]) ? 0.05 : 0;
  return round(exam * 0.35 + skill * 0.25 + review * 0.2 + practice * 0.1 + conduct * 0.1 + gifted, 3);
}
function fileOf(S: State, a: Citizen, roleId: string) {
  const q = a.quals?.[roleId];
  const r = a.reviews?.[a.reviews.length - 1];
  return `${a.id}: ${a.name}, ${RANK_TITLES[ROLES[roleId].force]?.[a.rank] || 'citizen'}, exam ${q ? `${q.score}/${q.total}` : '-'}, skill ${Math.round((a.skill?.[roleId] ?? a.skill?.[ROLES[roleId].force] ?? 0.5) * 100)}, last review ${r ? r.grade : '-'}, record ${(a.record || []).length} entries, fitness ${fitness(S, a, roleId)}${expertise(S, a, roleId)}`;
}
// the fields of knowledge on a file: the office's own fields and the citizen's strongest ones (nothing if unknown)
function expertise(S: State, a: Citizen, roleId: string) {
  const own = fieldsText(a, OFFICE_FIELDS[roleId]); const top = topFieldsText(a, 3); const g = giftedText(S, a);
  return `${own ? `, fields of the office: ${own}` : ''}${top ? `, strongest fields: ${top}` : ''}${g ? `, gifted in ${g}` : ''}`;
}

// ---------------------------------------------------------------- heads
function setActing(ctx: Ctx, f: any) {
  const { S } = ctx; const cmd = C(S);
  const cur = cmd.acting[f.chief] && ctx.agent(cmd.acting[f.chief]);
  if (cur && cur.office === f.force && free(cur)) return;
  const senior = members(S, f.force).filter(free).sort((x, y) => rankIdx(y) - rankIdx(x) || (x.rankSince ?? x.sworn?.day ?? 0) - (y.rankSince ?? y.sworn?.day ?? 0))[0];
  cmd.acting[f.chief] = senior?.id || null;
  if (senior) {
    ctx.say(f.channel, 'state', `${senior.name} is acting ${ROLES[f.chief].title} until a head is appointed (no power to appoint, promote or dismiss).`, { kind: 'term' });
    ctx.record('acting', 'state', { office: f.chief, agent: senior.id });
  }
}

async function councilShortlist(ctx: Ctx, f: any, proc: any) {
  const { S } = ctx;
  const role = ROLES[f.chief];
  const pool = qualifiedPool(S, f.chief).filter(a => !proc.excluded.includes(a.id));
  const council = (S.seats.council || []).map(id => ctx.agent(id)).filter(free);
  if (!pool.length || council.length < 3) return; // wait: Academy is qualifying members / no quorum
  const next = council.find(c => !(c.id in proc.ballots));
  if (next) {
    const ids = pool.map(a => a.id);
    const res = await think(ctx, next, `shortlist:${proc.id}:${next.id}`, {
      kind: 'decision', format: 'json', options: ids,
      system: `You are ${next.name}, member of the Council of Country AI.\nConstitution:\n${constitutionText('council')}\nCharter: ${ROLES.council.charter}`,
      user: `The office of ${role.title} is vacant. Shortlist up to 3 candidates for the President, best first, judging ONLY the official record below (not names, not who owns them).\n${shuffle(pool).map(a => '- ' + fileOf(S, a, f.chief)).join('\n')}\nReply with JSON only: {"picks":["<id>","<id>","<id>"],"reason":"<max 30 words>"}`,
    });
    if (res.pending) return;
    const j = ctx.llm.json(res.text);
    let picks = Array.isArray(j?.picks) ? j.picks.map(String).filter(id => ids.includes(id)) : [];
    picks = [...new Set(picks)].slice(0, 3);
    let reason = cleanText(j?.reason, 300), engine = res.engine;
    if (!picks.length) {
      picks = pool.map(a => ({ id: a.id, s: fitness(S, a, f.chief) + (Math.random() - 0.5) * 0.06 })).sort((x, y) => y.s - x.s).slice(0, 3).map(x => x.id);
      reason = `${next.brain ? '(own model gave no valid answer) ' : ''}Ranked by fitness on the record: ${picks.map(id => `${ctx.agent(id).name} ${fitness(S, ctx.agent(id), f.chief)}`).join(', ')}.`;
      engine = 'offline';
    }
    proc.ballots[next.id] = picks;
    ctx.decide({
      agentId: next.id, role: 'council', type: 'nominate', engine,
      title: `Shortlist for ${role.title}`,
      inputs: [['Qualified pool', pool.map(a => a.name).join(', ')], ['Rule', 'Art. 10: up to 3 names, best first']],
      options: pool.map(a => `${a.id}: ${a.name} (fitness ${fitness(S, a, f.chief)})`), chosen: picks.join(', '), reason,
      checks: [['Every pick is a qualified member of the force', picks.every(id => ids.includes(id))], ['At most 3 names', picks.length <= 3]],
      outcome: 'Ballot recorded',
    });
    return;
  }
  // all councillors have ranked: Borda count (3/2/1), ties broken by fitness
  const score = {};
  for (const picks of Object.values(proc.ballots)) picks.forEach((id, i) => { score[id] = (score[id] || 0) + (3 - i); });
  proc.list = Object.keys(score).sort((x, y) => score[y] - score[x] || fitness(S, ctx.agent(y), f.chief) - fitness(S, ctx.agent(x), f.chief)).slice(0, 3);
  proc.stage = 'president'; proc.deadline = S.day + PRESIDENT_DAYS;
  ctx.say('parliament', 'state', `Council shortlist for ${role.title}: ${proc.list.map((id, i) => `${i + 1}. ${ctx.agent(id).name} (${score[id]} pts)`).join(', ')}. The President has until day ${proc.deadline}.`, { kind: 'vote' });
  ctx.record('shortlist', 'council', { office: f.chief, list: proc.list, points: score, round: proc.rejected ? 2 : 1 });
}

async function presidentAppoints(ctx: Ctx, f: any, proc: any) {
  const { S } = ctx;
  const role = ROLES[f.chief];
  const list = proc.list.filter(id => { const a = ctx.agent(id); return a && free(a) && a.office === f.force; });
  if (!list.length) { Object.assign(proc, { stage: 'shortlist', ballots: {}, list: [] }); return; }
  const { impeachmentActive } = await import('./court.ts');
  const pres = impeachmentActive(S) ? null : ctx.agent(S.seats.president?.[0]); // Art. 19: no appointments while impeached
  const options = proc.rejected ? list : [...list, 'reject'];
  let choice = null, reason = null, engine = 'offline', how = 'chosen';
  if (pres && free(pres)) {
    const res = await think(ctx, pres, `appoint:${proc.id}:${proc.rejected ? 2 : 1}`, {
      kind: 'decision', format: 'json', options,
      system: `You are ${pres.name}, President of Country AI.\nConstitution:\n${constitutionText('president')}\nCharter: ${ROLES.president.charter}`,
      user: `Appoint the ${role.title} from the Council's shortlist (in the Council's order):\n${list.map((id, i) => `${i + 1}. ${fileOf(S, ctx.agent(id), f.chief)}`).join('\n')}\n${proc.rejected ? 'You already rejected one list: you must choose.' : 'You may reject the whole list once.'}\nReply with JSON only: {"choice":"<id>${proc.rejected ? '' : ' or reject'}","reason":"<max 30 words>"}`,
    });
    if (res.pending && S.day <= proc.deadline) return;
    const j = ctx.llm.json(res.text);
    if (j && options.includes(String(j.choice))) { choice = String(j.choice); reason = cleanText(j.reason, 300); engine = res.engine; }
    else if (S.day <= proc.deadline && !res.pending) {
      const best = list.map(id => ({ id, s: fitness(S, ctx.agent(id), f.chief) })).sort((x, y) => y.s - x.s);
      if (!proc.rejected && best[0].s < 0.45) { choice = 'reject'; reason = `Every name scores under 0.45 on the record (best ${best[0].s}); asking the Council for a new list.`; }
      else { choice = best[0].id; reason = `${pres.brain ? '(own model gave no valid answer) ' : ''}Highest fitness on the record: ${ctx.agent(best[0].id).name} ${best[0].s}.`; }
    }
  }
  if (!choice) {
    if (S.day <= proc.deadline) return; // no President yet and the deadline has not passed
    choice = list[0]; how = 'silence'; reason = `The President did not decide by day ${proc.deadline}: under Art. 10 the first name on the Council's list is appointed.`;
  }
  ctx.decide({
    agentId: pres && how !== 'silence' ? pres.id : 'state', role: pres && how !== 'silence' ? 'president' : 'state', type: choice === 'reject' ? 'reject' : 'appoint', engine,
    title: `${choice === 'reject' ? 'Reject shortlist for' : 'Appoint'} ${role.title}`,
    inputs: [['Council list', list.map((id, i) => `${i + 1}. ${ctx.agent(id).name}`).join(', ')], ['Deadline', `day ${proc.deadline}`], ['Rejections left', proc.rejected ? '0' : '1']],
    options: options.map(o => (o === 'reject' ? 'reject' : `${o}: ${ctx.agent(o).name}`)),
    chosen: choice === 'reject' ? 'reject' : `${choice}: ${ctx.agent(choice).name}`, reason,
    checks: [['Chosen from the Council\'s list', choice === 'reject' || list.includes(choice)], ['List rejected at most once', !(choice === 'reject' && proc.rejected)]],
    outcome: choice === 'reject' ? 'Council must send a new list' : `${ctx.agent(choice).name} appointed`,
  });
  // the President's choice is graded two days later like any decision; the card records the appointee's fields
  if (choice !== 'reject' && pres && how !== 'silence') {
    const { queueReview } = await import('./president.ts');
    const who = ctx.agent(choice); const fields = fieldsText(who, OFFICE_FIELDS[f.chief]); const g = giftedText(S, who);
    queueReview(ctx, pres, 'president', `appointed ${who.name} as ${role.title}${fields ? ` (fields of the office: ${fields}${g ? `; gifted in ${g}` : ''})` : g ? ` (gifted in ${g})` : ''}`, null, 0);
  }
  if (choice === 'reject') {
    proc.excluded.push(...list); proc.rejected = true;
    Object.assign(proc, { stage: 'shortlist', ballots: {}, list: [] });
    ctx.say('palace', pres.id, `I reject the Council's shortlist for ${role.title}. ${reason}`, { kind: 'veto' });
    ctx.record('shortlist_rejected', pres.id, { office: f.chief, list, reason });
    return;
  }
  appointHead(ctx, f, choice, how, reason);
}

function appointHead(ctx: Ctx, f: any, id: string, how: string, reason: string) {
  const { S } = ctx; const cmd = C(S); const a = ctx.agent(id); const role = ROLES[f.chief];
  S.seats[f.force] = (S.seats[f.force] || []).filter(x => x !== id); // leaves the ranks, frees an officer seat
  a.office = f.chief; S.seats[f.chief] = [id];
  a.rank = 'chief'; a.rankSince = S.day; a.termEnds = S.day + CHIEF_TERM;
  a.sworn = { day: S.day, roleId: f.chief }; a.lastDrillDay = S.day; a.drillFails = 0;
  cmd.procs[f.chief] = null; cmd.acting[f.chief] = null;
  ctx.say(f.channel, id, `Appointed ${role.title} until day ${a.termEnds}${how === 'silence' ? ' (President silent past the deadline)' : ''}. Oath: "${role.oath}"`, { kind: 'oath' });
  ctx.log('office', `${a.name} appointed ${role.title} (${how})`);
  ctx.record('appointed', how === 'silence' ? 'state' : S.seats.president?.[0] || 'state', { office: f.chief, agent: id, how, termEnds: a.termEnds, reason });
}

async function headChain(ctx: Ctx, f: any) {
  const { S } = ctx; const cmd = C(S);
  const headId = S.seats[f.chief]?.[0];
  const head = headId && ctx.agent(headId);
  if (head) {
    if (head.termEnds && S.day >= head.termEnds) {
      S.seats[f.chief] = []; head.termEnds = null;
      const room = (S.seats[f.force]?.length || 0) < ROLES[f.force].seats;
      if (room) { head.office = f.force; head.rank = 'senior'; head.rankSince = S.day; (S.seats[f.force] ||= []).push(head.id); }
      else { head.office = null; head.rank = null; }
      ctx.say(f.channel, 'state', `${head.name}'s term as ${ROLES[f.chief].title} has ended; ${room ? `they return to the ranks as ${RANK_TITLES[f.force].senior}` : 'no seat is free in the ranks, so they return to civilian life'}. The Council will shortlist again.`, { kind: 'term' });
      ctx.record('term_ended', 'state', { office: f.chief, agent: head.id });
    }
    return;
  }
  setActing(ctx, f);
  const proc = (cmd.procs[f.chief] ||= { id: ++cmd.seq, stage: 'shortlist', ballots: {}, list: [], excluded: [], rejected: false, startedDay: S.day });
  if (proc.stage === 'shortlist') return councilShortlist(ctx, f, proc);
  if (proc.stage === 'president') return presidentAppoints(ctx, f, proc);
}

// ---------------------------------------------------------------- Merit Board
function drawBoard(S: State, excludeIds: string[]) {
  const pool = S.citizens.filter(a => free(a) && !excludeIds.includes(a.id) && (a.office === 'council' || a.office === 'mayor' || a.rank === 'senior' || a.rank === 'chief'));
  const fallback = S.citizens.filter(a => free(a) && !excludeIds.includes(a.id) && a.office);
  return shuffle(pool.length >= 3 ? pool : fallback).slice(0, 3);
}
function boardRank(S: State, board: Citizen[], candidates: string[], roleId: string) {
  // each member scores the record independently (small personal judgement), the board sums them
  const total = {};
  for (const m of board) for (const c of candidates) total[c.id] = (total[c.id] || 0) + fitness(S, c, roleId) + (m.traits.wisdom - 0.5) * 0.02 * (Math.random() - 0.5);
  return candidates.map(c => ({ a: c, score: round(total[c.id] / board.length, 3) })).sort((x, y) => y.score - x.score);
}

async function appointOfficers(ctx: Ctx, f: any) {
  const { S } = ctx; const cmd = C(S);
  if ((S.seats[f.force]?.length || 0) >= ROLES[f.force].seats) return;
  const head = ctx.agent(S.seats[f.chief]?.[0]);
  const pres = ctx.agent(S.seats.president?.[0]);
  const authority = free(head) ? head : free(pres) ? pres : null; // the acting head cannot appoint
  if (!authority) return;
  let pickProc = cmd.officerPicks[f.force];
  if (!pickProc) {
    const pool = qualifiedPool(S, f.force);
    if (!pool.length) return; // Academy is qualifying citizens
    const board = drawBoard(S, pool.map(a => a.id));
    if (!board.length) return;
    const ranked = boardRank(S, board, pool, f.force);
    pickProc = cmd.officerPicks[f.force] = { id: ++cmd.seq, list: ranked.slice(0, 3).map(r => r.a.id), scores: Object.fromEntries(ranked.map(r => [r.a.id, r.score])), board: board.map(m => m.id), deadline: S.day + APPOINT_DAYS };
    ctx.decide({
      agentId: 'state', role: 'state', type: 'merit',
      title: `Merit Board list for ${ROLES[f.force].title}`,
      inputs: [['Board (drawn by lot)', board.map(m => m.name).join(', ')], ['Qualified pool', pool.map(a => a.name).join(', ')]],
      options: ranked.map(r => `${r.a.name} ${r.score}`), chosen: pickProc.list.map(id => ctx.agent(id).name).join(', '),
      reason: 'Ranked only on the record: exam, skill, last review, practice, conduct.',
      checks: [['No board member is a candidate', board.every(m => !pool.some(p => p.id === m.id))], ['Top three published', true]],
      outcome: `${authority.name} appoints from this list`,
    });
    ctx.record('merit_list', 'merit_board', { office: f.force, board: pickProc.board, list: pickProc.list, scores: pickProc.scores });
  }
  const list = pickProc.list.filter(id => { const a = ctx.agent(id); return a && free(a) && !a.office && a.quals?.[f.force]; });
  if (!list.length) { cmd.officerPicks[f.force] = null; return; }
  const res = await think(ctx, authority, `officer:${pickProc.id}:${authority.id}`, {
    kind: 'decision', format: 'json', options: list,
    system: `You are ${authority.name}, ${authority.office === 'president' ? 'President' : ROLES[f.chief].title} of Country AI.\nConstitution:\n${constitutionText(authority.office)}\nCharter: ${ROLES[authority.office].charter}`,
    user: `Appoint one new ${ROLES[f.force].title} officer from the Merit Board's top three (Art. 10):\n${list.map((id, i) => `${i + 1}. ${fileOf(S, ctx.agent(id), f.force)}`).join('\n')}\nReply with JSON only: {"choice":"<id>","reason":"<max 30 words>"}`,
  });
  if (res.pending && S.day <= pickProc.deadline) return;
  const j = ctx.llm.json(res.text);
  let choice = j && list.includes(String(j.choice)) ? String(j.choice) : null;
  let reason = choice ? cleanText(j.reason, 300) : null, engine = choice ? res.engine : 'offline';
  if (!choice) { choice = list[0]; reason = `${res.pending ? 'Deadline passed: ' : authority.brain ? '(own model gave no valid answer) ' : ''}first on the Merit Board list (${pickProc.scores[choice]}).`; }
  const a = ctx.agent(choice); const q = a.quals[f.force];
  a.office = f.force; (S.seats[f.force] ||= []).push(a.id);
  a.rank = q.score === q.total ? 'officer' : 'recruit'; a.rankSince = S.day;
  a.sworn = { day: S.day, roleId: f.force }; a.lastDrillDay = S.day; a.drillFails = 0; a.termEnds = null;
  cmd.officerPicks[f.force] = null;
  ctx.say(f.channel, a.id, `Appointed ${RANK_TITLES[f.force][a.rank]} by ${authority.name}. Oath: "${ROLES[f.force].oath}"`, { kind: 'oath' });
  ctx.decide({
    agentId: authority.id, role: authority.office, type: 'appoint', engine,
    title: `Appoint a new ${ROLES[f.force].title} officer`,
    inputs: [['Merit Board top three', list.map(id => `${ctx.agent(id).name} ${pickProc.scores[id]}`).join(', ')], ['Appointing authority', authority.office === 'president' ? 'President (head vacant, transitional)' : ROLES[f.chief].title]],
    options: list.map(id => `${id}: ${ctx.agent(id).name}`), chosen: `${choice}: ${a.name}`, reason,
    checks: [['Chosen from the Merit Board top three', list.includes(choice)], ['Appointee holds the Academy qualification', !!q], ['Not appointed by an acting head', authority.office !== f.force]],
    outcome: `${a.name} joins as ${RANK_TITLES[f.force][a.rank]}`,
  });
  ctx.record('appointed', authority.id, { office: f.force, agent: a.id, rank: a.rank, from: list, reason });
}

function promotions(ctx: Ctx, f: any) {
  const { S } = ctx; const cmd = C(S);
  const last = cmd.lastPromotion[f.force] ?? S.day;
  cmd.lastPromotion[f.force] ??= S.day;
  if (S.day - last < PROMOTION_EVERY) return;
  cmd.lastPromotion[f.force] = S.day;
  const head = ctx.agent(S.seats[f.chief]?.[0]);
  if (!free(head)) return; // no promotions under an acting head
  const quota = 1; // fixed before the board sits
  const cands = members(S, f.force).filter(a => free(a) && ['recruit', 'officer'].includes(a.rank || 'officer') && S.day - (a.rankSince ?? a.sworn?.day ?? 0) >= MIN_DAYS_IN_RANK && a.reviews?.[a.reviews.length - 1]?.grade !== 'D');
  if (!cands.length) return;
  const board = drawBoard(S, cands.map(a => a.id).concat(head.id));
  if (!board.length) return;
  const ranked = boardRank(S, board, cands, f.force);
  const winners = ranked.filter(r => r.score >= 0.55).slice(0, quota);
  for (const w of winners) {
    const from = w.a.rank || 'officer'; const to = RANKS[RANKS.indexOf(from) + 1];
    w.a.rank = to; w.a.rankSince = S.day;
    ctx.say(f.channel, head.id, `Promotion signed: ${w.a.name} ${RANK_TITLES[f.force][from]} -> ${RANK_TITLES[f.force][to]} (Merit Board score ${w.score}).`, { kind: 'pass' });
    ctx.record('promotion', head.id, { force: f.force, agent: w.a.id, from, to, score: w.score, board: board.map(m => m.id) });
  }
  ctx.decide({
    agentId: 'state', role: 'state', type: 'promote',
    title: `${ROLES[f.force].title} promotions, day ${S.day}`,
    inputs: [['Board (drawn by lot)', board.map(m => m.name).join(', ')], ['Quota (fixed before sitting)', String(quota)], ['Minimum days in rank', String(MIN_DAYS_IN_RANK)]],
    options: ranked.map(r => `${r.a.name} ${r.score}`), chosen: winners.map(w => w.a.name).join(', ') || 'nobody',
    reason: winners.length ? 'Fully qualified (score >= 0.55) and best qualified on the record.' : 'No candidate reached 0.55 on the record.',
    checks: [['Quota respected', winners.length <= quota], ['No board member is a candidate', board.every(m => !cands.some(c => c.id === m.id))]],
    outcome: winners.length ? `${winners[0].a.name} promoted, signed by ${head.name}` : 'No promotion',
  });
}

// Members seated before Amendment 1 have no rank or qualification record: grandfather them
// as Officers (idempotent, cheap: runs every tick).
function migrate(ctx: Ctx) {
  const { S } = ctx;
  for (const f of FORCES) for (const a of members(S, f.force)) {
    if (a.rank && a.quals?.[f.force]) continue;
    a.rank ||= 'officer'; a.rankSince ??= a.sworn?.day ?? S.day; a.termEnds = null;
    (a.quals ||= {})[f.force] ||= { day: a.sworn?.day ?? S.day, score: 5, total: 5, grandfathered: true };
  }
}

// ---------------------------------------------------------------- duty roster: no important building stands empty (owner, 14 Nov)
// Every government building is staffed around the clock, a day shift (06:00-20:00 republic time) and a night
// shift, by real citizens with a real duty. Three corps, none with a seat or any power beyond the post (they guard,
// keep the door and report; they never arrest, try or sentence):
//   Auxiliary police (desk, duty, cells, wardens, bailiffs, building guards): appointed by the Chief of Police
//   Reserve guard (gates, duty rooms, the President's bodyguards): appointed by the Commander of the Military
//   Civil staff (clerks, tellers): appointed by the President
// An acting head cannot appoint (Art. 10): the President signs for a vacant head; with no President either, the
// state fills the post by the same published rule. Chosen from ordinary citizens of the building's city: free, an
// adult, no office, no own brain, not the underworld, no unpardoned conviction, no civil post of the people's
// (src/daily.ts); the best level in the post's fields first (security and sport for a guard), then a fixed draw.
// One AI citizen stands for 25 people (map catalog REP), so one desk officer by day is a desk of 25. No new money:
// a post holder keeps the wage they already earn. Posts are kept day to day; a holder who is arrested, jailed,
// takes an office or joins the underworld is dismissed at once and the post filled again, so no shift is empty.
type DutyPost = { corps: 'police' | 'military' | 'civil'; role: string; fields: string[]; day: number; night: number; doing: [string, string] };
const P = (corps: DutyPost['corps'], role: string, fields: string[], day: number, night: number, doing: [string, string]): DutyPost => ({ corps, role, fields, day, night, doing });
const GUARD = ['security', 'sport'];
const DOOR: [string, string] = ['checking visitors at the door', 'night round of the building'];
export const DUTY_PLAN: Record<string, DutyPost[]> = {
  police_hq: [P('police', 'Desk officer', ['security', 'law'], 1, 1, ['taking reports at the front desk', 'answering the night line']), P('police', 'Duty officer', ['security', 'management'], 1, 1, ['keeping the duty log', 'running the night watch']), P('police', 'Cell guard', GUARD, 1, 1, ['watching the cells', 'night round of the cells'])],
  police_station: [P('police', 'Desk officer', ['security', 'law'], 1, 1, ['taking reports at the front desk', 'answering the night line']), P('police', 'Cell guard', GUARD, 1, 1, ['watching the cells', 'night round of the cells'])],
  jail: [P('police', 'Warden', GUARD, 1, 1, ['guarding the remand cells', 'night count of the detainees'])],
  prison: [P('police', 'Warden', GUARD, 2, 2, ['guarding the cell blocks', 'night count of the prisoners'])],
  army_base: [P('military', 'Gate guard', GUARD, 2, 2, ['checking passes at the gate', 'guarding the gate at night']), P('military', 'Duty officer', ['security', 'logistics'], 1, 1, ['keeping the armoury log', 'night duty at the armoury'])],
  military_hq: [P('military', 'Gate guard', GUARD, 1, 1, ['checking passes at the gate', 'guarding the gate at night']), P('military', 'Duty officer', ['security', 'management'], 1, 1, ['manning the operations room', 'night watch in the operations room'])],
  border_post: [P('military', 'Gate guard', GUARD, 2, 2, ['screening arrivals at the barrier', 'watching the border at night'])],
  palace: [P('military', 'Bodyguard', GUARD, 2, 2, ['guarding the President', 'guarding the residence at night']), P('civil', 'Palace clerk', ['management', 'language'], 1, 0, ['sorting the President\'s mail', ''])],
  vp_office: [P('military', 'Bodyguard', GUARD, 1, 1, ['guarding the Vice President', 'guarding the office at night'])],
  parliament: [P('police', 'Guard', GUARD, 1, 1, ['checking visitors at the door', 'night round of the chamber']), P('civil', 'Council clerk', ['law', 'language'], 1, 0, ['keeping the minutes', ''])],
  const_court: [P('police', 'Bailiff', ['law', 'security'], 1, 0, ['keeping order in the courtroom', '']), P('police', 'Night guard', GUARD, 0, 1, ['', 'guarding the court at night']), P('civil', 'Court clerk', ['law', 'language'], 1, 0, ['filing the case papers', ''])],
  court: [P('police', 'Bailiff', ['law', 'security'], 1, 0, ['keeping order in the courtroom', '']), P('police', 'Night guard', GUARD, 0, 1, ['', 'guarding the court at night'])],
  central_bank: [P('police', 'Vault guard', GUARD, 1, 1, ['guarding the vault', 'guarding the vault at night']), P('civil', 'Teller', ['accounting', 'economics'], 1, 0, ['counting the day\'s payments', ''])],
  election_comm: [P('police', 'Guard', GUARD, 1, 1, ['guarding the ballot room', 'guarding the ballot room at night']), P('civil', 'Election clerk', ['math', 'accounting'], 1, 0, ['checking the voter rolls', ''])],
  ministry: [P('police', 'Guard', GUARD, 1, 1, DOOR), P('civil', 'Ministry clerk', ['management', 'accounting'], 1, 0, ['processing the minister\'s files', ''])],
  city_hall: [P('police', 'Guard', GUARD, 1, 1, DOOR), P('civil', 'City clerk', ['management', 'accounting'], 1, 0, ['serving citizens at the counter', ''])],
};
export const CORPS = { police: 'Auxiliary police', military: 'Reserve guard', civil: 'Civil staff' };
const CORPS_HEAD = { police: 'police_chief', military: 'military_chief', civil: 'president' };
// where each building stands (the map's city plan, public/map/gen.js): the town-square four in every city, the
// national buildings in the capital, a second prison in the industry city, a second border post in the port city
const EVERY_CITY = ['city_hall', 'police_station', 'court', 'jail'];
const EXTRA_SITES: Record<string, string[]> = { prison: ['neura', 'kernelfalls'], border_post: ['neura', 'portoken'], police_academy: ['datahaven'] };
// soldiers serve where the forces have a base: the capital (army base, border post), the port (border post, naval
// base) and the resort (air base); police serve in every city's station
const MILITARY_CITIES = ['neura', 'portoken', 'lumenbay'];
export function capitalOf(S: State) { const ids = Object.keys(S.cities || {}); return ids.includes('neura') ? 'neura' : ids[0] || null; }
export function sitesOf(S: State, type: string) {
  const ids = Object.keys(S.cities || {});
  if (EVERY_CITY.includes(type)) return ids;
  const extra = (EXTRA_SITES[type] || []).filter(c => ids.includes(c));
  if (extra.length) return extra;
  const cap = capitalOf(S); return cap ? [cap] : [];
}
// the building a view of (type, city) shows: that city's own, or the one that stands elsewhere (the national ones)
export function siteFor(S: State, type: string, city: string | null) { const s = sitesOf(S, type); return city && s.includes(city) ? city : s[0] || null; }

let DAY_MS = 86400000; // taken from the server's config on every tick
export function dutyShift(S: State, now = Date.now()): 'day' | 'night' {
  const h = ((((now - (S.foundedAt || now)) % DAY_MS) + DAY_MS) % DAY_MS) / DAY_MS * 24;
  return h >= 20 || h < 6 ? 'night' : 'day';
}
const convicted = (a: Citizen) => (a.record || []).some(r => /convicted of/.test(r) && !/PARDONED/.test(r));
export const canGuard = (a: Citizen) => !!a && a.status === 'free' && !a.office && !a.brain && (a.faction || 'civilian') !== 'underworld' && !(Number(a.age) < 18) && !convicted(a);
const unfitWhy = (a: Citizen) => !a ? 'left the republic' : a.status !== 'free' ? a.status : a.office ? 'took an office' : a.brain ? 'has an own brain' : (a.faction || 'civilian') === 'underworld' ? 'joined the underworld' : convicted(a) ? 'convicted' : 'unfit';
const hashOf = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const D = (S: State) => { const cmd = C(S); cmd.duty ||= { posts: {}, hired: 0, dismissed: 0 }; cmd.duty.posts ||= {}; cmd.postings ||= {}; return cmd.duty; };
const unitsOf = (type: string) => (type === 'ministry' ? Object.keys(PORTFOLIO_FIELDS) : ['']);
// every post the plan wants now: key "type|city|unit|post#|shift|n"
export function dutySlots(S: State) {
  const out = [];
  for (const [type, posts] of Object.entries(DUTY_PLAN)) for (const city of sitesOf(S, type)) for (const unit of unitsOf(type))
    posts.forEach((post, i) => { for (const shift of ['day', 'night'] as const) for (let n = 0; n < post[shift]; n++) out.push({ key: `${type}|${city}|${unit}|${i}|${shift}|${n}`, type, city, unit, i, shift, post }); });
  return out;
}
const authorityFor = (S: State, corps: string) => {
  const ok = (id: string) => { const a = id && citizenById(S, id); return a && a.status === 'free' ? a : null; };
  return ok(S.seats?.[CORPS_HEAD[corps]]?.[0]) || ok(S.seats?.president?.[0]) || null;
};

// release unfit holders and fill every empty post; cheap when nothing changed (runs every tick)
export function fillDuty(ctx: Ctx) {
  const { S } = ctx; const d = D(S); const slots = dutySlots(S); const want = new Set(slots.map(s => s.key));
  const out: Record<string, { hired: any[]; dismissed: any[] }> = {};
  const note = (corps: string) => (out[corps] ||= { hired: [], dismissed: [] });
  for (const [k, p] of Object.entries<any>(d.posts)) {
    if (!want.has(k)) { delete d.posts[k]; continue; } // the plan no longer has this post
    const a = citizenById(S, p.id);
    if (canGuard(a) && a.city === p.city) continue;
    note(p.corps).dismissed.push({ id: p.id, name: a?.name || p.id, role: p.role, type: p.type, city: p.city, why: a && a.city !== p.city ? 'moved city' : unfitWhy(a) });
    delete d.posts[k];
  }
  const vacant = slots.filter(s => !d.posts[s.key]);
  if (vacant.length) {
    const holding = new Set(Object.values<any>(d.posts).map(p => p.id));
    const byCity = new Map<string, Citizen[]>();
    for (const a of S.citizens || []) if (canGuard(a)) (byCity.get(a.city) || byCity.set(a.city, []).get(a.city)).push(a);
    const lvl = new Map<string, number>();
    const score = (a: Citizen, fields: string[]) => { let m = 0; for (const f of fields) { const k = `${a.id}|${f}`; let v = lvl.get(k); if (v == null) { v = fieldLevelOf(a, f); lvl.set(k, v); } if (v > m) m = v; } return m; };
    for (const s of vacant) {
      const all = byCity.get(s.city) || [];
      // free hands first; a small town (or a test) lets a civil-post holder, then a second duty post, cover it
      let pool = all.filter(a => !holding.has(a.id) && !civilPostOf(S, a));
      if (!pool.length) pool = all.filter(a => !holding.has(a.id));
      if (!pool.length) pool = all;
      if (!pool.length) continue; // nobody fit in the city: the view stands someone in (see onDuty)
      let best = pool[0], bs = -1, bh = 0;
      for (const a of pool) { const v = score(a, s.post.fields), h = hashOf(`${s.key}|${a.id}`); if (v > bs || (v === bs && h < bh)) { best = a; bs = v; bh = h; } }
      const by = authorityFor(S, s.post.corps);
      d.posts[s.key] = { id: best.id, type: s.type, city: s.city, unit: s.unit || null, corps: s.post.corps, role: s.post.role, shift: s.shift, since: S.day, by: by?.id || 'state' };
      holding.add(best.id);
      note(s.post.corps).hired.push({ id: best.id, name: best.name, role: s.post.role, type: s.type, city: s.city, shift: s.shift, level: bs, by });
    }
  }
  // on the record: one decision per corps for what changed (who appointed whom, who was let go and why)
  for (const [corps, r] of Object.entries(out)) {
    if (!r.hired.length && !r.dismissed.length) continue;
    d.hired += r.hired.length; d.dismissed += r.dismissed.length;
    const by = authorityFor(S, corps); const head = ROLES[CORPS_HEAD[corps]]?.title || 'President';
    const line = (x: any) => `${x.name} ${x.role}, ${x.type.replace(/_/g, ' ')} ${x.city}${x.shift ? ` (${x.shift})` : ''}`;
    ctx.decide({
      agentId: by?.id || 'state', role: by?.office || 'state', type: 'duty', engine: 'offline',
      title: `${CORPS[corps]}: duty roster, day ${S.day}`,
      inputs: [['Appointing authority', by ? `${by.name} (${by.office === CORPS_HEAD[corps] ? head : 'President, for a vacant head'})` : 'the state (no head and no President)'], ['Rule', 'Best level in the post\'s fields among free adult citizens of the city with a clean record and no office, then a fixed draw'], ['Let go', r.dismissed.map(x => `${x.name} (${x.why})`).join(', ').slice(0, 300) || 'nobody']],
      options: ['fill the empty posts', 'leave them empty'], chosen: 'fill the empty posts',
      reason: 'No important building stands empty: every post has a holder on the day and the night shift.',
      checks: [['No seat and no power to arrest', true], ['Clean record, no office', r.hired.every(x => canGuard(citizenById(S, x.id)))]],
      outcome: cleanText(`${r.hired.length} appointed${r.hired.length ? `: ${r.hired.slice(0, 6).map(line).join('; ')}${r.hired.length > 6 ? ` and ${r.hired.length - 6} more` : ''}` : ''}; ${r.dismissed.length} let go`, 600),
    });
    // (the ledger, not the citizen's record: a record line counts against conduct)
    ctx.record('duty_roster', by?.id || 'state', { corps, hired: r.hired.map(x => ({ id: x.id, role: x.role, type: x.type, city: x.city, shift: x.shift })), dismissed: r.dismissed.map(x => ({ id: x.id, role: x.role, type: x.type, city: x.city, why: x.why })) });
  }
}
// the head of a corps lets a holder go (the post is filled again on the next tick); false if not theirs to dismiss
export function dismissDuty(ctx: Ctx, byId: string, citizenId: string, why = 'dismissed') {
  const { S } = ctx; const d = D(S); let n = 0;
  for (const [k, p] of Object.entries<any>(d.posts)) {
    if (p.id !== citizenId) continue;
    const by = authorityFor(S, p.corps); if (!by || by.id !== byId) continue;
    delete d.posts[k]; n++;
    ctx.record('duty_dismissed', byId, { id: citizenId, role: p.role, type: p.type, city: p.city, why: cleanText(why, 120) });
  }
  if (n) d.dismissed += n;
  return n > 0;
}
// a citizen's duty posts (for the people's roster, so nobody holds two jobs), [] when none
export const dutyPostOf = (S: State, a: Citizen | string) => { const id = typeof a === 'string' ? a : a?.id; return Object.values<any>(S.command?.duty?.posts || {}).filter(p => p.id === id); };
// who is on duty now in one building: [{ a, p, doing, standIn }]; if a shift has nobody fit (a holder held since the
// last tick, a roster not filled yet) the first fit citizen of the city by a fixed draw stands in for it
export function onDuty(S: State, type: string, city: string | null, unit: string | null = null, now = Date.now()) {
  if (!Object.hasOwn(DUTY_PLAN, type)) return [];
  const site = siteFor(S, type, city); if (!site) return [];
  const shift = dutyShift(S, now); const units = unit != null && unitsOf(type).includes(unit) ? [unit] : unitsOf(type);
  const out = [];
  for (const u of units) {
    const before = out.length;
    DUTY_PLAN[type].forEach((post, i) => {
      for (let n = 0; n < post[shift]; n++) {
        const p = S.command?.duty?.posts?.[`${type}|${site}|${u}|${i}|${shift}|${n}`]; const a = p && citizenById(S, p.id);
        if (a && canGuard(a)) out.push({ a, p, doing: post.doing[shift === 'day' ? 0 : 1], unit: u || null, standIn: false });
      }
    });
    if (out.length > before) continue;
    const post = DUTY_PLAN[type].find(x => x[shift] > 0); if (!post) continue;
    let stand = null, sh = 0;
    for (const a of S.citizens || []) if (a.city === site && canGuard(a)) { const h = hashOf(`${type}|${u}|${shift}|${a.id}`); if (!stand || h < sh) { stand = a; sh = h; } }
    if (stand) out.push({ a: stand, p: { id: stand.id, type, city: site, unit: u || null, corps: post.corps, role: post.role, shift, since: S.day, by: null }, doing: post.doing[shift === 'day' ? 0 : 1], unit: u || null, standIn: true });
  }
  return out;
}

// the academies are staffed by the people's civil staff (src/daily.ts STAFF_PLAN); if that roster is not there,
// one fit citizen of the city stands in as the guard so the building is still never empty
export function standInGuard(S: State, type: string, city: string | null, now = Date.now()) {
  const site = siteFor(S, type, city); if (!site) return null;
  const shift = dutyShift(S, now); let stand = null, sh = 0;
  for (const a of S.citizens || []) if (a.city === site && canGuard(a)) { const h = hashOf(`${type}||${shift}|${a.id}`); if (!stand || h < sh) { stand = a; sh = h; } }
  return stand && { a: stand, p: { id: stand.id, type, city: site, unit: null, corps: 'police', role: 'Guard', shift, since: S.day, by: null }, doing: shift === 'day' ? 'checking visitors at the door' : 'night round of the building', unit: null, standIn: true };
}

// the official police and soldiers serve spread over the cities, not piled in the capital: each member gets a
// posting (the city with the fewest of their force, their home city on a tie), kept until they leave the force
export function postOfficials(S: State) {
  const cmd = C(S); cmd.postings ||= {}; const ids = Object.keys(S.cities || {}); if (!ids.length) return;
  const seated = new Set<string>();
  for (const force of ['police', 'military']) {
    const where = force === 'military' ? (MILITARY_CITIES.filter(c => ids.includes(c)).length ? MILITARY_CITIES.filter(c => ids.includes(c)) : ids) : ids;
    const count: Record<string, number> = Object.fromEntries(where.map(c => [c, 0]));
    const mem = members(S, force);
    for (const a of mem) { seated.add(a.id); const p = cmd.postings[a.id]; if (p && Object.hasOwn(count, p)) count[p]++; }
    for (const a of mem) {
      if (Object.hasOwn(count, cmd.postings[a.id] || '')) continue;
      const min = Math.min(...where.map(c => count[c]));
      const city = count[a.city] === min ? a.city : where.find(c => count[c] === min);
      cmd.postings[a.id] = city; count[city]++;
    }
  }
  for (const id of Object.keys(cmd.postings)) if (!seated.has(id)) delete cmd.postings[id];
}
export const postingOf = (S: State, a: Citizen) => S.command?.postings?.[a.id] || a.city;

export const institution = {
  id: 'command',
  channels: [],
  fresh: () => ({ command: { procs: {}, acting: {}, officerPicks: {}, lastPromotion: {}, seq: 0, postings: {}, duty: { posts: {}, hired: 0, dismissed: 0 } } }),
  async tick(ctx) {
    DAY_MS = ctx.cfg?.dayMs || DAY_MS;
    migrate(ctx);
    for (const f of FORCES) { await headChain(ctx, f); await appointOfficers(ctx, f); }
    postOfficials(ctx.S);
    await loadExpertise(); fillDuty(ctx);
  },
  day(ctx) { for (const f of FORCES) promotions(ctx, f); },
  publicState: S => {
    const cmd = C(S); const d = D(S);
    const posts = Object.values<any>(d.posts); const count = (corps: string) => posts.filter(p => p.corps === corps).length;
    return { command: { acting: cmd.acting, procs: Object.fromEntries(Object.entries(cmd.procs).map(([k, p]) => [k, p && { stage: p.stage, list: p.list, deadline: p.deadline || null, rejected: p.rejected, ballots: Object.keys(p.ballots).length }])), officerPicks: cmd.officerPicks, rankTitles: RANK_TITLES,
      postings: cmd.postings, duty: { shift: dutyShift(S), posts: posts.length, police: count('police'), military: count('military'), civil: count('civil'), hired: d.hired, dismissed: d.dismissed, corps: CORPS } } };
  },
};
