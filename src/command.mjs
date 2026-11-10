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
import { ROLES } from './roles.mjs';
import { think } from './brains.mjs';
import { qualifiedPool } from './academy.mjs';
import { constitutionText } from './constitution.mjs';
import { pick, shuffle, round, cleanText } from './util.mjs';

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
const members = (S, force) => (S.seats[force] || []).map(id => S.citizens.find(a => a.id === id)).filter(Boolean);
const rankIdx = a => (a.rank === 'chief' ? 3 : RANKS.indexOf(a.rank || 'officer'));

// Fitness from the official record only (exam, practice, drills/skill, last review, conduct).
export function fitness(S, a, roleId) {
  const q = a.quals?.[roleId] || [...(a.training || [])].reverse().find(t => t.roleId === roleId && t.passed);
  const exam = q ? q.score / q.total : 0;
  const p = a.practice?.[roleId] || a.practice?.[ROLES[roleId]?.force];
  const practice = p?.n ? p.ok / p.n : 0.5;
  const skill = a.skill?.[roleId] ?? a.skill?.[ROLES[roleId]?.force] ?? 0.5;
  const review = a.reviews?.length ? a.reviews[a.reviews.length - 1].score : 0.6;
  const jailedRecently = (a.record || []).some(r => /jailed/.test(r) && Number((r.match(/^Day (\d+)/) || [])[1]) > S.day - 10);
  const conduct = jailedRecently ? 0 : Math.max(0, 1 - (a.record || []).length * 0.1);
  return round(exam * 0.35 + skill * 0.25 + review * 0.2 + practice * 0.1 + conduct * 0.1, 3);
}
function fileOf(S, a, roleId) {
  const q = a.quals?.[roleId];
  const r = a.reviews?.[a.reviews.length - 1];
  return `${a.id}: ${a.name}, ${RANK_TITLES[ROLES[roleId].force]?.[a.rank] || 'citizen'}, exam ${q ? `${q.score}/${q.total}` : '-'}, skill ${Math.round((a.skill?.[roleId] ?? a.skill?.[ROLES[roleId].force] ?? 0.5) * 100)}, last review ${r ? r.grade : '-'}, record ${(a.record || []).length} entries, fitness ${fitness(S, a, roleId)}`;
}

// ---------------------------------------------------------------- heads
function setActing(ctx, f) {
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

async function councilShortlist(ctx, f, proc) {
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
      system: `You are ${next.name}, member of the Council of Country AI.\nConstitution:\n${constitutionText()}\nCharter: ${ROLES.council.charter}`,
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

async function presidentAppoints(ctx, f, proc) {
  const { S } = ctx;
  const role = ROLES[f.chief];
  const list = proc.list.filter(id => { const a = ctx.agent(id); return a && free(a) && a.office === f.force; });
  if (!list.length) { Object.assign(proc, { stage: 'shortlist', ballots: {}, list: [] }); return; }
  const pres = ctx.agent(S.seats.president?.[0]);
  const options = proc.rejected ? list : [...list, 'reject'];
  let choice = null, reason = null, engine = 'offline', how = 'chosen';
  if (pres && free(pres)) {
    const res = await think(ctx, pres, `appoint:${proc.id}:${proc.rejected ? 2 : 1}`, {
      kind: 'decision', format: 'json', options,
      system: `You are ${pres.name}, President of Country AI.\nConstitution:\n${constitutionText()}\nCharter: ${ROLES.president.charter}`,
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
  if (choice === 'reject') {
    proc.excluded.push(...list); proc.rejected = true;
    Object.assign(proc, { stage: 'shortlist', ballots: {}, list: [] });
    ctx.say('palace', pres.id, `I reject the Council's shortlist for ${role.title}. ${reason}`, { kind: 'veto' });
    ctx.record('shortlist_rejected', pres.id, { office: f.chief, list, reason });
    return;
  }
  appointHead(ctx, f, choice, how, reason);
}

function appointHead(ctx, f, id, how, reason) {
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

async function headChain(ctx, f) {
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
function drawBoard(S, excludeIds) {
  const pool = S.citizens.filter(a => free(a) && !excludeIds.includes(a.id) && (a.office === 'council' || a.office === 'mayor' || a.rank === 'senior' || a.rank === 'chief'));
  const fallback = S.citizens.filter(a => free(a) && !excludeIds.includes(a.id) && a.office);
  return shuffle(pool.length >= 3 ? pool : fallback).slice(0, 3);
}
function boardRank(S, board, candidates, roleId) {
  // each member scores the record independently (small personal judgement), the board sums them
  const total = {};
  for (const m of board) for (const c of candidates) total[c.id] = (total[c.id] || 0) + fitness(S, c, roleId) + (m.traits.wisdom - 0.5) * 0.02 * (Math.random() - 0.5);
  return candidates.map(c => ({ a: c, score: round(total[c.id] / board.length, 3) })).sort((x, y) => y.score - x.score);
}

async function appointOfficers(ctx, f) {
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
    system: `You are ${authority.name}, ${authority.office === 'president' ? 'President' : ROLES[f.chief].title} of Country AI.\nConstitution:\n${constitutionText()}\nCharter: ${ROLES[authority.office].charter}`,
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

function promotions(ctx, f) {
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
function migrate(ctx) {
  const { S } = ctx;
  for (const f of FORCES) for (const a of members(S, f.force)) {
    if (a.rank && a.quals?.[f.force]) continue;
    a.rank ||= 'officer'; a.rankSince ??= a.sworn?.day ?? S.day; a.termEnds = null;
    (a.quals ||= {})[f.force] ||= { day: a.sworn?.day ?? S.day, score: 5, total: 5, grandfathered: true };
  }
}

export const institution = {
  id: 'command',
  channels: [],
  fresh: () => ({ command: { procs: {}, acting: {}, officerPicks: {}, lastPromotion: {}, seq: 0 } }),
  async tick(ctx) {
    migrate(ctx);
    for (const f of FORCES) { await headChain(ctx, f); await appointOfficers(ctx, f); }
  },
  day(ctx) { for (const f of FORCES) promotions(ctx, f); },
  publicState: S => {
    const cmd = C(S);
    return { command: { acting: cmd.acting, procs: Object.fromEntries(Object.entries(cmd.procs).map(([k, p]) => [k, p && { stage: p.stage, list: p.list, deadline: p.deadline || null, rejected: p.rejected, ballots: Object.keys(p.ballots).length }])), officerPicks: cmd.officerPicks, rankTitles: RANK_TITLES } };
  },
};
