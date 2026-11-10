// Smoke checks for Amendment 3 (F3): Court, Audit Office, Election Supervisor, impeachment, timelock.
import { recount } from '../src/auditoffice.ts';
import { ledgerAll } from './smoke-elections.mjs';

export async function run({ BASE, get, until, check, TOKEN }) {
  // ---------------- the Audit Office catches a tampered result (unit test)
  const e = { kind: 'regular', seats: 1, office: 'mayor', candidates: [{ id: 'a' }, { id: 'b' }], result: { anonymisedBallots: ['a>b', 'a', 'b>a'].sort(), winners: ['a'] } };
  const { createHash } = await import('node:crypto');
  const { canon } = await import('../src/db.ts');
  e.result.digest = createHash('sha256').update(canon([...e.result.anonymisedBallots].sort())).digest('hex');
  check('recount confirms an honest result', recount(e).ok);
  check('recount catches a forged winner', !recount({ ...e, result: { ...e.result, winners: ['b'] } }).ok);
  check('recount catches swapped ballots (digest)', !recount({ ...e, result: { ...e.result, anonymisedBallots: ['b>a', 'b', 'b>a'] } }).digestOk);

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
