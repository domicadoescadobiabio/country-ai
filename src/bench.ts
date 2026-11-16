// The daily fixed exam (owner, 16 Nov): the same 325 multiple-choice questions (28 fields, frozen in db/bench.jsonl,
// a byte-for-byte copy of lora-lab/bench/bench-fixed.jsonl: {id, q, key, domain} per line) are put to the local brain
// once a republic day, in the quiet hours (from BENCH_HOUR, default 03:00 republic time), so the owner can see whether
// the brain (and its LoRA adapters) gets better day by day. Each question goes through think(..., paid: false) like a
// citizen's school question: lowest priority (behind exams, votes and daily life), the runner picks the field's adapter
// from the domain. Never a paid API: while the local brain is offline the run simply waits. BENCH_INFLIGHT questions are
// out at a time. A question the brain gave up on (queue full, too slow) is asked again later; a run that crosses midnight
// keeps the day it started. S.bench.history keeps the last 120 runs; each finished run is on the ledger ('bench').
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { think, localOnline, localStatus } from './brains.ts';
import { clamp } from './util.ts';
import type { Ctx, State } from './types.ts';

const envNum = (k: string, d: number, lo: number, hi: number) => { const v = Number(process.env[k]); return process.env[k] != null && process.env[k] !== '' && Number.isFinite(v) ? clamp(v, lo, hi) : d; };
export const BENCH_HOUR = envNum('BENCH_HOUR', 3, 0, 23);
export const BENCH_INFLIGHT = Math.round(envNum('BENCH_INFLIGHT', 8, 1, 64));
const KEEP = 120;
export const benchFile = () => process.env.BENCH_FILE || fileURLToPath(new URL('../db/bench.jsonl', import.meta.url));

// the questions, read once: only well-formed lines ({id, q, key A-D, domain}); null when the file is missing
let QUESTIONS: { id: string; q: string; key: string; domain: string }[] | null | undefined;
export function benchQuestions() {
  if (QUESTIONS !== undefined) return QUESTIONS;
  try {
    const out = [];
    for (const line of fs.readFileSync(benchFile(), 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      const x = JSON.parse(line);
      if (x && typeof x.id === 'string' && typeof x.q === 'string' && /^[A-D]$/.test(x.key) && typeof x.domain === 'string') out.push({ id: x.id, q: x.q, key: x.key, domain: x.domain });
    }
    QUESTIONS = out.length ? out : null;
  } catch { QUESTIONS = null; }
  return QUESTIONS;
}
export const _resetBench = (file?: string) => { QUESTIONS = undefined; if (file) process.env.BENCH_FILE = file; }; // tests

export function B(S: State) {
  const b = ((S as any).bench ||= {});
  b.history ||= []; b.run ??= null; b.lastDay ??= 0;
  return b;
}
// the republic's hour now (0-24), on the clock of the day (the anchor follows the local wall clock, see util.ts)
const hourNow = (S: State, dayMs: number) => ((((Date.now() - (S.foundedAt || Date.now())) % dayMs) + dayMs) % dayMs) / dayMs * 24;
// who sits the exam: nobody's own brain, no office, no wallet; only an id for the local queue
const EXAMINEE: any = { id: 'bench', name: 'Republic bench', office: null, status: 'free', brain: null, training: [], quals: {}, traits: {} };
const SYSTEM = 'You are taking a fixed multiple-choice test. Answer with the letter of the right option first.';

// one step (every tick of the republic): start the day's run in the quiet hours, hand out and collect answers
export async function benchTick(ctx: Ctx) {
  const { S } = ctx; const b = B(S); const Q = benchQuestions();
  if (!Q) { b.status = 'no questions file'; return null; }
  if (!b.run) {
    if (b.lastDay >= S.day) { b.status = 'done today'; return null; }
    if (hourNow(S, ctx.cfg?.dayMs || 86400000) < BENCH_HOUR) { b.status = 'waiting for the quiet hours'; return null; }
    if (!localOnline()) { b.status = 'waiting for the local brain'; return null; }
    b.run = { day: S.day, startedAt: Date.now(), next: 0, open: [], answers: {}, model: null };
  }
  const run = b.run;
  if (!localOnline()) { b.status = 'paused: the local brain is offline'; return null; }
  b.status = 'running';
  // collect what came back; a question the brain gave up on goes back to be asked again
  const still = [];
  for (const i of run.open) {
    const item = Q[i];
    const r: any = await think(ctx, EXAMINEE, `bench:${run.day}:${item.id}`, { system: SYSTEM, user: item.q, kind: 'bench', format: 'letter', paid: false, domain: item.domain });
    if (r?.pending) { still.push(i); continue; }
    if (!r?.text) { run.retry = [...(run.retry || []), i]; continue; }
    const m = String(r.text).match(/^\W*([A-D])\b/i);
    run.answers[item.id] = m ? m[1].toUpperCase() : '?';
    if (r.engine && !run.model) run.model = String(r.engine).replace(/^local:/, '').slice(0, 60);
  }
  run.open = still;
  // hand out more, up to BENCH_INFLIGHT at a time
  while (run.open.length < BENCH_INFLIGHT) {
    let i: number;
    if (run.next < Q.length) i = run.next++;
    else if (run.retry?.length) i = run.retry.shift();
    else break;
    const item = Q[i];
    const r: any = await think(ctx, EXAMINEE, `bench:${run.day}:${item.id}`, { system: SYSTEM, user: item.q, kind: 'bench', format: 'letter', paid: false, domain: item.domain });
    if (r?.pending) run.open.push(i);
    else if (r?.text) { const m = String(r.text).match(/^\W*([A-D])\b/i); run.answers[item.id] = m ? m[1].toUpperCase() : '?'; }
    else { (run.retry ||= []).push(i); break; } // the queue has no room now: try again next tick
  }
  if (Object.keys(run.answers).length < Q.length) return { asked: Object.keys(run.answers).length, total: Q.length };
  // the run is complete: score it
  const byDomain: Record<string, [number, number]> = {}; let right = 0;
  for (const item of Q) { const ok = run.answers[item.id] === item.key; if (ok) right++; const d = (byDomain[item.domain] ||= [0, 0]); if (ok) d[0]++; d[1]++; }
  const rn: any = localStatus().runner || {};
  const entry = { day: run.day, date: new Date().toISOString().slice(0, 10), score: Math.round(right / Q.length * 1000) / 10, right, total: Q.length, byDomain,
    adapters: Array.isArray(rn.adapters) ? rn.adapters.slice(0, 32) : rn.adapter ? [rn.adapter] : [], model: run.model || localStatus().model || null, minutes: Math.round((Date.now() - run.startedAt) / 6000) / 10 };
  b.history.push(entry); if (b.history.length > KEEP) b.history.splice(0, b.history.length - KEEP);
  b.lastDay = run.day; b.run = null; b.status = 'done today';
  ctx.record?.('bench', 'state', { day: entry.day, score: entry.score, right, total: entry.total, model: entry.model, adapters: entry.adapters });
  return entry;
}
// GET /api/bench and the live stream
export function benchView(S: State, n = 120) {
  const b = B(S); const Q = benchQuestions();
  const history = b.history.slice(-clamp(Math.round(Number(n) || KEEP), 1, KEEP));
  return { latest: history.at(-1) || null, history, status: b.status || 'idle', questions: Q ? Q.length : 0,
    running: b.run ? { day: b.run.day, answered: Object.keys(b.run.answers).length, total: Q ? Q.length : 0 } : null };
}
export function benchSummary(S: State) {
  const v = benchView(S, 1);
  return { latest: v.latest ? { day: v.latest.day, score: v.latest.score, total: v.latest.total } : null, status: v.status, running: v.running };
}
