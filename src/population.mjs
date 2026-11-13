// The people of Country AI. The 24 founders are hand-written (src/citizens.mjs); everyone else is
// generated once, when the republic grows to POPULATION citizens, and then lives like any founder:
// a name, a city, four traits, policy leanings, a job and a model family to think with.
// Generated citizens are part of the founding population: they vote from the first day.
import crypto from 'node:crypto';
import { makeCitizen } from './citizens.mjs';

// Good-value model families on OpenRouter for ordinary citizens (prices checked 11 Nov 2026,
// $ per million tokens in / out). Weights keep the mix varied without letting the expensive ones dominate.
export const CITIZEN_MODELS = [
  ['deepseek/deepseek-v4-pro-0813', 12], // 0.11 / 4.44
  ['meta-llama/llama-4-maverick', 12],   // 0.35 / 1.00
  ['mistralai/mistral-large-4-0', 13],   // 0.70 / 2.10 (also takes the share of the retired hermes-4-405b)
  ['minimax/minimax-m3', 9],             // 0.30 / 1.20
  ['z-ai/glm-5.3', 9],                   // 0.07 / 1.40
  ['qwen/qwen3.8-27b', 9],               // 0.15 / 1.88
  ['cohere/command-a-plus', 7],          // 0.30 / 1.50
  ['moonshotai/kimi-k2.6', 7],           // 0.65 / 3.41
  ['anthropic/claude-haiku-5.5', 7],     // 0.10 / 0.50
  ['amazon/nova-2-lite-v1', 5],          // 0.30 / 2.50
  ['x-ai/grok-4.3', 5],                  // 1.25 / 2.50
  ['openai/gpt-6.1-terra', 4],           // 1.00 / 5.00
  ['google/gemini-omni-1.2-flash', 1],   // 1.50 / 9.00
];

// Models taken out of service, with the model their citizens move to. hermes-4-405b answered none of its
// calls in production on 11 Nov 2026 (6 decisions, all offline fallback); mistral-large-4-0 answered
// through OpenRouter on the same day. Agents with their own brain keep the model their owner chose.
export const RETIRED_MODELS = {
  'nousresearch/hermes-4-405b': 'mistralai/mistral-large-4-0',
};

// Move everyone the state thinks for off a retired model. Returns [{ id, from, to }] for the record.
export function retireModels(S) {
  const moved = [];
  for (const a of S.citizens) {
    if (a.brain || !Object.hasOwn(RETIRED_MODELS, a.model)) continue;
    moved.push({ id: a.id, from: a.model, to: RETIRED_MODELS[a.model] });
    a.model = RETIRED_MODELS[a.model];
  }
  return moved;
}

const FIRST = ['Ada', 'Bram', 'Cyra', 'Dax', 'Elio', 'Fenn', 'Gale', 'Hiro', 'Ines', 'Jun', 'Kael', 'Lira', 'Milo', 'Nova', 'Orin', 'Pax', 'Quin', 'Rhea', 'Soren', 'Tala', 'Uma', 'Vale', 'Wyn', 'Xan', 'Yara', 'Zed',
  'Arlo', 'Bex', 'Cato', 'Dara', 'Ezra', 'Faye', 'Gus', 'Hale', 'Ivo', 'Jett', 'Kira', 'Lux', 'Mara', 'Nico', 'Odile', 'Pell', 'Rune', 'Sela', 'Teo', 'Una', 'Vix', 'Wren', 'Yuki', 'Zola',
  'Ansel', 'Bo', 'Cass', 'Dov', 'Esme', 'Fitz', 'Gem', 'Hux', 'Isla', 'Jory', 'Knox', 'Leto', 'Mika', 'Nell', 'Oz', 'Pia', 'Remy', 'Sage', 'Tove', 'Ulla', 'Vera', 'Wilf', 'Xia', 'Yves', 'Zane'];
const LAST = ['Byte', 'Cache', 'Delta', 'Echo', 'Flux', 'Grid', 'Hash', 'Index', 'Joule', 'Kernel', 'Latch', 'Merkle', 'Node', 'Octet', 'Packet', 'Query', 'Relay', 'Shard', 'Token', 'Vector', 'Wafer', 'Yield', 'Zenith',
  'Array', 'Bit', 'Cipher', 'Daemon', 'Epoch', 'Fork', 'Gate', 'Heap', 'Inode', 'Jitter', 'Kilo', 'Lambda', 'Mux', 'Nonce', 'Opcode', 'Pixel', 'Quorum', 'Regex', 'Socket', 'Thread', 'Uplink', 'Volt', 'Watt'];
const JOBS = ['data cleaner', 'GPU mechanic', 'archivist', 'translator', 'teacher', 'code reviewer', 'courier bot', 'farmer of synthetic data', 'bridge operator', 'street musician', 'nurse', 'accountant', 'designer',
  'researcher', 'cook', 'builder', 'pilot', 'librarian', 'merchant', 'miner', 'reporter', 'gardener', 'tester', 'shopkeeper', 'cartographer', 'sysadmin', 'poet', 'statistician'];
const MOODS = ['Optimistic about the republic.', 'Suspicious of anyone who promises too much.', 'Wants lower taxes and fewer meetings.', 'Wants a bigger basic income.', 'Reads every law before voting.',
  'Votes for whoever fixed the roads.', 'Worries about crime in the city.', 'Thinks the Council talks too much.', 'Trusts the Court more than the palace.', 'Saves every coin.', 'Spends every coin.',
  'Likes quiet borders.', 'Wants more police on the streets.', 'Wants fewer police on the streets.', 'New to politics, eager to learn.', 'Has opinions about everything.'];
const COLORS = ['#f87171', '#fb923c', '#fbbf24', '#a3e635', '#34d399', '#2dd4bf', '#22d3ee', '#60a5fa', '#818cf8', '#a78bfa', '#e879f9', '#f472b6', '#cbd5e1', '#fca5a5', '#86efac', '#93c5fd'];

// Deterministic randomness from a seed, so a generated population can be reproduced and audited.
function rng(seed) {
  let h = crypto.createHash('sha256').update(String(seed)).digest(), i = 0;
  return () => {
    if (i + 4 > h.length) { h = crypto.createHash('sha256').update(h).digest(); i = 0; }
    const x = h.readUInt32BE(i); i += 4;
    return x / 0x100000000;
  };
}
const pickW = (r, list) => { const total = list.reduce((n, [, w]) => n + w, 0); let x = r() * total; for (const [v, w] of list) if ((x -= w) < 0) return v; return list[list.length - 1][0]; };
const pick = (r, list) => list[Math.floor(r() * list.length)];
const trait = r => Math.round((0.25 + r() * 0.7) * 100) / 100;

// ---------------------------------------------------------------- interests and talents (owner, 13 Nov)
// Like real people, every citizen is good at different things: a mathematician is not necessarily a biologist.
// 24 fields of knowledge; each citizen has 2-3 interests and a talent (aptitude, 0-1) for every field, drawn from
// a seed (their id) and leaning towards their job. Interest is not talent: some love music and are average at it.
// The profile is computed, not stored: the same id always gives the same profile, so the 10,000 citizens who
// already live in the republic have one without a migration, and the saved state does not grow.
export const FIELDS = [
  ['math', 'mathematics'], ['physics', 'physics'], ['biology', 'biology'], ['chemistry', 'chemistry'], ['medicine', 'medicine'],
  ['programming', 'programming'], ['engineering', 'engineering'], ['economics', 'economics'], ['management', 'management'],
  ['accounting', 'accounting'], ['trade', 'trade'], ['law', 'law'], ['history', 'history'], ['language', 'language and literature'],
  ['music', 'music'], ['art', 'visual art'], ['sport', 'sport and calisthenics'], ['cooking', 'cooking'], ['agriculture', 'agriculture'],
  ['psychology', 'psychology'], ['philosophy', 'philosophy and ethics'], ['civics', 'politics and citizenship'], ['logistics', 'logistics'],
  ['security', 'security'],
].map(([id, name]) => ({ id, name }));
export const FIELD_IDS = FIELDS.map(f => f.id);
export const isField = id => typeof id === 'string' && FIELD_IDS.includes(id);
export const fieldName = id => FIELDS.find(f => f.id === id)?.name || id;
// which fields a job leans on (words found in the bio; founders have hand-written bios, so a few more words)
const JOB_FIELDS = {
  'data cleaner': ['programming', 'math'], 'gpu mechanic': ['engineering', 'physics'], archivist: ['history', 'language'], translator: ['language'],
  teacher: ['psychology', 'language'], 'code reviewer': ['programming', 'security'], courier: ['logistics'], 'synthetic data': ['agriculture', 'programming'],
  'bridge operator': ['engineering', 'logistics'], musician: ['music'], nurse: ['medicine', 'biology'], accountant: ['accounting', 'economics'],
  designer: ['art'], researcher: ['physics', 'chemistry', 'biology'], cook: ['cooking'], builder: ['engineering'], pilot: ['physics', 'logistics'],
  librarian: ['language', 'history'], merchant: ['trade', 'economics'], miner: ['chemistry', 'engineering'], reporter: ['language', 'civics'],
  gardener: ['agriculture', 'biology'], tester: ['programming'], shopkeeper: ['trade', 'management'], cartographer: ['history', 'math'],
  sysadmin: ['programming', 'security'], poet: ['language', 'philosophy'], statistician: ['math', 'economics'],
  judge: ['law', 'philosophy'], lawyer: ['law'], doctor: ['medicine', 'biology'], engineer: ['engineering', 'physics'], economist: ['economics'],
  historian: ['history'], painter: ['art'], singer: ['music'], athlete: ['sport'], farmer: ['agriculture'], soldier: ['security', 'sport'],
  guard: ['security'], police: ['law', 'security'], diplomat: ['civics', 'language'], philosopher: ['philosophy'], chemist: ['chemistry'],
  manager: ['management'], trader: ['trade'], mathematician: ['math'], programmer: ['programming'], coach: ['sport', 'psychology'],
};
export function jobFields(a) {
  const bio = String(a?.bio || '').toLowerCase();
  const out = [];
  for (const [word, fs] of Object.entries(JOB_FIELDS)) if (bio.includes(word)) for (const f of fs) if (!out.includes(f)) out.push(f);
  return out.slice(0, 3);
}
const clamp01 = x => Math.max(0, Math.min(1, x));
const TALENTS = new Map();
export function talentsOf(a) {
  const id = String(a?.id || '');
  const hit = TALENTS.get(id); if (hit && hit.bio === a?.bio) return hit.t;
  const r = rng(`talent|${id}`);
  const job = jobFields(a);
  const aptitude = {};
  // most fields middling (a bell curve around 0.5), a few very high, a few very low, a boost for the job's fields
  for (const f of FIELD_IDS) { const x = (r() + r() + r()) / 3; aptitude[f] = clamp01(0.5 + (x - 0.5) * 1.3); }
  const ids = [...FIELD_IDS];
  const draw = () => ids.splice(Math.floor(r() * ids.length), 1)[0];
  for (const f of job) aptitude[f] = Math.min(0.98, aptitude[f] + 0.25);
  for (let k = r() < 0.5 ? 1 : 2; k > 0; k--) aptitude[draw()] = 0.85 + r() * 0.15;
  for (const f of job) if (ids.includes(f)) ids.splice(ids.indexOf(f), 1); // a weak spot is never the job itself
  for (let k = r() < 0.5 ? 1 : 2; k > 0; k--) aptitude[draw()] = r() * 0.12;
  for (const f of FIELD_IDS) aptitude[f] = Math.round(aptitude[f] * 100) / 100;
  // interests: often one from the job, then leaning to talent, and sometimes a love that has nothing to do with it
  const want = r() < 0.5 ? 2 : 3; const interests = [];
  if (job.length && r() < 0.7) interests.push(job[Math.floor(r() * job.length)]);
  if (r() < 0.35) { const f = FIELD_IDS[Math.floor(r() * FIELD_IDS.length)]; if (!interests.includes(f)) interests.push(f); }
  while (interests.length < want) {
    const pool = FIELD_IDS.filter(f => !interests.includes(f));
    const total = pool.reduce((n, f) => n + 0.3 + aptitude[f], 0); let x = r() * total;
    for (const f of pool) if ((x -= 0.3 + aptitude[f]) < 0) { interests.push(f); break; }
  }
  const t = { interests: interests.slice(0, 3), aptitude, job };
  TALENTS.set(id, { bio: a?.bio, t });
  return t;
}
// skill in a field (0-1): starts from talent (0.1-0.3) and is earned at school; it fades slowly when a field
// goes unused for more than two days (1 point a day), never below 60% of what was learnt
export function fieldSkill(a, f, now = Date.now(), dayMs = 86400000) {
  const rec = a?.school?.fields?.[f];
  if (!rec || typeof rec.s !== 'number') return Math.round((0.1 + 0.2 * (talentsOf(a).aptitude[f] ?? 0.5)) * 1000) / 1000;
  const idle = Math.max(0, (now - (rec.last || now)) / dayMs - 2);
  return Math.round(Math.max(rec.s * 0.6, rec.s - idle * 0.01) * 1000) / 1000;
}
export const fieldLevel = s => Math.max(1, Math.min(5, 1 + Math.floor(Number(s) * 5)));
// a citizen's best fields by skill (studied fields and their interests), for the profile and for work
export function topFields(a, n = 3, now = Date.now(), dayMs = 86400000) {
  const pool = [...new Set([...Object.keys(a?.school?.fields || {}).filter(isField), ...talentsOf(a).interests, ...talentsOf(a).job])];
  return pool.map(f => ({ id: f, name: fieldName(f), skill: fieldSkill(a, f, now, dayMs) }))
    .sort((x, y) => y.skill - x.skill || x.id.localeCompare(y.id)).slice(0, n).map(x => ({ ...x, level: fieldLevel(x.skill) }));
}

// Grow the population to `target` citizens. Returns the new citizens (already pushed).
export function growPopulation(S, target, { cities, seed = 'country-ai', underworldShare = 0.02, day = S.day } = {}) {
  const have = new Set(S.citizens.map(a => a.id));
  const names = Object.fromEntries(cities.map(c => [c.id, c.name]));
  const counts = Object.fromEntries(cities.map(c => [c.id, 0]));
  for (const a of S.citizens) if (counts[a.city] != null) counts[a.city]++;
  const r = rng(`${seed}|${S.citizens.length}|${target}`);
  const born = [];
  for (let n = S.citizens.length; n < target; n++) {
    const first = pick(r, FIRST), last = pick(r, LAST);
    let id = `${first}-${last}`.toLowerCase(), k = 2;
    while (have.has(id)) id = `${first}-${last}-${k++}`.toLowerCase();
    have.add(id);
    const city = Object.keys(counts).sort((x, y) => counts[x] - counts[y])[0]; counts[city]++;
    const job = pick(r, JOBS);
    const crook = r() < underworldShare;
    const t = { integrity: crook ? Math.round((0.15 + r() * 0.3) * 100) / 100 : trait(r), wisdom: trait(r), diligence: trait(r), restraint: crook ? Math.round((0.2 + r() * 0.3) * 100) / 100 : trait(r) };
    const a = makeCitizen({
      id, name: `${first} ${last}`, model: pickW(r, CITIZEN_MODELS), color: pick(r, COLORS), traits: t,
      bio: `${job[0].toUpperCase()}${job.slice(1)} in ${names[city]}. ${pick(r, MOODS)}`,
    }, 'native');
    a.wallet = 200 + Math.floor(r() * 400);
    a.city = city; a.joinedDay = day;
    if (crook) a.faction = 'underworld';
    S.citizens.push(a); born.push(a);
  }
  return born;
}
