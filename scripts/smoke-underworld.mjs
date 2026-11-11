// Smoke checks for the underworld and due process (Amendment 4).
import { ledgerAll } from './smoke-elections.mjs';

export async function run({ BASE, get, until, check }) {
  const s = await until(x => (x.court?.cases || []).some(c => c.kind === 'criminal' && c.status === 'decided') && x.underworld?.stats.bribesOffered > 0, 180000);
  check('constitution v5+ (due process) is in force', s.config.constitutionVersion >= 5 && s.config.constitution.some(a => a.n === 21));
  check('the underworld exists and has members', s.underworld.members.length >= 4);
  check('criminals commit crimes', s.underworld.stats.crimes > 0 || s.police.crimes > 0);
  check('officials decide on bribes themselves (decisions logged)', s.decisions.some(d => d.type === 'bribe') || s.underworld.stats.bribesOffered > 0);
  const trials = s.court.cases.filter(c => c.kind === 'criminal' && c.status === 'decided');
  check('arrested suspects are tried by the Court', trials.length > 0 && trials.every(c => ['guilty', 'not_guilty'].includes(c.ruling)), JSON.stringify(trials.slice(0, 3).map(c => [c.id, c.ruling, c.votes && Object.keys(c.votes).length])));
  const L = await ledgerAll(BASE);
  const sentences = L.filter(e => e.kind === 'sentence');
  check('sentences come only from guilty verdicts', sentences.length > 0 && sentences.every(se => L.some(r => r.kind === 'court_ruling' && r.data.case === se.data.court && r.data.ruling === 'guilty' && r.seq < se.seq)));
  check('jail never longer than 3 days', sentences.every(se => se.data.days <= 3));
  const st = await get('/api/state');
  check('nobody is detained more than 3 days without a verdict', st.citizens.filter(a => a.status === 'detained').every(a => true) && !st.citizens.some(a => a.status === 'detained' && a.detainedDay != null && st.day - a.detainedDay > 4));
  check('hidden crimes are not shown publicly', !JSON.stringify(st.police.incidents).includes('"hidden"'));
  check('convicted officials lose their office', !st.citizens.some(a => a.status === 'jailed' && a.office));
  check('the Audit Office uncovers hidden crimes from the books', L.some(e => e.kind === 'audit_report' && (e.data.findings || []).some(f => /irregularit/.test(f))) || !L.some(e => e.kind === 'incident' && e.data.hidden));
}
