// Smoke checks for Amendment 1 (F0 + F1): ledger, constitution v2, chain of command, ranks.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../src/db.mjs';

export async function run({ BASE, get, until, check }) {
  // ---------------- ledger integrity (unit test on a scratch database)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  const st = openStore(dir);
  for (let i = 0; i < 5; i++) st.append({ day: i, kind: 'test', actor: 'smoke', data: { i, note: 'entry ' + i } });
  check('fresh ledger verifies', st.verify().ok && st.verify().checked === 5);
  if (st.kind === 'sqlite') {
    const { DatabaseSync } = await import('node:sqlite');
    st.close();
    const db = new DatabaseSync(path.join(dir, 'country.db'));
    let blocked = false;
    try { db.exec("UPDATE ledger SET data = '{\"i\":99}' WHERE seq = 3"); } catch { blocked = true; }
    check('ledger rejects UPDATE (append-only trigger)', blocked);
    db.exec('DROP TRIGGER ledger_no_update');
    db.exec("UPDATE ledger SET data = '{\"i\":99,\"note\":\"forged\"}' WHERE seq = 3");
    db.close();
    const st2 = openStore(dir);
    const v = st2.verify();
    check('a forged entry breaks the chain at that entry', !v.ok && v.brokenAt === 3, JSON.stringify(v));
    st2.close();
  }
  fs.rmSync(dir, { recursive: true, force: true });

  // ---------------- live republic
  const s0 = await get('/api/state');
  check('constitution v2+ (chain of command) is in force', s0.config.constitutionVersion >= 2 && s0.config.constitution.some(a => a.n === 10));
  const led = await (await fetch(BASE + '/api/ledger?after=0&limit=500')).json();
  check('ledger has genesis and the amendment', led.entries.some(e => e.kind === 'genesis') && led.entries.some(e => e.kind === 'amendment'), JSON.stringify(led.entries.slice(0, 4).map(e => [e.seq, e.kind])) + ' count ' + led.head?.count);
  const ver = await (await fetch(BASE + '/api/ledger/verify')).json();
  check('live ledger verifies end to end', ver.ok && ver.checked > 0, JSON.stringify(ver));

  const s = await until(x => x.seats.police_chief?.length === 1 && x.seats.military_chief?.length === 1 && x.decisions.some(d => d.type === 'merit'), 120000);
  check('Chief of Police appointed through the chain', s.seats.police_chief.length === 1);
  check('Commander of the Military appointed through the chain', s.seats.military_chief.length === 1);
  const { ledgerAll } = await import('./smoke-elections.mjs');
  const L = await ledgerAll(BASE);
  const heads = L.filter(e => e.kind === 'appointed' && /_chief$/.test(e.data.office));
  const shortlists = L.filter(e => e.kind === 'shortlist');
  check('each head came from a Council shortlist', heads.every(h => shortlists.some(sl => sl.data.office === h.data.office && sl.data.list.includes(h.data.agent) && sl.seq < h.seq)), JSON.stringify({ heads: heads.map(h => h.data), shortlists: shortlists.map(x => x.data) }));
  check('shortlists have at most 3 names', shortlists.every(x => x.data.list.length <= 3));
  check('councillors cast shortlist ballots', L.some(e => e.kind === 'shortlist') && (s.decisions.some(d => d.type === 'nominate') || L.filter(e => e.kind === 'shortlist').every(e => Object.keys(e.data.points || {}).length > 0)));
  const officerAppts = L.filter(e => e.kind === 'appointed' && (e.data.office === 'police' || e.data.office === 'military'));
  check('officers are appointed only from the Merit Board top three', officerAppts.length > 0 && officerAppts.every(e => (e.data.from || []).slice(0, 3).includes(e.data.agent)), String(officerAppts.length));
  const qual = L.filter(e => e.kind === 'qualified');
  check('the Academy qualifies instead of seating police and military', qual.length > 0 && !L.some(e => e.kind === 'sworn' && ['police', 'military', 'police_chief', 'military_chief'].includes(e.data.office)));
  const force = ['police', 'military'].flatMap(r => s.seats[r]).map(id => s.citizens.find(a => a.id === id));
  check('every force member has a rank', force.every(a => ['recruit', 'officer', 'senior'].includes(a.rank)), JSON.stringify(force.map(a => [a.name, a.rank])));
  const chiefs = ['police_chief', 'military_chief'].map(r => s.citizens.find(a => a.id === s.seats[r][0]));
  check('heads hold the qualification and the chief rank', chiefs.every(c => c.rank === 'chief' && c.quals?.[c.office]));
  check('no decision in the chain failed a constitutional check', s.decisions.filter(d => ['nominate', 'appoint', 'reject', 'merit', 'promote'].includes(d.type)).every(d => d.checks.every(c => c[1])),
    JSON.stringify(s.decisions.filter(d => ['nominate', 'appoint', 'reject', 'merit', 'promote'].includes(d.type) && d.checks.some(c => !c[1])).slice(0, 2)));
  const final = await (await fetch(BASE + '/api/ledger/verify')).json();
  check('ledger still verifies after the run', final.ok);
}
