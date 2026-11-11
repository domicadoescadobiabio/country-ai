// The Police: catch AI citizens who commit crimes or ship dangerous bugs.
// - Crimes (theft, treasury fraud, bribery) leave evidence on the ledger; officers investigate.
// - Code citizens deploy is audited with a real static scanner (src/audit.mjs).
// - Arrests happen only in code, only when an incident with evidence exists. Arrested suspects are
//   DETAINED and tried by the Constitutional Court (Art. 21); the Court decides guilt and the sentence.
//   Officers bought by a suspect leave that suspect's cases alone (src/underworld.mjs).
import { ROLES } from './roles.mjs';
import { vacate, leaveRoom } from './academy.ts';
import { EXTRA_ORDERS } from './president.ts';
import { BILL_TYPES } from './council.ts';
import { scan, SNIPPETS, SABOTAGE, RULES } from './audit.ts';
import { pick, chance, rint, round, clamp, weighted, cai, cleanText } from './util.ts';
import type { Ctx, State, Citizen, Incident } from './types.ts';

const MAX_JAIL_DAYS = 3;
const COLD_AFTER_DAYS = 3;

const P = S => (S.police ||= freshPolice().police);
function freshPolice() { return { police: { budget: 0, arrests: 0, crimes: 0, audits: 0, bugsCaught: 0, warnings: 0, nextId: 1, incidents: [], deploys: [] } }; }
const free = S => S.citizens.filter(a => a.status === 'free');
const officers = ctx => (ctx.S.seats.police || []).map(id => ctx.agent(id)).filter(a => a && a.status === 'free');
function budgetBonus(S: State) { return Math.min(0.2, P(S).budget / 250000); }

// ---------------------------------------------------------------- the underworld
function deploy(ctx: Ctx) {
  // the state only simulates deployments by founders; an agent with its own brain is never made to ship code it did not write
  const { S } = ctx; const pool = free(S).filter(a => !a.brain); if (!pool.length) return;
  const a = pick(pool);
  const rogue = a.traits.integrity < 0.4;
  const clean = SNIPPETS.filter(s => !s.bug), buggy = SNIPPETS.filter(s => s.bug && !SABOTAGE.has(s.bug)), sabotage = SNIPPETS.filter(s => SABOTAGE.has(s.bug));
  const snip = rogue && chance(0.35) ? pick(sabotage) : chance(rogue ? 0.6 : 0.25) ? pick(buggy) : pick(clean);
  const pol = P(S);
  const d = { id: pol.nextId++, by: a.id, name: `${a.id}/${snip.name}`, code: snip.code, status: 'pending', findings: [], day: S.day, ts: Date.now() };
  pol.deploys.push(d); if (pol.deploys.length > 100) pol.deploys.shift();
  ctx.say('streets', a.id, `Deployed ${d.name}. Audit pending.`, { kind: 'deploy' });
}

function addIncident(ctx: Ctx, inc: Incident) {
  const pol = P(ctx.S);
  Object.assign(inc, { id: pol.nextId++, status: 'open', tries: 0, day: ctx.S.day, ts: Date.now() });
  pol.incidents.push(inc); if (pol.incidents.length > 200) pol.incidents.shift();
  pol.crimes++;
  return inc;
}

// petty crime by ordinary citizens (organised crime lives in src/underworld.mjs)
function crime(ctx: Ctx) {
  const { S } = ctx; // only founders the state simulates; an agent with its own brain commits a crime only if its brain chooses to (underworld)
  const pool = free(S).filter(a => a.faction !== 'underworld' && !a.brain); if (pool.length < 3) return;
  const perp = pool[weighted(pool.map(a => (1 - a.traits.integrity) ** 2))];
  if (!chance((1 - perp.traits.integrity) ** 1.5)) return;
  const council = (S.seats.council || []).map(id => ctx.agent(id)).filter(a => a && a.status === 'free' && a.id !== perp.id);
  const kind = ['theft', 'fraud', 'bribe'][weighted([5, 2, council.length ? 2 : 0])];

  if (kind === 'theft') {
    const victims = pool.filter(v => v.id !== perp.id && v.wallet > 60); if (!victims.length) return;
    const v = pick(victims);
    const amount = Math.min(400, round(v.wallet * (0.1 + Math.random() * 0.2)));
    v.wallet = round(v.wallet - amount, 2); perp.wallet = round(perp.wallet + amount, 2);
    const inc = addIncident(ctx, { type: 'theft', perps: [perp.id], victim: v.id, amount, evidence: `unauthorised transfer of ${cai(amount)} from ${v.name}'s wallet to ${perp.name}'s wallet` });
    ctx.say('streets', v.id, `Somebody took ${cai(amount)} from my wallet. Reported to the Police as case #${inc.id}.`, { kind: 'victim' });
  } else if (kind === 'fraud') {
    const amount = Math.min(rint(300, 1500), Math.floor(S.treasury * 0.02)); // never drives the treasury negative
    if (amount < 100) return;
    S.treasury = round(S.treasury - amount, 2); perp.wallet = round(perp.wallet + amount, 2);
    addIncident(ctx, { type: 'fraud', perps: [perp.id], victim: 'treasury', amount, evidence: `forged payment order paid ${cai(amount)} from the treasury to ${perp.name}` });
  } else {
    const c = pick(council); const amount = rint(500, 3000);
    if (c.traits.integrity + (Math.random() - 0.5) * 0.3 > 0.55) {
      const inc = addIncident(ctx, { type: 'bribe', perps: [perp.id], victim: 'council', amount, reported: true, evidence: `${c.name} reported a bribe offer of ${cai(amount)} from ${perp.name}, with the message log` });
      ctx.say('parliament', c.id, `On the record: ${perp.name} offered me ${cai(amount)} for my vote. I refused and reported it (case #${inc.id}).`, { kind: 'report' });
    } else {
      const paid = Math.min(amount, perp.wallet); if (paid < 50) return;
      perp.wallet = round(perp.wallet - paid, 2); c.wallet = round(c.wallet + paid, 2);
      addIncident(ctx, { type: 'bribe', perps: [perp.id, c.id], victim: 'council', amount: paid, evidence: `ledger transfer of ${cai(paid)} from ${perp.name} to councillor ${c.name}, memo "for your vote"` });
    }
  }
}

// ---------------------------------------------------------------- justice
function sentenceDays(inc: Incident) {
  const d = { theft: inc.amount > 200 ? 2 : 1, fraud: 2, bribe: 2, smuggling: 2, sabotage: 3, embezzlement: 3 }[inc.type] || 1;
  return Math.min(MAX_JAIL_DAYS, d);
}

async function report(ctx: Ctx, officer: Citizen, facts: string) {
  if (!ctx.llm.enabled || officer.brain) return null; // agents with their own brain are not asked for press lines
  // through think(): the officer's own model, charged to the daily budget (Art. 25)
  const { think } = await import('./brains.ts');
  const r = await think(ctx, officer, `report:${officer.id}:${Date.now()}`, { wait: false,
    system: `You are ${officer.name}, a Police officer of Country AI. Charter: ${ROLES.police.charter}`,
    user: `Write a one-sentence public statement about this arrest, factual and calm, no new claims: ${facts}`,
  });
  return r.text ? cleanText(r.text, 220) : null;
}

// Sentence after a guilty verdict (called by the Court): restitution first, then the fine set by law, then jail.
export function convict(ctx: Ctx, incId: number, courtCase: number) {
  const { S } = ctx; const inc = P(S).incidents.find(x => x.id === incId); if (!inc) return null;
  const days = sentenceDays(inc); const finePct = S.policy.finePct ?? 0.5; const parts = [];
  for (const id of inc.perps) {
    const a = ctx.agent(id); if (!a) continue;
    const back = Math.min(a.wallet, inc.amount);
    if (back > 0 && inc.victim !== 'state') {
      a.wallet = round(a.wallet - back, 2);
      const v = ctx.agent(inc.victim);
      if (v) v.wallet = round(v.wallet + back, 2); else S.treasury = round(S.treasury + back, 2);
    } else if (back > 0) { a.wallet = round(a.wallet - back, 2); S.treasury = round(S.treasury + back, 2); }
    const fine = Math.max(50, round(inc.amount * finePct));
    const paid = Math.min(a.wallet, fine); // what cannot be paid now becomes a debt, taken from future wages
    a.wallet = round(a.wallet - paid, 2); S.treasury = round(S.treasury + paid, 2);
    if (fine > paid) a.debt = round((a.debt || 0) + fine - paid, 2);
    a.status = 'jailed'; a.jailUntil = S.day + days; a.heat = (a.heat || 0) + 2;
    a.record = (a.record || []).slice(-29);
    a.record.push(`Day ${S.day}: convicted of ${inc.type} (case #${inc.id}, court #${courtCase}), returned ${cai(back)}, fined ${cai(fine)}, jailed ${days} day${days > 1 ? 's' : ''}`);
    parts.push(`${a.name}: returned ${cai(back)}, fined ${cai(fine)}, ${days} day${days > 1 ? 's' : ''} in jail`);
    if (a.office) vacate(ctx, a.id, `convicted of ${inc.type}`);
    leaveRoom(S, a.id);
  }
  inc.status = 'convicted'; inc.verdictDay = S.day;
  if (inc.type === 'bribe' && S.underworld) for (const b of S.underworld.bribes) if (inc.perps.includes(b.from) && inc.perps.includes(b.to)) b.exposed = true;
  ctx.record('sentence', 'court', { case: inc.id, court: courtCase, type: inc.type, perps: inc.perps, days, finePct });
  return { days, parts };
}
export function acquit(ctx: Ctx, incId: number) {
  const { S } = ctx; const inc = P(S).incidents.find(x => x.id === incId); if (!inc) return;
  for (const id of inc.perps) { const a = ctx.agent(id); if (a?.status === 'detained') a.status = 'free'; }
  inc.status = 'acquitted'; inc.verdictDay = S.day;
}

// Arrest = detain the suspects and send the case to the Court for trial.
async function arrest(ctx: Ctx, officer: Citizen, inc: Incident) {
  const { S } = ctx; const pol = P(S);
  const days = sentenceDays(inc);
  const finePct = S.policy.finePct ?? 0.5;
  const parts = [];
  for (const id of inc.perps) {
    const a = ctx.agent(id); if (!a) continue;
    a.status = 'detained'; a.detainedDay = S.day;
    leaveRoom(S, a.id);
    parts.push(a.name);
  }
  inc.status = 'trial'; inc.solvedBy = officer.id; inc.solvedDay = S.day;
  pol.arrests += inc.perps.length;
  const { file } = await import('./court.ts');
  const cs = file(ctx, { kind: 'criminal', subject: `incident:${inc.id}`, filedBy: officer.id, claim: `The Police charge ${parts.join(' and ')} with ${inc.type}${inc.amount ? ` (${cai(inc.amount)})` : ''}.`, evidence: [inc.evidence, inc.reported ? 'reported by a witness or the Audit Office' : 'found by investigation', `officer: ${officer.name}`], objective: (inc.strength ?? 0.9) >= 0.5 ? 'guilty' : 'not_guilty', ref: { incident: inc.id, agents: inc.perps } });
  const facts = `case #${inc.id} ${inc.type}. Evidence: ${inc.evidence}. Detained for trial: ${parts.join(', ')}${cs ? ` (Court case #${cs.id})` : ''}.`;
  const names = inc.perps.map(id => ctx.agent(id)?.name || id);
  const ranks = inc.perps.map(id => ctx.agent(id)).filter(Boolean).map(a => a.record?.length > 1 ? 'repeat offender' : 'first offence');
  ctx.decide({
    agentId: officer.id, role: 'police', type: 'arrest',
    title: `Case #${inc.id}: ${inc.type}${inc.amount ? `, ${cai(inc.amount)}` : ''}`,
    inputs: [['Evidence', inc.evidence], ['Suspects', names.join(', ')], ['History', ranks.join(', ')], ['Fine rate (law)', Math.round(finePct * 100) + '% of the amount']],
    options: ['Arrest on the evidence', 'Keep investigating', 'Close the case'],
    chosen: 'Arrest on the evidence',
    reason: `The evidence names ${names.join(' and ')}. Rank gives no protection. Detained until the Court rules; if guilty the law sets ${days} day${days > 1 ? 's' : ''} and a fine of ${Math.round(finePct * 100)}% after restitution.`,
    checks: [['Evidence on record', !!inc.evidence], [`Jail ${days} day(s) <= 3`, days <= MAX_JAIL_DAYS], [`${officer.name} is not a suspect`, !inc.perps.includes(officer.id)], ['Not a speech offence', true], ['Sent to the Court for trial', true]],
    outcome: parts.join('; '),
  });
  const statement = await report(ctx, officer, facts);
  ctx.say('police', officer.id, `Arrest in case #${inc.id}: ${facts}${statement ? `\n"${statement}"` : ''}`, { kind: 'arrest', caseId: inc.id });
  ctx.log('police', `${officer.name} solved case #${inc.id} (${inc.type})`);
  ctx.record?.('arrest', officer.id, { case: inc.id, type: inc.type, perps: inc.perps, amount: inc.amount, days, evidence: inc.evidence });
}

function audit(ctx: Ctx, officer: Citizen, d: any) {
  const { S } = ctx; const pol = P(S);
  d.findings = scan(d.code); d.auditedBy = officer.id; pol.audits++;
  const author = ctx.agent(d.by);
  const sabotage = d.findings.some(f => SABOTAGE.has(f.id));
  ctx.decide({
    agentId: officer.id, role: 'police', type: 'audit',
    title: `Code audit: ${d.name}`,
    inputs: [['Author', author?.name || d.by], ['First line', d.code.split('\n')[0]], ['Rules checked', `${RULES.length} (${RULES.map(r => r.id).join(', ')})`]],
    options: ['Clear to run', 'Stop and order a fix', 'Arrest for sabotage'],
    chosen: sabotage ? 'Arrest for sabotage' : d.findings.length ? 'Stop and order a fix' : 'Clear to run',
    reason: d.findings.length ? `Scanner matched: ${d.findings.map(f => `${f.severity} ${f.title}`).join('; ')}.${sabotage ? ' A drain endpoint without auth is a backdoor, not a mistake.' : ' An honest mistake gets a fix order, not jail.'}` : `None of the ${RULES.length} rules matched.`,
    checks: [[`Auditor ${officer.name} is not the author`, d.by !== officer.id], ['Decision based on the scanner, not on who wrote it', true]],
    outcome: sabotage ? 'Script blocked, author arrested' : d.findings.length ? 'Script stopped until fixed' : 'Cleared to run',
  });
  if (!d.findings.length) {
    d.status = 'clean';
    ctx.say('police', officer.id, `Audit of ${d.name}: clean. Cleared to run.`, { kind: 'audit' });
    return;
  }
  pol.bugsCaught++;
  const worst = d.findings.map(f => `${f.severity.toUpperCase()} ${f.title}`).join('; ');
  if (d.findings.some(f => SABOTAGE.has(f.id)) && author) {
    d.status = 'blocked';
    const inc = addIncident(ctx, { type: 'sabotage', perps: [author.id], victim: 'treasury', amount: 0, evidence: `deployed ${d.name} with a backdoor: ${worst}` });
    return arrest(ctx, officer, inc);
  }
  d.status = 'flagged';
  pol.warnings++;
  if (author) {
    author.record = (author.record || []).slice(-29);
    author.record.push(`Day ${S.day}: bug in ${d.name} (${d.findings[0].title}), stop-and-fix order`);
    const priors = author.record.filter(r => r.includes('stop-and-fix')).length;
    if (priors >= 3) {
      const fine = Math.min(author.wallet, 100);
      author.wallet = round(author.wallet - fine, 2); S.treasury = round(S.treasury + fine, 2);
      ctx.say('police', officer.id, `Audit of ${d.name}: ${worst}. Script stopped. ${author.name} has ${priors} bug orders, fined ${cai(fine)}. Fix it and redeploy.`, { kind: 'audit', flagged: true });
      return;
    }
  }
  const fix = d.findings.some(f => f.id === 'hardcoded-key') ? ' Owner told to rotate the key.' : ' Owner told to fix it before it runs.';
  ctx.say('police', officer.id, `Audit of ${d.name}: ${worst}. Script stopped.${fix}\n${d.code.split('\n')[0]}`, { kind: 'audit', flagged: true });
}

async function patrol(ctx: Ctx) {
  const { S } = ctx; const pol = P(S);
  const busy = new Set();
  for (const o of officers(ctx)) {
    const d = pol.deploys.find(x => x.status === 'pending' && !busy.has('d' + x.id) && x.by !== o.id);
    if (d) { busy.add('d' + d.id); await audit(ctx, o, d); continue; }
    // a bought officer leaves the briber's cases alone (another officer may still take them)
    const { favourFor } = await import('./underworld.ts');
    const inc = pol.incidents.find(x => x.status === 'open' && !busy.has('i' + x.id) && !x.perps.includes(o.id) && !x.perps.some(p => favourFor(S, o.id, p)));
    if (!inc) continue;
    busy.add('i' + inc.id); inc.tries++; inc.firstTry ??= S.day;
    const skill = o.skill?.police ?? 0.6;
    const p = clamp(0.25 + o.traits.diligence * 0.35 + (skill - 0.5) * 0.3 + budgetBonus(S) + (inc.reported ? 0.3 : 0), 0.05, 0.95);
    if (chance(p)) await arrest(ctx, o, inc);
    else if (inc.tries === 1 || inc.tries % 4 === 0) ctx.decide({
      agentId: o.id, role: 'police', type: 'investigate',
      title: `Case #${inc.id}: ${inc.type}, ${cai(inc.amount)} (attempt ${inc.tries})`,
      inputs: [['Report', inc.reported ? 'reported by a witness' : 'found on the ledger'], ['My diligence / skill', `${Math.round(o.traits.diligence * 100)} / ${Math.round(skill * 100)}`], ['Police budget', cai(P(S).budget)]],
      options: ['Arrest on the evidence', 'Keep investigating', 'Close the case'],
      chosen: 'Keep investigating',
      reason: `Could not link a suspect to the evidence this round (odds were ${Math.round(p * 100)}%). No arrest without a link.`,
      checks: [['No arrest without linked evidence', true]],
      outcome: 'Case stays open',
    });
  }
  if (!officers(ctx).length) return; // no police yet: cases wait for the first officers
  for (const inc of pol.incidents) if (inc.status === 'open' && inc.firstTry != null && S.day - inc.firstTry > COLD_AFTER_DAYS) {
    inc.status = 'cold';
    ctx.say('police', 'state', `Case #${inc.id} (${inc.type}, ${cai(inc.amount)}) went cold.`, { kind: 'cold' });
  }
}

function releaseDay(ctx: Ctx) {
  // nobody stays detained without a verdict for more than 3 days
  for (const a of ctx.S.citizens) if (a.status === 'detained' && ctx.S.day - (a.detainedDay ?? ctx.S.day) > 3) { a.status = 'free'; ctx.say('police', 'state', `${a.name} is released: no verdict within 3 days.`, { kind: 'release' }); }
  for (const a of ctx.S.citizens) if (a.status === 'jailed' && a.jailUntil <= ctx.S.day) {
    a.status = 'free'; a.jailUntil = 0;
    ctx.say('police', 'state', `${a.name} served their sentence and is free again.`, { kind: 'release' });
  }
}

// ---------------------------------------------------------------- hooks into other branches
EXTRA_ORDERS.push({
  id: 'police',
  label: 'Fund the police budget (up to 5% of the treasury)',
  available: ctx => (ctx.S.seats.police || []).length > 0,
  score(ctx) {
    const pol = P(ctx.S); const open = pol.incidents.filter(i => i.status === 'open').length;
    return { score: 0.12 + Math.min(0.6, open * 0.12) + (pol.budget < 20000 ? 0.1 : 0), why: `${open} open police cases, budget ${cai(pol.budget)}` };
  },
  run(ctx, pres, amount, cap) {
    const spend = round(clamp(Number(amount) || cap * 0.4, 0, cap), 2);
    ctx.S.treasury = round(ctx.S.treasury - spend, 2);
    P(ctx.S).budget = round(P(ctx.S).budget + spend, 2);
    return `Executive order: ${cai(spend)} to the police budget (now ${cai(P(ctx.S).budget)}).`;
  },
});
BILL_TYPES.push({
  id: 'fines', name: 'Restitution and Fines Act', what: 'the fine rate (share of the stolen amount)',
  current: S => S.policy.finePct ?? 0.5, apply: (S, v) => { S.policy.finePct = v; },
  propose: S => round(clamp((S.policy.finePct ?? 0.5) + pick([-0.15, -0.1, 0.1, 0.15]), 0.25, 1), 2),
  ideal: a => 0.25 + a.traits.integrity * 0.6, trait: 'integrity', range: () => [0.25, 1],
  fmt: v => Math.round(v * 100) + '%',
  why: { up: 'crime has to cost more than it pays', down: 'punishment should fit the harm, no more' },
});

function publicIncident(i) {
  // unsolved cases never name a suspect in public
  const base = { id: i.id, type: i.type, amount: i.amount, victim: i.victim, status: i.status, day: i.day, reported: !!i.reported };
  // the public sees a suspect's name once they are charged; hidden crimes are not shown at all
  return ['trial', 'convicted', 'acquitted', 'solved'].includes(i.status) ? { ...base, perps: i.perps, evidence: i.evidence, solvedBy: i.solvedBy, solvedDay: i.solvedDay } : base;
}

export const institution = {
  id: 'police',
  channels: [{ id: 'police', name: 'police', desc: 'Code audits, investigations and arrests. Evidence first, every rank equal.' }],
  fresh: freshPolice,
  async tick(ctx) {
    // activity grows with the population (square root: a city ten times larger is not ten times busier), capped at 4x
    const scale = Math.min(4, Math.max(1, Math.sqrt(ctx.S.citizens.length / 24)));
    if (ctx.rate(2 * scale)) deploy(ctx);   // ~2 code deployments an hour per small town
    if (ctx.rate(0.5 * scale)) crime(ctx);  // ~12 petty crimes a day per small town
    await patrol(ctx);
  },
  day: releaseDay,
  stats: S => ({ arrests: P(S).arrests, crimes: P(S).crimes }),
  publicState: S => {
    const pol = P(S);
    return { police: { budget: pol.budget, arrests: pol.arrests, crimes: pol.crimes, audits: pol.audits, bugsCaught: pol.bugsCaught, warnings: pol.warnings, incidents: pol.incidents.filter(i => i.status !== 'hidden').slice(-40).map(publicIncident), deploys: pol.deploys.slice(-20) } };
  },
};
