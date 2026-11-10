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
  if (roles.includes('police')) await runPolice({ get, until, check });
  if (roles.includes('military')) await runMilitary(arguments[0]);
}

export async function runPolice({ get, until, check }) {
  const { scan, SNIPPETS } = await import('../src/audit.mjs');
  check('scanner finds every planted bug', SNIPPETS.filter(s => s.bug).every(s => scan(s.code).some(f => f.id === s.bug)), JSON.stringify(SNIPPETS.filter(s => s.bug && !scan(s.code).some(f => f.id === s.bug)).map(s => s.name)));
  check('scanner passes clean code', SNIPPETS.filter(s => !s.bug).every(s => scan(s.code).length === 0), JSON.stringify(SNIPPETS.filter(s => !s.bug && scan(s.code).length).map(s => s.name)));

  const s = await until(x => x.police.arrests >= 1 && x.police.audits >= 3, 120000);
  check('police audited deployed code', s.police.audits >= 3, String(s.police.audits));
  check('police made an arrest', s.police.arrests >= 1, String(s.police.arrests));
  const solved = s.police.incidents.filter(i => i.status === 'solved');
  check('every arrest has evidence', solved.every(i => i.evidence && i.perps?.length));
  check('open cases do not name suspects', s.police.incidents.filter(i => i.status !== 'solved').every(i => !i.perps && !i.evidence));
  const jailed = s.citizens.filter(a => a.status === 'jailed');
  check('jail never longer than 3 days', jailed.every(a => a.jailUntil - s.day <= 3), JSON.stringify(jailed.map(a => [a.name, a.jailUntil, s.day])));
  check('jailed agents hold no office', jailed.every(a => !a.office));
}
