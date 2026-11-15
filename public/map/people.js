// All the republic's citizens on the map (owner, 15 Nov: "really 10,000"). Plain data, no three.js objects per person:
// a Map of people with their real home (a housing building), where they are now (GET /api/whereabouts?city=) and the
// building that means; those outside become robots (a limited number, nearest the camera first), everyone else is
// counted on the card of the building they are in. Names come from the server and are only ever set as text.
import { hash } from './gen.js';
import { MOODS } from './catalog.js';
import { cleanJob } from '../jobs.js?v=2';

export const HOUSING = new Set(['houses', 'rowhouses', 'apartments', 'public_housing', 'kampung', 'villas']);
const ID = /^[a-z0-9-]{1,40}$/;
const OUTSIDE = new Set(['street', 'outside']);
// what a 'where' means for the counts
export function kindOf(p) {
  const w = p.where;
  if (OUTSIDE.has(w)) return 'out';
  if (w === 'asleep') return 'asleep';
  if (w === 'home') return 'home';
  if (w === 'prison' || w === 'jail') return 'prison';
  return 'work';
}

export class People {
  constructor(data, agents) {
    this.data = data; this.agents = agents;
    this.byId = new Map(); this.inB = new Map(); // building idx -> people
    this.counts = null; this.byCity = {}; this.real = false; this.bytes = 0; this.at = 0;
  }
  // every citizen of every city, light (/api/citizens?lite=1, 2,000 a page): one request per city, more only if a
  // city has more than 2,000
  async load(cityIds) {
    await Promise.all(cityIds.map(async c => {
      for (let page = 1; page <= 5; page++) {
        const r = await fetch(`/api/citizens?lite=1&city=${encodeURIComponent(c)}&size=2000&page=${page}`);
        if (!r.ok) break;
        const txt = await r.text(); this.bytes += txt.length;
        let j; try { j = JSON.parse(txt); } catch { break; }
        for (const x of Array.isArray(j?.citizens) ? j.citizens : []) {
          if (!x || typeof x.id !== 'string' || !ID.test(x.id) || typeof x.name !== 'string') continue;
          const mood = typeof x.mood === 'object' ? x.mood?.label : x.mood;
          this.byId.set(x.id, { id: x.id, name: x.name.slice(0, 40), city: typeof x.city === 'string' ? x.city : c, status: x.status, office: x.office || null, color: x.color,
            mood: MOODS[mood] ? mood : null, student: x.occupation === 'student' && !x.office, job: cleanJob(x.job), home: x.home && typeof x.home === 'object' ? x.home : null, goal: x.goal || null, where: null, act: null, at: null, b: null, h: null });
        }
        const total = Number(j?.total) || 0; if (page * 2000 >= total) break;
      }
    }));
    return this.byId.size;
  }
  // the real home: the server's address laid on the map (agents.realHome), else a housing block by hash
  homeOf(p) {
    if (p.h) return p.h;
    const r = this.agents.realHome(p.id, p.city);
    if (r) p.h = { b: r.b, x: r.x, z: r.z, address: r.address };
    else { const b = this.agents.homeFor(p.id, p.city); p.h = b ? { b, x: b.x, z: b.z, address: null } : null; }
    return p.h;
  }
  // the building a 'where' means: home for home/asleep; else the building the server's key names (contract in
  // server.mjs): a ministry by its portfolio, any other type pool[key % pool.length] with pool = the buildings of that
  // type in the city where they are, in the generator's order (the same in every browser, and what /api/place folds
  // with key=<i>&of=<m>). Only without a key: the nearest building of that type to their home.
  placeOf(p) {
    const h = this.homeOf(p); const w = p.where;
    if (!w || w === 'home' || w === 'asleep' || OUTSIDE.has(w)) return h ? h.b : null;
    const c = this.data.cities[p.at] || this.data.cities[p.city];
    const own = c?.byType?.[w] || [];
    // with a key the server has said which building; when the map has no such building in that city, the person is
    // on no card (rather than on a wrong one): /api/place would not count them there either
    if (w === 'ministry' && typeof p.key === 'string') return own.find(b => b.extra?.portfolio === p.key) || null;
    if (Number.isInteger(p.key) && p.key >= 0) return own.length ? own[p.key % own.length] : null;
    let pool = own;
    if (!pool.length) for (const cc of Object.values(this.data.cities)) if (cc.byType?.[w]?.length) { pool = cc.byType[w]; break; }
    if (!pool.length) return null;
    if (pool.length === 1 || !h || p.at !== p.city) return pool[hash(p.id) % pool.length];
    let best = pool[0], bd = Infinity; for (const b of pool) { const d = (b.x - h.x) ** 2 + (b.z - h.z) ** 2; if (d < bd) { bd = d; best = b; } }
    return best;
  }
  // one city's whereabouts: returns the people whose place changed (for the walking robots)
  apply(city, view) {
    const moved = []; const seen = new Set();
    for (const row of Array.isArray(view?.people) ? view.people : []) {
      if (!Array.isArray(row)) continue;
      const p = this.byId.get(row[0]); if (!p) continue;
      let where = typeof row[1] === 'string' ? row[1] : 'home'; const act = typeof row[2] === 'string' ? row[2].slice(0, 40) : null;
      if (where === 'unknown') where = 'home'; // not known: counted at home (asleep now arrives as itself)
      const was = p.b;
      // key (4th column): a portfolio for a ministry, a slot 0..65535 for any other building type, else null
      const key = row[3]; p.key = typeof key === 'string' && /^[a-z][a-z_]{0,23}$/.test(key) ? key : Number.isInteger(key) && key >= 0 && key < 65536 ? key : null;
      p.where = where; p.act = act; p.at = city; p.seen = true; seen.add(p.id);
      p.b = this.placeOf(p);
      if (was && p.b !== was) { p.from = was; moved.push(p); }
    }
    this.real = true; this.at = Number(view?.at) || Date.now();
    (this.cityAt ||= {})[city] = Number(view?.at) || 0; // the snapshot each city's counts come from
    return moved;
  }
  // nobody's whereabouts yet (or the endpoint failed): everyone at home by day, asleep at night (an estimate)
  estimate(night) {
    for (const p of this.byId.values()) if (!p.seen) { p.where = night ? 'asleep' : 'home'; p.act = night ? 'sleeping' : 'at home'; p.at = p.city; p.b = this.placeOf(p); }
  }
  // counts (the whole country and per city where they are) and who is in each building
  index() {
    const zero = () => ({ total: 0, out: 0, home: 0, asleep: 0, work: 0, prison: 0, students: 0 });
    const all = zero(); const byCity = {}; this.inB = new Map();
    for (const p of this.byId.values()) {
      const k = kindOf(p); all.total++; all[k]++; if (p.student) all.students++;
      const c = (byCity[p.at || p.city] ||= zero()); c.total++; c[k]++; if (p.student) c.students++;
      if (k !== 'out' && p.b) { let l = this.inB.get(p.b.idx); if (!l) this.inB.set(p.b.idx, l = []); l.push(p); }
    }
    this.counts = all; this.byCity = byCity;
    return all;
  }
  // residents of a housing building (home there), whatever they are doing now
  residents(b) { const out = []; for (const p of this.byId.values()) if (this.homeOf(p)?.b === b) out.push(p); return out; }
  find(q, n = 8) {
    const s = String(q || '').trim().toLowerCase(); if (s.length < 2) return [];
    const out = []; for (const p of this.byId.values()) { if (p.name.toLowerCase().includes(s)) { out.push(p); if (out.length >= n) break; } }
    return out;
  }
}
