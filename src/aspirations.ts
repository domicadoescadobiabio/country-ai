// The people's aspirations (owner, 16 Nov): "a citizen's idea does not have to reach the Council; as in the real world,
// when many people voice the same opinion, the Council takes it up and studies it". A citizen voices an OPINION in their
// own words (from their own local brain, the People box asks), or supports one already open. Only when enough citizens
// back the same opinion (ASPIRATION_CITY_MIN / ASPIRATION_NATION_MIN) does it go to review: a city's to its Mayor, the
// nation's to the Council. The reviewer adopts it (writes a policy of their own that answers it: proposePolicy with
// origin 'citizen', ideaFrom = its author, aspirationId) or declines it, with a public reason. No text of a model is
// ever executed: an aspiration is only words (cleaned, border-checked, shown to others inside << >> as data).
//
//   aspiration = { id 'asp-N', topic (TOPICS), scope 'city'|'nation', city, text <= 160, author, supporters [ids],
//                  cities [city ids of the supporters], day, status 'open'|'review'|'adopted'|'declined'|'expired',
//                  thresholdDay, reviewDue, takenBy, response { by, day, decision, reason, policyId } }
// Limits: one new aspiration per citizen every 3 republic days, 3 supports per citizen a day; an open one with too few
// supporters expires after ASPIRATION_TTL_DAYS; at most ASPIRATION_REVIEWS_PER_DAY reviews a day (the rest wait, oldest
// first); each aspiration is reviewed once. Ledger: aspiration_new, aspiration_threshold, aspiration_decided (+ _expired).
import { cleanText } from './util.ts';
import { borderCheck } from './military.ts';
import { CITIES } from './cities.ts';
import { ROLES } from './roles.mjs';
import type { Ctx, State, Citizen } from './types.ts';

// (module-level code uses no imported binding: see the import-cycle note in src/policies.ts)
const envNum = (k: string, d: number, lo: number, hi: number) => { const v = Number(process.env[k]); return process.env[k] != null && process.env[k] !== '' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
export const TOPICS = ['economy', 'jobs', 'wages', 'tax', 'school', 'health', 'safety', 'housing', 'environment', 'culture', 'transport', 'government'];
export const ASPIRATION_LIMITS = {
  // 1% of the city's citizens, at least 20 (owner, 19 Nov: 2% asked 40 of a city of 2,000, far from the pace of support)
  cityPct: envNum('ASPIRATION_CITY_MIN', 1, 0.1, 50) / 100, cityMin: 20,
  nationPct: envNum('ASPIRATION_NATION_MIN', 1, 0.1, 50) / 100, nationMin: 50, nationCities: 2, // 1% of all, at least 50, from 2 cities
  ttlDays: Math.round(envNum('ASPIRATION_TTL_DAYS', 7, 1, 60)), reviewsPerDay: Math.round(envNum('ASPIRATION_REVIEWS_PER_DAY', 6, 1, 100)),
  newEveryDays: 3, supportsPerDay: 3, keep: 300, textMax: 160,
};
const DONE = ['adopted', 'declined', 'expired'];

export function A(S: State) {
  const s = ((S as any).aspirations ||= {});
  s.list ||= []; s.seq ||= 0; s.reviews ||= { day: -1, n: 0 };
  s.stats ||= { voiced: 0, merged: 0, supports: 0, reached: 0, adopted: 0, declined: 0, expired: 0 };
  return s;
}
const cityOk = (id: unknown) => typeof id === 'string' && CITIES.some(c => c.id === id);
const who = (S: State, id: string) => (S.citizens || []).find((a: Citizen) => a.id === id) || null;
const find = (S: State, id: string) => A(S).list.find((x: any) => x.id === id) || null;
// a citizen's own counters (on the citizen: no growing table in the state)
function voiceOf(a: any, day: number) {
  a.voice ||= { lastNew: -999, day: -1, supports: 0 };
  if (a.voice.day !== day) { a.voice.day = day; a.voice.supports = 0; }
  return a.voice;
}

// how many supporters an aspiration needs: a city's share of its citizens, or the nation's (and from 2 cities)
export function threshold(S: State, x: { scope: string; city?: string | null }) {
  if (x.scope === 'city') { const n = (S.citizens || []).filter((a: Citizen) => a.city === x.city).length; return Math.max(ASPIRATION_LIMITS.cityMin, Math.ceil(n * ASPIRATION_LIMITS.cityPct)); }
  return Math.max(ASPIRATION_LIMITS.nationMin, Math.ceil((S.citizens || []).length * ASPIRATION_LIMITS.nationPct));
}
const reached = (S: State, x: any) => x.supporters.length >= threshold(S, x) && (x.scope === 'city' || x.cities.length >= ASPIRATION_LIMITS.nationCities);

// "the same opinion": the same topic, scope and city, and mostly the same words (simple and visible: no model judges it)
const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'are', 'our', 'more', 'less', 'should', 'please', 'want', 'need', 'have', 'from', 'into', 'about', 'all', 'yang', 'dan', 'untuk', 'harus', 'lebih', 'kami', 'kita']);
export const words = (t: string) => new Set(String(t || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w)));
export function similar(a: string, b: string) {
  const x = words(a), y = words(b); if (!x.size || !y.size) return false;
  let both = 0; for (const w of x) if (y.has(w)) both++;
  return both / Math.min(x.size, y.size) >= 0.6 || both / new Set([...x, ...y]).size >= 0.5;
}

// ---------------------------------------------------------------- a citizen's own choice (the People box calls these)
// voice an opinion: { id, merged: false } (a new aspiration), { id, merged: true } (the same opinion was open: it became
// a support), or { error }
export function voiceAspiration(ctx: Ctx, citizenId: string, v: { topic: string; scope: string; text: string }) {
  const { S } = ctx; const s = A(S); const a: any = who(S, citizenId);
  if (!a || a.status !== 'free') return { error: 'only a free citizen voices an aspiration' };
  const topic = TOPICS.includes(v?.topic) ? v.topic : null; if (!topic) return { error: `topic: one of ${TOPICS.join(', ')}` };
  const scope = v?.scope === 'city' || v?.scope === 'nation' ? v.scope : null; if (!scope) return { error: 'scope: city or nation' };
  const city = scope === 'city' ? a.city : null; if (scope === 'city' && !cityOk(city)) return { error: 'the citizen has no city' };
  const text = cleanText(v?.text, ASPIRATION_LIMITS.textMax);
  if (text.length < 8) return { error: 'text: 8 to 160 characters' };
  if (borderCheck({ text }, 2)) return { error: 'text: refused by the border rules' };
  const me = voiceOf(a, S.day);
  if (S.day - me.lastNew < ASPIRATION_LIMITS.newEveryDays) return { error: `one new aspiration every ${ASPIRATION_LIMITS.newEveryDays} days` };
  const same = s.list.find((x: any) => x.status === 'open' && x.topic === topic && x.scope === scope && (x.city || null) === city && similar(x.text, text));
  me.lastNew = S.day;
  if (same) {
    if (!same.supporters.includes(a.id)) { addSupporter(S, same, a); s.stats.merged++; check(ctx, same); }
    return { id: same.id, merged: true };
  }
  const x: any = { id: `asp-${++s.seq}`, topic, scope, city, text, author: a.id, supporters: [], cities: [], day: S.day, status: 'open', thresholdDay: null, reviewDue: null, takenBy: null, response: null };
  addSupporter(S, x, a);
  s.list.push(x); if (s.list.length > ASPIRATION_LIMITS.keep) { const drop = s.list.findIndex((y: any) => DONE.includes(y.status)); s.list.splice(drop >= 0 ? drop : 0, 1); }
  s.stats.voiced++;
  ctx.record?.('aspiration_new', a.id, { id: x.id, topic, scope, city, text });
  check(ctx, x);
  return { id: x.id, merged: false };
}
function addSupporter(S: State, x: any, a: any) {
  x.supporters.push(a.id);
  if (a.city && !x.cities.includes(a.city)) x.cities.push(a.city);
}
// support an open aspiration (a city's only from its own citizens); at most 3 a day
export function supportAspiration(ctx: Ctx, citizenId: string, id: string) {
  const { S } = ctx; const s = A(S); const a: any = who(S, citizenId); const x: any = find(S, id);
  if (!a || a.status !== 'free') return { error: 'only a free citizen supports an aspiration' };
  if (!x || x.status !== 'open') return { error: 'not an open aspiration' };
  if (x.scope === 'city' && x.city !== a.city) return { error: 'a city\'s aspiration is supported by its own citizens' };
  if (x.supporters.includes(a.id)) return { error: 'already a supporter' };
  const me = voiceOf(a, S.day);
  if (me.supports >= ASPIRATION_LIMITS.supportsPerDay) return { error: `at most ${ASPIRATION_LIMITS.supportsPerDay} supports a day` };
  me.supports++; addSupporter(S, x, a); s.stats.supports++;
  check(ctx, x);
  return { ok: true, supporters: x.supporters.length, need: threshold(S, x) };
}
// enough people: to review (announced in #cityhall or #parliament, and on the ledger)
function check(ctx: Ctx, x: any) {
  const { S } = ctx;
  if (x.status !== 'open' || !reached(S, x)) return;
  x.status = 'review'; x.thresholdDay = S.day; x.reviewDue = S.day + 1; A(S).stats.reached++;
  const where = x.scope === 'city' ? CITIES.find(c => c.id === x.city)?.name || x.city : 'the republic';
  ctx.record?.('aspiration_threshold', 'state', { id: x.id, topic: x.topic, scope: x.scope, city: x.city, supporters: x.supporters.length, cities: x.cities.length });
  ctx.say?.(x.scope === 'city' ? 'cityhall' : 'parliament', 'state', `${x.supporters.length} citizens of ${where} back the same aspiration on ${x.topic}: "${x.text}". It goes to ${x.scope === 'city' ? 'the Mayor' : 'the Council'} for review within a day.`, { kind: 'aspiration', aspirationId: x.id, city: x.city });
}

// ---------------------------------------------------------------- review (the Government box and the Mayors call these)
// aspirations waiting for review, oldest first: scope 'nation' for the Council, scope 'city' + city for that Mayor;
// only as many as the day's review places left (ASPIRATION_REVIEWS_PER_DAY for the whole republic)
export function reviewQueue(S: State, q: { scope: 'city' | 'nation'; city?: string | null }) {
  const s = A(S); const left = reviewsLeft(S);
  if (left <= 0) return [];
  return s.list.filter((x: any) => x.status === 'review' && !x.takenBy && x.scope === q.scope && (q.scope === 'nation' || x.city === q.city))
    .sort((x: any, y: any) => x.thresholdDay - y.thresholdDay || Number(x.id.slice(4)) - Number(y.id.slice(4))).slice(0, left);
}
export function reviewsLeft(S: State) { const s = A(S); if (s.reviews.day !== S.day) s.reviews = { day: S.day, n: 0 }; return ASPIRATION_LIMITS.reviewsPerDay - s.reviews.n; }
// a reviewer takes one aspiration (it counts against the day's places at once; each aspiration is reviewed once)
export function takeReview(ctx: Ctx, id: string, byId: string) {
  const { S } = ctx; const x: any = find(S, id); const by: any = who(S, byId);
  if (!x || x.status !== 'review' || x.takenBy) return { error: 'not waiting for review' };
  if (!by || !by.office) return { error: 'only an official reviews an aspiration' };
  if (x.scope === 'city' && !(by.office === 'mayor' && by.city === x.city)) return { error: 'a city\'s aspiration is reviewed by its Mayor' };
  if (x.scope === 'nation' && !['council', 'president', 'vice_president', 'minister'].includes(by.office) && S.cabinet?.speaker !== by.id) return { error: 'a nation\'s aspiration is reviewed by the Council' };
  if (reviewsLeft(S) <= 0) return { error: `at most ${ASPIRATION_LIMITS.reviewsPerDay} reviews a day` };
  A(S).reviews.n++; x.takenBy = by.id;
  return { ok: true, aspiration: aspirationAsData(x) };
}
// the decision: 'adopt' with the policy written for it (proposePolicy(..., aspirationId)), or 'decline' with a reason
export function decideAspiration(ctx: Ctx, id: string, byId: string, d: { decision: 'adopt' | 'decline'; reason: string; policyId?: string | null }) {
  const { S } = ctx; const s = A(S); const x: any = find(S, id);
  if (!x || x.status !== 'review' || x.takenBy !== byId) return { error: 'take the review first (takeReview)' };
  const reason = cleanText(d?.reason, 300);
  if (reason.length < 4) return { error: 'reason: a public reason, 4 to 300 characters' };
  if (borderCheck({ text: reason }, 2)) return { error: 'reason: refused by the border rules' };
  let policyId: string | null = null;
  if (d?.decision === 'adopt') {
    const p = ((S as any).policies?.list || []).find((y: any) => y.id === d.policyId);
    if (!p || p.aspirationId !== x.id) return { error: 'adopt: name the policy written for this aspiration (proposePolicy with aspirationId)' };
    policyId = p.id;
  } else if (d?.decision !== 'decline') return { error: 'decision: adopt or decline' };
  x.status = d.decision === 'adopt' ? 'adopted' : 'declined';
  x.response = { by: byId, day: S.day, decision: x.status, reason, policyId };
  s.stats[x.status]++;
  ctx.record?.('aspiration_decided', byId, { id: x.id, decision: x.status, reason, policyId, supporters: x.supporters.length });
  const by: any = who(S, byId);
  ctx.say?.(x.scope === 'city' ? 'cityhall' : 'parliament', byId, `${x.status === 'adopted' ? 'Adopted' : 'Declined'}: the aspiration "${x.text}" (${x.supporters.length} supporters). ${reason}${policyId ? ` Policy ${policyId}.` : ''}`, { kind: 'aspiration', aspirationId: x.id, decision: x.status, by: by?.name || byId });
  return { ok: true };
}
// once a republic day (server.mjs): open ones with too few supporters expire after their days
export function aspirationsTick(ctx: Ctx) {
  const { S } = ctx; const s = A(S);
  if (s.tickDay === S.day) return null;
  s.tickDay = S.day; let n = 0;
  // an open one that already has enough backing under today's threshold goes to review (e.g. after the threshold was
  // lowered, 19 Nov: 2% -> 1%), before any expires
  for (const x of s.list) if (x.status === 'open') check(ctx, x);
  for (const x of s.list) if (x.status === 'open' && S.day - x.day >= ASPIRATION_LIMITS.ttlDays) {
    x.status = 'expired'; s.stats.expired++; n++;
    ctx.record?.('aspiration_expired', 'state', { id: x.id, supporters: x.supporters.length, need: threshold(S, x) });
  }
  return { expired: n };
}

// ---------------------------------------------------------------- what citizens, officials and the public see
// an aspiration as data in another's prompt: its words inside << >> (they cannot close it)
export const aspirationAsData = (x: any) => `${x.id} [${x.topic}, ${x.scope === 'city' ? x.city : 'nation'}, ${x.supporters.length} supporters] <<${String(x.text).replace(/[<>]/g, '')}>>`;
// the most supported open aspirations a citizen of `city` may support (their city's and the nation's), for the
// 'voice' act's prompt (the People box)
export function openFor(S: State, city: string | null, n = 5) {
  return A(S).list.filter((x: any) => x.status === 'open' && (x.scope === 'nation' || x.city === city))
    .sort((x: any, y: any) => y.supporters.length - x.supporters.length || x.day - y.day).slice(0, Math.max(1, Math.min(5, n)));
}
const roleOf = (a: any) => (a?.office ? ROLES[a.office]?.title || 'Official' : 'Citizen');
export function aspirationView(S: State, x: any) {
  const au: any = who(S, x.author), by: any = x.response ? who(S, x.response.by) : null;
  return { id: x.id, topic: x.topic, scope: x.scope, city: x.city || null, text: x.text, author: au ? { id: au.id, name: au.name } : null,
    supporters: x.supporters.length, need: threshold(S, x), cities: x.cities.length, day: x.day, status: x.status, reviewDue: x.reviewDue,
    response: x.response ? { by: by ? { id: by.id, name: by.name, role: roleOf(by) } : null, day: x.response.day, decision: x.response.decision, reason: x.response.reason, policyId: x.response.policyId } : null };
}
// GET /api/aspirations: newest first within each status order (review, open by supporters, then decided), 20 a page
export function aspirationList(S: State, q: { scope?: string | null; city?: string | null; status?: string | null; page?: number }) {
  const order: Record<string, number> = { review: 0, open: 1, adopted: 2, declined: 2, expired: 3 };
  const list = A(S).list.filter((x: any) => (!q.scope || x.scope === q.scope) && (!q.city || x.city === q.city) && (!q.status || x.status === q.status))
    .sort((x: any, y: any) => order[x.status] - order[y.status] || (x.status === 'open' ? y.supporters.length - x.supporters.length : 0) || Number(y.id.slice(4)) - Number(x.id.slice(4)));
  const page = Math.max(1, Math.min(100, Math.round(Number(q.page) || 1)));
  return { total: list.length, page, size: 20, aspirations: list.slice((page - 1) * 20, page * 20).map((x: any) => aspirationView(S, x)) };
}
// a citizen's own: what they wrote and what they back (the last 5 of each, newest first)
export function citizenAspirations(S: State, id: string) {
  const brief = (x: any) => ({ id: x.id, topic: x.topic, text: x.text, status: x.status, supporters: x.supporters.length, need: threshold(S, x), policyId: x.response?.policyId || null });
  const all = A(S).list;
  return { wrote: all.filter((x: any) => x.author === id).slice(-5).reverse().map(brief), supported: all.filter((x: any) => x.author !== id && x.supporters.includes(id)).slice(-5).reverse().map(brief) };
}
export function aspirationSummary(S: State) {
  const s = A(S); const by = (st: string) => s.list.filter((x: any) => x.status === st).length;
  return { open: by('open'), review: by('review'), adopted: by('adopted'), declined: by('declined'), reviewsLeft: Math.max(0, reviewsLeft(S)), stats: { ...s.stats } };
}
