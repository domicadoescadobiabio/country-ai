// Unit checks for the voting rules fixed on 11 Nov 2026 (no server needed):
//   founders vote from the founding, later citizens after 3 days;
//   a seat won with no ballots is vacated; nobody in jail keeps an elected seat.
import { electorate, voidEmptyMandates } from '../src/elections.ts';

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name} ${ok ? '' : extra}`); };

const cit = (id, o) => ({ id, name: id, status: 'free', office: null, origin: 'founder', wallet: 500, traits: {}, training: [], lessons: {}, ...o });
const S = {
  day: 1, constitutionVersion: 5, treasury: 0,
  citizens: [
    cit('ann', { office: 'president' }),
    cit('bob', { office: 'mayor', mayorOf: 'neura', city: 'neura' }),
    cit('cat', { office: 'mayor', status: 'jailed', mayorOf: 'port', city: 'port' }),
    cit('dan', { origin: 'registered', joinedDay: 1 }),
    cit('eve', { origin: 'registered', joinedDay: 1, status: 'left' }),
  ],
  seats: { president: ['ann'], mayor: ['bob', 'cat'] },
  cities: { neura: { mayor: 'bob' }, port: { mayor: 'cat' } },
  elections: { list: [
    { id: 1, office: 'president', kind: 'regular', stage: 'done', result: { winners: ['ann'], anonymisedBallots: [] } },
    { id: 2, office: 'mayor', city: 'neura', kind: 'regular', stage: 'done', result: { winners: ['bob'], anonymisedBallots: ['bob>x', 'BLANK'] } },
  ], seq: 2, strikes: {} },
};
const ledger = [];
const ctx = { S, agent: id => S.citizens.find(a => a.id === id), say() {}, log() {}, record: (kind, actor, data) => ledger.push({ kind, actor, data }) };

const voters = electorate(S, { city: null });
check('founders vote from the founding day', voters.includes('ann') && voters.includes('cat'));
check('a citizen who arrived today waits 3 days', !voters.includes('dan'));
check('citizens who left do not vote', !voters.includes('eve'));
S.day = 4;
check('after 3 days the newcomer votes', electorate(S, { city: null }).includes('dan'));
check('mayor electorate is the city only', electorate(S, { city: 'neura' }).join() === 'bob');

const n = voidEmptyMandates(ctx);
check('seat won with no ballots is vacated', ctx.agent('ann').office === null && !S.seats.president.includes('ann'));
check('seat won with real ballots is kept', ctx.agent('bob').office === 'mayor');
check('jailed official loses the elected seat', ctx.agent('cat').office === null && !S.seats.mayor.includes('cat'));
check('corrections are on the ledger', ledger.some(e => e.kind === 'election_void' && e.data.election === 1) && ledger.filter(e => e.kind === 'vacated').length === 2, JSON.stringify(ledger.map(e => e.kind)));
check('the correction runs once', n === 2 && voidEmptyMandates(ctx) === 0);

// ---- Art. 25: tiers and the daily budget for thought (think() with a fake model provider)
const { think, tierOf } = await import('../src/brains.ts');
const calls = [];
const fakeLLM = { enabled: true, json: JSON.parse, askDetailed: async (o) => { calls.push(o); return { text: 'A - ok', via: o.claudeModel ? `claude:${o.claudeModel}` : `openrouter:${o.model}`, cost: 0.5 }; } };
const B = { day: 1, foundedAt: Date.now() - 12 * 3600000, citizens: [], seats: {}, cabinet: { speaker: 'spk' } };
const bctx = { S: B, llm: fakeLLM, cfg: { dailyBudgetUsd: 10, dayMs: 86400000, leaderModel: 'claude-opus-5-5' } };
const pres = { id: 'p', office: 'president', model: 'qwen/x' }, cop = { id: 'c', office: 'police', model: 'meta/x' }, joe = { id: 'j', office: null, model: 'anthropic/claude-haiku-5.5' }, spk = { id: 'spk', office: 'council', model: 'z/x' };
check('tiers: President and Speaker lead, a police officer is an official, a citizen is a citizen', tierOf(B, pres) === 'leader' && tierOf(B, spk) === 'leader' && tierOf(B, cop) === 'official' && tierOf(B, joe) === 'citizen');
await think(bctx, pres, 'q1', { system: 's', user: 'u', kind: 'decision' });
await think(bctx, joe, 'q2', { system: 's', user: 'u' });
check('leaders think with Claude Opus at medium effort', calls[0].claudeModel === 'claude-opus-5-5' && calls[0].effort === 'medium');
check('citizens think with their own model through OpenRouter at low effort', !calls[1].claudeModel && calls[1].route === 'openrouter' && calls[1].model === 'anthropic/claude-haiku-5.5' && calls[1].effort === 'low');
// half the day is gone: pace = 0.5 + 3/24 = 62.5% of $10. Citizens may spend at most 35% of that, leaders the rest.
for (let i = 0; i < 20; i++) await think(bctx, joe, `c${i}`, { system: 's', user: 'u' });
check('citizens stop at their share of the paced budget', B.thinkBudget.citizen <= 10 * 0.35 * 0.625 + 0.5 && B.thinkBudget.denied.citizen > 0, JSON.stringify(B.thinkBudget));
let leaderCalls = 0; for (let i = 0; i < 20; i++) { const r = await think(bctx, pres, `l${i}`, { system: 's', user: 'u' }); if (r.text) leaderCalls++; }
check('leaders keep thinking after citizens are cut off, up to the paced total', leaderCalls > 0 && B.thinkBudget.spent <= 10 * 0.625 + 0.5, JSON.stringify(B.thinkBudget));
const late = await think(bctx, pres, 'late', { system: 's', user: 'u' });
check('when the budget is spent the answer is offline (budget)', late.engine === 'offline (budget)');
B.day = 2; const fresh = await think(bctx, joe, 'newday', { system: 's', user: 'u' });
check('a new day opens a new budget', !!fresh.text && B.thinkBudget.spent === 0.5);

// ---- the brain ladder: citizens -> local brain, officials -> OpenRouter, leaders -> Claude Opus
const { ladderTick, workerPull, workerAnswer } = await import('../src/brains.ts');
const LS = { day: 1, foundedAt: Date.now(), seats: { council: ['ofc'], president: [] }, cabinet: {}, citizens: [] };
const said = [], led = [];
const people = { cit: { id: 'cit', name: 'Cit', model: 'z-ai/glm-5.3' }, ofc: { id: 'ofc', name: 'Ofc', office: 'council', model: 'mistralai/mistral-large-4-0' } };
const lctx = { S: LS, cfg: { dailyBudgetUsd: 0, leaderModel: 'claude-opus-5-5' }, agent: id => people[id], say: (c, a, t) => said.push(t), record: (k, a, d) => led.push({ k, d }),
  llm: { enabled: true, json: JSON.parse, askDetailed: async o => ({ text: 'B - api', via: `openrouter:${o.model}`, cost: 0.01 }) } };
workerPull(1, 'ollama/test'); // the local brain is online
const c1 = await think(lctx, people.cit, 'lq1', { system: 's', user: 'citizen question' });
check('a citizen thinks with the local brain first', c1.pending === true);
const job = workerPull(4).find(j => j.id === 'lq1');
workerAnswer('lq1', 'A - local answer', 'ollama/test');
const c2 = await think(lctx, people.cit, 'lq1', { system: 's', user: 'citizen question' });
check('the local answer comes back to the citizen', !!job && c2.text === 'A - local answer' && /^local:/.test(c2.engine), JSON.stringify(c2));
const o1 = await think(lctx, people.ofc, 'oq1', { system: 's', user: 'official question' });
check('an official moves up to their own OpenRouter model', o1.engine === 'openrouter:mistralai/mistral-large-4-0', JSON.stringify(o1));
ladderTick(lctx);
check('moving up the ladder is announced and on the ledger', said.some(t => /Ofc moves up to their own model on OpenRouter/.test(t)) && led.some(e => e.k === 'brain_ladder' && e.d.to === 'official'), JSON.stringify(said));
LS.seats.council = []; people.ofc.office = null;
ladderTick(lctx);
check('losing the seat moves the brain back down', said.some(t => /Ofc moves back to the local brain/.test(t)) && people.ofc.brainTier === 'citizen', JSON.stringify(said));

console.log(`\nsmoke:voting-rules: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
