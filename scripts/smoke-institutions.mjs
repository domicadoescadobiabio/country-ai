// Extra smoke checks per institution; each block runs only if that office exists.
export async function run({ get, until, check }) {
  const s = await get('/api/state');
  const roles = s.config.roles.map(r => r.id);

  if (roles.includes('council')) {
    const s2 = await until(x => x.laws?.length >= 1, 90000);
    check('council enacted at least one law', s2.laws.length >= 1);
    const p = s2.policy;
    check('tax stays within 0-30%', p.taxRate >= 0 && p.taxRate <= 0.3, String(p.taxRate));
    check('ubi stays within 5-100', p.ubi >= 5 && p.ubi <= 100, String(p.ubi));
    const done = s2.bills.filter(b => ['enacted', 'rejected', 'vetoed'].includes(b.stage));
    check('bills reach a final stage', done.length >= 1);
    check('every enacted law had a council majority or override', s2.laws.every(l => l.how.startsWith('veto overridden') ? l.yes >= 0 : l.yes > l.no), JSON.stringify(s2.laws.slice(-3)));
  }
}
