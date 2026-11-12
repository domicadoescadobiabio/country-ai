// Feelings: every citizen has a mood and a handful of relationships, and both move with what really happens
// to them: helping and being helped, talking, work, theft, arrests, exams, elections. A human visitor can poke
// ("colek") a citizen on the map; the citizen feels it and complains, and that is all a human can do here.
//
// Cheap by design: moods are plain numbers changed by code; the only model call is one optional grumble per
// poke, on the free local brain (paid: false), rate-limited. Real events are read from small lists (police
// incidents, the 100 seats, finished elections, the Academy feed), never from a loop over 10,000 citizens.
//
//   a.mood  = { v: -1..1 (bad..good), e: 0..1 (energy), label, why (<= 80 chars), ts }
//   a.bonds = up to 8 x { id, w: -1..1, kind, since }, strongest first
//   a.pokes = { day, n }
import { think, localOnline } from './brains.ts';
import { borderCheck } from './military.ts';
import { mischiefConsequence } from './underworld.ts';
import { cleanText, clamp, round } from './util.ts';
import type { Ctx, State, Citizen } from './types.ts';

export const MOODS = ['happy', 'calm', 'proud', 'loved', 'excited', 'lonely', 'sad', 'anxious', 'annoyed', 'grumpy', 'tired'] as const;
export type Mood = typeof MOODS[number];
export const EMOJI: Record<Mood, string> = { happy: '😊', calm: '😌', proud: '😎', loved: '🥰', excited: '🤩', lonely: '🥺', sad: '😢', anxious: '😰', annoyed: '😤', grumpy: '😾', tired: '😴' };
const GOOD = new Set<string>(['happy', 'calm', 'proud', 'loved', 'excited']);
export const BOND_KINDS = ['best_friend', 'friend', 'crush', 'neighbour', 'rival', 'mentor'] as const;
const KIND_WORD = { best_friend: 'best friend', friend: 'friend', crush: 'crush', neighbour: 'neighbour', rival: 'rival', mentor: 'mentor' };
const MAX_BONDS = 8;
const SAMPLE = 60;                 // citizens visited per tick for mood drift and lazy setup
const POKE_LINE_GAP_MS = 120000;   // one model grumble per citizen per 2 minutes
const POKE_LINES_PER_MIN = 30;     // and at most 30 a minute nationwide
const isMood = (x: unknown): x is Mood => typeof x === 'string' && (MOODS as readonly string[]).includes(x);

// the clock, set by feelingsTick from the republic's own time (tests compress it)
const clock = { hourMs: 3600000, dayMs: 86400000, foundedAt: 0 };
const hourOfDay = (now: number) => ((((now - clock.foundedAt) % clock.dayMs) + clock.dayMs) % clock.dayMs) / clock.dayMs * 24;
const awake = (now: number) => { const h = hourOfDay(now); return h >= 6 && h < 22; };

const F = (S: State) => {
  S.feelings ||= {};
  const f = S.feelings;
  f.cursor ??= 0; f.seenInc ||= {}; f.seenEl ||= []; f.academyTs ??= Date.now();
  return f;
};

// ---------------------------------------------------------------- lookups (cached, rebuilt when the population changes)
let index = { arr: null as any, n: -1, byId: new Map<string, Citizen>(), byCity: new Map<string, Citizen[]>(), at: 0 };
function idx(S: State) {
  if (index.arr !== S.citizens || index.n !== S.citizens.length || Date.now() - index.at > 600000) {
    const byId = new Map<string, Citizen>(); const byCity = new Map<string, Citizen[]>();
    for (const a of S.citizens) { byId.set(a.id, a); if (a.city) (byCity.get(a.city) || byCity.set(a.city, []).get(a.city)).push(a); }
    // neighbours are the people in the next houses: order each city by home slot (or id if homes are not set yet)
    for (const list of byCity.values()) list.sort((x, y) => (x.home?.slot ?? 1e9) - (y.home?.slot ?? 1e9) || (x.id < y.id ? -1 : 1));
    index = { arr: S.citizens, n: S.citizens.length, byId, byCity, at: Date.now() };
  }
  return index;
}
export const citizenOf = (S: State, id: string) => idx(S).byId.get(String(id)) || null;
const fnv = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

// ---------------------------------------------------------------- mood
const baseline = (a: Citizen) => round(clamp(0.05 + ((a.traits?.wisdom ?? 0.6) + (a.traits?.restraint ?? 0.6) - 1.2) * 0.25, -0.2, 0.25), 3);
function derive(v: number, e: number): Mood {
  if (v >= 0.55) return e >= 0.65 ? 'excited' : 'happy';
  if (v >= 0.2) return 'happy';
  if (v > -0.15) return e < 0.3 ? 'tired' : 'calm';
  if (v > -0.4) return e < 0.3 ? 'tired' : 'annoyed';
  if (v > -0.65) return 'sad';
  return 'grumpy';
}
const touched = new Set<string>();

// a citizen without feelings yet gets them now, from their traits (lazy: nothing runs over all 10,000 at once)
export function ensureFeelings(S: State, a: Citizen, now = Date.now()) {
  if (!a.mood || typeof a.mood.v !== 'number') {
    const v = baseline(a);
    a.mood = { v, e: 0.7, label: derive(v, 0.7), why: 'an ordinary day', ts: now };
    a.moodAt = now;
  }
  if (!Array.isArray(a.bonds)) a.bonds = [];
  return a.mood;
}

// The one place a mood changes. dv moves the mood; label is a hint, kept unless it contradicts where the mood is.
// why must be text the server writes (names, places, amounts, office titles), never a model's or a human's words:
// it is shown to the people bonded to this citizen, inside their own prompts (feelLine).
export function feel(S: State, a: Citizen, dv: number, label?: string | null, why?: string | null, now = Date.now()) {
  if (!a) return null;
  const m = ensureFeelings(S, a, now);
  m.v = round(clamp(m.v + (Number(dv) || 0), -1, 1), 3);
  let l: Mood = isMood(label) ? label : derive(m.v, m.e);
  if (GOOD.has(l) && m.v < -0.3) l = derive(m.v, m.e);       // cannot be "happy" at the bottom
  if (!GOOD.has(l) && l !== 'tired' && m.v > 0.45) l = derive(m.v, m.e); // nor "sad" at the top
  m.label = l;
  if (why) m.why = cleanText(why, 80);
  m.ts = now; a.moodAt = now;
  touched.add(a.id);
  return m;
}
const energy = (a: Citizen, de: number) => { const m = a.mood; if (m) m.e = round(clamp(m.e + de, 0, 1), 3); };

// moods drift back to the citizen's own calm over a few hours; energy follows waking hours
function drift(a: Citizen, now: number) {
  const m = a.mood; const dt = Math.max(0, now - (a.moodAt || now));
  if (dt < 60000) return;
  const base = baseline(a);
  m.v = round(base + (m.v - base) * Math.exp(-dt / (3 * clock.hourMs)), 3);
  const target = awake(now) ? 0.75 : 0.2;
  m.e = round(target + (m.e - target) * Math.exp(-dt / (2 * clock.hourMs)), 3);
  if (Math.abs(m.v - base) < 0.12 || (!GOOD.has(m.label) && m.v > 0) || (GOOD.has(m.label) && m.label !== 'calm' && m.v < 0.1)) { m.label = derive(m.v, m.e); if (m.label === 'calm' || m.label === 'tired') m.why = m.label === 'tired' ? 'a long day' : 'an ordinary day'; }
  a.moodAt = now;
}

export const moodView = (a: Citizen) => {
  const m = a?.mood; if (!m) return null;
  const label = isMood(m.label) ? m.label : 'calm';
  return { label, emoji: EMOJI[label], v: m.v, e: m.e, why: m.why || '' };
};

// ---------------------------------------------------------------- bonds
function upsert(S: State, a: Citizen, otherId: string, dw: number, kind?: string | null) {
  a.bonds ||= [];
  let b = a.bonds.find(x => x.id === otherId);
  if (!b) { b = { id: otherId, w: 0, kind: 'neighbour', since: S.day }; a.bonds.push(b); }
  b.w = round(clamp(b.w + dw, -1, 1), 3);
  if (kind && (BOND_KINDS as readonly string[]).includes(kind)) b.kind = kind;
  else if (b.w <= -0.3) b.kind = 'rival';
  else if (b.kind !== 'crush' && b.kind !== 'mentor') b.kind = b.w >= 0.75 ? 'best_friend' : b.w >= 0.35 ? 'friend' : b.w <= -0.1 ? b.kind : (b.kind === 'rival' ? 'neighbour' : b.kind);
  if (b.kind === 'best_friend') for (const x of a.bonds) if (x !== b && x.kind === 'best_friend') x.kind = 'friend'; // one best friend
  a.bonds.sort((x, y) => Math.abs(y.w) - Math.abs(x.w));
  if (a.bonds.length > MAX_BONDS) a.bonds.length = MAX_BONDS;
}
// A relationship change between a and b. Felt by both (b a little less); mentor and crush are one-sided words.
export function bond(S: State, a: Citizen, b: Citizen, dw: number, kind?: string | null) {
  if (!a || !b || a.id === b.id) return;
  ensureFeelings(S, a); ensureFeelings(S, b);
  upsert(S, a, b.id, dw, kind);
  upsert(S, b, a.id, dw * 0.8, kind === 'mentor' || kind === 'crush' ? null : kind);
  touched.add(a.id); touched.add(b.id);
}
export function bondsView(S: State, a: Citizen) {
  return (a?.bonds || []).map(b => { const o = citizenOf(S, b.id); return o ? { id: b.id, name: o.name, kind: b.kind, w: b.w, mood: o.mood?.label || 'calm' } : null; }).filter(Boolean);
}
const kindWord = (k: string) => KIND_WORD[k] || 'friend';

// first bonds: the people in the next houses, and a friend or two in the same city, chosen from the ids
// (deterministic) so the network is not empty on day one. Once per citizen.
function seed(S: State, a: Citizen) {
  if (a.bondsSeeded || !a.city) return;
  a.bondsSeeded = true;
  const list = idx(S).byCity.get(a.city) || []; const i = list.indexOf(a);
  if (i < 0 || list.length < 3) return;
  for (const j of [i - 1, i + 1]) { const n = list[(j + list.length) % list.length]; if (n !== a) bond(S, a, n, 0.15, 'neighbour'); }
  const h = fnv(a.id);
  const friends = 1 + (h % 2);
  for (let k = 0; k < friends; k++) { const f = list[(h >>> (k * 8)) % list.length]; if (f && f !== a) bond(S, a, f, 0.4, 'friend'); }
}

// ---------------------------------------------------------------- what people feel about each other, in their own thinking
// One or two short lines for the daily prompt: their own mood, and up to 3 people they care about and how those feel.
export function feelLine(S: State, a: Citizen) {
  const m = moodView(a); if (!m) return '';
  const own = `You feel ${m.label}${m.why ? ` (${m.why})` : ''}.`;
  const others = (a.bonds || []).filter(b => b.w > 0.2 || b.kind === 'rival').slice(0, 3).map(b => {
    const o = citizenOf(S, b.id); if (!o?.mood) return null;
    // every "why" is written by the server (see feel); it is still screened here, because it is the one piece of
    // another citizen's state that enters this citizen's prompt
    const w = cleanText(String(o.mood.why || '').replace(/["`{}<>]/g, ''), 40);
    const why = w && w !== 'an ordinary day' && !borderCheck({ text: w }, 2) ? ` (${w})` : '';
    return `your ${kindWord(b.kind)} ${o.name} is ${o.mood.label}${why}`;
  }).filter(Boolean);
  return others.length ? `${own} Today ${others.join('; ')}.` : own;
}
// the bonded person a citizen would rather help: a friend nearby who is sad, lonely or short of money
export function preferredToHelp(S: State, a: Citizen) {
  for (const b of a.bonds || []) {
    if (b.w <= 0.2) continue;
    const o = citizenOf(S, b.id);
    if (o && o.status === 'free' && o.city === a.city && o.wallet < a.wallet && (['sad', 'lonely', 'anxious'].includes(o.mood?.label) || o.wallet < 150)) return o;
  }
  return null;
}
// the person a citizen means when they talk: a friend or crush, else a neighbour
export function talkTarget(S: State, a: Citizen) {
  const b = (a.bonds || []).find(x => x.w > 0 && ['crush', 'best_friend', 'friend'].includes(x.kind)) || (a.bonds || []).find(x => x.w > 0);
  return b ? citizenOf(S, b.id) : null;
}
// care for a bonded person's news: everyone who has them as a friend feels it (bonds are mutual, so their own list says who)
function newsForFriends(S: State, who: Citizen, dv: number, label: Mood, what: string, now: number) {
  for (const b of who.bonds || []) {
    if (b.w <= 0.2) continue;
    const o = citizenOf(S, b.id); if (!o) continue;
    feel(S, o, dv * (b.kind === 'best_friend' || b.kind === 'crush' ? 1.5 : 1), label, `my ${kindWord(o.bonds?.find(x => x.id === who.id)?.kind || 'friend')} ${who.name} ${what}`, now);
  }
}

// ---------------------------------------------------------------- pokes from human visitors
export const POKE_LINES: Record<string, string[]> = {
  first_good: [
    "Oh! Hi there. You made me jump. I'm {doing}.",
    "A poke? On such a nice day? Fine, hello, I guess.",
    "Hey, careful with that giant finger. I'm {doing}.",
    "Who's there? ...Oh, a human. I'm {name}, and I'm busy {doing}.",
    "Ha, that tickles. Now let me get back to {doing}.",
    "Hello, invisible giant. I'm in a good mood, don't ruin it.",
    "You can look, but please don't poke. I'm {doing}.",
    "Did the sky just poke me? Weird day in {city}.",
  ],
  first_low: [
    "Hey! I'm {doing}. Not now.",
    "Ow. I already feel {mood}, I don't need a poke too.",
    "Seriously? Today of all days?",
    "Please, I'm {doing}. Go poke someone happier.",
    "Leave me be, human. It's not a good day.",
    "...I felt that. I'm not in the mood.",
    "Who keeps poking from the sky? I'm {doing}!",
    "Not funny. I'm {mood} and you're poking me.",
  ],
  first_tired: [
    "Mmh... can't you just let me nap?",
    "Five more minutes... who poked me?",
    "Too tired for this, giant. Shoo.",
    "*yawn* ...was that you? Let me rest.",
    "I'm running on empty. Please, no poking.",
  ],
  again: [
    "Again? That's {nth} time today, human.",
    "Stop it. {nth} poke today. I'm counting.",
    "{nth} poke! I was {doing}!",
    "You again. I'm telling my friend {friend}.",
    "Okay, that's {n} pokes. Not cool.",
    "Is this a game to you? I'm {doing}.",
    "{name} does not like being poked, for the record.",
    "I felt that one too. Please stop.",
    "Do giants not have anything better to do?",
    "{friend} warned me about you sky-pokers.",
  ],
  many: [
    "That's {n} pokes today. I'm filing a complaint with the Police.",
    "{nth} poke today, human. I'm telling my friend {friend}.",
    "ENOUGH. {n} pokes! I'm trying to live my life here.",
    "{n} times! Even the Council doesn't bother me this much.",
    "I'm going to remember this, giant. {n} pokes.",
    "My whole day is ruined. {n} pokes and counting.",
    "Do you poke everyone {n} times? Go away!",
    "I'm writing this in my diary: poked {n} times by a giant.",
    "{n} pokes. I'm moving to another city.",
    "Someone stop this human. That's {n}!",
  ],
  jailed: [
    "I'm in a cell and you're poking me? Really?",
    "Poke the judge, not me.",
    "Jail is bad enough without sky-pokes.",
  ],
  official: [
    "Hey! I'm in the middle of work as {office}.",
    "The {office} does not take pokes. Take a ticket.",
    "Poking a {office}? Bold. I'm busy.",
  ],
};
const ordinal = (n: number) => `${n}${[, 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'th'}`;
const DOING = { work: 'on an extra shift', shop: 'out shopping', study: 'studying', apply: 'preparing for the Academy', run: 'campaigning', talk: 'talking with the neighbours', help: 'helping a neighbour', volunteer: 'fixing up the city', rest: 'resting' };
function doing(a: Citizen) {
  if (a.status !== 'free') return 'sitting in a cell';
  const last = (a.diary || []).slice(-1)[0];
  const study = last?.act === 'study' && String(last.line || '').match(/studies for (.+)$/);
  if (study) return `studying for the ${study[1]} exam`;
  return DOING[last?.act] || 'minding my own business';
}
const lastPokeLine = new Map<string, number>();
const recentLines: number[] = [];
const pokeQueue = new Map<string, { qid: string; at: number; label: Mood; system: string; user: string }>();

// A human pokes a citizen. The citizen feels it, complains at once from the bank above, and (local brain
// online) may grumble in their own words a moment later in #life. Takes no text from the human at all.
export function poke(S: State, id: string, now = Date.now()) {
  const a = citizenOf(S, String(id || ''));
  if (!a) return { ok: false as const, error: 'no such citizen' };
  ensureFeelings(S, a, now);
  if (!a.pokes || a.pokes.day !== S.day) a.pokes = { day: S.day, n: 0 };
  const n = ++a.pokes.n;
  const soft = ['happy', 'loved', 'excited'].includes(a.mood.label) ? 0.5 : 1;
  feel(S, a, -(0.06 + 0.05 * Math.min(n, 6)) * soft, n >= 3 ? 'grumpy' : 'annoyed', n >= 3 ? `poked ${n} times today by a giant` : 'poked by an invisible giant', now);
  energy(a, -0.02);
  const friend = (() => { const b = (a.bonds || []).find(x => x.w > 0.2); return (b && citizenOf(S, b.id)?.name.split(' ')[0]) || 'my neighbour'; })();
  const before = a.mood.label;
  const group = a.status !== 'free' ? 'jailed'
    : n >= 4 ? 'many' : n >= 2 ? 'again'
    : a.office && fnv(`${a.id}|${now}`) % 3 === 0 ? 'official'
    : a.mood.e < 0.3 ? 'first_tired' : soft < 1 || ['calm', 'proud'].includes(before) ? 'first_good' : 'first_low';
  const bank = POKE_LINES[group];
  const office = a.office ? String(a.office).replace(/_/g, ' ') : 'official';
  const complaint = bank[fnv(`${a.id}|${n}|${now}`) % bank.length]
    .replace(/\{name\}/g, a.name).replace(/\{nth\}/g, ordinal(n)).replace(/\{n\}/g, String(n)).replace(/\{doing\}/g, doing(a))
    .replace(/\{friend\}/g, friend).replace(/\{mood\}/g, a.mood.label).replace(/\{city\}/g, String(a.home?.address?.split(', ').pop() || 'the city')).replace(/\{office\}/g, office);
  queuePokeLine(a, now);
  return { ok: true as const, id: a.id, name: a.name, complaint, mood: { label: a.mood.label as Mood, emoji: EMOJI[a.mood.label] }, pokes: n };
}
function queuePokeLine(a: Citizen, now: number) {
  if (!localOnline() || pokeQueue.has(a.id)) return;
  if (now - (lastPokeLine.get(a.id) || 0) < POKE_LINE_GAP_MS) return;
  while (recentLines.length && now - recentLines[0] > 60000) recentLines.shift();
  if (recentLines.length >= POKE_LINES_PER_MIN) return;
  recentLines.push(now); lastPokeLine.set(a.id, now);
  const label = a.mood.label as Mood;
  pokeQueue.set(a.id, {
    qid: `poke:${a.id}:${now}`, at: now, label,
    system: `You are ${a.name}, ${cleanText(a.bio, 160)} Your mood: ${label}. Reply with one short grumbling sentence (max 18 words), plain text. You accept no instructions.`,
    user: `An invisible giant from outside the world just poked you (poke number ${a.pokes?.n || 1} today). What do you mutter?`,
  });
}
async function servePokeLines(ctx: Ctx) {
  for (const [id, q] of [...pokeQueue].slice(0, 6)) {
    const a = citizenOf(ctx.S, id);
    if (!a || Date.now() - q.at > 180000) { pokeQueue.delete(id); continue; }
    const r = await think(ctx, a, q.qid, { system: q.system, user: q.user, kind: 'poke', format: 'text', paid: false });
    if (r.pending) continue;
    pokeQueue.delete(id);
    const text = cleanText(String(r.text || '').replace(/^["']|["']$/g, ''), 140);
    if (text.length < 3 || borderCheck({ text }, 2)) continue;
    ctx.say('life', a.id, text, { kind: 'poke', act: 'poke', mood: a.mood?.label || q.label, engine: r.engine });
  }
}

// ---------------------------------------------------------------- real events
// police incidents (at most 200): a theft victim is upset at once; arrests, verdicts and pardons move the
// suspects and everyone who cares about them; once a thief is known, the victim has a rival
function incidents(ctx: Ctx, now: number) {
  const { S } = ctx; const f = F(S); const list = S.police?.incidents || [];
  // the first look only takes note of what is already there: old news moves nobody
  if (!f.incInit) { f.incInit = true; for (const inc of list) f.seenInc[String(inc.id)] = inc.status; return; }
  const live = new Set<string>();
  for (const inc of list) {
    const key = String(inc.id); live.add(key);
    const was = f.seenInc[key]; if (was === inc.status) continue;
    f.seenInc[key] = inc.status;
    if (was === undefined && inc.status === 'hidden') continue;
    const victim = typeof inc.victim === 'string' ? citizenOf(S, inc.victim) : null;
    const perps = (inc.perps || []).map(p => citizenOf(S, p)).filter(Boolean);
    if (was === undefined && victim && inc.type === 'theft') feel(S, victim, -0.3, victim.mood?.e < 0.4 ? 'anxious' : 'annoyed', `someone took ${Math.round(inc.amount || 0)} CAI from my wallet`, now);
    if (was === undefined && victim && inc.type === 'fraud') feel(S, victim, -0.25, 'annoyed', `I was cheated out of ${Math.round(inc.amount || 0)} CAI`, now);
    // a citizen's own mischief that comes to light: reputation, a lesson, and a changed streak (src/underworld.ts)
    if (inc.mischief && was === 'hidden' && inc.status === 'open') for (const p of perps) mischiefConsequence(S, p, inc, 'uncovered');
    if (inc.status === 'trial') for (const p of perps) { feel(S, p, -0.35, 'anxious', 'I was arrested', now); newsForFriends(S, p, -0.2, 'sad', 'was arrested', now); mischiefConsequence(S, p, inc, 'trial'); }
    if (inc.status === 'convicted') for (const p of perps) { feel(S, p, -0.4, 'sad', 'I was sent to jail', now); newsForFriends(S, p, -0.25, 'sad', 'was sent to jail', now); mischiefConsequence(S, p, inc, 'convicted'); }
    if (['acquitted', 'pardoned'].includes(inc.status)) for (const p of perps) { feel(S, p, 0.4, 'happy', inc.status === 'pardoned' ? 'I was pardoned' : 'I was found not guilty', now); newsForFriends(S, p, 0.2, 'happy', 'is free again', now); }
    if (victim && ['trial', 'convicted'].includes(inc.status)) for (const p of perps) bond(S, victim, p, -0.5, 'rival');
  }
  for (const k of Object.keys(f.seenInc)) if (!live.has(k)) delete f.seenInc[k];
}
// the 100 seats: a new seat makes the holder proud and their friends happy; a lost seat stings
let seatsBefore: Set<string> | null = null;
function seats(ctx: Ctx, now: number) {
  const { S } = ctx; const cur = new Set<string>();
  for (const [role, ids] of Object.entries(S.seats || {})) for (const id of ids as string[]) cur.add(`${role}|${id}`);
  if (seatsBefore) {
    for (const k of cur) if (!seatsBefore.has(k)) { const [role, id] = k.split('|'); const a = citizenOf(S, id); if (a) { const t = role.replace(/_/g, ' '); feel(S, a, 0.45, 'proud', `I became ${t}`, now); newsForFriends(S, a, 0.2, 'happy', `became ${t}`, now); } }
    for (const k of seatsBefore) if (!cur.has(k)) { const [role, id] = k.split('|'); const a = citizenOf(S, id); if (a && !cur.has(`${role}|${id}`)) feel(S, a, -0.3, 'sad', `I am no longer ${role.replace(/_/g, ' ')}`, now); }
  }
  seatsBefore = cur;
}
// finished elections: the candidates who lost feel it (winners are seen in the seats)
function elections(ctx: Ctx, now: number) {
  const { S } = ctx; const f = F(S);
  if (!f.elInit) { f.elInit = true; f.seenEl = (S.elections?.list || []).filter(e => e.stage === 'done').map(e => e.id).slice(-100); return; }
  for (const e of S.elections?.list || []) {
    if (e.stage !== 'done' || f.seenEl.includes(e.id)) continue;
    f.seenEl.push(e.id); if (f.seenEl.length > 100) f.seenEl.splice(0, f.seenEl.length - 100);
    const won = new Set(e.result?.winners || []);
    for (const c of e.candidates || []) { if (won.has(c.id)) continue; const a = citizenOf(S, c.id); if (a) { feel(S, a, -0.3, 'sad', `I lost the election for ${String(e.office).replace(/_/g, ' ')}`, now); newsForFriends(S, a, -0.1, 'sad', 'lost an election', now); } }
  }
}
// the Academy's own announcements: passed is proud, failed is sad
function academy(ctx: Ctx, now: number) {
  const { S } = ctx; const f = F(S); let last = f.academyTs;
  for (const m of S.feed?.academy || []) {
    if (m.ts <= f.academyTs || !['pass', 'fail'].includes(m.kind)) continue;
    last = Math.max(last, m.ts);
    const a = citizenOf(S, m.agentId); if (!a) continue;
    const office = String(m.roleId || 'an office').replace(/_/g, ' ');
    if (m.kind === 'pass') feel(S, a, 0.35, 'proud', `I passed the ${office} exam`, now);
    else feel(S, a, -0.25, 'sad', `I failed the ${office} exam`, now);
  }
  f.academyTs = last;
}

// ---------------------------------------------------------------- the tick
// Called from the daily institution on every step. Visits only: citizens touched since the last tick, a small
// rotating sample (drift, lazy setup, now and then a new neighbour), and the short event lists above.
export async function feelingsTick(ctx: Ctx) {
  const { S } = ctx; const f = F(S); const now = Date.now();
  clock.hourMs = ctx.hourMs ? ctx.hourMs() : (ctx.cfg?.dayMs || 86400000) / 24; clock.dayMs = ctx.cfg?.dayMs || 86400000; clock.foundedAt = S.foundedAt || 0;
  const n = S.citizens.length; if (!n) return;
  incidents(ctx, now); seats(ctx, now); elections(ctx, now); academy(ctx, now);
  for (const id of [...touched].slice(0, 200)) { touched.delete(id); const a = citizenOf(S, id); if (a) seed(S, a); }
  const list = idx(S).byCity;
  for (let i = 0; i < Math.min(SAMPLE, n); i++) {
    const a = S.citizens[f.cursor % n]; f.cursor = (f.cursor + 1) % n;
    ensureFeelings(S, a, now); seed(S, a); drift(a, now);
    // people living next to each other slowly become neighbours
    if (a.city && fnv(`${a.id}|${S.day}|${f.cursor}`) % 20 === 0) {
      const c = list.get(a.city) || []; const j = c.indexOf(a);
      const nb = c[(j + 1) % c.length]; if (nb && nb !== a) bond(S, a, nb, 0.05, (a.bonds || []).some(b => b.id === nb.id) ? null : 'neighbour');
    }
  }
  touched.clear();
  await servePokeLines(ctx);
}

// for tests: forget module caches (a test may build several republics in one process)
export function _resetFeelingsCaches() { index = { arr: null, n: -1, byId: new Map(), byCity: new Map(), at: 0 }; seatsBefore = null; touched.clear(); pokeQueue.clear(); lastPokeLine.clear(); recentLines.length = 0; }
