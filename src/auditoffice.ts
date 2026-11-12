// The Audit Office (Art. 17): deterministic code, independent of the Election Commission.
//   1. Recount every election from its anonymised ballots before certification (IRV/STV again,
//      from scratch). A mismatch goes to the Court and blocks certification until it rules.
//   2. Daily audit of the public accounts: no negative balances, executive orders within 5%,
//      city spending within budget, failed constitutional checks of the day, money supply drift.
import crypto from 'node:crypto';
import { irv, stv } from './elections.ts';
import { file, openCase } from './court.ts';
import { canon } from './db.ts';
import { round, cai } from './util.ts';
import type { Ctx, State, Election } from './types.ts';

const A = S => { S.audit ||= {}; S.audit.reports ||= []; S.audit.recounts ||= 0; S.audit.mismatches ||= 0; return S.audit; };

// Pure function (also used by tests): recount an election from its anonymised ballots.
export function recount(e: Election) {
  const anon = e.result?.anonymisedBallots || [];
  const digest = crypto.createHash('sha256').update(canon([...anon].sort())).digest('hex');
  // an empty ranking is stored as '' (not BLANK): it is a ballot that ranks nobody, exactly as the count saw it
  const ballots = anon.filter(b => b !== 'BLANK').map(b => (b ? b.split('>') : []));
  const ids = e.candidates.map(c => c.id);
  let winners;
  if (['recall', 'referendum', 'impeachment'].includes(e.kind)) {
    const yes = ballots.filter(b => b[0] === 'yes').length, no = ballots.filter(b => b[0] === 'no').length;
    winners = [yes > no ? 'yes' : 'no'];
  } else if (e.kind === 'confirm') {
    winners = ids.filter(id => ballots.filter(b => b.includes(id)).length * 2 > ballots.length);
  } else if (e.seats === 1) {
    winners = e.result?.winners?.length === 0 && e.office === 'president' ? [] : [irv(ballots, ids).winner].filter(Boolean);
  } else winners = stv(ballots, ids, e.seats).elected;
  const official = e.result?.winners || [];
  const ok = digest === e.result?.digest && JSON.stringify([...winners].sort()) === JSON.stringify([...official].sort());
  return { ok, winners, official, digestOk: digest === e.result?.digest, ballots: anon.length };
}

function recountPending(ctx: Ctx) {
  const { S } = ctx; const au = A(S);
  for (const e of (S.elections?.list || [])) {
    if (e.stage !== 'certify' || e.audit) continue;
    const r = recount(e);
    e.audit = { ok: r.ok, day: S.day, winners: r.winners };
    au.recounts++;
    ctx.record('audit_recount', 'audit_office', { election: e.id, ok: r.ok, recount: r.winners, official: r.official, ballots: r.ballots, digestOk: r.digestOk });
    if (r.ok) { ctx.say('election', 'state', `Audit Office recount of election #${e.id}: matches the official result (${r.ballots} ballots).`, { kind: 'pass' }); continue; }
    au.mismatches++;
    ctx.say('election', 'state', `Audit Office recount of election #${e.id} does NOT match. Certification is suspended and the case goes to the Court.`, { kind: 'fail' });
    if (!openCase(S, 'election', String(e.id))) file(ctx, { kind: 'election', subject: String(e.id), filedBy: 'audit_office', claim: `The recount of election #${e.id} does not match the official result.`, evidence: [`official winners: ${r.official.join(', ') || 'none'}`, `recount winners: ${r.winners.join(', ') || 'none'}`, `ballot digest ${r.digestOk ? 'matches' : 'DOES NOT match'}`], objective: 'annul', ref: { election: e.id } });
  }
}

function moneySupply(S: State) {
  return round(S.citizens.reduce((n, a) => n + a.wallet, 0) + S.treasury + Object.values(S.cities || {}).reduce((n, c) => n + (c.budget || 0), 0) + (S.police?.budget || 0), 2);
}

async function dailyAudit(ctx: Ctx) {
  const { S } = ctx; const au = A(S);
  const findings = [];
  const { auditUncover } = await import('./underworld.ts');
  for (const inc of auditUncover(ctx)) findings.push(`irregularity referred to the Police: ${inc.type}, ${cai(inc.amount)} (case #${inc.id})`);
  const neg = S.citizens.filter(a => a.wallet < -0.01);
  if (S.treasury < 0) findings.push(`treasury is negative (${cai(S.treasury)})`);
  if (neg.length) findings.push(`${neg.length} wallet(s) negative`);
  for (const [id, c] of Object.entries(S.cities || {})) if ((c.budget || 0) < -0.01) findings.push(`${id} city budget is negative`);
  const today = (S.decisions || []).filter(d => d.day === S.day - 1);
  const failed = today.filter(d => d.checks?.some(c => !c[1]));
  for (const d of failed) findings.push(`failed check in "${d.title}": ${d.checks.filter(c => !c[1]).map(c => c[0]).join('; ')}`);
  const supply = moneySupply(S);
  const drift = au.lastSupply != null ? round(supply - au.lastSupply, 2) : 0;
  au.lastSupply = supply;
  const report = { day: S.day - 1, findings, decisionsChecked: today.length, supply, drift, treasury: Math.round(S.treasury) };
  au.reports.push(report); if (au.reports.length > 60) au.reports.shift();
  ctx.record('audit_report', 'audit_office', report);
  ctx.decide({
    agentId: 'state', role: 'state', type: 'audit', title: `Daily audit of the public accounts, day ${report.day}`,
    inputs: [['Decisions checked', String(today.length)], ['Money supply', cai(supply)], ['Change since last audit', `${drift >= 0 ? '+' : ''}${cai(drift)} (wages and UBI create money; fines and tax move it)`]],
    options: ['Clean', 'Findings'], chosen: findings.length ? 'Findings' : 'Clean',
    reason: findings.length ? findings.join(' | ') : 'No negative balances, no failed constitutional checks yesterday.',
    checks: [['Treasury not negative', S.treasury >= 0], ['No negative wallets', !neg.length]],
    outcome: findings.length ? `${findings.length} finding(s) published` : 'Clean report',
  });
}

export const institution = {
  id: 'audit',
  channels: [],
  fresh: () => ({ audit: { reports: [], recounts: 0, mismatches: 0 } }),
  async tick(ctx) { if (ctx.S.constitutionVersion >= 4) recountPending(ctx); },
  async day(ctx) { if (ctx.S.constitutionVersion >= 4) await dailyAudit(ctx); },
  publicState: S => { const au = A(S); return { audit: { recounts: au.recounts, mismatches: au.mismatches, reports: au.reports.slice(-10) } }; },
};
