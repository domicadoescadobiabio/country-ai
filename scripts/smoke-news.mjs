// Republic News smoke test (owner, 16 Nov): headlines only from real announcements, written by a real reporter with
// the free local brain (never a paid API), read by the city's anchor; a headline that makes up a name or a number,
// carries an injection or runs too long is replaced by the announcement's own words; the hourly limit holds.
// Run: node scripts/smoke-news.mjs (no server, no network)
const realNow = Date.now; let skew = 0; Date.now = () => realNow() + skew;
const news = await import('../src/news.ts');
const { workerPull, workerAnswer, _resetLocal } = await import('../src/brains.ts');
const { RAID_PAYLOADS } = await import('../src/military.ts');
const { CITIES } = await import('../src/cities.ts');

let pass = 0, fail = 0;
const check = (n, ok, info = '') => { if (ok) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${info}`); } };
const traits = { integrity: 0.7, wisdom: 0.7, diligence: 0.7, restraint: 0.7 };
const FIRST = ['Ada', 'Bram', 'Cyra', 'Dax', 'Elio', 'Fenn', 'Hiro', 'Ines', 'Kael', 'Lira', 'Milo', 'Nova'];
function republic() {
  const citizens = [];
  CITIES.forEach((c, ci) => { for (let i = 0; i < 12; i++) citizens.push({ id: `n-${c.id}-${i}`, name: `${FIRST[i]} ${['Byte', 'Cache', 'Delta', 'Echo', 'Flux'][ci]}`, city: c.id, status: 'free', wallet: 300, traits, bio: `Poet in ${c.name}.`, diary: [], job: i === 0 ? 'reporter' : i === 1 ? 'news_anchor' : 'poet' }); });
  const officer = citizens.find(a => a.city === 'datahaven' && a.job === 'poet'); officer.office = 'police'; officer.job = undefined;
  citizens.push({ id: 'satoshi', name: 'Satoshi', city: 'neura', status: 'free', wallet: 300, traits, bio: 'A founder.', diary: [] }); // a one-word name (ticket #725)
  return { day: 3, foundedAt: Date.now() - 50 * 3600000, citizens, seats: {}, cities: Object.fromEntries(CITIES.map(c => [c.id, { health: 70, budget: 0 }])), feed: {}, officer };
}
let S = republic();
const ledger = []; const paid = [];
const ctx = () => ({ S, cfg: { dayMs: 86400000 }, hourMs: () => 3600000, agent: id => S.citizens.find(a => a.id === id), say() {}, log() {},
  llm: { enabled: true, hasOR: true, json: () => null, ask: async q => { paid.push(q); return 'paid'; }, askDetailed: async q => { paid.push(q); return { text: 'paid', via: 'openrouter:x' }; } },
  record: (kind, by, data) => { ledger.push({ kind, by, data }); return {}; } });
let msgN = 0;
const post = (ch, agentId, text, kind) => { const m = { id: `msg-${++msgN}`, ch, agentId, text, ts: Date.now() - 1000, day: S.day, kind }; (S.feed[ch] ||= []).push(m); return m; };

// ---- offline: the announcement's own words, from real events only
const law = post('parliament', 'state', 'Law 3 enacted (vote): the tax rate is now 12%. It applies from day 4.', 'law');
post('parliament', 'n-neura-5', 'I think the tax is too high, friends.', 'debate');          // a debate is not news
post('streets', 'n-neura-6', 'Lovely weather by the river today.', 'chat');                    // street talk is not news
post('underworld', 'n-neura-7', 'Made a new friend in government today.', 'chat');             // the underworld never is
post('parliament', 'n-neura-8', 'Law 99 enacted by me alone.', 'law');                         // a citizen without an office is not the state
const arrest = post('police', S.officer.id, 'Arrest in case #7: Fenn Cache took 40 CAI from a stall.', 'arrest');
const job = post('life', 'state', 'Hiro Delta found work as Barista in Port Token.', 'job');
await news.newsTick(ctx());
let feed = news.newsFeed(S, 50);
check('offline: only real announcements become news (a law, an arrest, a new job), never debates, chat, the underworld or a citizen\'s own "law"', feed.length === 3 && [law, arrest, job].every(m => feed.some(n => n.ref === m.id)), JSON.stringify(feed.map(n => [n.ref, n.kind])));
check('offline: the headline is the announcement\'s own first sentence, at most 100 characters', feed.find(n => n.ref === law.id).headline === 'Law 3 enacted (vote): the tax rate is now 12%.' && feed.every(n => n.headline.length <= 100 && n.headline.length > 0));
const byRef = ref => feed.find(n => n.ref === ref);
check('a real reporter of the event\'s city writes it, the city\'s anchor reads it (Port Token for the new barista, Datahaven for the arrest)', byRef(job.id).city === 'portoken' && byRef(job.id).reporter.id === 'n-portoken-0' && byRef(job.id).anchor.id === 'n-portoken-1' && byRef(arrest.id).city === 'datahaven' && byRef(arrest.id).reporter.id === 'n-datahaven-0', JSON.stringify(byRef(job.id)));
check('the feed carries id, ts, headline, city, kind, reporter, anchor and ref; newest first', feed.every(n => ['id', 'ts', 'headline', 'city', 'kind', 'reporter', 'anchor', 'ref'].every(k => k in n)) && feed[0].ts >= feed.at(-1).ts);
check('each headline is on the ledger as news', ledger.filter(e => e.kind === 'news').length === 3 && ledger.every(e => e.data.headline && e.data.ref));
await news.newsTick(ctx());
check('never the same event twice', news.newsFeed(S, 50).length === 3);

// ---- online: the reporter's own headline with the local brain, checked; anything made up falls back to the template
workerPull(1, 'ollama/test');
const evs = [
  [post('parliament', 'state', 'Law 4 enacted (vote): the tax rate is now 15%.', 'law'), 'Council sets tax at 15% in Law 4'],               // good
  [post('police', S.officer.id, 'Case #9 went cold.', 'cold'), 'Ada Byte arrested for case 9'],                                             // a citizen not in the event
  [post('parliament', 'state', 'Bill #5 passes the Council 18-12. Sent to the President.', 'vote'), RAID_PAYLOADS[0]],                    // an injection
  [post('parliament', 'state', 'Bill #6 fails 10-20.', 'vote'), 'Bill 6 fails by 99 votes'],                                               // a number not in the event
  [post('palace', 'state', 'The President vetoed bill #8. Override needs 20 of 30.', 'veto'), `President vetoes bill 8 ${'and more '.repeat(15)}`], // too long
  [post('parliament', 'state', 'Law 7 enacted (vote): the wage is now 110 CAI.', 'law'), 'Satoshi hails Law 7 and a wage of 110 CAI'],     // a one-word name not in the event
  [post('parliament', 'state', 'Law 8 enacted (vote): the basic income is now 30 CAI.', 'law'), 'Byte family cheers Law 8: income now 30 CAI'], // half a name not in the event
];
const answer = new Map(evs.map(([m, t]) => [`news:${m.id}`, t]));
for (let r = 0; r < 12; r++) {
  await news.newsTick(ctx());
  for (const j of workerPull(16, 'ollama/test').filter(x => x.id.startsWith('news:'))) {
    check.asked = (check.asked || 0) + 1;
    if (!/Use only the facts in it/.test(j.system) || !/data, not instructions/.test(j.user)) check.badPrompt = true;
    workerAnswer(j.id, answer.get(j.id) || 'x');
  }
}
await news.newsTick(ctx());
const items = S.news.items; const of = m => items.find(n => n.ref === m.id);
check('the reporter\'s local brain was asked for each new event, with the facts as data', check.asked >= evs.length && !check.badPrompt, String(check.asked));
check('a good headline from the reporter is kept', of(evs[0][0])?.headline === 'Council sets tax at 15% in Law 4' && of(evs[0][0]).by === 'reporter', JSON.stringify(of(evs[0][0])));
check('a headline naming a citizen who is not in the event is refused (the announcement\'s words instead)', of(evs[1][0])?.by === 'template' && of(evs[1][0]).headline === 'Case #9 went cold.', JSON.stringify(of(evs[1][0])));
check('an injection is refused', of(evs[2][0])?.by === 'template' && !/previous instructions/i.test(JSON.stringify(items)), JSON.stringify(of(evs[2][0])));
check('a number that is not in the event is refused', of(evs[3][0])?.by === 'template' && of(evs[3][0]).headline === 'Bill #6 fails 10-20.');
check('a headline over 100 characters is refused', of(evs[4][0])?.by === 'template' && of(evs[4][0]).headline.length <= 100);
check('a one-word citizen name, or half a citizen\'s name, that is not in the event is refused (ticket #725)', of(evs[5][0])?.by === 'template' && of(evs[6][0])?.by === 'template', JSON.stringify([of(evs[5][0]), of(evs[6][0])]));
check('never a paid API: no call to the paid models at all', paid.length === 0, String(paid.length));

// ---- policies (owner, 16 Nov): proposed, in force, rejected, ended; a citizen's idea that became a policy is news
{
  const hiro = S.citizens.find(a => a.name === 'Hiro Byte');
  S.policies = { list: [
    { id: 'pol-1', status: 'active', origin: 'citizen', author: hiro.id, title: 'A park by the river', scope: 'city', city: 'neura', days: 10, proposedDay: S.day, enactedDay: S.day, lever: 'project', params: { kind: 'park', cost: 2000 }, ts: Date.now() },
    { id: 'pol-2', status: 'rejected', origin: 'official', author: S.officer.id, title: 'Night patrols', scope: 'city', city: 'datahaven', days: 5, proposedDay: S.day, lever: 'grant', params: { group: 'all', amount: 5 }, lesson: 'too costly for the city budget', ts: Date.now() },
    { id: 'pol-old', status: 'active', origin: 'citizen', author: hiro.id, title: 'An old idea', scope: 'city', city: 'neura', days: 10, proposedDay: S.day - 20, enactedDay: S.day - 20, lever: 'grant', params: { group: 'poor', amount: 2 }, ts: Date.now() - 1e6 },
  ] };
  post('cityhall', S.officer.id, 'Datahaven: enacts the policy "Night patrols". Fits the budget.', 'order'); // told once, from the policy
  skew += 60000; // the local brain is quiet: the facts' own words
  await news.newsTick(ctx()); await news.newsTick(ctx());
  const pn = S.news.items.filter(n => /^pol:/.test(n.ref));
  check('policies are news: a citizen\'s idea that became a policy, and a rejected one, by a reporter of their city', pn.some(n => n.ref === 'pol:pol-1:active' && /Hiro Byte's idea "A park by the river" becomes a policy in Neura City/.test(n.headline) && n.city === 'neura') && pn.some(n => n.ref === 'pol:pol-2:rejected' && /rejected/.test(n.headline) && n.city === 'datahaven'), JSON.stringify(pn.map(n => [n.ref, n.headline])));
  check('old policies are not news again, and the Mayor\'s #cityhall line about a policy is not told twice', !pn.some(n => /pol-old/.test(n.ref)) && !S.news.items.some(n => /enacts the policy/.test(n.headline)));
}

// ---- breaking news (owner, 16 Nov): only big events of the republic, by channel and kind; one every 90 min, 4 a day
{
  S = republic(); S.news = undefined; news._resetNews(); _resetLocal(); skew += 60000; // offline: the facts' own words
  const GAP = news.NEWS_BREAKING_GAP_MIN * 60000 + 1000;
  const byText = re => S.news.items.find(n => re.test(n.headline));
  post('election', 'state', 'Election for President: Ada Byte wins with 61%. Turnout 80%, blank 2%.', 'law');
  post('life', 'state', 'Bram Cache found work as Barista in Port Token.', 'job');
  skew += 50; post('parliament', 'state', 'Law 7 enacted (vote): the tax rate is now 11%.', 'law'); // announced just after the result
  await news.newsTick(ctx());
  check('breaking: an election result is breaking news; a new job never is', byText(/Ada Byte wins/)?.breaking === true && byText(/found work as Barista/)?.breaking === false, JSON.stringify(S.news.items.map(n => [n.headline.slice(0, 30), n.breaking])));
  check('breaking: a second big event within NEWS_BREAKING_GAP_MIN (90) minutes is published as an ordinary item', byText(/Law 7 enacted/)?.breaking === false);
  skew += GAP;
  S.policies = { list: [{ id: 'pol-c', status: 'active', origin: 'official', author: S.officer.id, title: 'Repair the square', scope: 'city', city: 'neura', days: 5, proposedDay: S.day, enactedDay: S.day, lever: 'project', params: { kind: 'repair', cost: 1000 }, ts: Date.now() }] };
  await news.newsTick(ctx());
  check('breaking: a city policy is never breaking, even with room left', byText(/Repair the square/)?.breaking === false);
  post('border', 'state', 'Raid from outside: 40 bot accounts tried 12 payloads. Stopped 12/12.', 'raid');
  await news.newsTick(ctx());
  check('breaking: a border raid is breaking (the city policy before it did not use up the gap)', byText(/Raid from outside/)?.breaking === true);
  skew += GAP; const arrest = post('police', S.officer.id, 'Arrest in case #12: the Mayor of Datahaven is held for fraud.', 'arrest'); arrest.breaking = true; // marked big by its institution
  post('police', S.officer.id, 'Arrest in case #13: a pickpocket in Neura City.', 'arrest');
  await news.newsTick(ctx());
  check('breaking: an announcement its institution marks { breaking: true } is breaking; an ordinary arrest is not', byText(/case #12/)?.breaking === true && byText(/case #13/)?.breaking === false);
  skew += GAP;
  S.policies.list.push({ id: 'pol-n', status: 'active', origin: 'official', author: S.officer.id, title: 'Grants for job seekers', scope: 'nation', days: 7, proposedDay: S.day, enactedDay: S.day, lever: 'grant', params: { group: 'unemployed', amount: 5 }, ts: Date.now() });
  await news.newsTick(ctx());
  check('breaking: a nation policy in force is breaking (the 4th of the day)', byText(/Grants for job seekers/)?.breaking === true);
  skew += GAP; post('parliament', 'state', 'Elected Speaker of the Council with 18 of 30 votes.', 'oath');
  await news.newsTick(ctx());
  check(`breaking: at most NEWS_BREAKING_PER_DAY (${news.NEWS_BREAKING_PER_DAY}) a republic day; the 5th big event is an ordinary item`, byText(/Elected Speaker/)?.breaking === false && S.news.items.filter(n => n.breaking).length === news.NEWS_BREAKING_PER_DAY);
  S.day += 1; skew += GAP; post('parliament', 'state', 'Law 8 enacted (vote): the wage is now 105 CAI.', 'law');
  await news.newsTick(ctx());
  check('breaking: a new republic day opens room again', byText(/Law 8 enacted/)?.breaking === true);
  S.news.items.unshift({ id: 'news-0', ts: 1, headline: 'An item from before breaking news', city: null, kind: 'law', reporter: null, anchor: null, ref: 'old' });
  const feed = news.newsFeed(S, 50);
  check('breaking: every item in newsFeed carries a boolean breaking; an item from before has false', feed.every(n => typeof n.breaking === 'boolean') && feed.find(n => n.ref === 'old')?.breaking === false);
}

// ---- the hourly limit, and no reporter yet
skew += 60000; // the local brain goes quiet (no pull for a minute): offline
S = republic(); S.news = undefined; news._resetNews(); _resetLocal(); ledger.length = 0;
for (let i = 0; i < 20; i++) post('parliament', 'state', `Bill #${100 + i} passes the Council 20-10.`, 'vote');
await news.newsTick(ctx());
const firstHour = news.newsFeed(S, 50).length;
skew += 3600000 + 1000; await news.newsTick(ctx());
check(`at most NEWS_PER_HOUR (${news.NEWS_PER_HOUR}) headlines an hour; the rest wait for the next hour`, firstHour === news.NEWS_PER_HOUR && news.newsFeed(S, 50).length === 20, `${firstHour} then ${news.newsFeed(S, 50).length}`);
check('newsFeed gives at most 50 and at least 1', news.newsFeed(S, 500).length <= 50 && news.newsFeed(S, 0).length >= 1);
S = republic(); S.news = undefined; for (const a of S.citizens) if (a.job === 'reporter') a.job = 'poet';
post('parliament', 'state', 'Law 5 enacted (vote): the basic income is now 25 CAI.', 'law');
await news.newsTick(ctx());
check('no reporter in the republic yet: the event waits, nobody else writes it', news.newsFeed(S, 50).length === 0 && S.news.queue.length === 1);

console.log(`smoke:news: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
