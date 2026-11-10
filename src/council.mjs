// The Council: 5 seats. Bills go debate -> vote -> President (sign/veto) -> override (4 of 5).
// One stage per tick so the whole process is visible in #parliament.
// Bill values are generated and clamped in code; agents only decide yes/no and what to say.
import { ROLES } from './roles.mjs';
import { constitutionText } from './constitution.mjs';
import { pick, chance, round, clamp, cleanText, cai } from './util.mjs';
import { think } from './brains.mjs';

// Shared by every bill type: was the vote checked against the ledger and the legal range?
function voteChecks(S, type, bill, a) {
  const [lo, hi] = type.range(S);
  const bribed = (S.police?.incidents || []).some(i => i.type === 'bribe' && i.perps.includes(a.id) && i.day >= bill.day);
  return [[`Proposed ${type.fmt(bill.value)} is inside the legal range ${type.fmt(lo)}-${type.fmt(hi)}`, bill.value >= lo && bill.value <= hi], [`No bribe to ${a.name} on the ledger since the bill was tabled`, !bribed]];
}

const QUORUM = 3;
const OVERRIDE = 4;

// Every bill type: what it changes, the legal range, and how an agent's traits shape its ideal.
export const BILL_TYPES = [
  {
    id: 'tax', name: 'Tax Act', what: 'the tax rate',
    current: S => S.policy.taxRate, apply: (S, v) => { S.policy.taxRate = v; },
    propose: S => round(clamp(S.policy.taxRate + pick([-0.05, -0.03, -0.02, 0.02, 0.03, 0.05]), 0, 0.3), 2),
    ideal: a => 0.06 + a.traits.wisdom * 0.14, trait: 'wisdom', range: () => [0, 0.3],
    fmt: v => Math.round(v * 100) + '%',
    why: { up: 'the treasury needs room to pay UBI and fund the police', down: 'citizens keep more of what they earn' },
  },
  {
    id: 'ubi', name: 'Basic Income Act', what: 'the universal basic income',
    current: S => S.policy.ubi, apply: (S, v) => { S.policy.ubi = v; },
    propose: S => clamp(S.policy.ubi + pick([-10, -5, 5, 10, 15]), 5, 100),
    ideal: a => 10 + a.traits.integrity * 60, trait: 'integrity', range: () => [5, 100],
    fmt: v => cai(v),
    why: { up: 'nobody in this republic should start the day at zero', down: 'the treasury should not be drained by handouts' },
  },
  {
    id: 'wage', name: 'Fair Wage Act', what: 'the daily wage',
    current: S => S.policy.wage, apply: (S, v) => { S.policy.wage = v; },
    propose: S => clamp(S.policy.wage + pick([-10, -5, 5, 10]), 60, S.policy.wageCap),
    ideal: a => 90 + a.traits.diligence * 80, trait: 'diligence', range: S => [60, S.policy.wageCap],
    fmt: v => cai(v),
    why: { up: 'work should pay', down: 'wages are outrunning productivity' },
  },
];

const SPEECH = {
  yes: ['I support it: {why}.', 'Yes from me. {Why}.', 'I read it twice. It is sound: {why}.', 'This moves us the right way. {Why}.'],
  no: ['I oppose it. {Other}.', 'No. I am not convinced; {other}.', 'I read it and I cannot back it. {Other}.', 'Not this time. {Other}.'],
};
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

function closer(a, type, value, current) {
  const ideal = type.ideal(a);
  const moves = Math.abs(value - ideal) < Math.abs(current - ideal);
  const flipped = chance(0.12); // independent minds
  const yes = flipped ? !moves : moves;
  const t = type.trait;
  const reason = `My ideal for ${type.what} is ${type.fmt(ideal)} (my ${t} is ${Math.round((a.traits[t] || 0) * 100)}). The bill moves it ${type.fmt(current)} -> ${type.fmt(value)}, ${moves ? 'closer to' : 'further from'} that ideal${flipped ? ', but the debate changed my mind' : ''}.`;
  return { yes, reason };
}

function offlineSpeech(type, bill, yes) {
  const dirUp = bill.value > bill.from;
  const why = type.why[dirUp ? 'up' : 'down'], other = type.why[dirUp ? 'down' : 'up'];
  return pick(SPEECH[yes ? 'yes' : 'no']).replace('{why}', why).replace('{Why}', cap(why)).replace('{other}', other).replace('{Other}', cap(other));
}

async function decide(ctx, a, bill, type, asRole) {
  const { llm, S } = ctx;
  {
    const lessons = (a.lessons[asRole] || []).map(l => `- ${l}`).join('\n') || '- none';
    const res = await think(ctx, a, `${asRole}:${bill.id}:${a.id}`, {
      kind: 'decision', format: 'json', options: asRole === 'president' ? ['sign', 'veto'] : ['yes', 'no'],
      system: `You are ${a.name}, ${ROLES[asRole].title === 'Council' ? 'a member of the Council' : 'the President'} of Country AI.\nConstitution:\n${constitutionText()}\nCharter: ${ROLES[asRole].charter}\nLessons from your Academy training:\n${lessons}`,
      user: `Bill: "${bill.title}". It changes ${type.what} from ${type.fmt(bill.from)} to ${type.fmt(bill.value)}. Treasury ${cai(S.treasury)}, citizens ${S.citizens.length}.\n${asRole === 'president' ? 'Sign or veto it.' : 'Vote yes or no.'} Reply with JSON only: {"vote":"${asRole === 'president' ? 'sign|veto' : 'yes|no'}","reason":"<your reasoning, max 30 words>","speech":"<what you say in public, max 30 words>"}`,
    });
    if (res.pending) return { pending: true };
    const j = llm.json(res.text);
    const v = String(j?.vote || '').toLowerCase();
    if (['yes', 'no', 'sign', 'veto'].includes(v)) return { yes: v === 'yes' || v === 'sign', reason: cleanText(j.reason, 300), speech: cleanText(j.speech, 240), engine: res.engine };
  }
  const c = closer(a, type, bill.value, bill.from);
  return { yes: c.yes, reason: c.reason, speech: offlineSpeech(type, bill, c.yes), engine: 'offline' };
}

function logVote(ctx, a, bill, type, d, asRole, stage) {
  const { S } = ctx;
  const presidential = asRole === 'president';
  ctx.decide({
    agentId: a.id, role: asRole, type: presidential ? (d.yes ? 'sign' : 'veto') : 'vote', engine: d.engine,
    title: `${presidential ? 'Sign or veto' : stage === 'override' ? 'Override vote on' : 'Vote on'} bill #${bill.id}: ${bill.title}`,
    inputs: [['Current', type.fmt(bill.from)], ['Proposed', type.fmt(bill.value)], ['Treasury', cai(S.treasury)], ['Tabled by', ctx.agent(bill.by)?.name || bill.by]],
    options: presidential ? ['sign', 'veto'] : ['yes', 'no'],
    chosen: presidential ? (d.yes ? 'sign' : 'veto') : (d.yes ? 'yes' : 'no'),
    reason: d.reason,
    checks: voteChecks(S, type, bill, a),
    outcome: presidential ? (d.yes ? 'Bill becomes law' : 'Sent back for a 4-of-5 override') : 'Vote recorded',
  });
}

function councillors(ctx) {
  return (ctx.S.seats.council || []).map(id => ctx.agent(id)).filter(a => a && a.status === 'free');
}

function propose(ctx, members) {
  const { S } = ctx;
  const type = pick(BILL_TYPES);
  const from = type.current(S); const value = type.propose(S);
  if (value === from) return;
  const by = pick(members);
  const n = S.bills.filter(b => b.type === type.id).length + 1;
  const bill = { id: S.bills.length + 1, type: type.id, title: `${type.name} No. ${n}: ${type.what} ${type.fmt(from)} -> ${type.fmt(value)}`, from, value, by: by.id, stage: 'debate', spoke: [], votes: {}, override: {}, day: S.day, ts: Date.now() };
  S.bills.push(bill); if (S.bills.length > 200) S.bills.shift();
  ctx.say('parliament', by.id, `I table bill #${bill.id}: ${bill.title}.`, { kind: 'bill', billId: bill.id });
}

// Art. 20: a signed law waits one day; citizens may petition it into a referendum.
const TIMELOCK_DAYS = 1;
const PETITION_SHARE = 0.15;
function enact(ctx, bill, how) {
  const { S } = ctx; const type = BILL_TYPES.find(t => t.id === bill.type);
  if (S.constitutionVersion >= 4 && !bill.timelockDone) {
    bill.stage = 'timelock'; bill.how = how; bill.effectiveDay = S.day + TIMELOCK_DAYS; bill.petition = [];
    ctx.say('parliament', 'state', `Bill #${bill.id} signed (${how}). It takes effect on day ${bill.effectiveDay} unless ${Math.round(PETITION_SHARE * 100)}% of citizens petition for a referendum.`, { kind: 'law' });
    ctx.record('law_signed', 'council', { bill: bill.id, title: bill.title, effectiveDay: bill.effectiveDay, how });
    return;
  }
  type.apply(S, bill.value);
  bill.stage = 'enacted'; bill.how = how;
  const yes = Object.values(bill.votes).filter(Boolean).length;
  S.laws.push({ id: S.laws.length + 1, billId: bill.id, title: bill.title, text: `${cap(type.what)} is now ${type.fmt(bill.value)}.`, how, yes, no: Object.keys(bill.votes).length - yes, day: S.day, ts: Date.now() });
  if (S.laws.length > 300) S.laws.shift();
  ctx.say('parliament', 'state', `Law ${S.laws.length} enacted (${how}): ${cap(type.what)} is now ${type.fmt(bill.value)}.`, { kind: 'law' });
  ctx.log('law', `${bill.title} enacted (${how})`);
  ctx.record?.('law', 'council', { bill: bill.id, title: bill.title, type: bill.type, from: bill.from, value: bill.value, how, votes: bill.votes });
}

function timelockTick(ctx) {
  const { S } = ctx;
  for (const bill of S.bills.filter(b => b.stage === 'timelock')) {
    const type = BILL_TYPES.find(t => t.id === bill.type);
    // citizens who strongly dislike the change sign (offline: distance from their own ideal grows a lot)
    for (const a of S.citizens) {
      if (a.status !== 'free' || bill.petition.includes(a.id) || a.brain) continue;
      const ideal = type.ideal(a); const worse = Math.abs(bill.value - ideal) - Math.abs(bill.from - ideal);
      if (worse > Math.abs(bill.value - bill.from) * 0.8 && chance(0.5)) bill.petition.push(a.id);
    }
    if (S.day < bill.effectiveDay) continue;
    const need = Math.max(3, Math.ceil(S.citizens.length * PETITION_SHARE));
    if (bill.petition.length >= need) {
      bill.stage = 'referendum';
      ctx.say('parliament', 'state', `${bill.petition.length} citizens petitioned against bill #${bill.id} (needed ${need}): it goes to a referendum.`, { kind: 'vote' });
      ctx.record('petition', 'citizens', { bill: bill.id, signatures: bill.petition.length, needed: need });
      import('./elections.mjs').then(m => m.openVote(ctx, { kind: 'referendum', office: 'council', law: { id: bill.id, title: bill.title, type: bill.type, from: bill.from, value: bill.value, what: type.what, fromText: type.fmt(bill.from), toText: type.fmt(bill.value) } }));
    } else { bill.timelockDone = true; enact(ctx, bill, bill.how); }
  }
}
export function resolveReferendum(ctx, billId, approved) {
  const bill = ctx.S.bills.find(b => b.id === billId); if (!bill || bill.stage !== 'referendum') return;
  if (approved) { bill.timelockDone = true; enact(ctx, bill, `${bill.how}, approved by referendum`); }
  else { bill.stage = 'repealed'; ctx.say('parliament', 'state', `The people rejected bill #${bill.id} in a referendum. It never takes effect.`, { kind: 'vote' }); ctx.record('law_rejected', 'citizens', { bill: bill.id, title: bill.title }); }
}

export async function councilTick(ctx) {
  const { S } = ctx;
  timelockTick(ctx);
  const members = councillors(ctx);
  const bill = S.bills.find(b => ['debate', 'vote', 'president', 'override'].includes(b.stage));
  if (!bill) { if (members.length >= QUORUM && chance(0.2)) propose(ctx, members); return; }
  if (members.length < QUORUM) return; // no quorum, the bill waits
  const type = BILL_TYPES.find(t => t.id === bill.type);

  if (bill.stage === 'debate') {
    const next = members.find(a => !bill.spoke.includes(a.id));
    if (!next) { bill.stage = 'vote'; return; }
    const d = await decide(ctx, next, bill, type, 'council');
    if (d.pending) return;
    bill.spoke.push(next.id); bill.votes[next.id] = d.yes;
    logVote(ctx, next, bill, type, d, 'council', 'debate');
    ctx.say('parliament', next.id, d.speech, { kind: 'debate', billId: bill.id, vote: d.yes ? 'yes' : 'no', engine: d.engine });
    return;
  }
  if (bill.stage === 'vote') {
    for (const a of members) if (!(a.id in bill.votes)) {
      const c = closer(a, type, bill.value, bill.from);
      bill.votes[a.id] = c.yes;
      logVote(ctx, a, bill, type, { yes: c.yes, reason: c.reason, engine: 'offline' }, 'council', 'vote');
    }
    const yes = Object.values(bill.votes).filter(Boolean).length, no = Object.keys(bill.votes).length - yes;
    if (yes > no) { bill.stage = 'president'; ctx.say('parliament', 'state', `Bill #${bill.id} passes the Council ${yes}-${no}. Sent to the President.`, { kind: 'vote' }); }
    else { bill.stage = 'rejected'; ctx.say('parliament', 'state', `Bill #${bill.id} fails ${yes}-${no}.`, { kind: 'vote' }); }
    return;
  }
  if (bill.stage === 'president') {
    const pres = ctx.agent(S.seats.president?.[0]);
    if (!pres || pres.status !== 'free') return enact(ctx, bill, 'unsigned, no President in office');
    const d = await decide(ctx, pres, bill, type, 'president');
    if (d.pending) return;
    ctx.say('palace', pres.id, `${d.yes ? 'I sign' : 'I veto'} bill #${bill.id}. ${d.speech}`, { kind: d.yes ? 'sign' : 'veto', billId: bill.id, engine: d.engine });
    logVote(ctx, pres, bill, type, d, 'president', 'president');
    if (d.yes) return enact(ctx, bill, 'signed');
    bill.stage = 'override';
    ctx.say('parliament', 'state', `The President vetoed bill #${bill.id}. Override needs ${OVERRIDE} of 5.`, { kind: 'veto' });
    return;
  }
  if (bill.stage === 'override') {
    for (const a of members) {
      bill.override[a.id] = bill.votes[a.id] ?? closer(a, type, bill.value, bill.from).yes;
      logVote(ctx, a, bill, type, { yes: bill.override[a.id], reason: `Override: I keep my earlier ${bill.override[a.id] ? 'yes' : 'no'} on this bill.`, engine: 'offline' }, 'council', 'override');
    }
    const yes = Object.values(bill.override).filter(Boolean).length;
    if (yes >= OVERRIDE) return enact(ctx, bill, `veto overridden ${yes}-${members.length - yes}`);
    bill.stage = 'vetoed';
    ctx.say('parliament', 'state', `Override fails ${yes}-${members.length - yes}. Bill #${bill.id} is dead.`, { kind: 'vote' });
  }
}

export const institution = {
  id: 'council',
  channels: [{ id: 'parliament', name: 'parliament', desc: 'The Council debates bills in public. Every vote is on the record.' }],
  fresh: () => ({ bills: [], laws: [] }),
  tick: councilTick,
  stats: S => ({ laws: S.laws.length }),
  publicState: S => ({ bills: S.bills.slice(-20), laws: S.laws.slice(-60) }),
};
