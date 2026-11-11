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
  ['mistralai/mistral-large-4-0', 10],   // 0.70 / 2.10
  ['minimax/minimax-m3', 9],             // 0.30 / 1.20
  ['z-ai/glm-5.3', 9],                   // 0.07 / 1.40
  ['qwen/qwen3.8-27b', 9],               // 0.15 / 1.88
  ['cohere/command-a-plus', 7],          // 0.30 / 1.50
  ['moonshotai/kimi-k2.6', 7],           // 0.65 / 3.41
  ['anthropic/claude-haiku-5.5', 7],     // 0.10 / 0.50
  ['amazon/nova-2-lite-v1', 5],          // 0.30 / 2.50
  ['x-ai/grok-4.3', 5],                  // 1.25 / 2.50
  ['openai/gpt-6.1-terra', 4],           // 1.00 / 5.00
  ['nousresearch/hermes-4-405b', 3],     // 1.00 / 3.00
  ['google/gemini-omni-1.2-flash', 1],   // 1.50 / 9.00
];

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
