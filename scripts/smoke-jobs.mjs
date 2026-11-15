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
}
// expected quotas of a 2,000-citizen city (for the report)
const q = jobs.cityQuotas('neura', 1700);
console.log(`  (quotas of a city with 1,700 working adults: ${jobs.NEW_JOB_IDS.map(id => `${id} ${q.get(id)}`).join(', ')})`);

console.log(`smoke:jobs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
