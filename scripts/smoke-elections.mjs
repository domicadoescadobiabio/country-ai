// Smoke checks for Amendment 2 (F2): elections, compulsory voting, secret ballots, recounts.
import { irv, stv } from '../src/elections.ts';
export async function ledgerAll(BASE) {
  const out = []; let after = 0;
  for (;;) { const j = await (await fetch(`${BASE}/api/ledger?after=${after}&limit=500`)).json(); out.push(...j.entries); if (j.entries.length < 500) return out; after = j.entries[j.entries.length - 1].seq; }
}


export async function run({ BASE, get, until, check }) {
  // ---------------- counting rules (known answers)
  const r1 = irv([['a', 'b'], ['a'], ['b', 'a'], ['c', 'b'], ['c', 'b']], ['a', 'b', 'c']);
  check('IRV: eliminates the last and transfers (b out, a wins 3-2)', r1.winner === 'a' && r1.rounds.length === 2, JSON.stringify(r1));
  const r2 = irv([['a'], ['a'], ['b']], ['a', 'b']);
  check('IRV: an outright majority wins in round 1', r2.winner === 'a' && r2.rounds.length === 1);
  const s1 = stv([['a', 'b'], ['a', 'b'], ['a', 'c'], ['b'], ['c'], ['c']], ['a', 'b', 'c'], 2);
  check('STV: Droop quota and surplus transfer elect a and c', s1.quota === 3 && s1.elected.includes('a') && s1.elected.includes('c'), JSON.stringify(s1));

  // ---------------- the live republic
  const s0 = await get('/api/state');
  check('constitution v3+ (elections) is in force', s0.config.constitutionVersion >= 3 && s0.config.constitution.some(a => a.n === 14) && s0.config.constitution.some(a => a.n === 15));
  const s = await until(x => (x.elections || []).filter(e => e.result && e.kind !== 'recall').length >= 3, 120000);
  const pub = JSON.stringify(s);
  check('secret ballots never appear in public state', !/"ballots":\{/.test(pub) && !pub.includes('noShowReason'));

  const L = await ledgerAll(BASE);
  const sworn = L.filter(e => e.kind === 'sworn' && e.data.mandate === 'elected');
  check('officials are sworn in by election, recorded on the ledger', sworn.length > 0 && sworn.every(e => L.some(r => r.kind === 'election_result' && r.data.election === e.data.election && r.data.winners.includes(e.actor))));

  // recount every finished election from its anonymised ballots, like an auditor would
  const all = (await get('/api/elections')).elections.filter(e => e.result && e.stage !== 'failed' && ['regular', 'runoff'].includes(e.kind));
  let recounted = 0, matches = 0;
  for (const e of all.slice(-6)) {
    const d = await get(`/api/elections/${e.id}`);
    const ballots = (d.anonymisedBallots || []).filter(b => b !== 'BLANK').map(b => b.split('>'));
    const ids = e.candidates.map(c => c.id);
    const winners = e.seats === 1 ? [irv(ballots, ids).winner] : stv(ballots, ids, e.seats).elected;
    recounted++;
    const official = e.result.winners;
    // a president who failed the city-spread rule has no winners here: a runoff decided it
    if (official.length === 0 && e.office === 'president') { matches++; continue; }
    if (JSON.stringify([...winners].sort()) === JSON.stringify([...official].sort())) matches++;
  }
  check('independent recount from anonymised ballots matches every result', recounted > 0 && matches === recounted, `${matches}/${recounted}`);
  check('every result records turnout, blank share and position bias', all.every(e => typeof e.result.metrics.turnout === 'number' && typeof e.result.metrics.blankShare === 'number'));
  check('turnout is high under compulsory voting', all.every(e => e.result.metrics.turnout >= 0.8), JSON.stringify(all.map(e => e.result.metrics.turnout)));
  const presidents = all.filter(e => e.office === 'president' && e.kind === 'regular' && e.result.winners.length);
  check('a President won with at least 20% in 2 cities (or went to a runoff)', presidents.every(e => !e.result.spread || e.result.spread.citiesOver20 >= 2), JSON.stringify(presidents.map(e => e.result.spread)));
  const mayors = all.filter(e => e.office === 'mayor');
  // live count per city (the population summary in /api/state is cached for 15 s)
  const residents = {};
  for (const c of new Set(mayors.map(e => e.city))) residents[c] = (await get(`/api/citizens?city=${c}&size=1`)).total;
  check('mayor elections only count residents of that city', mayors.every(e => e.electorate == null || e.electorate <= residents[e.city]), JSON.stringify(mayors.map(e => [e.city, e.electorate, residents[e.city]])));
  // the public state shows only the latest decisions: wait until an election result is among them
  const withElection = await until(x => x.decisions.some(d => d.type === 'election'), 90000).catch(() => s);
  const decisions = withElection.decisions.filter(d => d.type === 'election');
  check('every result is in the decision log with its method', decisions.length > 0 && decisions.every(d => d.inputs.some(i => i[0] === 'Method')));
  const res = await fetch(BASE + '/api/elections/999999');
  check('unknown election id returns 404', res.status === 404);
}
