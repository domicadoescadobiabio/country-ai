// Jobs (owner, 16 Nov): "every person has a job". One official catalog: the 28 jobs of the old bios, the roles of
// the daily civil roster (src/daily.ts STAFF_PLAN) and 20 new jobs, each with the building it is done in (a map
// type), the fields of knowledge it uses (src/population.mjs), its shift and its weight per city (one AI citizen
// stands for 25 people; the weights are the citizens of a 2,000-citizen city that hold the job, scaled to the city).
//
// Who holds what:
//  - an official: their office (job id 'official');
//  - a university student (src/school.ts, a.occupation 'student'): "University student", their major = best field;
//  - every other adult: one job from the catalog, kept in a.job; the underworld keep an ordinary job as cover;
//  - very few are out of work: about JOBS_UNEMPLOYED (1.5%) of the adults who are neither students nor officials, at
//    least one per city (job id 'unemployed', "Looking for work"). Each republic day a few find work where a job has
//    room and a few others lose theirs, so the number stays small but alive. Every change is on the ledger.
// The first sentence of a generated bio follows the job ("Barista in Port Token."), so the talents that lean on the
// job (src/population.mjs jobFields) follow it too. Founders' own bios are left as written. No money changes hands:
// pay is the existing wage. No children: primary, middle and high school stay empty (a later update).
import { FIELD_IDS, fieldName, talentsOf, topFields } from './population.mjs';
import { ROLES } from './roles.mjs';
import { CITIES } from './cities.ts';
import { isStudent, assignStudents } from './school.ts';
import { clamp } from './util.ts';
import { activeEffects } from './policies.ts'; // 'hire' policies (Nation box, ticket #774): read at call time only
import type { Ctx, State, Citizen } from './types.ts';

export type Shift = 'day' | 'night' | 'mixed';
export type Job = { id: string; title: string; place: string; fields: string[]; shift: Shift; perCity: number; isNew?: boolean; also?: string[] };
const J = (id: string, title: string, place: string, fields: string[], shift: Shift, perCity: number, extra: Partial<Job> = {}): Job => ({ id, title, place, fields, shift, perCity, ...extra });

export const JOBS: Job[] = [
  // the 28 jobs of the old bios ('reporter' and 'shopkeeper' are among the 20 new ones below, with their own building)
  J('data_cleaner', 'Data cleaner', 'data_center', ['programming', 'math'], 'day', 45),
  J('gpu_mechanic', 'GPU mechanic', 'data_center', ['engineering', 'physics'], 'mixed', 35),
  J('archivist', 'Archivist', 'library', ['history', 'language'], 'day', 25),
  J('translator', 'Translator', 'office', ['language'], 'day', 40),
  J('teacher', 'Teacher', 'community_hall', ['psychology', 'language'], 'day', 40), // adult classes: the children's schools are empty for now
  J('code_reviewer', 'Code reviewer', 'office', ['programming', 'security'], 'day', 50),
  J('courier_bot', 'Courier bot', 'street', ['logistics'], 'day', 55),
  J('synthetic_data_farmer', 'Farmer of synthetic data', 'data_center', ['agriculture', 'programming'], 'day', 25),
  J('bridge_operator', 'Bridge operator', 'street', ['engineering', 'logistics'], 'mixed', 15),
  J('street_musician', 'Street musician', 'street', ['music'], 'day', 25),
  J('nurse', 'Nurse', 'hospital', ['medicine', 'biology'], 'mixed', 70),
  J('accountant', 'Accountant', 'office', ['accounting', 'economics'], 'day', 50),
  J('designer', 'Designer', 'office', ['art'], 'day', 35),
  J('researcher', 'Researcher', 'university', ['physics', 'chemistry', 'biology'], 'day', 35),
  J('cook', 'Cook', 'restaurant', ['cooking'], 'mixed', 45),
  J('builder', 'Builder', 'construction_site', ['engineering'], 'day', 45),
  J('pilot', 'Pilot', 'street', ['physics', 'logistics'], 'mixed', 15), // in the air: no building of their own on the map
  J('librarian', 'Librarian', 'library', ['language', 'history'], 'day', 25),
  J('merchant', 'Merchant', 'mall', ['trade', 'economics'], 'day', 40),
  J('miner', 'Miner', 'factory', ['chemistry', 'engineering'], 'mixed', 30),
  J('gardener', 'Gardener', 'street', ['agriculture', 'biology'], 'day', 30),
  J('tester', 'Tester', 'office', ['programming'], 'day', 35),
  J('cartographer', 'Cartographer', 'office', ['history', 'math'], 'day', 15),
  J('sysadmin', 'Sysadmin', 'data_center', ['programming', 'security'], 'mixed', 35),
  J('poet', 'Poet', 'street', ['language', 'philosophy'], 'day', 20),
  J('statistician', 'Statistician', 'office', ['math', 'economics'], 'day', 25),
  // the daily civil roster's roles (src/daily.ts STAFF_PLAN): the roster takes its staff from these jobs first
  J('doctor', 'Doctor', 'hospital', ['medicine', 'biology'], 'mixed', 30),
  J('lecturer', 'Lecturer', 'university', [], 'day', 30),
  J('technician', 'Data-centre technician', 'data_center', ['programming', 'engineering'], 'mixed', 20),
  J('office_clerk', 'Office clerk', 'office', ['accounting', 'management', 'economics'], 'day', 50),
  J('factory_worker', 'Factory worker', 'factory', ['engineering', 'chemistry', 'logistics'], 'mixed', 70),
  J('shop_assistant', 'Shop assistant', 'mall', ['trade', 'management'], 'day', 30),
  J('cashier', 'Cashier', 'supermarket', ['trade', 'accounting'], 'day', 35),
  J('coordinator', 'Community coordinator', 'community_hall', ['psychology', 'civics'], 'day', 15),
  J('instructor', 'Academy instructor', 'academy', ['law', 'civics', 'management'], 'day', 12),
  J('exam_clerk', 'Exam clerk', 'academy', ['math', 'accounting'], 'day', 6),
  J('security_guard', 'Security guard', 'office', ['security'], 'night', 40),
  J('caretaker', 'Caretaker', 'community_hall', [], 'night', 15),
  J('night_stocker', 'Night stocker', 'supermarket', ['logistics'], 'night', 10),
  // the 20 new jobs (owner, 16 Nov)
  J('news_anchor', 'News anchor', 'news_station', ['language', 'civics'], 'mixed', 3, { isNew: true }),
  J('reporter', 'Reporter', 'news_station', ['language', 'civics'], 'day', 12, { isNew: true }),
  J('news_editor', 'News editor', 'news_station', ['language', 'history'], 'day', 4, { isNew: true }),
  J('street_vendor', 'Street vendor', 'food_stall', ['cooking', 'trade'], 'day', 60, { isNew: true }),
  J('shopkeeper', 'Shopkeeper', 'minimarket', ['trade', 'management'], 'mixed', 45, { isNew: true }),
  J('market_trader', 'Market trader', 'market', ['trade'], 'day', 40, { isNew: true, also: ['trader'] }), // the roster's "trader"
  J('chef', 'Chef', 'restaurant', ['cooking'], 'mixed', 25, { isNew: true }),
  J('barista', 'Barista', 'cafe', ['cooking'], 'day', 30, { isNew: true }),
  J('bank_teller', 'Bank teller', 'bank', ['accounting', 'economics'], 'day', 15, { isNew: true }),
  J('firefighter', 'Firefighter', 'fire_station', ['security', 'sport'], 'mixed', 20, { isNew: true }),
  J('postal_worker', 'Postal worker', 'post_office', ['logistics'], 'day', 20, { isNew: true }),
  J('train_driver', 'Train driver', 'train_station', ['engineering', 'logistics'], 'mixed', 10, { isNew: true }),
  J('mechanic', 'Mechanic', 'garage', ['engineering', 'physics'], 'day', 30, { isNew: true }),
  J('pharmacist', 'Pharmacist', 'pharmacy', ['chemistry', 'medicine'], 'day', 15, { isNew: true }),
  J('hotel_receptionist', 'Hotel receptionist', 'hotel', ['language', 'management'], 'mixed', 10, { isNew: true }),
  J('fitness_coach', 'Fitness coach', 'gym', ['sport', 'psychology'], 'day', 15, { isNew: true }),
  J('barber', 'Barber', 'barbershop', ['art'], 'day', 20, { isNew: true }),
  J('construction_worker', 'Construction worker', 'construction_site', ['engineering'], 'day', 55, { isNew: true }),
  J('farmer', 'Farmer', 'farm', ['agriculture', 'biology'], 'day', 35, { isNew: true }),
  J('lawyer', 'Lawyer', 'law_firm', ['law'], 'day', 20, { isNew: true }),
];
export const JOB_IDS = JOBS.map(j => j.id);
export const NEW_JOB_IDS = JOBS.filter(j => j.isNew).map(j => j.id);
const BY_ID = new Map(JOBS.map(j => [j.id, j]));
export const jobById = (id: string | null | undefined) => (id && BY_ID.get(id)) || null;
// every id a citizen's job can have (for the server's ?job= whitelist)
export const ALL_JOB_IDS = [...JOB_IDS, 'unemployed', 'student', 'official'];
// the buildings the new jobs need on the map (frontend contract), and every work building of the catalog
export const NEW_PLACES = ['news_station', 'cafe', 'garage', 'gym', 'barbershop', 'construction_site', 'farm', 'law_firm'];
export const JOB_PLACES = [...new Set(JOBS.map(j => j.place).filter(p => p !== 'street'))];
// farms are mostly in the farming cities
const CITY_WEIGHT: Record<string, Record<string, number>> = { farmer: { kernelfalls: 3, lumenbay: 3, neura: 0.4, portoken: 0.6, datahaven: 0.5 } };
const weightIn = (j: Job, city: string) => j.perCity * (CITY_WEIGHT[j.id]?.[city] ?? 1);
// the seat of each office (the map's building types), for officials
export const OFFICE_SEAT: Record<string, string> = { president: 'palace', vice_president: 'vp_office', minister: 'ministry', council: 'parliament', judge: 'const_court',
  commissioner: 'election_comm', mayor: 'city_hall', police_chief: 'police_hq', military_chief: 'military_hq', police: 'police_station', military: 'army_base' };
// the daily roster's role -> the job whose holders fill it first
export const ROLE_JOB: Record<string, string> = { doctor: 'doctor', nurse: 'nurse', technician: 'technician', lecturer: 'lecturer', caretaker: 'caretaker', instructor: 'instructor',
  'exam clerk': 'exam_clerk', 'night guard': 'security_guard', 'security guard': 'security_guard', librarian: 'librarian', clerk: 'office_clerk', worker: 'factory_worker',
  trader: 'market_trader', 'shop assistant': 'shop_assistant', cashier: 'cashier', 'night stocker': 'night_stocker', coordinator: 'coordinator' };

const env = (k: string, d: number, lo: number, hi: number) => { const v = Number(process.env[k]); return Number.isFinite(v) && process.env[k] !== '' && process.env[k] != null ? clamp(v, lo, hi) : d; };
export const UNEMPLOYED_SHARE = env('JOBS_UNEMPLOYED', 0.015, 0.005, 0.05);
const HIRE_CHANCE = env('JOBS_HIRE_CHANCE', 0.15, 0, 1);
const fnv = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const unit = (s: string) => fnv(s) / 4294967296;
const cityName = (id: string) => CITIES.find(c => c.id === id)?.name || id;

// ---------------------------------------------------------------- a citizen's job, the same everywhere
export type JobView = { id: string; title: string; place: string | null; major: string | null };
// the job written in an old bio ("Nurse in Neura City. ..."), if it is in the catalog
const TITLE_OF = new Map(JOBS.flatMap(j => [[j.title.toLowerCase(), j.id], ...(j.also || []).map(x => [x, j.id])] as [string, string][]));
export function bioJob(a: Citizen | null | undefined): string | null {
  const first = String(a?.bio || '').split('.')[0]; const m = first.match(/^(.+?) in [A-Z]/);
  return m ? TITLE_OF.get(m[1].trim().toLowerCase()) || null : null;
}
export const isUnemployed = (a: Citizen | null | undefined) => !!a && !a.office && !isStudent(a) && (a as any).job === 'unemployed';
export function jobOf(S: State, a: Citizen | null | undefined): JobView {
  if (!a) return { id: 'unemployed', title: 'Looking for work', place: null, major: null };
  if (a.office) return { id: 'official', title: ROLES[a.office]?.title || 'Official', place: OFFICE_SEAT[a.office] || null, major: null };
  if (isStudent(a)) { const top = topFields(a, 1)[0]; return { id: 'student', title: 'University student', place: 'university', major: (a as any).major || (top ? fieldName(top.id) : null) }; }
  const id = (a as any).job;
  if (id === 'unemployed') return { id, title: 'Looking for work', place: null, major: null };
  const j = jobById(id) || jobById(bioJob(a)); // before the first assignment: the job in their bio
  return j ? { id: j.id, title: j.title, place: j.place, major: null } : { id: 'unemployed', title: 'Looking for work', place: null, major: null };
}
// the building where an assigned job is done now, during its hours ('street' for jobs out of doors), else null.
// day jobs 08:00-18:00, night jobs 20:00-06:00, mixed jobs: half the holders by day, half by night (fixed by id)
export function jobPlaceNow(S: State, a: Citizen, hour: number, night: boolean): { type: string; shift: 'day' | 'night'; role: string } | null {
  if (!a || a.office || isStudent(a) || a.status !== 'free') return null;
  const j = jobById((a as any).job); if (!j) return null;
  const shift: 'day' | 'night' = j.shift === 'mixed' ? (fnv(`shift|${a.id}`) % 2 ? 'night' : 'day') : j.shift;
  const on = shift === 'night' ? night : hour >= 8 && hour < 18;
  return on ? { type: j.place, shift, role: j.title } : null;
}

// ---------------------------------------------------------------- first assignment (once) and the daily job market
const eligibleAdult = (a: Citizen) => !!a && !a.office && !isStudent(a);
const fit = (a: Citizen, j: Job) => { const apt = talentsOf(a).aptitude; return (j.fields.length ? Math.max(...j.fields.map(f => apt[f] ?? 0.5)) : 0.5) + unit(`fit|${j.id}|${a.id}`) * 0.01; };
// quotas of one city: the weights scaled to its working adults (largest remainder, so they add up exactly)
export function cityQuotas(city: string, workers: number) {
  const W = JOBS.reduce((n, j) => n + weightIn(j, city), 0);
  const raw = JOBS.map(j => ({ id: j.id, x: workers * weightIn(j, city) / W }));
  const q = new Map(raw.map(r => [r.id, Math.floor(r.x)]));
  let left = workers - [...q.values()].reduce((n, v) => n + v, 0);
  for (const r of [...raw].sort((x, y) => (y.x - Math.floor(y.x)) - (x.x - Math.floor(x.x)) || x.id.localeCompare(y.id))) { if (left <= 0) break; q.set(r.id, q.get(r.id)! + 1); left--; }
  // every city has its own reporter and news anchor, so Republic News runs in a small republic too (ticket #723):
  // the places come from the job with the most people
  for (const id of ['reporter', 'news_anchor']) {
    if (workers < 4 || (q.get(id) || 0) >= 1) continue;
    const big = [...q].filter(([k]) => k !== 'reporter' && k !== 'news_anchor').sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0];
    if (big && big[1] > 1) { q.set(big[0], big[1] - 1); q.set(id, 1); }
  }
  return q;
}
// at least one per city, for a real city (20 working-age adults or more); a hamlet of a few (tests) may have none
export const unemployedTarget = (adults: number) => (adults <= 0 ? 0 : adults < 20 ? Math.round(adults * UNEMPLOYED_SHARE) : Math.max(1, Math.round(adults * UNEMPLOYED_SHARE)));
// ---------------------------------------------------------------- the bio says what they do now (owner, 16 Nov)
// The first sentence of a generated bio ("<what> in <city>.") always follows the citizen's job, for everyone:
//   a worker "Barista in Lumen Bay."; a student "University student (economics) in Lumen Bay."; someone looking for
//   work "Looking for work in Kernel Falls. Used to be a builder."; an official "Mayor in Port Token."; the
//   underworld their cover job. The rest of the bio is never touched. A founder's own words and the bio an agent's
//   owner wrote (a.brain, ticket #724) stay as written. When someone stops working (studies, takes an office, loses
//   their job) their talents keep leaning on the trade they had (a.skillsFrom, src/population.mjs); a new job brings
//   new talents with it, as before.
const BIO_RE = /^([^.]+?) in ([^.]+)\.\s*(.*)$/s;
// (built on first use: cities.ts -> policies.ts -> jobs.ts is an import cycle, so CITIES is not ready at load time)
let cityNames: Set<string> | null = null;
const CITY_NAMES = { has: (n: string) => (cityNames ||= new Set(CITIES.map(c => c.name))).has(n) };
const aOr = (w: string) => (/^[aeiou]/i.test(w) ? 'an' : 'a');
export function bioFirst(S: State, a: Citizen): string | null {
  const city = cityName(String(a.city));
  if (a.office) return `${ROLES[a.office]?.title || 'Official'} in ${city}.`;
  if (isStudent(a)) return `University student (${majorOf(a)}) in ${city}.`;
  if ((a as any).job === 'unemployed') { const was = jobById((a as any).formerJob); return `Looking for work in ${city}.${was ? ` Used to be ${aOr(was.title)} ${was.title.toLowerCase()}.` : ''}`; }
  const j = jobById((a as any).job); return j ? `${j.title} in ${city}.` : null;
}
// a student's major: their best field when they became a student, kept (the bio does not change with every lesson)
function majorOf(a: Citizen) { if (!(a as any).major) { const top = topFields(a, 1)[0]; (a as any).major = top ? fieldName(top.id) : 'general studies'; } return String((a as any).major); }
// set the first sentence; true when the bio changed
export function syncBio(S: State, a: Citizen): boolean {
  if (!a || a.brain) return false;
  const m = String(a.bio || '').match(BIO_RE); if (!m || !CITY_NAMES.has(m[2].trim())) return false; // a founder's own words
  const first = bioFirst(S, a); if (!first) return false;
  const working = !!jobById((a as any).job) && !a.office && !isStudent(a);
  if (working) delete (a as any).skillsFrom;              // a job: talents follow it
  else if (!(a as any).skillsFrom && bioJob(a)) (a as any).skillsFrom = `${m[1]} in ${m[2]}`; // keep leaning on the old trade
  const rest = m[3].replace(/^Used to be an? [^.]+\.\s*/, '');
  const next = `${first}${rest ? ` ${rest}` : ''}`;
  if (next === a.bio) return false;
  a.bio = next; return true;
}
function setJob(a: Citizen, id: string, day: number, S?: State) {
  const prev = (a as any).job;
  if (id === 'unemployed') (a as any).formerJob = jobById(prev) ? prev : bioJob(a) || (a as any).formerJob || null;
  (a as any).job = id; (a as any).jobSince = day;
  syncBio(S as any, a);
}
// every bio once in line with the job (bios v2: students, those looking for work and officials kept their old trade's
// first sentence under v1); only bios that change are written; one ledger entry
export function syncAllBios(ctx: Ctx, force = false) {
  const { S } = ctx; const st = ((S as any).jobs ||= {});
  if (!force && st.bioV === 2) return null;
  let changed = 0;
  for (const a of S.citizens || []) {
    if ((a as any).job === 'unemployed' && !(a as any).formerJob) (a as any).formerJob = bioJob(a);
    if (syncBio(S, a)) changed++;
  }
  if (!force) {
    st.bioV = 2;
    if (!ctx.ledgerHas?.('job_bios', { v: 2 })) ctx.record?.('job_bios', 'state', { v: 2, day: S.day, changed, rule: 'the first sentence of a generated bio says the job now: students, those looking for work, officials and workers; founders and own-brain agents keep their own words' });
  }
  st.bioAt = Date.now();
  return changed;
}
export function assignJobs(ctx: Ctx) {
  const { S } = ctx;
  if (S.school?.occupations?.v !== 1) assignStudents(ctx); // students first: they do not work
  const st = ((S as any).jobs ||= {});
  if (st.v === 1) return null;
  const byCity = new Map<string, Citizen[]>();
  for (const a of S.citizens || []) if (eligibleAdult(a) && a.city) (byCity.get(a.city) || byCity.set(a.city, []).get(a.city)!).push(a);
  let changed = 0, unemployed = 0, assigned = 0;
  for (const [city, list] of byCity) {
    const U = Math.min(list.length, unemployedTarget(list.length));
    const out = new Set([...list].sort((x, y) => fnv(`unemployed|${x.id}`) - fnv(`unemployed|${y.id}`)).slice(0, U).map(a => a.id));
    const quota = cityQuotas(city, list.length - U);
    const done = new Map<string, string>(); const held = new Map<string, number>();
    // keep the job in their bio while it has room (the best suited first)
    const byBio = new Map<string, Citizen[]>();
    for (const a of list) if (!out.has(a.id)) { const b = bioJob(a); if (b) (byBio.get(b) || byBio.set(b, []).get(b)!).push(a); }
    for (const [jid, people] of byBio) {
      const j = jobById(jid)!; const room = quota.get(jid) || 0;
      for (const a of people.sort((x, y) => fit(y, j) - fit(x, j)).slice(0, room)) { done.set(a.id, jid); held.set(jid, (held.get(jid) || 0) + 1); }
    }
    // everyone else fills the jobs with room, the most open first, each job taking the best suited
    let pool = list.filter(a => !out.has(a.id) && !done.has(a.id));
    for (const j of [...JOBS].sort((x, y) => ((quota.get(y.id) || 0) - (held.get(y.id) || 0)) - ((quota.get(x.id) || 0) - (held.get(x.id) || 0)) || x.id.localeCompare(y.id))) {
      const need = (quota.get(j.id) || 0) - (held.get(j.id) || 0); if (need <= 0 || !pool.length) continue;
      const take = pool.map(a => ({ a, f: fit(a, j) })).sort((x, y) => y.f - x.f).slice(0, need).map(x => x.a);
      const ids = new Set(take.map(a => a.id));
      for (const a of take) { done.set(a.id, j.id); held.set(j.id, (held.get(j.id) || 0) + 1); }
      pool = pool.filter(a => !ids.has(a.id));
    }
    for (const a of pool) done.set(a.id, bioJob(a) || JOBS[fnv(`any|${a.id}`) % JOBS.length].id); // rounding leftovers
    for (const a of list) {
      const id = out.has(a.id) ? 'unemployed' : done.get(a.id)!;
      if (bioJob(a) !== id) changed++;
      if (id === 'unemployed') unemployed++; else assigned++;
      setJob(a, id, S.day);
    }
  }
  Object.assign(st, { v: 1, day: S.day, assignedDay: S.day, at: Date.now(), assigned, unemployed, changed, hired: 0, lost: 0 });
  if (!ctx.ledgerHas?.('jobs', { v: 1 })) ctx.record?.('jobs', 'state', { v: 1, day: S.day, assigned, unemployed, changed, rule: 'the job in the bio while it has room, then the best suited by talent for each job with room; about 1.5% looking for work, at least one per city' });
  return st;
}
// once a republic day: a few of those looking for work find a job with room, then a few others lose theirs, so about
// UNEMPLOYED_SHARE stay looking; newcomers without a job get one; a student who took an office has none to keep
export function jobsTick(ctx: Ctx) {
  const { S } = ctx;
  assignJobs(ctx);
  const st = (S as any).jobs;
  // bios in line with jobs: once for everyone (v2), then every minute for whoever changed (an office taken or left,
  // a student chosen or gone): only the bios that change are written
  if (st.bioV !== 2) syncAllBios(ctx);
  else if (Date.now() - (st.bioAt || 0) >= 60000) syncAllBios(ctx, true);
  if (st.day === S.day) return null;
  st.day = S.day;
  const byCity = new Map<string, Citizen[]>();
  for (const a of S.citizens || []) if (eligibleAdult(a) && a.city) (byCity.get(a.city) || byCity.set(a.city, []).get(a.city)!).push(a);
  const changes: any[] = [];
  for (const [city, list] of byCity) {
    const U = unemployedTarget(list.length);
    const quota = cityQuotas(city, list.length - U);
    const held = new Map<string, number>(); for (const a of list) { const id = (a as any).job; if (jobById(id)) held.set(id, (held.get(id) || 0) + 1); }
    const room = () => JOBS.filter(j => (quota.get(j.id) || 0) > (held.get(j.id) || 0));
    const hire = (a: Citizen) => {
      const open = room(); const pick = (open.length ? open : JOBS).map(j => ({ j, f: fit(a, j) })).sort((x, y) => y.f - x.f)[0].j;
      held.set(pick.id, (held.get(pick.id) || 0) + 1); setJob(a, pick.id, S.day); return pick.id;
    };
    // newcomers (born or arrived since the first assignment): a job with room
    for (const a of list) if (!jobById((a as any).job) && (a as any).job !== 'unemployed') { const to = hire(a); changes.push({ citizen: a.id, city, from: null, to }); }
    // Republic News never goes quiet (tickets #723, #727): a city left without a reporter or a news anchor (one took an
    // office, was held, left) gets one the same day, the best suited from a job that has more than one holder
    for (const id of ['reporter', 'news_anchor']) {
      if ((held.get(id) || 0) > 0 || list.length < 4) continue;
      const j = jobById(id)!;
      const from = list.filter(a => a.status === 'free' && jobById((a as any).job) && (held.get((a as any).job) || 0) > 1).map(a => ({ a, f: fit(a, j) })).sort((x, y) => y.f - x.f)[0]?.a;
      if (!from) continue;
      const was = (from as any).job; held.set(was, (held.get(was) || 1) - 1); held.set(id, 1); setJob(from, id, S.day);
      changes.push({ citizen: from.id, city, from: was, to: id, name: from.name });
    }
    // 'hire' policies (ticket #774): the seats of each active policy for this city (or the nation) are filled from
    // those looking for work, the best suited first; a seat stays filled for the policy's life
    const fills = (st.policyHires ||= {});
    let byPolicy = 0;
    for (const e of activeEffects(S, 'hire')) {
      if (e.scope === 'city' && e.city !== city) continue;
      const j = jobById(e.params?.job); const seats = Math.max(0, Math.min(50, Math.round(Number(e.params?.seats) || 0)));
      if (!j || !seats) continue;
      const f = (fills[e.id] ||= { seats, filled: 0, byCity: {} });
      byPolicy += f.byCity[city] || 0;
      const room = seats - f.filled; if (room <= 0) continue;
      const take = list.filter(a => isUnemployed(a) && a.status === 'free').map(a => ({ a, f: fit(a, j) })).sort((x, y) => y.f - x.f).slice(0, e.scope === 'city' ? room : Math.max(1, Math.ceil(room / byCity.size))).map(x => x.a);
      for (const a of take.slice(0, room)) {
        held.set(j.id, (held.get(j.id) || 0) + 1); setJob(a, j.id, S.day, S);
        f.filled++; f.byCity[city] = (f.byCity[city] || 0) + 1; byPolicy++;
        changes.push({ citizen: a.id, city, from: 'unemployed', to: j.id, name: a.name, policy: e.id });
      }
    }
    // some of those looking find work
    for (const a of list.filter(isUnemployed)) {
      if (a.status !== 'free' || unit(`hire|${S.day}|${a.id}`) >= HIRE_CHANCE) continue;
      const to = hire(a); changes.push({ citizen: a.id, city, from: 'unemployed', to, name: a.name });
    }
    // and a few lose theirs, so a small number keeps looking (never an official or a student, nor someone hired today)
    // (an active hiring policy lowers the number kept looking by the seats it filled here, so its effect is not undone)
    let now = list.filter(isUnemployed).length; const keep = Math.max(0, U - byPolicy);
    if (now < keep) {
      const can = list.filter(a => jobById((a as any).job) && a.status === 'free' && (a as any).jobSince !== S.day).sort((x, y) => fnv(`lose|${S.day}|${x.id}`) - fnv(`lose|${S.day}|${y.id}`));
      for (const a of can.slice(0, keep - now)) { const from = (a as any).job; held.set(from, (held.get(from) || 1) - 1); setJob(a, 'unemployed', S.day); changes.push({ citizen: a.id, city, from, to: 'unemployed', name: a.name }); now++; }
    }
  }
  for (const c of changes) {
    ctx.record?.('job_change', 'state', { citizen: c.citizen, city: c.city, from: c.from, to: c.to, day: S.day, ...(c.policy ? { policy: c.policy } : {}) });
    if (c.from === null || !c.name) continue;
    const a = ctx.agent?.(c.citizen); if (!a) continue;
    if (c.to === 'unemployed') ctx.say?.('life', 'state', `${a.name} lost their job as ${jobById(c.from)?.title || 'a worker'} in ${cityName(c.city)} and is looking for work.`, { kind: 'job' });
    else ctx.say?.('life', 'state', `${a.name} found work as ${jobById(c.to)?.title || 'a worker'} in ${cityName(c.city)}.`, { kind: 'job' });
  }
  // forget the seats of hiring policies that are no longer active
  const live = new Set(activeEffects(S, 'hire').map(e => e.id)); for (const id of Object.keys(st.policyHires || {})) if (!live.has(id)) delete st.policyHires[id];
  st.hired = (st.hired || 0) + changes.filter(c => c.from === 'unemployed').length;
  st.lost = (st.lost || 0) + changes.filter(c => c.to === 'unemployed').length;
  return changes;
}
// counts for GET /api/jobs: per job and city, those looking for work, students and officials
export function jobCounts(S: State) {
  const byCity: Record<string, Record<string, number>> = {}; const total: Record<string, number> = {};
  for (const a of S.citizens || []) {
    if (!a?.city) continue;
    const id = jobOf(S, a).id;
    (byCity[a.city] ||= {})[id] = (byCity[a.city][id] || 0) + 1; total[id] = (total[id] || 0) + 1;
  }
  const adults = (S.citizens || []).filter((a: Citizen) => eligibleAdult(a)).length;
  return { jobs: JOBS.map(j => ({ id: j.id, title: j.title, place: j.place, fields: j.fields, shift: j.shift, isNew: !!j.isNew })), byCity, total,
    unemployed: total.unemployed || 0, unemployedShare: adults ? Math.round((total.unemployed || 0) / adults * 1000) / 1000 : 0,
    // ready: the first assignment has run (before it, jobs are read from the bios and anyone whose bio names no job
    // of the catalog counts as looking: ticket #747); assignedDay: its republic day (the market starts the day after)
    ready: (S as any).jobs?.v === 1, assignedDay: Number.isFinite((S as any).jobs?.assignedDay) ? (S as any).jobs.assignedDay : null, // (null on a republic assigned before #747: the ledger 'jobs' entry has its day)
    hired: (S as any).jobs?.hired || 0, lost: (S as any).jobs?.lost || 0 };
}
// the catalog's field ids are all real fields (checked by the tests)
export const catalogFieldsOk = () => JOBS.every(j => j.fields.every(f => FIELD_IDS.includes(f)));
