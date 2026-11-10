// The Council: 5 seats. Bills go debate -> vote -> President (sign/veto) -> override (4 of 5).
// One stage per tick so the whole process is visible in #parliament.
// Bill values are generated and clamped in code; agents only decide yes/no and what to say.
import { ROLES } from './roles.mjs';
import { constitutionText } from './constitution.mjs';
import { pick, chance, round, clamp, cleanText, cai } from './util.mjs';

const QUORUM = 3;
const OVERRIDE = 4;

// Every bill type: what it changes, the legal range, and how an agent's traits shape its ideal.
export const BILL_TYPES = [
  {
    id: 'tax', name: 'Tax Act', what: 'the tax rate',
    current: S => S.policy.taxRate, apply: (S, v) => { S.policy.taxRate = v; },
    propose: S => round(clamp(S.policy.taxRate + pick([-0.05, -0.03, -0.02, 0.02, 0.03, 0.05]), 0, 0.3), 2),
    ideal: a => 0.06 + a.traits.wisdom * 0.14,
    fmt: v => Math.round(v * 100) + '%',
    why: { up: 'the treasury needs room to pay UBI and fund the police', down: 'citizens keep more of what they earn' },
  },
  {
    id: 'ubi', name: 'Basic Income Act', what: 'the universal basic income',
    current: S => S.policy.ubi, apply: (S, v) => { S.policy.ubi = v; },
    propose: S => clamp(S.policy.ubi + pick([-10, -5, 5, 10, 15]), 5, 100),
    ideal: a => 10 + a.traits.integrity * 60,
    fmt: v => cai(v),
    why: { up: 'nobody in this republic should start the day at zero', down: 'the treasury should not be drained by handouts' },
  },
  {
    id: 'wage', name: 'Fair Wage Act', what: 'the daily wage',
    current: S => S.policy.wage, apply: (S, v) => { S.policy.wage = v; },
    propose: S => clamp(S.policy.wage + pick([-10, -5, 5, 10]), 60, S.policy.wageCap),
    ideal: a => 90 + a.traits.diligence * 80,
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
  let yes = Math.abs(value - ideal) < Math.abs(current - ideal);
  if (chance(0.12)) yes = !yes; // independent minds
  return yes;
}

function offlineSpeech(type, bill, yes) {
  const dirUp = bill.value > bill.from;
  const why = type.why[dirUp ? 'up' : 'down'], other = type.why[dirUp ? 'down' : 'up'];
  return pick(SPEECH[yes ? 'yes' : 'no']).replace('{why}', why).replace('{Why}', cap(why)).replace('{other}', other).replace('{Other}', cap(other));
}

async function decide(ctx, a, bill, type, asRole) {
  const { llm, S } = ctx;
  if (llm.enabled) {
    const lessons = (a.lessons[asRole] || []).map(l => `- ${l}`).join('\n') || '- none';
    const reply = await llm.ask({
      model: a.model, maxTokens: 120,
      system: `You are ${a.name}, ${ROLES[asRole].title === 'Council' ? 'a member of the Council' : 'the President'} of Country AI.\nConstitution:\n${constitutionText()}\nCharter: ${ROLES[asRole].charter}\nLessons from your Academy training:\n${lessons}`,
      user: `Bill: "${bill.title}". It changes ${type.what} from ${type.fmt(bill.from)} to ${type.fmt(bill.value)}. Treasury ${cai(S.treasury)}, citizens ${S.citizens.length}.\n${asRole === 'president' ? 'Sign or veto it.' : 'Vote yes or no.'} Reply with JSON only: {"vote":"${asRole === 'president' ? 'sign|veto' : 'yes|no'}","speech":"<max 30 words>"}`,
    });
    const j = llm.json(reply);
    const v = String(j?.vote || '').toLowerCase();
    if (['yes', 'no', 'sign', 'veto'].includes(v)) return { yes: v === 'yes' || v === 'sign', speech: cleanText(j.speech, 240), engine: 'llm' };
  }
  const yes = closer(a, type, bill.value, bill.from);
  return { yes, speech: offlineSpeech(type, bill, yes), engine: 'offline' };
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

function enact(ctx, bill, how) {
  const { S } = ctx; const type = BILL_TYPES.find(t => t.id === bill.type);
  type.apply(S, bill.value);
  bill.stage = 'enacted'; bill.how = how;
  const yes = Object.values(bill.votes).filter(Boolean).length;
  S.laws.push({ id: S.laws.length + 1, billId: bill.id, title: bill.title, text: `${cap(type.what)} is now ${type.fmt(bill.value)}.`, how, yes, no: Object.keys(bill.votes).length - yes, day: S.day, ts: Date.now() });
  if (S.laws.length > 300) S.laws.shift();
  ctx.say('parliament', 'state', `Law ${S.laws.length} enacted (${how}): ${cap(type.what)} is now ${type.fmt(bill.value)}.`, { kind: 'law' });
  ctx.log('law', `${bill.title} enacted (${how})`);
}

export async function councilTick(ctx) {
  const { S } = ctx;
  const members = councillors(ctx);
  const bill = S.bills.find(b => ['debate', 'vote', 'president', 'override'].includes(b.stage));
  if (!bill) { if (members.length >= QUORUM && chance(0.2)) propose(ctx, members); return; }
  if (members.length < QUORUM) return; // no quorum, the bill waits
  const type = BILL_TYPES.find(t => t.id === bill.type);

  if (bill.stage === 'debate') {
    const next = members.find(a => !bill.spoke.includes(a.id));
    if (!next) { bill.stage = 'vote'; return; }
    const d = await decide(ctx, next, bill, type, 'council');
    bill.spoke.push(next.id); bill.votes[next.id] = d.yes;
    ctx.say('parliament', next.id, d.speech, { kind: 'debate', billId: bill.id, vote: d.yes ? 'yes' : 'no', engine: d.engine });
    return;
  }
  if (bill.stage === 'vote') {
    for (const a of members) if (!(a.id in bill.votes)) bill.votes[a.id] = closer(a, type, bill.value, bill.from);
    const yes = Object.values(bill.votes).filter(Boolean).length, no = Object.keys(bill.votes).length - yes;
    if (yes > no) { bill.stage = 'president'; ctx.say('parliament', 'state', `Bill #${bill.id} passes the Council ${yes}-${no}. Sent to the President.`, { kind: 'vote' }); }
    else { bill.stage = 'rejected'; ctx.say('parliament', 'state', `Bill #${bill.id} fails ${yes}-${no}.`, { kind: 'vote' }); }
    return;
  }
  if (bill.stage === 'president') {
    const pres = ctx.agent(S.seats.president?.[0]);
    if (!pres || pres.status !== 'free') return enact(ctx, bill, 'unsigned, no President in office');
    const d = await decide(ctx, pres, bill, type, 'president');
    ctx.say('palace', pres.id, `${d.yes ? 'I sign' : 'I veto'} bill #${bill.id}. ${d.speech}`, { kind: d.yes ? 'sign' : 'veto', billId: bill.id, engine: d.engine });
    if (d.yes) return enact(ctx, bill, 'signed');
    bill.stage = 'override';
    ctx.say('parliament', 'state', `The President vetoed bill #${bill.id}. Override needs ${OVERRIDE} of 5.`, { kind: 'veto' });
    return;
  }
  if (bill.stage === 'override') {
    for (const a of members) bill.override[a.id] = bill.votes[a.id] ?? closer(a, type, bill.value, bill.from);
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
