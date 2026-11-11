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

console.log(`\nsmoke:voting-rules: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
