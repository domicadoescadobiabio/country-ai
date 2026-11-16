// Smoke checks for the daily fixed exam (src/bench.ts): the frozen question file (325 questions, 28 fields, the same
// bytes as lora-lab's bench-fixed.jsonl), and the run itself with a stand-in runner: it waits for the quiet hours and
// for the local brain, never calls a paid API, asks at most BENCH_INFLIGHT questions at a time at the lowest priority
// with the field as the adapter, scores the answers, keeps the history (120 days) and writes it on the ledger.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name} ${detail}`); } };

// --- the frozen questions in the repository
const FROZEN = path.join(ROOT, 'db', 'bench.jsonl'), SOURCE = path.resolve(ROOT, '..', 'lora-lab', 'bench', 'bench-fixed.jsonl');
let frozen = null; try { frozen = fs.readFileSync(FROZEN, 'utf8'); } catch { frozen = null; }
const items = frozen ? frozen.split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l)) : [];
check('db/bench.jsonl holds the 325 frozen questions of 28 fields, each {id, q, key A-D, domain}, ids unique', items.length === 325 && new Set(items.map(x => x.id)).size === 325 && new Set(items.map(x => x.domain)).size === 28
  && items.every(x => typeof x.q === 'string' && x.q.length > 10 && /^[A-D]$/.test(x.key) && typeof x.domain === 'string'), frozen ? JSON.stringify({ n: items.length, domains: new Set(items.map(x => x.domain)).size }) : 'db/bench.jsonl is missing (copy lora-lab/bench/bench-fixed.jsonl there unchanged)');
if (fs.existsSync(SOURCE)) check('db/bench.jsonl is byte for byte lora-lab/bench/bench-fixed.jsonl (nothing changed)', frozen != null && fs.readFileSync(SOURCE).equals(fs.readFileSync(FROZEN)));

// --- the run, on a small file of its own (30 questions, 3 fields) and a stand-in runner
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'country-bench-'));
const FIX = path.join(DIR, 'bench.jsonl');
const QS = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, q: `Question ${i}: pick the right letter. A) a B) b C) c D) d`, key: 'ABCD'[i % 4], domain: ['math', 'law', 'history'][i % 3] }));
fs.writeFileSync(FIX, QS.map(x => JSON.stringify(x)).join('\n') + '\n');
process.env.BENCH_FILE = FIX; process.env.BENCH_INFLIGHT = '8'; process.env.BENCH_HOUR = '3';
const brains = await import('../src/brains.ts');
const bench = await import('../src/bench.ts');

const DAY = 86400000;
let paid = 0; const ledger = [];
const S = { day: 1, foundedAt: Date.now() - 4 * 3600000, citizens: [], seats: {}, academy: { rooms: [] }, elections: { list: [] } }; // 04:00 republic time
const ctx = { S, cfg: { dayMs: DAY }, llm: { enabled: true, askDetailed: async () => { paid++; return { text: 'A', cost: 0.01 }; }, json: () => null }, record: (kind, by, data) => ledger.push({ kind, by, data }) };
const RUNNER = { version: 4, backend: 'llamacpp', adapter: 'general', loraScale: 1, adapters: ['general', 'math', 'law'], byAdapter: { general: 1 } };
const byQid = id => QS.find(x => `bench:${S.day}:${x.id}` === id || id.endsWith(`:${x.id}`));

brains._resetLocal(); brains._setLocalOffline();
await bench.benchTick(ctx);
check('offline: the run waits for the local brain (nothing queued, no paid call)', bench.benchView(S).status === 'waiting for the local brain' && !S.bench.run && brains.localStatus().queued === 0 && paid === 0, JSON.stringify(bench.benchView(S)));
S.foundedAt = Date.now() - 1 * 3600000; brains.workerPull(0, 'qwen3:8b', RUNNER);
await bench.benchTick(ctx);
check('before the quiet hours (01:00 < 03:00) the run does not start', bench.benchView(S).status === 'waiting for the quiet hours' && !S.bench.run);
S.foundedAt = Date.now() - 4 * 3600000;

// the runner answers: right on even questions, wrong on odd ones
let maxOut = 0, domainsSeen = new Set(), rounds = 0, lowPriority = true;
const answer = jobs => { for (const j of jobs) { const q = byQid(j.id); if (!q) continue; domainsSeen.add(j.domain); const i = QS.indexOf(q); brains.workerAnswer(j.id, `${i % 2 === 0 ? q.key : q.key === 'A' ? 'B' : 'A'} - because`, 'qwen3:8b+' + (j.domain || 'general')); } };
while (!S.bench.history.length && rounds++ < 40) {
  await bench.benchTick(ctx);
  const st = brains.localStatus(); maxOut = Math.max(maxOut, st.queued); if (st.queued !== st.queuedTrain) lowPriority = false;
  answer(brains.workerPull(16, 'qwen3:8b', RUNNER));
}
const h = S.bench.history[0];
check('online in the quiet hours: all 30 questions are asked and scored (15 right = 50%), per field', h && h.total === 30 && h.right === 15 && h.score === 50 && Object.values(h.byDomain).reduce((n, d) => n + d[1], 0) === 30 && h.byDomain.math[1] === 10, JSON.stringify(h));
check('at most BENCH_INFLIGHT (8) questions out at a time, all at the lowest priority (behind exams, votes and daily life)', maxOut > 0 && maxOut <= 8 && lowPriority, JSON.stringify({ maxOut, lowPriority }));
check('each question carries its field, so the runner picks that field\'s adapter', ['math', 'law', 'history'].every(d => domainsSeen.has(d)), JSON.stringify([...domainsSeen]));
check('the run keeps the runner\'s adapters and model, and is on the ledger (bench)', h && h.adapters.join() === 'general,math,law' && /qwen3/.test(h.model) && ledger.some(l => l.kind === 'bench' && l.data.score === 50), JSON.stringify({ adapters: h?.adapters, model: h?.model, ledger: ledger.map(l => l.kind) }));
check('never a paid API: paid calls 0', paid === 0, String(paid));

await bench.benchTick(ctx);
check('once a republic day: the same day does not start again', S.bench.history.length === 1 && !S.bench.run && bench.benchView(S).status === 'done today');

// the next day: the brain goes offline in the middle; the run waits and goes on where it was
S.day = 2; await bench.benchTick(ctx); answer(brains.workerPull(4, 'qwen3:8b', RUNNER)); await bench.benchTick(ctx);
const mid = Object.keys(S.bench.run?.answers || {}).length;
brains._setLocalOffline(); await bench.benchTick(ctx);
check('offline in the middle of a run: it pauses and keeps what was answered', S.bench.run && bench.benchView(S).status === 'paused: the local brain is offline' && Object.keys(S.bench.run.answers).length === mid && mid > 0, JSON.stringify({ mid, status: bench.benchView(S).status }));
S.day = 3; rounds = 0; // past midnight: the run keeps the day it started
while (S.bench.history.length < 2 && rounds++ < 40) { answer(brains.workerPull(16, 'qwen3:8b', RUNNER)); await bench.benchTick(ctx); answer(brains.workerPull(16, 'qwen3:8b', RUNNER)); }
check('back online it finishes, keeping the day it started (2)', S.bench.history.length === 2 && S.bench.history[1].day === 2 && paid === 0, JSON.stringify(S.bench.history.map(x => x.day)));

// history: at most 120 days; the public view
S.bench.history = Array.from({ length: 125 }, (_, i) => ({ ...h, day: i + 1 }));
const v = bench.benchView(S);
check('GET /api/bench view: latest, history (at most 120), status, number of questions, the run in progress', v.latest && v.history.length === 120 && v.latest.day === 125 && v.questions === 30 && 'running' in v && 'status' in v, JSON.stringify({ n: v.history.length, latest: v.latest?.day }));
const sm = bench.benchSummary(S);
check('the live summary is small (latest score, status, run)', JSON.stringify(sm).length < 400 && sm.latest.day === 125, JSON.stringify(sm));
bench._resetBench(path.join(DIR, 'missing.jsonl')); S.bench.run = null; S.bench.lastDay = 0;
await bench.benchTick(ctx);
check('without a question file the bench says so and does nothing', bench.benchView(S).status === 'no questions file' && bench.benchView(S).questions === 0);

fs.rmSync(DIR, { recursive: true, force: true });
console.log(`\nsmoke:bench: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
