// Decision log: every choice an official makes is recorded with what they looked at,
import type { Ctx, DecisionInput } from './types.ts';
// which options they had, what they picked, why, and which constitutional checks it passed.
// Shown live in #decisions and on each official's profile.

const STAT_KEY = { order: 'orders', vote: 'votes', sign: 'signs', veto: 'vetoes', arrest: 'arrests', audit: 'audits', block: 'blocks', admit: 'admits', investigate: 'investigations' };

export function freshDecisions() { return { decisions: [], decisionSeq: 0 }; }

// rec: { agentId, role, type, title, inputs: [[label, value]], options: [str], chosen, reason, checks: [[rule, ok]], outcome, engine }
export function recordDecision(ctx: Ctx, rec: DecisionInput) {
  const { S } = ctx;
  const d = {
    id: ++S.decisionSeq, day: S.day, ts: Date.now(),
    agentId: rec.agentId, role: rec.role, type: rec.type, title: String(rec.title || '').slice(0, 200),
    inputs: (rec.inputs || []).slice(0, 10).map(([k, v]) => [String(k).slice(0, 60), String(v).slice(0, 200)]),
    options: (rec.options || []).slice(0, 8).map(o => String(o).slice(0, 160)),
    chosen: String(rec.chosen ?? '').slice(0, 200),
    reason: String(rec.reason || '').slice(0, 400),
    checks: (rec.checks || []).map(([r, ok]) => [String(r).slice(0, 120), !!ok]),
    outcome: String(rec.outcome || '').slice(0, 300),
    engine: rec.engine || 'offline',
  };
  S.decisions.push(d);
  if (S.decisions.length > 400) S.decisions.splice(0, S.decisions.length - 400);
  const a = ctx.agent(d.agentId);
  if (a) {
    const k = STAT_KEY[d.type] || d.type;
    (a.stats ||= {})[k] = (a.stats[k] || 0) + 1;
  }
  ctx.emit('decision', d);
  return d;
}

export const pctOf = (x, y) => (y ? Math.round((x / y) * 100) : 0) + '%';
