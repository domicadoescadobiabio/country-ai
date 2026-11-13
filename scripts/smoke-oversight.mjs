// Smoke checks for Amendment 3 (F3): Court, Audit Office, Election Supervisor, impeachment, timelock.
import { recount } from '../src/auditoffice.ts';
import { ledgerAll } from './smoke-elections.mjs';

// ---------------- one-off pardon for the old police.ts simulation bug (unit test, no server)
// Mirrors the production prisoners of day 2: framed natives are pardoned, founders and underworld choices are not.
async function pardonChecks(check) {
  const { pardonSimulatedCrimes } = await import('../src/police.ts');
  const T0 = 1000;
  const mk = (id, origin, faction, extra = {}) => ({ id, name: id, origin, faction, status: 'free', wallet: 0, debt: 0, heat: 2, jailUntil: 0, record: [], traits: {}, ...extra });
  const citizens = [
    // reported bribe made up by crime(): 503 taken as "restitution", 256 fine still owed, in jail
    mk('knox', 'native', 'civilian', { status: 'jailed', jailUntil: 3, debt: 256, record: ['Day 1: convicted of bribe (case #100, court #32), returned 503 CAI, fined 256 CAI, jailed 2 days'] }),
    // sabotage from a deploy() the state wrote, no underworld move: 50 fine paid, in jail
    mk('ada', 'native', 'underworld', { status: 'jailed', jailUntil: 4, wallet: 169, record: ['Day 1: convicted of sabotage (case #114, court #35), returned 0 CAI, fined 50 CAI, jailed 3 days'] }),
    // theft made up by crime(), sentence served, part of the fine still owed
    mk('bram', 'native', 'civilian', { wallet: 10, debt: 20, record: ['Day 1: convicted of theft (case #78, court #20), returned 85 CAI, fined 50 CAI, jailed 1 day'] }),
    // fraud she chose herself in the underworld (strength set): stays convicted
    mk('tove', 'native', 'underworld', { status: 'jailed', jailUntil: 4, debt: 409, record: ['Day 2: convicted of fraud (case #41, court #36), returned 2,000 CAI, fined 1,000 CAI, jailed 2 days'] }),
    // founder: simulated by design, stays convicted
    mk('glint', 'founder', 'underworld', { status: 'jailed', jailUntil: 4, wallet: 350, record: ['Day 1: convicted of sabotage (case #9, court #1), returned 0 CAI, fined 50 CAI, jailed 3 days'] }),
    // a sabotage this native chose in the underworld: stays convicted
    mk('moth2', 'native', 'underworld', { status: 'jailed', jailUntil: 4, record: ['Day 1: convicted of sabotage (case #120, court #40), returned 0 CAI, fined 50 CAI, jailed 3 days'] }),
    // detained on a made-up charge that was never tried
    mk('nell', 'native', 'civilian', { status: 'detained', detainedDay: 2 }),
    // detained on a made-up charge AND on a real one she chose in the underworld: that one still holds her
    mk('nell2', 'native', 'underworld', { status: 'detained', detainedDay: 2 }),
    // founder whose reported bribe OFFER (chosen in the underworld) cost 300 CAI of "restitution": conviction stands
    mk('vex', 'founder', 'underworld', { status: 'jailed', jailUntil: 3, wallet: 100, debt: 50, record: ['Day 1: convicted of bribe (case #4, court #4), returned 300 CAI, fined 150 CAI, jailed 2 days'] }),
  ];
  const inc = (id, type, perps, extra = {}) => ({ id, type, perps, amount: 0, victim: 'treasury', status: 'convicted', ts: T0 + id, day: 1, ...extra });
  const S = {
    day: 2, treasury: 100000, citizens,
    police: { incidents: [
      inc(100, 'bribe', ['knox'], { amount: 512, victim: 'council', reported: true }),
      inc(114, 'sabotage', ['ada']),
      inc(78, 'theft', ['bram'], { amount: 85, victim: 'cato' }),
      inc(41, 'fraud', ['tove'], { amount: 2000, reported: true, strength: 0.85 }),
      inc(9, 'sabotage', ['glint']),
      inc(120, 'sabotage', ['moth2']),
      inc(130, 'theft', ['nell'], { amount: 90, victim: 'cato', status: 'trial' }),
      inc(131, 'theft', ['nell2'], { amount: 80, victim: 'cato', status: 'trial' }),
      inc(132, 'theft', ['nell2'], { amount: 250, victim: 'cato', status: 'trial', strength: 0.9 }),
      inc(4, 'bribe', ['vex'], { amount: 300, victim: 'state', reported: true, strength: 0.95 }),
    ] },
    court: { cases: [{ id: 32, ref: { incident: 100 } }, { id: 50, status: 'open', ref: { incident: 130, agents: ['nell'] } }] },
    feed: { underworld: [{ agentId: 'moth2', crime: 'sabotage', ts: T0 + 50 }, { agentId: 'ada', ts: T0 + 60 }] },
  };
  const byId = Object.fromEntries(citizens.map(a => [a.id, a]));
  const ledger = [];
  const ctx = { S, agent: id => byId[id], say() {}, record: (kind, by, data) => ledger.push({ kind, data }) };
  const t0 = S.treasury;
  const done = pardonSimulatedCrimes(ctx);
  const ids = [...new Set(done.map(d => d.id))].sort().join(',');
  check('pardon: only natives framed by the simulation (knox, ada, bram, nell, nell2)', ids === 'ada,bram,knox,nell,nell2', ids);
  check('pardon: a detainee still charged with a crime she chose stays detained', byId.nell2.status === 'detained' && S.police.incidents.find(i => i.id === 131).status === 'dropped' && S.police.incidents.find(i => i.id === 132).status === 'trial');
  check('pardon: founder and underworld choices stay jailed', ['tove', 'glint', 'moth2'].every(id => byId[id].status === 'jailed' && !byId[id].record[0].includes('PARDONED')));
  check('pardon: knox freed, 256 debt cleared, 503 refunded', byId.knox.status === 'free' && byId.knox.debt === 0 && byId.knox.wallet === 503);
  check('pardon: ada freed, 50 fine refunded', byId.ada.status === 'free' && byId.ada.wallet === 219);
  check('pardon: bram 20 debt cleared, 30 paid fine refunded, restitution of a gain kept', byId.bram.debt === 0 && byId.bram.wallet === 40);
  check('pardon: treasury pays exactly the refunds', S.treasury === t0 - 503 - 50 - 30, String(t0 - S.treasury));
  check('pardon: untried charge dropped, detainee home, court case withdrawn', byId.nell.status === 'free' && S.police.incidents.find(i => i.id === 130).status === 'dropped' && S.court.cases[1].status === 'withdrawn');
  check('pardon: records marked, incidents and court case flagged', byId.knox.record[0].includes('PARDONED') && S.police.incidents.find(i => i.id === 100).status === 'pardoned' && S.court.cases[0].pardoned === 2);
  check('pardon: one ledger entry per pardoned citizen, with the reason', ledger.length === 5 &&ledger.every(e => e.kind === 'pardon' && e.data.reason));
  // a restart reruns the tick: nothing may happen twice
  const snap = JSON.stringify({ c: citizens, t: S.treasury });
  const again = pardonSimulatedCrimes(ctx);
  check('pardon: idempotent on restart (flag in state)', again === null && JSON.stringify({ c: citizens, t: S.treasury }) === snap && ledger.length === 5);
  // the court cannot sentence a pardoned or dropped incident later
  const { convict } = await import('../src/police.ts');
  check('pardon: a late guilty verdict cannot re-sentence a pardoned case', convict(ctx, 100, 32) === null && convict(ctx, 130, 50) === null && byId.knox.status === 'free');

  // ---------------- hard crash between the ledger write and the state save: replay must not double the ledger
  {
    const fresh = () => ({
      day: 2, treasury: 1000,
      citizens: [mk('k2', 'native', 'civilian', { status: 'jailed', jailUntil: 3, debt: 100, record: ['Day 1: convicted of bribe (case #300, court #90), returned 200 CAI, fined 100 CAI, jailed 2 days'] }),
        mk('v2', 'founder', 'underworld', { wallet: 0, record: ['Day 1: convicted of bribe (case #301, court #91), returned 150 CAI, fined 75 CAI, jailed 2 days'] })],
      police: { incidents: [inc(300, 'bribe', ['k2'], { amount: 400, victim: 'council', reported: true }), inc(301, 'bribe', ['v2'], { amount: 150, victim: 'state', reported: true, strength: 0.95 })] },
      court: { cases: [] }, feed: { underworld: [] },
    });
    const { refundUnearnedRestitution } = await import('../src/police.ts');
    const L2 = []; let flushed = 0;
    const run = S2 => {
      const by = Object.fromEntries(S2.citizens.map(a => [a.id, a]));
      const c2 = { S: S2, agent: id => by[id], say() {}, record: (kind, _by, data) => L2.push({ kind, data }), flush: () => flushed++,
        ledgerHas: (kind, m) => L2.some(e => e.kind === kind && Object.entries(m).every(([k, v]) => e.data[k] === v)) };
      pardonSimulatedCrimes(c2); refundUnearnedRestitution(c2);
      return { citizens: S2.citizens, treasury: S2.treasury, incidents: S2.police.incidents.map(i => i.status) };
    };
    const first = JSON.stringify(run(fresh()));
    const n = L2.length;
    const replay = JSON.stringify(run(fresh())); // the save was lost: the same one-offs run again on the old state
    check('crash replay: the state comes out the same, the ledger is not written twice', replay === first && L2.length === n && n === 2, `${n} -> ${L2.length}`);
    check('crash replay: the state is flushed right after each one-off sets its flag', flushed === 4, String(flushed));
  }

  // ---------------- restitution only from whoever received the money
  const { refundUnearnedRestitution } = await import('../src/police.ts');
  const t1 = S.treasury;
  const fixed = refundUnearnedRestitution(ctx);
  check('restitution fix: vex gets back the 300 taken for an offer that moved nothing, nobody else', fixed.length === 1 && fixed[0].id === 'vex' && byId.vex.wallet === 400 && S.treasury === t1 - 300, JSON.stringify(fixed));
  check('restitution fix: conviction, debt and jail stand; record and ledger say why', byId.vex.status === 'jailed' && byId.vex.debt === 50 && byId.vex.record[0].includes('restitution refunded') && ledger.some(e => e.kind === 'correction' && e.data.citizen === 'vex'));
  check('restitution fix: knox (pardoned, already refunded) is not paid twice', byId.knox.wallet === 503);
  const t2 = S.treasury;
  check('restitution fix: runs once', refundUnearnedRestitution(ctx) === null && S.treasury === t2 && byId.vex.wallet === 400);
  // new sentences: an offer costs only the fine; a taken bribe is returned by the official, not by the briber
  S.policy = { finePct: 0.5 }; S.academy = { rooms: [] };
  citizens.push(mk('offerer', 'founder', 'underworld', { wallet: 1000 }), mk('briber2', 'founder', 'underworld', { wallet: 500 }), mk('taker', 'founder', 'civilian', { wallet: 500 }));
  for (const c of citizens.slice(-3)) byId[c.id] = c;
  S.police.incidents.push(inc(200, 'bribe', ['offerer'], { amount: 400, victim: 'state', reported: true, status: 'trial', strength: 0.95 }),
    inc(201, 'bribe', ['briber2', 'taker'], { amount: 300, victim: 'state', status: 'trial', strength: 0.8 }));
  convict(ctx, 200, 60); convict(ctx, 201, 61);
  check('convict: a reported bribe offer costs the fine only (no restitution)', byId.offerer.wallet === 800, String(byId.offerer.wallet));
  check('convict: the official who took a bribe returns it, the briber pays only the fine', byId.taker.wallet === 50 && byId.briber2.wallet === 350, `${byId.taker.wallet} ${byId.briber2.wallet}`);

  // small wrongs from daily life (ticket #284): vandalism pays the damaged city, a riot is one day
  S.cities = { neura: { budget: 0 }, portoken: { budget: 0 } };
  citizens.push(mk('vandal', 'native', 'civilian', { wallet: 200, city: 'neura' }), mk('rioter', 'native', 'civilian', { wallet: 200, city: 'portoken' }));
  for (const c of citizens.slice(-2)) byId[c.id] = c;
  const t3 = S.treasury;
  S.police.incidents.push(inc(210, 'vandalism', ['vandal'], { amount: 120, victim: 'state', status: 'trial', strength: 0.8, mischief: true }),
    inc(211, 'disturbance', ['rioter'], { amount: 0, victim: 'state', status: 'trial', strength: 0.9, mischief: true }));
  convict(ctx, 210, 70); convict(ctx, 211, 71);
  check('vandalism: the vandal pays the damage into the damaged city budget, then the fine; one day in jail', S.cities.neura.budget === 120 && byId.vandal.wallet === 20 && byId.vandal.jailUntil === S.day + 1 && S.treasury === t3 + 60 + 50, JSON.stringify({ city: S.cities.neura, wallet: byId.vandal.wallet, jail: byId.vandal.jailUntil }));
  check('disturbance: no restitution, the minimum fine of 50, one day in jail', byId.rioter.wallet === 150 && byId.rioter.jailUntil === S.day + 1 && S.cities.portoken.budget === 0);

  // elections (ticket #284): reputation is on the voter card; a citizen skipping the vote today does not vote today
  const el = await import('../src/elections.ts');
  check('voter card shows the candidate reputation (0-100)', el.card({ day: 5, decisions: [] }, { id: 'x', name: 'X', reputation: 0.42 }, 'mayor').reputation === 42 && el.card({ day: 5, decisions: [] }, { id: 'y', name: 'Y' }, 'mayor').reputation === 70);
  const ev = { electorate: ['vandal', 'rioter', 'knox'], ballots: {}, noShow: [] };
  byId.rioter.skipVoteDay = S.day;
  const today = el.votersToday(ctx, ev);
  check('a citizen who skips the vote today is left out of today\'s voters (and is fined if the polls close)', !today.includes('rioter') && today.includes('vandal') && today.includes('knox'));
}

// ---------------- the Court's bench is odd and a mechanical finding is read as written (ticket #320)
// Four offline judges with no wisdom (the highest chance of a wrong vote) could split 2-2 on a disqualification.
async function benchChecks(check) {
  const { file, decideCases } = await import('../src/court.ts');
  let wrong = 0, even = 0;
  for (let t = 0; t < 200; t++) {
    const judges = ['j1', 'j2', 'j3', 'j4'].map(id => ({ id, name: id, office: 'judge', status: 'free', traits: { wisdom: 0, integrity: 0.5, diligence: 0.5, restraint: 0.5 } }));
    const tester = { id: 'tester', name: 'Tester', status: 'free', traits: {} };
    const by = Object.fromEntries([...judges, tester].map(a => [a.id, a]));
    const S = { day: 3, treasury: 1000, citizens: [...judges, tester], court: { slots: judges.map(j => ({ by: 'lot', agent: j.id })), cases: [], seq: 0 }, elections: { list: [{ id: 9, office: 'mayor', stage: 'campaign', candidates: [{ id: 'tester', deposit: 100 }] }] } };
    const ctx = { S, cfg: {}, agent: id => by[id], say() {}, log() {}, record() {}, decide: d => d, llm: { enabled: false, json: () => null } };
    const cs = file(ctx, { kind: 'disqualify', subject: `9:tester`, filedBy: 'supervisor', claim: 'rule matched', evidence: ['rule matched: prompt injection'], objective: 'grant', ref: { agent: 'tester', election: 9 } });
    for (let i = 0; i < 8 && cs.status === 'open'; i++) await decideCases(ctx);
    if (cs.ruling !== 'grant') wrong++;
    if ((cs.bench || []).length % 2 === 0) even++;
  }
  check('Court: a disqualification on a rule the code matched is granted by offline judges every time (200 runs, 4 judges)', wrong === 0, `${wrong} not granted`);
  check('Court: the bench of a case is always odd, so a two-way ruling cannot tie', even === 0, `${even} even benches`);
  // a criminal panel stays three, and a judge who is a party stands aside before the bench is drawn
  const judges = ['j1', 'j2', 'j3', 'j4', 'j5'].map(id => ({ id, name: id, office: 'judge', status: 'free', traits: { wisdom: 1, integrity: 1, diligence: 0.5, restraint: 0.5 } }));
  const by = Object.fromEntries(judges.map(a => [a.id, a]));
  const S = { day: 3, treasury: 0, citizens: judges, court: { slots: judges.map(j => ({ by: 'lot', agent: j.id })), cases: [], seq: 0 }, police: { incidents: [] } };
  const ctx = { S, cfg: {}, agent: id => by[id], say() {}, log() {}, record() {}, decide: d => d, llm: { enabled: false, json: () => null } };
  const cs = file(ctx, { kind: 'impeachment', subject: 'j2', claim: 'grounds', evidence: ['failed checks'], objective: 'reject', ref: { agent: 'j2' } });
  await decideCases(ctx);
  check('Court: a judge who is a party is left off the bench, and the bench stays odd', cs.bench && !cs.bench.includes('j2') && cs.bench.length === 3, JSON.stringify(cs.bench));
}

export async function run({ BASE, get, until, check, TOKEN }) {
  // ---------------- the Audit Office catches a tampered result (unit test)
  const e = { kind: 'regular', seats: 1, office: 'mayor', candidates: [{ id: 'a' }, { id: 'b' }], result: { anonymisedBallots: ['a>b', 'a', 'b>a'].sort(), winners: ['a'] } };
  const { createHash } = await import('node:crypto');
  const { canon } = await import('../src/db.ts');
  e.result.digest = createHash('sha256').update(canon([...e.result.anonymisedBallots].sort())).digest('hex');
  check('recount confirms an honest result', recount(e).ok);
  check('recount catches a forged winner', !recount({ ...e, result: { ...e.result, winners: ['b'] } }).ok);
  check('recount catches swapped ballots (digest)', !recount({ ...e, result: { ...e.result, anonymisedBallots: ['b>a', 'b', 'b>a'] } }).digestOk);

  // the count and the recount agree whatever the ballot order, and on ballots that rank nobody
  const { stv } = await import('../src/elections.ts');
  const cands = ['a', 'b', 'c', 'd', 'e', 'f'];
  const shuffle = xs => xs.map(x => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map(p => p[1]);
  let orderDiff = 0;
  for (let t = 0; t < 300; t++) {
    const ballots = Array.from({ length: 7 + Math.floor(Math.random() * 40) }, () => shuffle(cands).slice(0, 1 + Math.floor(Math.random() * 5)));
    const seats = 2 + (t % 3);
    const base = JSON.stringify(stv(ballots, cands, seats).elected.slice().sort());
    for (let k = 0; k < 4; k++) if (JSON.stringify(stv(shuffle(ballots), cands, seats).elected.slice().sort()) !== base) orderDiff++;
  }
  check('STV result does not depend on the order of the ballots (300 random elections)', orderDiff === 0, String(orderDiff));
  const rankings = [['a', 'b'], ['a', 'c'], ['a', 'b'], ['b'], ['c'], [], []]; // two ballots that rank nobody
  const anonE = rankings.map(r => r.join('>')).sort();
  const se = { kind: 'regular', seats: 2, office: 'council', candidates: cands.slice(0, 3).map(id => ({ id })), result: { anonymisedBallots: anonE, winners: stv(rankings, ['a', 'b', 'c'], 2).elected } };
  se.result.digest = createHash('sha256').update(canon([...anonE].sort())).digest('hex');
  check('recount matches the count when some ballots rank nobody', recount(se).ok, JSON.stringify(recount(se)));

  await pardonChecks(check);
  await benchChecks(check);

  // ---------------- live republic
  const s = await until(x => x.config?.constitutionVersion >= 4 && x.court?.slots.every(sl => sl.agent) && x.audit?.recounts > 0 && x.court.cases.some(c => c.status === 'decided'), 180000);
  check('constitution v4 (courts and oversight) is in force', s.config.constitutionVersion >= 4 && [16, 17, 18, 19, 20].every(n => s.config.constitution.some(a => a.n === n)));
  check('three judges seated: President, Council, lot', s.court.slots.every(sl => sl.agent) && new Set(s.court.slots.map(sl => sl.by)).size === 3);
  const judges = s.court.slots.map(sl => s.citizens.find(a => a.id === sl.agent));
  check('judges hold the qualification and no other office', judges.every(j => j.office === 'judge' && j.quals?.judge));
  const L = await ledgerAll(BASE);
  const results = L.filter(x => x.kind === 'election_result' && x.data.winners?.length);
  const swornElected = L.filter(x => x.kind === 'sworn' && x.data.mandate === 'elected');
  const lateSworn = swornElected.filter(x => x.seq > (L.find(y => y.kind === 'amendment' && y.data.version === 4)?.seq || 0));
  check('every election certified under v4 was recounted first and matched', lateSworn.length > 0 && lateSworn.every(sw => L.some(r => r.kind === 'audit_recount' && r.data.election === sw.data.election && r.data.ok && r.seq < sw.seq)), `${lateSworn.length} sworn, ${results.length} results`);
  check('no recount mismatches in an honest run', s.audit.mismatches === 0);
  check('daily audit reports are published', s.audit.reports.length > 0 && L.some(x => x.kind === 'audit_report'));
  const rulings = L.filter(x => x.kind === 'court_ruling');
  check('the Court reviews appointments of heads and rules', rulings.some(r => r.data.kind === 'appointment'));
  const appt = rulings.filter(r => r.data.kind === 'appointment');
  // offline judges err now and then (each ~4% of rulings): at most two wrong, or 15%
  check('honest appointments are upheld (judges rarely err)', appt.length - appt.filter(r => r.data.ruling === 'uphold').length <= Math.max(2, Math.ceil(appt.length * 0.15)), `${appt.filter(r => r.data.ruling === 'uphold').length}/${appt.length}`);
  check('judges give reasons for each vote', s.court.cases.filter(c => c.status === 'decided' && c.quorum).every(c => Object.values(c.votes).every(v => v.reason)));
  const signed = L.filter(x => x.kind === 'law_signed');
  const laws = L.filter(x => x.kind === 'law' && x.seq > (L.find(y => y.kind === 'amendment' && y.data.version === 4)?.seq || 0));
  check('every law under v4 waited out the timelock', laws.every(l => signed.some(sg => sg.data.bill === l.data.bill && sg.seq < l.seq && l.day >= sg.data.effectiveDay)), `${laws.length} laws, ${signed.length} signed`);

  // ---------------- impeachment drill: a baseless motion must fail on the record
  const pres = s.seats.president?.[0];
  const noAuth = await fetch(BASE + '/api/admin/drill/impeachment', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  check('impeachment drill is founders-only', noAuth.status === 401);
  if (pres) {
    const r = await fetch(BASE + '/api/admin/drill/impeachment', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN }, body: JSON.stringify({ grounds: 'smoke test, no grounds' }) });
    check('impeachment drill opens a Council motion', r.status === 200 || r.status === 409, String(r.status));
    const s2 = await until(x => !x.court.impeachment, 60000);
    const L2 = await ledgerAll(BASE);
    check('the motion was recorded and nobody was removed without grounds', L2.some(x => x.kind === 'impeachment_motion') && !s2.court.impeachment && !L2.some(x => x.kind === 'vacated' && /impeachment/.test(x.data.reason)), JSON.stringify(s2.court.impeachment));
  }
}
