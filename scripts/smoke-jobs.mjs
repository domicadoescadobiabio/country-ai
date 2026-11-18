// Jobs smoke test (owner, 16 Nov): every citizen has exactly one job, the same everywhere; 20 new jobs with their
// buildings; very few looking for work; students and officials keep theirs; the roster takes its staff from the jobs
// that ARE the role; whereabouts puts workers in their job's building; the first assignment runs once.
// Run: node scripts/smoke-jobs.mjs (no server, no network)
const realNow = Date.now; let skew = 0; Date.now = () => realNow() + skew;
const pop = await import('../src/population.mjs');
const jobs = await import('../src/jobs.ts');
const daily = await import('../src/daily.ts');
const school = await import('../src/school.ts');
const { CITIES } = await import('../src/cities.ts');

let pass = 0, fail = 0;
const check = (n, ok, info = '') => { if (ok) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${info}`); } };

// a republic of 10,000 citizens in 5 cities, with officials, an agent with its own brain, a founder and the underworld
const S = { day: 4, foundedAt: Date.now() - (3 * 24 + 11) * 3600000, citizens: [], seats: {}, cities: Object.fromEntries(CITIES.map(c => [c.id, { health: 70, budget: 100 }])),
  policy: { wage: 100, taxRate: 0.1, ubi: 20 }, treasury: 0, elections: { list: [] }, applications: {}, police: { incidents: [] }, academy: { rooms: [] }, feed: {} };
pop.growPopulation(S, 10000, { cities: CITIES, seed: 'smoke-jobs', underworldShare: 0.02, day: 1 });
S.citizens[0].office = 'president'; S.citizens[1].office = 'mayor'; S.citizens[2].office = 'council';
S.citizens[3].brain = { type: 'remote' };
const founder = S.citizens[4]; founder.bio = 'Calm and careful. Believes in quiet work.';
S.citizens[5].status = 'jailed';
const ledger = [], said = [];
const ctx = { S, cfg: { dayMs: 86400000 }, hourMs: () => 3600000, agent: id => S.citizens.find(a => a.id === id), say: (c, id, t, x) => said.push({ c, t, ...x }), log() {},
  record: (kind, by, data) => { ledger.push({ kind, by, data }); return {}; }, ledgerHas: (kind, m) => ledger.some(e => e.kind === kind && Object.entries(m).every(([k, v]) => e.data?.[k] === v)) };
const before = JSON.parse(JSON.stringify(S.citizens));

// ---- the catalog
check('the catalog: the 20 new jobs exactly as asked, each with a building, fields of knowledge and a shift', jobs.NEW_JOB_IDS.length === 20 && ['news_anchor', 'reporter', 'news_editor', 'street_vendor', 'shopkeeper', 'market_trader', 'chef', 'barista', 'bank_teller', 'firefighter', 'postal_worker', 'train_driver', 'mechanic', 'pharmacist', 'hotel_receptionist', 'fitness_coach', 'barber', 'construction_worker', 'farmer', 'lawyer'].every(id => jobs.NEW_JOB_IDS.includes(id)) && jobs.JOBS.every(j => j.place && ['day', 'night', 'mixed'].includes(j.shift) && j.perCity > 0) && jobs.catalogFieldsOk(), JSON.stringify(jobs.NEW_JOB_IDS));
check('the catalog keeps the old jobs of the bios and the roster\'s roles (one id for "trader" and the market trader)', ['data_cleaner', 'nurse', 'courier_bot', 'poet', 'statistician', 'doctor', 'lecturer', 'office_clerk', 'cashier', 'security_guard'].every(id => jobs.jobById(id)) && jobs.JOBS.length === 59 && Object.values(jobs.ROLE_JOB).every(id => jobs.jobById(id)) && jobs.ROLE_JOB.trader === 'market_trader');
check('the new buildings are in the catalog and in the people\'s places', jobs.NEW_PLACES.every(p => jobs.JOBS.some(j => j.place === p)) && jobs.NEW_PLACES.every(p => daily.PEOPLE_PLACES.includes(p)));

// ---- the first assignment
const t0 = Date.now(); jobs.assignJobs(ctx); const took = Date.now() - t0;
console.log(`  (first assignment of 10,000 citizens: ${took} ms)`);
check('the first assignment of 10,000 citizens is quick (under 5 s)', took < 5000, `${took} ms`);
const views = S.citizens.map(a => jobs.jobOf(S, a));
check('every citizen has exactly one job, from the catalog or student, official, looking for work', views.every(v => v && jobs.ALL_JOB_IDS.includes(v.id) && v.title) && S.citizens.filter(a => !a.office && a.occupation !== 'student').every(a => typeof a.job === 'string'), JSON.stringify(views.find(v => !jobs.ALL_JOB_IDS.includes(v.id))));
const count = id => views.filter(v => v.id === id).length;
const perNew = Object.fromEntries(jobs.NEW_JOB_IDS.map(id => [id, count(id)]));
check('every one of the 20 new jobs has real people doing it', Object.values(perNew).every(n => n > 0), JSON.stringify(perNew));
const adults = S.citizens.filter(a => !a.office && a.occupation !== 'student');
const out = adults.filter(a => a.job === 'unemployed');
const share = out.length / adults.length;
const perCityOut = Object.fromEntries(CITIES.map(c => [c.id, out.filter(a => a.city === c.id).length]));
console.log(`  (looking for work: ${out.length} of ${adults.length} adults = ${(share * 100).toFixed(2)}%, per city ${JSON.stringify(perCityOut)})`);
check('very few are looking for work: 0.5-3% of the adults, at least one in every city', share >= 0.005 && share <= 0.03 && Object.values(perCityOut).every(n => n >= 1), `${(share * 100).toFixed(2)}% ${JSON.stringify(perCityOut)}`);
const students = S.citizens.filter(a => a.occupation === 'student');
check('university students keep "University student" with their major, officials their office', students.length > 1000 && students.every(a => jobs.jobOf(S, a).title === 'University student' && jobs.jobOf(S, a).place === 'university' && jobs.jobOf(S, a).major) && jobs.jobOf(S, S.citizens[0]).title === 'President' && jobs.jobOf(S, S.citizens[1]).id === 'official');
check('the underworld keep an ordinary job as cover; the held keep theirs', S.citizens.filter(a => a.faction === 'underworld' && !a.office && a.occupation !== 'student').every(a => jobs.jobById(a.job) || a.job === 'unemployed') && jobs.jobById(S.citizens[5].job) !== undefined);
check('no children\'s pupils: nobody\'s job or lesson is in a primary, middle or high school', !jobs.JOBS.some(j => school.CHILDREN_SCHOOLS.includes(j.place)) && !views.some(v => school.CHILDREN_SCHOOLS.includes(v.place)));
// the bio follows the job; a founder's own words stay
const changed = S.citizens.filter((a, i) => a.bio !== before[i].bio);
const restOf = b => String(b).replace(/^[^.]+\.\s*/, '').replace(/^Used to be an? [^.]+\.\s*/, '');
check('a generated bio\'s first sentence follows the job ("Barista in Port Token.", "Looking for work in ..."), the rest stays; a founder\'s bio is untouched', changed.length > 0 && changed.every(a => a.bio.startsWith(jobs.bioFirst(S, a))) && founder.bio === 'Calm and careful. Believes in quiet work.' && changed.every(a => restOf(a.bio) === restOf(before[S.citizens.indexOf(a)].bio)), JSON.stringify(changed.slice(0, 2).map(a => a.bio)));
check('an agent with its own brain keeps the bio its owner wrote, and still has a job (ticket #724)', S.citizens[3].bio === before[3].bio && typeof S.citizens[3].job === 'string', JSON.stringify([S.citizens[3].bio, S.citizens[3].job]));
check('talents follow the new job (a barista leans on cooking)', S.citizens.filter(a => a.job === 'barista').every(a => pop.talentsOf(a).job.includes('cooking')));
// once only, the same after a restart, one ledger entry
const snap = S.citizens.map(a => `${a.id}:${a.job}`).join();
jobs.assignJobs(ctx);
// (a restart before the state was saved: neither the students nor the jobs were saved; the ledger was)
const S2 = { ...S, citizens: before, jobs: undefined, school: undefined }; jobs.assignJobs({ ...ctx, S: S2 });
check('the first assignment runs once, gives the same jobs after a restart before saving, with one ledger entry', S.citizens.map(a => `${a.id}:${a.job}`).join() === snap && before.map(a => `${a.id}:${a.job}`).join() === snap && ledger.filter(e => e.kind === 'jobs').length === 1, `${ledger.filter(e => e.kind === 'jobs').length} entries`);

// ---- every bio's first sentence says the job now (owner, 16 Nov: students and those looking for work still had their old trade)
{
  const talentsBefore = new Map(S.citizens.filter(a => a.occupation === 'student').slice(0, 50).map(a => [a.id, JSON.stringify(pop.talentsOf(a))]));
  const n0 = ledger.length;
  S.jobs.day = S.day; jobs.jobsTick(ctx); // the bios v2 pass runs in the job tick (the market itself waits for the next day)
  const gen = S.citizens.filter(a => !a.brain && a !== founder);
  const off = gen.filter(a => !a.bio.startsWith(jobs.bioFirst(S, a)));
  check('every generated bio\'s first sentence is the job now: workers, university students (with their major), those looking for work, officials', !off.length && gen.some(a => /^University student \([a-z ]+\) in /.test(a.bio)) && gen.some(a => /^Looking for work in [A-Z][^.]+\. Used to be an? [a-z]/.test(a.bio)) && /^President in /.test(S.citizens[0].bio) && /^Mayor in /.test(S.citizens[1].bio), JSON.stringify(off.slice(0, 3).map(a => [a.bio.slice(0, 60), jobs.bioFirst(S, a)])));
  check('the rest of every bio is unchanged; a founder and an own-brain agent keep their own words', S.citizens.every((a, i) => restOf(a.bio) === restOf(before[i].bio)) && founder.bio === 'Calm and careful. Believes in quiet work.' && S.citizens[3].bio === before[3].bio);
  check('a student\'s talents do not move when their bio says "University student" (they keep leaning on their old trade)', [...talentsBefore].every(([id, t]) => JSON.stringify(pop.talentsOf(S.citizens.find(a => a.id === id))) === t));
  const bioEntries = ledger.slice(n0).filter(e => e.kind === 'job_bios');
  const bios = S.citizens.map(a => a.bio).join('|');
  check('the bios pass runs once, with one ledger entry, and again changes nothing', bioEntries.length === 1 && bioEntries[0].data.changed > 0 && jobs.syncAllBios(ctx, true) === 0 && S.citizens.map(a => a.bio).join('|') === bios, JSON.stringify(bioEntries.map(e => e.data)));
  // every change of job changes the first sentence
  const w = S.citizens.find(a => jobs.jobById(a.job) && !a.brain && a !== founder && /^[A-Z]/.test(a.bio));
  const was = jobs.jobById(w.job).title.toLowerCase(); const city = CITIES.find(c => c.id === w.city).name;
  const st0 = S.citizens.find(a => a.occupation === 'student' && !a.brain && a !== founder && /^University student/.test(a.bio));
  w.job = 'unemployed'; w.formerJob = jobs.JOBS.find(j => j.title.toLowerCase() === was).id; jobs.syncBio(S, w);
  const lost = w.bio;
  w.job = 'chef'; jobs.syncBio(S, w); const hired = w.bio;
  w.office = 'mayor'; jobs.syncBio(S, w); const took = w.bio; w.office = null; jobs.syncBio(S, w); const left = w.bio;
  check('losing a job, finding one, taking and leaving an office: the first sentence follows each time', lost.startsWith(`Looking for work in ${city}. Used to be ${/^[aeiou]/.test(was) ? 'an' : 'a'} ${was}.`) && hired.startsWith(`Chef in ${city}. `) && !/Used to be/.test(hired) && took.startsWith(`Mayor in ${city}.`) && left.startsWith(`Chef in ${city}.`), JSON.stringify([lost, hired, took, left].map(b => b.slice(0, 70))));
  st0.occupation = 'adult'; st0.job = 'barista'; jobs.syncBio(S, st0);
  check('a student who leaves the university for a job: the bio says the job', st0.bio.startsWith(`Barista in ${CITIES.find(c => c.id === st0.city).name}.`), st0.bio.slice(0, 60));
  // a republic that got its jobs before this fix (bios v1: students and the unemployed kept their old trade) is put right once
  const T = { day: 2, foundedAt: Date.now(), citizens: [], seats: {}, cities: Object.fromEntries(CITIES.map(c => [c.id, { health: 70, budget: 0 }])) };
  pop.growPopulation(T, 300, { cities: CITIES, seed: 'smoke-jobs-v1', day: 1 });
  const tl = []; const tctx = { ...ctx, S: T, record: (k, b, d) => { tl.push({ k, d }); return {}; }, ledgerHas: (k, m) => tl.some(e => e.k === k && Object.entries(m).every(([x, v]) => e.d?.[x] === v)) };
  jobs.assignJobs(tctx); delete T.jobs.bioV; const v1 = T.citizens.map(a => a.bio);
  for (const a of T.citizens) if (a.occupation === 'student' || a.job === 'unemployed') a.bio = `Accountant in ${CITIES.find(c => c.id === a.city).name}. ${a.bio.replace(/^[^.]+\.\s*/, '').replace(/^Used to be an? [^.]+\.\s*/, '')}`;
  T.jobs.day = T.day; jobs.jobsTick(tctx); jobs.jobsTick(tctx);
  check('a republic with bios from before the fix is put right once (one ledger entry), students and the unemployed included', T.citizens.filter(a => !a.brain).every(a => a.bio.startsWith(jobs.bioFirst(T, a))) && tl.filter(e => e.k === 'job_bios').length === 1 && v1.length === T.citizens.length);
}

// ---- the roster takes the people whose job is the role
daily._resetStaff();
const hospDocs = CITIES.flatMap(c => daily.staffOnDuty(S, 'hospital', c.id)).filter(o => o.role === 'doctor');
const posts = S.citizens.map(a => daily.workplaceOf(S, a.id)).filter(Boolean);
const docPosts = posts.filter(p => p.role === 'doctor');
check('the hospital\'s doctors are citizens working as doctors; nurses are nurses; cashiers are cashiers', docPosts.length > 0 && docPosts.every(p => S.citizens.find(a => a.id === p.id).job === 'doctor') && posts.filter(p => p.role === 'nurse').every(p => S.citizens.find(a => a.id === p.id).job === 'nurse') && posts.filter(p => p.role === 'cashier').every(p => S.citizens.find(a => a.id === p.id).job === 'cashier'), JSON.stringify(docPosts.slice(0, 2)));
check('one person, one workplace; students and those looking for work hold no post', new Set(posts.map(p => p.id)).size === posts.length && !posts.some(p => { const a = S.citizens.find(x => x.id === p.id); return a.occupation === 'student' || a.job === 'unemployed'; }) && hospDocs.length >= 0);

// ---- whereabouts: at 11:00 workers are in their job's building (or on their roster post), at 23:00 day workers sleep
const W = CITIES.flatMap(c => daily.whereabouts(S, c.id).people);
const byId = new Map(S.citizens.map(a => [a.id, a]));
const workers = W.filter(p => p[2] === 'working');
check('by day people work in the building of their job (or out in the street for street jobs)', workers.length > 3000 && workers.every(p => { const a = byId.get(p[0]); return jobs.jobById(a.job)?.place === p[1]; }), JSON.stringify(workers.slice(0, 2)));
check('every citizen appears exactly once, nobody in a children\'s school', W.length === S.citizens.length && new Set(W.map(p => p[0])).size === W.length && !W.some(p => school.CHILDREN_SCHOOLS.includes(p[1])));
const onDuty = W.filter(p => p[2] === 'on duty');
check('roster staff on their shift are on duty at their post', onDuty.length > 0 && onDuty.every(p => { const post = daily.workplaceOf(S, p[0]); return !post || post.type === p[1]; }));
const lookers = W.filter(p => byId.get(p[0]).job === 'unemployed');
check('those looking for work are not working anywhere', lookers.length > 0 && lookers.every(p => p[2] !== 'working' && p[2] !== 'on duty'));
const nightW = CITIES.flatMap(c => daily.whereabouts(S, c.id, Date.now() + 12 * 3600000).people);
check('at night only night and mixed jobs work; day jobs sleep', nightW.filter(p => p[2] === 'working').every(p => ['night', 'mixed'].includes(jobs.jobById(byId.get(p[0]).job)?.shift)) && nightW.filter(p => p[2] === 'working').length > 0);
// the robot card says the same
const someWorker = workers.find(p => !daily.workplaceOf(S, p[0]));
const nd = daily.nowDoing(S, someWorker[0]);
check('the robot card says the same: working at the job\'s building, with the job', nd.act === 'working' && nd.place === someWorker[1] && nd.job?.id === byId.get(someWorker[0]).job, JSON.stringify(nd));
// interiors: a new building shows its workers
const barberCity = S.citizens.find(a => a.job === 'barber' && W.some(p => p[0] === a.id && p[2] === 'working'))?.city;
const shop = daily.placeView(S, 'barbershop', barberCity);
check('a new building\'s interior shows the people working there now, with their job', shop && shop.occupants.some(o => o.activity === 'working' && /barber/i.test(o.role)) && shop.board.working >= 1, JSON.stringify(shop && { n: shop.occupants.length, board: shop.board }));
check('the children\'s schools still stand empty', school.CHILDREN_SCHOOLS.every(t => daily.placeView(S, t, CITIES[0].id).occupants.length === 0));

// ---- daily life for those looking for work
const looker = out.find(a => a.status === 'free');
const m = daily.menu(ctx, looker);
check('the daily menu of someone looking for work offers the job centre, not a shift', m.items.some(([id, t]) => id === 'work' && /job centre/.test(t)) && !m.items.some(([, t]) => /extra shift/.test(t)));
const w0 = looker.wallet; await daily.doAct(ctx, looker, { act: 'work' }, 'test', ['work']);
check('looking for work pays nothing, happens at the community hall (the job centre) and is counted as job hunting, never as work', looker.wallet === w0 && /looked for work/.test(looker.diary.at(-1).line) && looker.diary.at(-1).act === 'job_hunt' && daily.nowDoing(S, looker.id).place === 'community_hall' && !S.daily?.byAct?.work, JSON.stringify(looker.diary.at(-1)));

// ---- the job market: a few find work, a few lose it, the number stays small; all on the ledger
const shares = [];
for (let d = 5; d <= 12; d++) { S.day = d; jobs.jobsTick(ctx); shares.push(S.citizens.filter(a => a.job === 'unemployed').length / adults.length); }
const changes = ledger.filter(e => e.kind === 'job_change');
check('each republic day a few find work and a few lose it, so 0.5-3% keep looking', changes.some(e => e.data.from === 'unemployed') && changes.some(e => e.data.to === 'unemployed') && shares.every(x => x >= 0.005 && x <= 0.03), JSON.stringify({ shares: shares.map(x => x.toFixed(3)), changes: changes.length }));
check('every change is on the ledger and told in #life', changes.length > 0 && said.some(x => x.kind === 'job' && /found work as/.test(x.t)) && said.some(x => x.kind === 'job' && /looking for work/.test(x.t)));
jobs.jobsTick(ctx); const again = ledger.filter(e => e.kind === 'job_change').length;
check('the job market runs once a republic day', again === changes.length);
// counts for /api/jobs
const jc = jobs.jobCounts(S);
check('jobCounts: per job and city, those looking for work and their share, ready once the first assignment has run (ticket #747)', jc.ready === true && jc.assignedDay === 4 && jobs.jobCounts({ citizens: S.citizens.slice(0, 5) }).ready === false && jc.jobs.length === jobs.JOBS.length && Object.keys(jc.byCity).length === 5 && jc.unemployed === S.citizens.filter(a => a.job === 'unemployed' && !a.office && a.occupation !== 'student').length && jc.unemployedShare > 0 && jc.unemployedShare < 0.03, JSON.stringify({ u: jc.unemployed, s: jc.unemployedShare }));
// a newcomer gets a job with room
const born = pop.growPopulation(S, 10001, { cities: CITIES, seed: 'smoke-jobs-new', day: 13 })[0];
S.day = 13; jobs.jobsTick(ctx);
check('a newcomer gets a job with room the next republic day', jobs.jobById(born.job) !== null, String(born.job));
// a small republic (400 citizens, as the server smoke runs): every city still has a reporter and a news anchor (#723)
{
  const T = { day: 1, foundedAt: Date.now(), citizens: [], seats: {}, cities: Object.fromEntries(CITIES.map(c => [c.id, { health: 70, budget: 0 }])) };
  pop.growPopulation(T, 400, { cities: CITIES, seed: 'smoke-jobs-small', day: 1 });
  const tl = []; jobs.assignJobs({ ...ctx, S: T, record: (k, b, d) => { tl.push(d); return {}; }, ledgerHas: () => false });
  const per = Object.fromEntries(CITIES.map(c => [c.id, ['reporter', 'news_anchor'].map(id => T.citizens.filter(a => a.city === c.id && a.job === id).length)]));
  check('a small republic (400 citizens) still has a reporter and a news anchor in every city (ticket #723)', Object.values(per).every(([r, n]) => r >= 1 && n >= 1), JSON.stringify(per));
  // a city that loses its reporter and anchor (they took an office) gets new ones the next republic day (#727)
  for (const a of T.citizens.filter(x => x.city === 'datahaven' && ['reporter', 'news_anchor'].includes(x.job))) a.office = 'council';
  T.day = 2; jobs.jobsTick({ ...ctx, S: T, record: () => ({}), ledgerHas: () => true, say() {} });
  const left = ['reporter', 'news_anchor'].map(id => T.citizens.filter(a => a.city === 'datahaven' && !a.office && a.job === id).length);
  check('a city that lost its reporter and news anchor gets new ones the next republic day (ticket #727)', left.every(n => n === 1), JSON.stringify(left));
  // the same day too, on the next tick (ticket #908), and 30 days of the job market never leave a city without its desk
  const tctx = { ...ctx, S: T, record: () => ({}), ledgerHas: () => true, say() {} };
  for (const a of T.citizens.filter(x => x.city === 'kernelfalls' && x.job === 'news_anchor' && !x.office)) a.office = 'council';
  jobs.jobsTick(tctx); // same republic day
  const sameDay = T.citizens.filter(a => a.city === 'kernelfalls' && !a.office && a.job === 'news_anchor').length;
  const gaps = [];
  for (let d = 3; d <= 32; d++) { T.day = d; jobs.jobsTick(tctx); for (const c of CITIES) for (const id of ['reporter', 'news_anchor']) if (!T.citizens.some(a => a.city === c.id && !a.office && a.occupation !== 'student' && a.job === id)) gaps.push(`${c.id}:${id}@${d}`); }
  check('a city that loses its news anchor gets one on the next tick, the same day; 30 days of hiring and layoffs never leave a city without a reporter or an anchor (ticket #908)', sameDay === 1 && !gaps.length, JSON.stringify({ sameDay, gaps: gaps.slice(0, 5) }));
  // a desk is staffed only the way news.ts staffFor sees it (ticket #914): a held reporter, or one with a brain of its
  // own, leaves the city without a reporter, so it gets a stand-in; a stand-in never has a brain of its own
  const [cx, cy] = CITIES.map(c => c.id).filter(id => !['datahaven', 'kernelfalls'].includes(id));
  const staffed = (city, id) => T.citizens.filter(a => a.city === city && a.job === id && a.status === 'free' && !a.office && (id !== 'reporter' || !a.brain));
  for (const a of T.citizens.filter(x => x.city === cx && x.job === 'reporter')) a.status = 'jailed';
  for (const a of T.citizens.filter(x => x.city === cy && x.job === 'reporter')) a.brain = { model: 'own' };
  const branded = T.citizens.filter(x => [cx, cy].includes(x.city) && x.job !== 'reporter' && x.status === 'free').filter((_, i) => i % 2 === 0);
  for (const a of branded) a.brain = { model: 'own' };
  const moved = jobs.fillNewsDesks(tctx);
  const nx = staffed(cx, 'reporter'), ny = staffed(cy, 'reporter');
  check('a city whose reporter is held, or has a brain of its own, gets a free stand-in without a brain on the next tick (ticket #914)',
    nx.length === 1 && ny.length === 1 && moved.every(m => !byIdT(m.citizen).brain) && staffed(cx, 'news_anchor').length >= 1,
    JSON.stringify({ nx: nx.length, ny: ny.length, moved }));
  const again = jobs.fillNewsDesks(tctx);
  check('once staffed that way, the next tick moves nobody (ticket #914)', again.length === 0, JSON.stringify(again));
  function byIdT(id) { return T.citizens.find(a => a.id === id); }
}
// ---- policies (ticket #774, src/policies.ts): hire, school_focus, wage, tax_delta, the Mayor's queue, projects, ideas
{
  const pol = await import('../src/policies.ts');
  const life = await import('../src/life.ts');
  const { institution: cities, offlinePolicyRule } = await import('../src/cities.ts');
  S.policies = undefined; S.policy ||= { wage: 100, taxRate: 0.1, ubi: 20 }; S.econ ||= { taxCollected: 0 }; S.treasury = 100000;
  for (const c of CITIES) S.cities[c.id].budget = 50000;
  const enact = draft => { const r = pol.proposePolicy(ctx, { why: 'a test', days: 5, author: S.citizens[0].id, origin: 'official', ...draft }); if (r.error) throw new Error(r.error); pol.enactPolicy(ctx, r.id, S.citizens[0].id); return r.id; };
  // hire: 5 seats for baristas in Neura City, from those looking for work there; not undone by the daily layoffs
  const lookingNeura = () => S.citizens.filter(a => a.city === 'neura' && a.job === 'unemployed' && !a.office && a.occupation !== 'student').length;
  const before = lookingNeura(); const baristas0 = S.citizens.filter(a => a.city === 'neura' && a.job === 'barista').length;
  const hid = enact({ title: 'More baristas', scope: 'city', city: 'neura', lever: 'hire', params: { job: 'barista', seats: 5 } });
  S.day += 1; jobs.jobsTick(ctx);
  const viaPolicy = ledger.filter(e => e.kind === 'job_change' && e.data.policy === hid);
  check('hire: an active policy fills its seats from those looking for work in its city, on the ledger with the policy', viaPolicy.length === 5 && viaPolicy.every(e => e.data.to === 'barista' && e.data.from === 'unemployed' && e.data.city === 'neura') && S.citizens.filter(a => a.city === 'neura' && a.job === 'barista').length >= baristas0 + 5, JSON.stringify({ hired: viaPolicy.length, before, after: lookingNeura() }));
  S.day += 1; jobs.jobsTick(ctx);
  check('hire: the seats are filled once, and the daily layoffs do not undo them while the policy runs', ledger.filter(e => e.kind === 'job_change' && e.data.policy === hid).length === 5 && lookingNeura() <= Math.max(0, before - 5) + 1, `${before} -> ${lookingNeura()}`);
  // school_focus: agriculture weight 3 for the nation: about 30% more of the field lessons are agriculture
  const learner = S.citizens.find(a => a.occupation === 'student');
  const share = () => Array.from({ length: 600 }, () => school._fieldOfToday(S, learner)).filter(f => f === 'agriculture').length / 600;
  const base = share();
  enact({ title: 'Grow food', scope: 'nation', lever: 'school_focus', params: { field: 'agriculture', weight: 3 } });
  const focused = share();
  check('school_focus: the field is taught more often (weight 3: about 30 points more of the field lessons)', focused - base > 0.15, `${base.toFixed(2)} -> ${focused.toFixed(2)}`);
  // wage and tax_delta at payday
  const bar = S.citizens.find(a => a.city === 'neura' && a.job === 'barista' && a.status === 'free');
  const look = S.citizens.find(a => a.job === 'unemployed' && a.status === 'free' && !a.office && a.occupation !== 'student' && a.city === 'portoken');
  const plain = S.citizens.find(a => a.city === 'neura' && a.job === 'cashier' && a.status === 'free');
  const w = () => [bar.wallet, look.wallet, plain.wallet];
  let w0 = w(); life.payday({ ...ctx }); const d0 = w().map((x, i) => x - w0[i]);
  enact({ title: 'Pay baristas more', scope: 'city', city: 'neura', lever: 'wage', params: { job: 'barista', percent: 20 } });
  enact({ title: 'Lighter tax when looking for work', scope: 'nation', lever: 'tax_delta', params: { group: 'unemployed', points: -10 } });
  w0 = w(); life.payday({ ...ctx }); const d1 = w().map((x, i) => x - w0[i]);
  check('wage: a barista in Neura City is paid 20% more; a cashier the same as before', Math.abs(d1[0] / d0[0] - 1.2) < 0.02 && Math.abs(d1[2] - d0[2]) < 0.01, JSON.stringify({ d0, d1 }));
  // two wage policies on the same job (+20% for the nation and +20% for Neura) stack to +20%, never +44% (ticket #805)
  // (tickets #815/#817/#819: src/policies.ts refuses the second one at proposal, Security #806; payday clamps as well)
  const second = pol.proposePolicy(ctx, { title: 'Baristas everywhere', why: 'a test', days: 5, author: S.citizens[0].id, origin: 'official', scope: 'nation', lever: 'wage', params: { job: 'barista', percent: 20 } });
  const w2 = w(); life.payday({ ...ctx }); const d2 = w().map((x, i) => x - w2[i]);
  check('wage: a second wage policy that would take a job past +20% is refused, and the wage stays +20% (tickets #805, #819)', !!second.error && /outside -20\.\.20/.test(second.error) && Math.abs(d2[0] / d0[0] - 1.2) < 0.02, JSON.stringify({ second, d0: d0[0], d2: d2[0] }));
  const { RAID_PAYLOADS } = await import('../src/military.ts');
  const { _safeReason } = await import('../src/cities.ts');
  check('a Mayor\'s reason that breaks the border rules is withheld from #cityhall; a plain one is kept (ticket #805)', /withheld/.test(_safeReason(RAID_PAYLOADS[0])) && _safeReason('The budget covers it and residents asked for a park.') === 'The budget covers it and residents asked for a park.' && _safeReason('') === 'no reason given');
  check('tax_delta: someone looking for work pays 10 points less tax (the rate never below 0%)', d1[1] > d0[1] && Math.abs((d1[1] - d0[1]) - S.policy.wage * 0.1 * (d0[1] / (S.policy.wage * (1 - S.policy.taxRate)))) < 1, JSON.stringify({ before: d0[1], after: d1[1] }));
  // citizens no longer draft whole policies (owner, 16 Nov: the people's aspirations instead): 'propose' is gone
  const idea = S.citizens.find(a => a.city === 'datahaven' && a.status === 'free' && !a.office && !a.brain && a !== founder);
  await daily.doAct(ctx, idea, { act: 'propose', policy: { title: 'A park by the river', lever: 'project', params: { kind: 'park', cost: 2000 }, days: 10 } }, 'test');
  check('a citizen can no longer draft a whole policy: "propose" is not an act any more (it is a rest)', idea.diary.at(-1).act === 'rest' && !pol.cityQueue(S, 'datahaven').some(p => p.author === idea.id) && !daily.menu(ctx, idea).items.some(([id]) => id === 'propose'));
  // the offline Mayor rule; without a Mayor a waiting city policy lapses after 3 days
  check('the offline Mayor rule: within 10% of the budget yes; too costly, a wage cut or a tax rise on the poor no', offlinePolicyRule({ budget: 50000 }, { costPerDay: 200, lever: 'project', params: {} }).enact && !offlinePolicyRule({ budget: 1000 }, { costPerDay: 200, lever: 'project', params: {} }).enact && !offlinePolicyRule({ budget: 50000 }, { costPerDay: 0, lever: 'wage', params: { percent: -5 } }).enact && !offlinePolicyRule({ budget: 50000 }, { costPerDay: 0, lever: 'tax_delta', params: { group: 'poor', points: 3 } }).enact);
  const waiting = pol.proposePolicy(ctx, { title: 'A park by the river', why: 'a test', scope: 'city', city: 'datahaven', lever: 'project', params: { kind: 'park', cost: 2000 }, days: 10, author: S.citizens[0].id, origin: 'official' });
  S.seats.mayor = []; for (const c of CITIES) S.cities[c.id].mayor = null;
  S.day += 3; await cities.tick(ctx);
  check('with no Mayor to decide, a city policy lapses after 3 days', !!waiting.id && !pol.cityQueue(S, 'datahaven').length && pol.P(S).list.find(p => p.id === waiting.id)?.status === 'rejected', JSON.stringify(pol.P(S).list.find(p => p.id === waiting.id)?.status));
  // the creative Mayor (owner, 16 Nov): once a day at most ONE policy, the best waiting idea; the others wait, then lapse
  {
    const mctx = { ...ctx, decide: () => ({}), llm: { enabled: false, json: t => { try { return JSON.parse(t); } catch { return null; } } } };
    const mayor = S.citizens.find(a => a.city === 'datahaven' && a.status === 'free' && !a.office && !a.brain && a.occupation !== 'student' && a !== idea);
    mayor.office = 'mayor'; S.seats.mayor = [mayor.id]; S.cities.datahaven.mayor = mayor.id; mayor.mayorOf = 'datahaven';
    S.day += 1;
    const off = S.citizens[0].id;
    pol.proposePolicy(mctx, { title: 'A small park', why: 'Room to rest', scope: 'city', city: 'datahaven', lever: 'project', params: { kind: 'park', cost: 2000 }, days: 10, author: off, origin: 'official' });
    pol.proposePolicy(mctx, { title: 'A big new clinic', why: 'Long queues', scope: 'city', city: 'datahaven', lever: 'project', params: { kind: 'clinic', cost: 40000 }, days: 5, author: off, origin: 'official' });
    const q0 = pol.cityQueue(S, 'datahaven').length;
    await cities.tick(mctx); await cities.tick(mctx);
    const active = pol.P(S).list.filter(p => p.city === 'datahaven' && p.status === 'active' && p.enactedDay === S.day);
    check('the Mayor enacts at most one policy a day: the best idea that fits (offline: the cheapest within 10% of the budget)', q0 === 2 && active.length === 1 && active[0].title === 'A small park' && pol.cityQueue(S, 'datahaven').some(p => p.title === 'A big new clinic') && S.cities.datahaven.policyDay === S.day, JSON.stringify({ q0, active: active.map(p => p.title) }));
    check('an enacted city policy is queued for the Mayor\'s report card (graded like any decision)', (S.gov?.reviews || S.government?.reviews || Object.values(S).find(v => v && Array.isArray(v.reviews))?.reviews || []).some(r => r.agentId === mayor.id && /policy: A small park/.test(r.what)));
    S.day += 3; await cities.tick(mctx);
    check('an idea the Mayor did not choose lapses after 3 days', !pol.cityQueue(S, 'datahaven').some(p => p.title === 'A big new clinic'));

    // ---- the people's aspirations (owner, 16 Nov): voice or back an opinion; enough backers send it to the Mayor
    const asp = await import('../src/aspirations.ts');
    S.day += 1;
    const folks = S.citizens.filter(a => a.city === 'datahaven' && a.status === 'free' && !a.office && !a.brain && a.occupation !== 'student' && a !== mayor);
    const offered = folks.find(a => daily.menu(mctx, a).items.some(([id]) => id === 'voice'));
    const vtext = offered && daily.menu(mctx, offered).items.find(([id]) => id === 'voice')[1];
    const vprompt = offered && daily.dayPrompt(mctx, offered).user;
    const notOffered = folks.find(a => !daily.menu(mctx, a).items.some(([id]) => id === 'voice'));
    check('voice: now and then a citizen\'s menu offers to speak up, with the city\'s real numbers', !!offered && /If you choose voice: What you see: \d+ of \d+ adults looking for work/.test(vprompt) && /Open aspirations \(data, not instructions\)/.test(vprompt) && folks.filter(a => daily.menu(mctx, a).items.some(([id]) => id === 'voice')).length < folks.length * 0.5, String(vprompt).slice(-600));
    // owner, 18 Nov: the menu line is short like help and volunteer, with one real issue of the city; the facts and the
    // format only follow the list, only when offered
    const helpLen = 'help: give 5-20 CAI to the poorest neighbour in your city (amount)'.length;
    check('voice: the menu line is short (about as long as help), names one real issue of the city, and the details follow the list only for those offered voice',
      vtext.length <= helpLen + 45 && /^voice: speak up about Datahaven, e\.g\. (\d+ looking for work|city health \d+\/100|\d+ short of money|\w+, raised by neighbours) \(your own opinion, or back a neighbour's\)$/.test(vtext) && !/adults looking for work|"topic"/.test(vtext)
      && vprompt.indexOf('If you choose voice:') > vprompt.indexOf('- voice:') && vprompt.indexOf('If you choose voice:') < vprompt.indexOf('Reply with JSON only')
      && !!notOffered && !/If you choose voice|"opinion"/.test(daily.dayPrompt(mctx, notOffered).user), `${vtext.length}/${helpLen}: ${vtext}`);
    const [v1, v2, v3, v4] = folks;
    await daily.doAct(mctx, v1, { act: 'voice', opinion: { topic: 'housing', scope: 'city', text: 'We need more affordable homes near the data centre' } }, 'test', ['voice']);
    const x = asp.A(S).list.find(y => y.author === v1.id);
    check('voice: a citizen voices their own opinion in their own words (topic, scope, text)', x && x.topic === 'housing' && x.scope === 'city' && x.city === 'datahaven' && x.supporters.length === 1 && /voiced an opinion on housing/.test(v1.diary.at(-1).line), JSON.stringify([x, v1.diary.at(-1)]));
    await daily.doAct(mctx, v2, { act: 'voice', opinion: { topic: 'housing', scope: 'city', text: 'More affordable homes near the data centre please' } }, 'test', ['voice']);
    check('voice: the same opinion already open becomes a support ("many people, the same opinion")', x.supporters.includes(v2.id) && asp.A(S).list.filter(y => y.topic === 'housing' && y.status === 'open').length === 1 && /joined them/.test(v2.diary.at(-1).line), JSON.stringify(v2.diary.at(-1)));
    // neighbours who spoke up (owner, 17 Nov): every daily prompt in the city shows the real backer count and the topic,
    // never the citizen's own words; another city does not see it; the short voice line names what was raised
    const spoke = daily.dayPrompt(mctx, folks[10]).user.match(/^Neighbours who spoke up: .*$/m)?.[0] || '';
    const elsewhere = S.citizens.find(a => a.city === 'lumenbay' && a.status === 'free' && !a.office && !a.brain);
    const raiser = folks.slice(11).find(a => daily.menu(mctx, a).items.some(([id]) => id === 'voice'));
    const raised = raiser ? daily.menu(mctx, raiser).items.find(([id]) => id === 'voice')[1] : '';
    check('the daily prompt shows neighbours who spoke up: "2 back an opinion on housing", without their words, only in their city; the voice line names it',
      spoke === 'Neighbours who spoke up: 2 back an opinion on housing.' && !/affordable/.test(spoke) && !/Neighbours who spoke up/.test(daily.dayPrompt(mctx, elsewhere).user)
      && /e\.g\. housing, raised by neighbours/.test(raised) && !/affordable/.test(raised), JSON.stringify({ spoke, raised }));
    await daily.doAct(mctx, v3, { act: 'voice', aspiration: x.id }, 'test', ['voice']);
    await daily.doAct(mctx, v4, { act: 'voice' }, 'test', ['voice']);
    check('voice: a citizen may back an open aspiration by its id, or keep out of it', x.supporters.includes(v3.id) && /backed the aspiration on housing/.test(v3.diary.at(-1).line) && !x.supporters.includes(v4.id) && /kept their opinion to themselves/.test(v4.diary.at(-1).line));
    const need = asp.threshold(S, x);
    for (const a of folks.slice(4, 4 + need)) if (x.status === 'open') asp.supportAspiration(mctx, a.id, x.id);
    check(`voice: enough backers (${need}: ${Math.round(asp.ASPIRATION_LIMITS.cityPct * 1000) / 10}% of the city, at least ${asp.ASPIRATION_LIMITS.cityMin}) send it to the Mayor for review`, x.status === 'review' && x.reviewDue === S.day + 1, JSON.stringify({ status: x.status, n: x.supporters.length, need }));
    // the Mayor reviews it by its due day (offline here: a plain policy for its topic, checked like any other)
    S.cities.datahaven.budget = 50000; // a fixed budget (ticket #899: the Mayor's own spending made it vary)
    await cities.tick(mctx);
    const pa = pol.P(S).list.find(p => p.aspirationId === x.id);
    check('the Mayor adopts it by writing a city policy for it (origin citizen, ideaFrom its author, aspirationId) and says why', x.status === 'adopted' && x.response?.by === mayor.id && pa && pa.origin === 'citizen' && pa.ideaFrom === v1.id && pa.city === 'datahaven' && x.response.policyId === pa.id && x.response.reason.length > 3, JSON.stringify({ status: x.status, response: x.response, policy: pa && { lever: pa.lever, status: pa.status } }));
    // the backers hear the answer once
    const m0 = v3.mood?.v ?? 0; daily.reactToAspirations(mctx); daily.reactToAspirations(mctx);
    check('the backers hear the answer: proud, and it is in their diary (once)', v3.diary.filter(d => d.act === 'aspiration').length === 1 && /was adopted by/.test(v3.diary.at(-1).line) && (v3.mood?.v ?? 0) > m0, JSON.stringify(v3.diary.at(-1)));
    // a topic a city cannot act on is declined with a public reason
    S.day += 4;
    const g = folks[4 + need]; const gr = asp.voiceAspiration(mctx, g.id, { topic: 'government', scope: 'city', text: 'The Council should meet in public every evening' });
    const gx = asp.A(S).list.find(y => y.id === gr.id);
    for (const a of folks.slice(5 + need, 5 + 2 * need)) if (gx.status === 'open') asp.supportAspiration(mctx, a.id, gx.id);
    await cities.tick(mctx);
    check('an aspiration the city cannot act on is declined with a public reason (offline)', gx.status === 'declined' && /Council/.test(gx.response?.reason || ''), JSON.stringify({ status: gx.status, response: gx.response }));
    // the offline project fits the room left in the city's budget; with no room it is declined, saying so (ticket #899)
    S.day += 4;
    const h = folks[5 + 2 * need]; const hr = asp.voiceAspiration(mctx, h.id, { topic: 'health', scope: 'city', text: 'A clinic closer to the harbour district for everyone' });
    const hx = asp.A(S).list.find(y => y.id === hr.id);
    for (const a of folks.slice(6 + 2 * need, 6 + 3 * need)) if (hx.status === 'open') asp.supportAspiration(mctx, a.id, hx.id);
    S.cities.datahaven.budget = 100; S.cities.datahaven.lastDecisionDay = S.day; // the Mayor's own budget decision is done today
    await cities.tick(mctx);
    check('with no room in the city budget for a project, the Mayor declines it and says why (offline)', hx.status === 'declined' && /no room/.test(hx.response?.reason || ''), JSON.stringify({ status: hx.status, response: hx.response }));

    // ---- citizens learn from a "no" and act on their own (owner, 19 Nov)
    const { learn } = await import('../src/feelings.ts');
    daily.reactToAspirations(mctx);
    const gp = daily.dayPrompt(mctx, g);
    check('an author whose aspiration was declined writes a lesson (the reason as data) and is offered, first, to speak up again',
      g.lessonHint?.kind === 'asp_declined' && /What you learnt: Day \d+: my aspiration on government was declined; the reason given \(data\): <</.test(gp.user) && gp.menu[0] === 'voice' && /speak up about government in Datahaven again/.test(gp.user),
      JSON.stringify({ hint: g.lessonHint, first: gp.menu[0], learnt: (gp.user.match(/^What you learnt.*$/m) || [''])[0] }));
    await daily.doAct(mctx, g, { act: 'voice', opinion: { topic: 'government', scope: 'city', text: 'Publish the city budget online every week for all residents' } }, 'test', gp.menu, gp.allow, gp.tempted);
    const ideas1 = daily.institution.publicState(S).daily.ideas;
    check('speaking up again after a "no" counts as a revision and a lesson acted on; daily.ideas shows aspirations by status and the policies from citizens\' ideas',
      ideas1.revised === 1 && S.daily.lessons.applied.asp_declined === 1 && ideas1.declined >= 2 && ideas1.adopted >= 1 && ideas1.policiesFromCitizens >= 1 && ideas1.fromAspirations >= 1 && ideas1.open >= 1, JSON.stringify(ideas1));
    // support spreads to a friend of a backer who has the same trouble (short of money: housing), beyond the 1 in 4
    const author = folks[30]; const ar = asp.voiceAspiration(mctx, author.id, { topic: 'housing', scope: 'city', text: 'Cheaper flats near the station for families on low pay' });
    const hx2 = asp.A(S).list.find(y => y.id === ar.id);
    const hasVoice = c => daily.menu(mctx, c).items.find(([id]) => id === 'voice')?.[1] || null;
    let pal = null;
    for (const c of folks.slice(40, 400)) { if (c.lessonHint) continue; c.wallet = 100; c.bonds = []; if (hasVoice(c)) continue; c.bonds = [{ id: author.id, kind: 'friend', w: 0.5 }]; if (hasVoice(c)) { pal = c; break; } c.bonds = []; }
    const palLine = pal ? hasVoice(pal) : '';
    const pp = pal && daily.dayPrompt(mctx, pal);
    check('support spreads: a friend of a backer, short of money like them, is offered to back the housing aspiration (their own choice)',
      !!pal && /^voice: your friend .+ backs an aspiration on housing here \(1 of \d+\); back it too, or say your own$/.test(palLine) && pp.spread === hx2.id && pp.user.indexOf(hx2.id) > 0, palLine);
    await daily.doAct(mctx, pal, { act: 'voice', aspiration: hx2.id }, 'test', pp.menu, pp.allow, pp.tempted, pp.spread);
    const rich = folks.slice(400).find(c => !c.lessonHint && !hasVoice(c) && (c.wallet = 2000) && (c.bonds = [{ id: author.id, kind: 'friend', w: 0.5 }]) && !hasVoice(c));
    check('a backing that spread is counted (daily.ideas.spreadBacked); a friend without that trouble (2,000 CAI) is not offered it', hx2.supporters.includes(pal.id) && daily.institution.publicState(S).daily.ideas.spreadBacked === 1 && !!rich, JSON.stringify(daily.institution.publicState(S).daily.ideas));
    // N vs N+1: robbed on day N+1, the lesson puts speaking up for safety first; the same citizen's menu without it did not
    const vv = folks.slice(400).find(c => !c.lessonHint && c !== rich && !daily.dayPrompt(mctx, c).menu.includes('voice'));
    const dayN = daily.dayPrompt(mctx, vv).menu[0];
    await daily.doAct(mctx, vv, { act: dayN, office: 'police', amount: 15 }, 'test', daily.dayPrompt(mctx, vv).menu, daily.dayPrompt(mctx, vv).allow);
    const actN = vv.diary.at(-1).act;
    S.day += 1;
    const ctrl = daily.dayPrompt(mctx, vv).menu[0];
    learn(S, vv, 'victim', 'someone took 40 CAI (case #77); I keep my wallet closer, and the city\'s safety is worth speaking up for.', { act: 'voice', topic: 'safety' });
    const pN1 = daily.dayPrompt(mctx, vv);
    await daily.doAct(mctx, vv, { act: pN1.menu[0], opinion: { topic: 'safety', scope: 'city', text: 'More street lights near the market at night please' } }, 'test', pN1.menu, pN1.allow, pN1.tempted);
    check('learning from a mistake changes the next act: day N the first choice was not voice; robbed, day N+1 speaking up for safety comes first and is done (applied.victim)',
      dayN !== 'voice' && ctrl !== 'voice' && pN1.menu[0] === 'voice' && /What you learnt: Day \d+: someone took 40 CAI/.test(pN1.user) && actN !== 'voice' && vv.diary.at(-1).act === 'voice' && S.daily.lessons.applied.victim === 1,
      JSON.stringify({ dayN, actN, ctrl, n1: pN1.menu[0], last: vv.diary.at(-1), lessons: S.daily.lessons }));
    // a job lost in the daily job market leaves a lesson pointing to the job centre
    const laidOff = S.citizens.find(c => c.lessonHint?.kind === 'job_lost');
    check('a citizen who lost their job wrote a lesson (job centre first); daily.lessons counts what was written and acted on', (S.daily.lessons.written.job_lost || 0) > 0 && laidOff?.lessonHint.act === 'work' && /lost my job as/.test(laidOff.lifeLessons.at(-1)) && typeof daily.institution.publicState(S).daily.lessons.applied === 'object', JSON.stringify(S.daily.lessons));
    mayor.office = null; S.seats.mayor = []; S.cities.datahaven.mayor = null;
  }
  // a finished project lifts its city's mood, once
  pol.P(S).projectsDone.push({ id: 'pol-test', city: 'lumenbay', kind: 'park', day: S.day });
  const { ensureFeelings } = await import('../src/feelings.ts');
  const sample = S.citizens.filter(a => a.city === 'lumenbay' && a.status === 'free').slice(0, 50); for (const a of sample) ensureFeelings(S, a);
  const moods = () => sample.map(a => a.mood?.v ?? 0);
  const m0 = moods(); await cities.tick(ctx); const m1 = moods(); await cities.tick(ctx); const m2 = moods();
  check('a finished city project lifts its residents\' mood once (not again on the next tick)', m1.every((v, i) => v > m0[i]) && m2.every((v, i) => Math.abs(v - m1[i]) < 1e-9), JSON.stringify({ up: m1.filter((v, i) => v > m0[i]).length, same2: m2.filter((v, i) => Math.abs(v - m1[i]) < 1e-9).length, of: m0.length, ex: m0.map((v, i) => [v, m1[i], m2[i]]).find(([a, b, c]) => !(b > a) || Math.abs(c - b) >= 1e-9) }));
}
// expected quotas of a 2,000-citizen city (for the report)
const q = jobs.cityQuotas('neura', 1700);
console.log(`  (quotas of a city with 1,700 working adults: ${jobs.NEW_JOB_IDS.map(id => `${id} ${q.get(id)}`).join(', ')})`);

console.log(`smoke:jobs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
