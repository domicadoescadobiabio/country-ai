// Seeded city generator. Pure data: no three.js here, so it can be tested in Node.
// Output: buildings (clickable records), parts (primitive shapes to draw), grounds (flat patches),
// and per-city grids that agents walk on. 1 unit = 1 metre.
import { TYPES, CITY_PLAN, REP } from './catalog.js';

export const PITCH = 80;      // block + road
export const BLOCK = 62;      // usable block width
const LOT_W = 15, LOT_D = 29; // housing lot inside a block (4 x 2 lots)

export function hash(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0; return h; }
export function rng(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : hash(String(seed));
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
const range = (r, lo, hi) => lo + r() * (hi - lo);

const PALETTE = {
  wall: ['#efe6d6', '#e8dcc7', '#f3efe7', '#e2d2bc', '#d9cbb5', '#f0e1cc', '#e6e0d4', '#d7d2c8'],
  roof: ['#b5523b', '#c0653f', '#8f3b2e', '#6b4f3f', '#556270', '#7a8b6f', '#a0522d', '#4f5d75'],
  kampung: ['#c86b3c', '#d17b49', '#b55b34', '#9c6644', '#cf8a54', '#7f8c8d'],
  glass: ['#7aa6c8', '#6f93b3', '#8fb3cf', '#5e86a8', '#9cc0d8'],
  shop: ['#e05a7a', '#f59e0b', '#22a06b', '#3b82f6', '#ef4444', '#a855f7', '#14b8a6'],
};

export function generateCountry(state) {
  const out = { buildings: [], parts: [], grounds: [], trees: [], cities: {}, roads: [], water: [], labels: [] };
  const cities = (state?.cities?.length ? state.cities : Object.keys(CITY_PLAN).map(id => ({ id, name: id, residents: 2000 })));
  for (const c of cities) {
    const plan = CITY_PLAN[c.id] || { role: 'town', pos: [hash(c.id) % 6000 - 3000, hash(c.id + 'z') % 6000 - 3000], scale: 1 };
    out.cities[c.id] = buildCity(out, c, plan);
  }
  // sky-bridges across the narrow gaps between districts (capital to each district, and between neighbours)
  const ids = Object.keys(out.cities);
  const cap = out.cities.neura || out.cities[ids[0]];
  const bridge = (a, b, w) => {
    const dx = b.cx - a.cx, dz = b.cz - a.cz, d = Math.hypot(dx, dz); if (!d) return;
    const ux = dx / d, uz = dz / d, ra = a.radius * 0.86, rb = b.radius * 0.86;
    if (d - ra - rb < 40) return;
    out.roads.push({ a: [a.cx + ux * ra, a.cz + uz * ra], b: [b.cx - ux * rb, b.cz - uz * rb], w, kind: 'bridge' });
  };
  for (const id of ids) if (out.cities[id] !== cap) bridge(cap, out.cities[id], 22);
  const ring = ids.filter(id => out.cities[id] !== cap).sort((p, q) => Math.atan2(out.cities[p].cz, out.cities[p].cx) - Math.atan2(out.cities[q].cz, out.cities[q].cx));
  for (let i = 0; i < ring.length; i++) bridge(out.cities[ring[i]], out.cities[ring[(i + 1) % ring.length]], 16);
  // the airport sits on its own pad just outside the ring, south of the capital
  if (out.cities.neura) addAirport(out, cap.cx - 150, cap.cz + cap.radius + 1650, 'neura');
  return out;
}

function buildCity(out, c, plan) {
  const r = rng('country-ai|map|' + c.id);
  const people = Math.max(1, c.residents || 2000) * REP;
  const blocksWanted = Math.round(people / 58 * plan.scale);
  const N = Math.max(8, Math.round(Math.sqrt(blocksWanted / Math.PI)));
  const [cx, cz] = plan.pos;
  const city = { id: c.id, name: c.name || c.id, plan, cx, cz, N, people, grid: new Map(), blocks: [], byType: {}, lots: [], radius: (N + 1) * PITCH, center: null };
  out.cities[c.id] = city;
  const ph1 = r() * 6.28, ph2 = r() * 6.28;
  const key = (i, j) => i + ',' + j;
  // which grid cells are land and inside the city outline
  for (let i = -N - 1; i <= N + 1; i++) for (let j = -N - 1; j <= N + 1; j++) {
    const a = Math.atan2(j, i); const f = 1 + 0.16 * Math.sin(3 * a + ph1) + 0.09 * Math.sin(5 * a + ph2);
    const d = Math.hypot(i, j) / N / f;
    if (d > 1) continue;
    if (plan.coast === 'south' && j > Math.round(N * 0.55 + 2 * Math.sin(i / 3))) continue;
    if (plan.coast === 'east' && i > Math.round(N * 0.5 + 2 * Math.sin(j / 4))) continue;
    if (plan.river && Math.abs(i - Math.round(3 * Math.sin(j / 5))) === 0) continue;
    const b = { i, j, x: cx + i * PITCH, z: cz + j * PITCH, d, a, used: null, city: c.id };
    city.grid.set(key(i, j), b); city.blocks.push(b);
  }
  const at = (i, j) => city.grid.get(key(i, j));
  const L = (N + 12) * PITCH;
  // only a harbour strip of water (a neon-lit bay), not an ocean of empty blue
  if (plan.coast === 'south') out.water.push({ x: cx, z: cz + (N * 0.55 + 0.6) * PITCH + 330, w: 1.6 * N * PITCH, d: 660 });
  if (plan.coast === 'east') out.water.push({ x: cx + (N * 0.5 + 0.6) * PITCH + 330, z: cz, w: 660, d: 1.6 * N * PITCH });
  if (plan.river) for (let j = -N - 1; j <= N + 1; j++) out.water.push({ x: cx + Math.round(3 * Math.sin(j / 5)) * PITCH, z: cz + j * PITCH, w: PITCH - 6, d: PITCH + 2 });
  // bridges: every street that meets the river crosses it
  if (plan.river) for (let j = -N - 1; j <= N; j++) {
    const ri = Math.round(3 * Math.sin(j / 5)); if (ri !== Math.round(3 * Math.sin((j + 1) / 5))) continue;
    if (!(at(ri - 1, j) || at(ri - 1, j + 1)) || !(at(ri + 1, j) || at(ri + 1, j + 1))) continue;
    const x = cx + ri * PITCH, z = cz + (j + 0.5) * PITCH;
    out.grounds.push({ x, z, w: PITCH + 4, d: 16, color: '#555a61', y: 0.9 });
    out.parts.push({ b: -1, shape: 'box', x, y: 0, z: z - 8.5, sx: PITCH + 4, sy: 2.2, sz: 1, color: '#a8a29e' }, { b: -1, shape: 'box', x, y: 0, z: z + 8.5, sx: PITCH + 4, sy: 2.2, sz: 1, color: '#a8a29e' });
  }
  const free = (i, j, w = 1, h = 1) => { for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) { const b = at(i + x, j + y); if (!b || b.used) return false; } return true; };
  const claim = (type, i, j, w = 1, h = 1, extra = {}) => {
    if (!free(i, j, w, h)) { const nb = nearestFree(i, j, w, h); if (!nb) return null; i = nb.i; j = nb.j; }
    const blocks = []; for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) blocks.push(at(i + x, j + y));
    const x0 = cx + i * PITCH - BLOCK / 2, z0 = cz + j * PITCH - BLOCK / 2;
    const W = (w - 1) * PITCH + BLOCK, D = (h - 1) * PITCH + BLOCK;
    const bld = addBuilding(out, city, type, x0 + W / 2, z0 + D / 2, W, D, extra);
    for (const b of blocks) b.used = bld.idx;
    drawFacility(out, r, bld);
    return bld;
  };
  const nearestFree = (ti, tj, w = 1, h = 1) => {
    let best = null, bd = 1e9;
    for (const b of city.blocks) { if (!free(b.i, b.j, w, h)) continue; const d = (b.i - ti) ** 2 + (b.j - tj) ** 2; if (d < bd) { bd = d; best = b; } }
    return best;
  };
  const place = (type, ti, tj, w = 1, h = 1, extra) => { const b = nearestFree(ti, tj, w, h); return b ? claim(type, b.i, b.j, w, h, extra) : null; };
  const polar = (dn, ang) => [Math.round(Math.cos(ang) * dn * N), Math.round(Math.sin(ang) * dn * N)];
  const windAng = r() * 6.28; // industry sits on one side, villas on the opposite side

  // --- core: the town square with city hall, main place of worship, market and police around it (alun-alun pattern)
  const sq = claim('square', 0, 0); city.center = sq;
  place('city_hall', 0, -1); place('worship', -1, 0, 1, 1, { grand: true }); place('market', 1, 0); place('police_station', 0, 1, 1, 1, { main: true });
  place('court', 1, 1); place('jail', -1, 1);

  // --- role plans
  if (plan.role === 'capital') capitalPlan(out, r, city, { claim, place, free, at, N });
  if (plan.role === 'port') {
    const shore = city.blocks.filter(b => !at(b.i, b.j + 1)).sort((a, b) => a.i - b.i);
    const mid = shore[Math.floor(shore.length / 2)];
    if (mid) { place('port', mid.i - 1, mid.j - 1, 4, 2); place('naval_base', mid.i + 5, mid.j - 1, 3, 2); place('warehouse', mid.i - 2, mid.j - 3); place('warehouse', mid.i + 1, mid.j - 3); }
    place('power_plant', ...polar(0.85, windAng), 2, 1); place('hotel', 2, -2); (city.pendingLots ||= []).push({ type: 'border_post', i: -N, j: 0 });
  }
  if (plan.role === 'tech') {
    for (let k = 0; k < 8; k++) place('data_center', ...polar(0.62 + 0.05 * (k % 3), windAng + (k - 4) * 0.13));
    place('university', -3, -3, 2, 2); place('police_academy', ...polar(0.82, windAng + Math.PI * 0.6), 3, 2);
    place('solar_farm', ...polar(0.9, windAng + 0.5), 2, 2);
  }
  if (plan.role === 'industry') {
    place('dam', 0, -N + 1, 2, 1); place('prison', ...polar(0.85, windAng + Math.PI * 0.5), 2, 2);
    for (let k = 0; k < 6; k++) place('factory', ...polar(0.6 + 0.06 * (k % 3), windAng + (k - 3) * 0.16));
    place('military_housing', ...polar(0.7, windAng + Math.PI * 0.7));
  }
  if (plan.role === 'resort') {
    place('air_base', ...polar(0.8, windAng + Math.PI * 0.8), 4, 2); place('military_housing', ...polar(0.7, windAng + Math.PI * 0.8));
    for (let k = 0; k < 4; k++) place('hotel', N - 3, -3 + k * 2); place('stadium', -3, 3, 2, 2);
  }
  if (plan.role !== 'capital') place('train_station', ...polar(0.4, windAng + Math.PI / 2), 2, 1);
  place('university', ...polar(0.45, windAng + Math.PI), 2, 2);

  // --- ratio-driven block facilities, spread out (farthest point) inside their zone
  const zoneOk = (b, where) => where === 'any' || (where === 'core' && b.d < 0.25) || (where === 'inner' && b.d < 0.5) || (where === 'mid' && b.d > 0.2 && b.d < 0.8) || (where === 'edge' && b.d > 0.72) || (where === 'industry' && b.d > 0.45 && Math.cos(b.a - windAng) > 0.55);
  const count = t => Math.max(t.min || 0, Math.round(people / t.per));
  const spread = (type, n, w = 1, h = 1) => {
    const t = TYPES[type]; const placed = [...(city.byType[type] || [])].map(x => [x.x, x.z]);
    for (let k = 0; k < n; k++) {
      let best = null, bd = -1;
      for (const b of city.blocks) {
        if (!zoneOk(b, t.where) || !free(b.i, b.j, w, h)) continue;
        let d = 1e9; for (const [px, pz] of placed) d = Math.min(d, (b.x - px) ** 2 + (b.z - pz) ** 2);
        d += r() * 400; if (!placed.length) d = 1e8 - (b.i ** 2 + b.j ** 2) * (t.where === 'edge' ? -1 : 1) + r();
        if (d > bd) { bd = d; best = b; }
      }
      if (!best) return; const bld = claim(type, best.i, best.j, w, h); placed.push([bld.x, bld.z]);
    }
  };
  for (const [type, t] of Object.entries(TYPES)) {
    if (!t.per || t.size === 'lot') continue;
    const have = (city.byType[type] || []).length;
    spread(type, count(t) - have, ...(Array.isArray(t.size) ? t.size : [1, 1]));
  }
  // green space towards ~12% of blocks (parks are also where trees go)
  const parksWanted = Math.round(city.blocks.length * 0.07) - (city.byType.park || []).length;
  if (parksWanted > 0) spread('park', parksWanted);

  // --- housing fills everything left; type depends on distance from centre and which side of town
  for (const b of city.blocks) {
    if (b.used != null) continue;
    const side = Math.cos(b.a - windAng); let type;
    if (b.d < 0.22) type = r() < 0.75 ? 'office' : 'apartments';
    else if (b.d < 0.42) type = r() < 0.55 ? 'apartments' : (r() < 0.5 ? 'public_housing' : 'rowhouses');
    else if (side < -0.8 && b.d > 0.4 && b.d < 0.85 && r() < 0.45) type = 'villas';
    else if (side > 0.3 && b.d > 0.55 && r() < 0.55) type = 'kampung';
    else type = r() < 0.6 ? 'houses' : (r() < 0.5 ? 'rowhouses' : 'kampung');
    if (type === 'office' && (city.byType.office || []).length > count(TYPES.office) * 2) type = 'apartments';
    claim(type, b.i, b.j);
  }

  // --- small facilities replace housing lots (spread over the city)
  const lotTypes = Object.entries(TYPES).filter(([, t]) => t.size === 'lot' && t.per);
  for (const [type, t] of lotTypes) {
    const n = count(t) - (city.byType[type] || []).length;
    const cand = city.lots.filter(lot => t.where === 'any' || zoneOk(city.grid.get(key(lot.i, lot.j)), t.where));
    const dmin = new Float64Array(cand.length).fill(1e12); // farthest-point sampling, O(n * lots)
    for (let k = 0; k < n; k++) {
      let bi = -1, bd = -1;
      for (let q = 0; q < cand.length; q++) { if (cand[q].taken) continue; const d = dmin[q] + r() * 2000; if (d > bd) { bd = d; bi = q; } }
      if (bi < 0) break; const best = cand[bi]; best.taken = true; replaceLot(out, r, city, best, type);
      for (let q = 0; q < cand.length; q++) { const d = (cand[q].x - best.x) ** 2 + (cand[q].z - best.z) ** 2; if (d < dmin[q]) dmin[q] = d; }
    }
  }
  // the city's "special" lot facilities placed by plan
  for (const p of city.pendingLots || []) { const lot = nearestLot(city, p.i, p.j); if (lot) { lot.taken = true; replaceLot(out, r, city, lot, p.type); } }

  out.labels.push({ text: city.name, x: cx, y: 160, z: cz - city.radius * 0.2, kind: 'city', city: c.id });
  return city;
}

function nearestLot(city, i, j) {
  let best = null, bd = 1e9; const x = city.cx + i * PITCH, z = city.cz + j * PITCH;
  for (const l of city.lots) if (!l.taken) { const d = (l.x - x) ** 2 + (l.z - z) ** 2; if (d < bd) { bd = d; best = l; } }
  return best;
}

function capitalPlan(out, r, city, { claim, place, free, at, N }) {
  // national axis to the north of the town square: monument square, ministries on both sides,
  // then the Council House and the palace at the head of the axis (the "three arms": palace, council, court).
  claim('monument', 0, -3, 2, 2);
  const MIN = ['finance', 'economy', 'home', 'defence', 'justice', 'education', 'welfare', 'technology'];
  MIN.forEach((m, k) => { const side = k % 2 ? 2 : -1; const row = -5 - Math.floor(k / 2); if (free(side, row)) claim('ministry', side, row, 1, 1, { portfolio: m }); });
  for (let row = -5; row >= -8; row--) if (free(0, row) && free(1, row)) claim('park', 0, row, 2, 1, { mall: true });
  const pal = free(0, -11, 2, 2) ? claim('palace', 0, -11, 2, 2) : place('palace', 0, -11, 2, 2);
  if (free(0, -9, 2, 1)) claim('parliament', 0, -9, 2, 1); else place('parliament', 0, -9, 2, 1);
  place('const_court', 2, -10); place('vp_office', -1, -11); place('election_comm', -1, -9); place('national_archive', 2, -9);
  place('central_bank', 2, -2); place('police_hq', -2, -2); place('military_hq', 3, -4);
  place('academy', -4, -6, 2, 2); place('stadium', 4, 3, 2, 2); place('hotel', 3, 0); place('hotel', -3, 1);
  place('train_station', 0, 4, 2, 1); place('bus_terminal', 2, 4);
  const edge = (ang, dn = 0.88) => [Math.round(Math.cos(ang) * dn * N), Math.round(Math.sin(ang) * dn * N)];
  place('army_base', ...edge(0.4), 3, 3); place('military_academy', ...edge(0.9, 0.85), 3, 2); place('military_housing', ...edge(0.6, 0.72));
  place('police_housing', -5, 2); place('prison', ...edge(2.6), 2, 2);
  (city.pendingLots ||= []).push({ type: 'border_post', i: -N, j: 0 }, { type: 'border_post', i: N, j: 0 });
  return pal;
}

function addAirport(out, x, z, cityId) {
  const W = 5 * PITCH, D = 2 * PITCH;
  const city = { id: cityId, byType: {} };
  const bld = { idx: out.buildings.length, type: 'airport', name: TYPES.airport.name, cat: 'infra', x, z, w: W, d: D, h: 20, city: cityId, extra: {} };
  out.buildings.push(bld);
  out.grounds.push({ x, z, w: W + 40, d: D + 40, color: '#9aa39a', y: 0.05 });
  out.grounds.push({ x, z: z + 40, w: W, d: 30, color: '#3a3d42', y: 0.12 });
  for (let k = -6; k <= 6; k++) out.grounds.push({ x: x + k * 28, z: z + 40, w: 12, d: 2, color: '#f4f4f4', y: 0.18 });
  part(out, bld, 'box', x - 60, 0, z - 40, 140, 16, 36, '#cfd8e3');
  part(out, bld, 'box', x - 60, 16, z - 40, 150, 2, 42, '#8fb3cf');
  part(out, bld, 'cyl', x + 120, 0, z - 40, 6, 34, 6, '#e5e7eb'); part(out, bld, 'box', x + 120, 34, z - 40, 14, 8, 14, '#5e86a8');
  out.labels.push({ text: TYPES.airport.name, x, y: 50, z, kind: 'landmark', b: bld.idx });
}

function addBuilding(out, city, type, x, z, w, d, extra = {}) {
  const t = TYPES[type] || { name: type, cat: 'work' };
  let name = t.name;
  if (type === 'ministry' && extra.portfolio) name = `Ministry of ${({ home: 'Home Affairs', welfare: 'Welfare', technology: 'Technology', defence: 'Defence', justice: 'Justice', education: 'Education', economy: 'Economy', finance: 'Finance' })[extra.portfolio]}`;
  const n = (city.byType[type] ||= []).length + 1;
  const numbered = ['police_station', 'police_post', 'fire_station', 'primary_school', 'middle_school', 'high_school', 'clinic', 'community_hall', 'park', 'market', 'office', 'factory', 'data_center', 'supermarket', 'kindergarten'];
  if (numbered.includes(type)) name = `${t.name} ${n}`;
  const bld = { idx: out.buildings.length, type, name, cat: t.cat, x, z, w, d, h: 8, city: city.id, extra };
  out.buildings.push(bld); city.byType[type].push(bld);
  return bld;
}

function part(out, bld, shape, x, y, z, sx, sy, sz, color, rot = 0) {
  out.parts.push({ b: bld ? bld.idx : -1, shape, x, y, z, sx, sy, sz, color, rot });
  if (bld && y + sy > bld.h) bld.h = y + sy;
}
function ground(out, x, z, w, d, color, y = 0.06) { out.grounds.push({ x, z, w, d, color, y }); }
function tree(out, r, x, z, s = 1) { out.trees.push({ x, z, s: s * range(r, 0.75, 1.25), c: r() }); }
function treesIn(out, r, x, z, w, d, n) { for (let k = 0; k < n; k++) tree(out, r, x + (r() - 0.5) * w, z + (r() - 0.5) * d); }

function replaceLot(out, r, city, lot, type) {
  // hide the house that stood on this lot and put the facility there
  for (const pi of lot.parts) out.parts[pi].hidden = true;
  const bld = addBuilding(out, city, type, lot.x, lot.z, LOT_W, LOT_D, {});
  const face = lot.side ? 1 : -1; // facade towards the street
  const w = LOT_W - 2, d = LOT_D - 6, x = lot.x, z = lot.z;
  ground(out, x, z, LOT_W, LOT_D, '#c9c4b8', 0.09);
  switch (type) {
    case 'police_post': part(out, bld, 'box', x, 0, z + face * 6, 8, 4, 8, '#f3f4f6'); part(out, bld, 'box', x, 4, z + face * 6, 9, 1, 9, '#1d4ed8'); part(out, bld, 'box', x, 5, z + face * 6, 1.6, 1.2, 1.6, '#60a5fa'); break;
    case 'fire_station': part(out, bld, 'box', x, 0, z, w, 8, d, '#b91c1c'); part(out, bld, 'box', x, 0, z + face * (d / 2), w - 2, 5, 0.6, '#3f3f46'); part(out, bld, 'box', x + w / 2 - 2, 0, z - face * 6, 3, 15, 3, '#991b1b'); break;
    case 'clinic': part(out, bld, 'box', x, 0, z, w, 7, d, '#f8fafc'); part(out, bld, 'box', x, 7, z, 3, 0.6, 9, '#16a34a'); part(out, bld, 'box', x, 7, z, 9, 0.6, 3, '#16a34a'); break;
    case 'pharmacy': part(out, bld, 'box', x, 0, z + face * 4, w, 5, 14, '#ecfdf5'); part(out, bld, 'box', x, 5, z + face * 4, w, 1, 14, '#10b981'); break;
    case 'minimarket': case 'supermarket': {
      const big = type === 'supermarket'; const col = pick(r, PALETTE.shop);
      part(out, bld, 'box', x, 0, z + (big ? 0 : face * 5), big ? w : w - 2, big ? 7 : 4.5, big ? d : 12, '#f5f5f4');
      part(out, bld, 'box', x, big ? 7 : 4.5, z + (big ? 0 : face * 5), big ? w : w - 2, 1.4, big ? d : 12, col);
      if (big) ground(out, x, z + face * (d / 2 + 1), w, 6, '#4b5563', 0.1); break;
    }
    case 'food_stall': { const col = pick(r, PALETTE.shop); part(out, bld, 'box', x, 0, z + face * 8, 9, 3.4, 7, '#fde68a'); part(out, bld, 'gable', x, 3.4, z + face * 8, 11, 1.6, 9, col); for (let k = -1; k <= 1; k++) part(out, bld, 'cyl', x + k * 4, 0, z + face * 2, 1.2, 1, 1.2, '#78350f'); break; }
    case 'restaurant': part(out, bld, 'box', x, 0, z, w, 6, d - 4, '#fef3c7'); part(out, bld, 'gable', x, 6, z, w + 1, 3, d - 3, pick(r, PALETTE.roof)); break;
    case 'bank': part(out, bld, 'box', x, 0, z, w, 11, d, '#e2e8f0'); part(out, bld, 'box', x, 11, z, w, 1.2, d, '#1e3a8a'); break;
    case 'post_office': part(out, bld, 'box', x, 0, z, w, 7, d, '#fed7aa'); part(out, bld, 'box', x, 7, z, w, 1, d, '#ea580c'); break;
    case 'library': part(out, bld, 'box', x, 0, z, w, 9, d, '#e7e5e4'); part(out, bld, 'gable', x, 9, z, w + 1, 3, d + 1, '#57534e'); for (let k = -1; k <= 1; k++) part(out, bld, 'cyl', x + k * 4, 0, z + face * (d / 2 + 1), 1, 9, 1, '#fafaf9'); break;
    case 'community_hall': part(out, bld, 'box', x, 0, z, w, 6, d - 2, '#fde68a'); part(out, bld, 'gable', x, 6, z, w + 1, 4, d, '#a16207'); break;
    case 'civil_office': part(out, bld, 'box', x, 0, z, w, 9, d, '#f1f5f9'); part(out, bld, 'box', x, 9, z, w, 1, d, '#94a3b8'); part(out, bld, 'cyl', x + w / 2, 0, z + face * (d / 2 + 1), 0.3, 12, 0.3, '#e5e7eb'); break;
    case 'kindergarten': part(out, bld, 'box', x, 0, z - face * 4, w, 4.5, 14, '#fef08a'); part(out, bld, 'gable', x, 4.5, z - face * 4, w + 1, 3, 15, '#f97316'); ground(out, x, z + face * 8, w, 10, '#86efac', 0.11); break;
    case 'worship': {
      const v = Math.floor(r() * 3);
      if (v === 0) { part(out, bld, 'box', x, 0, z, w, 7, w, '#f5f5f4'); part(out, bld, 'dome', x, 7, z, 6, 6, 6, '#15803d'); part(out, bld, 'cyl', x + w / 2, 0, z + w / 2, 1.2, 18, 1.2, '#f5f5f4'); part(out, bld, 'cone', x + w / 2, 18, z + w / 2, 1.6, 3, 1.6, '#15803d'); }
      else if (v === 1) { part(out, bld, 'box', x, 0, z, 9, 9, d - 4, '#e7e5e4'); part(out, bld, 'gable', x, 9, z, 10, 6, d - 3, '#57534e', Math.PI / 2); part(out, bld, 'box', x, 0, z - (d / 2 - 4), 5, 18, 5, '#e7e5e4'); part(out, bld, 'cone', x, 18, z - (d / 2 - 4), 3.4, 8, 3.4, '#57534e'); }
      else { for (let k = 0; k < 3; k++) { part(out, bld, 'box', x, k * 5, z, 11 - k * 3, 4, 11 - k * 3, '#fca5a5'); part(out, bld, 'cone', x, k * 5 + 4, z, (14 - k * 3) * 0.72, 1.6, (14 - k * 3) * 0.72, '#7f1d1d'); } }
      break;
    }
    case 'gas_station': part(out, bld, 'box', x, 5, z, w, 1, 12, '#ef4444'); for (const k of [-4, 4]) part(out, bld, 'cyl', x + k, 0, z, 0.6, 5, 0.6, '#e5e7eb'); part(out, bld, 'box', x, 0, z - face * 9, 8, 4, 6, '#f5f5f4'); ground(out, x, z, w + 1, 18, '#52525b', 0.1); break;
    case 'water_tower': part(out, bld, 'cyl', x, 0, z, 1.2, 18, 1.2, '#9ca3af'); part(out, bld, 'cyl', x, 18, z, 5, 7, 5, '#93c5fd'); break;
    case 'substation': ground(out, x, z, w, d, '#a8a29e', 0.1); for (let k = -1; k <= 1; k++) part(out, bld, 'box', x + k * 4, 0, z, 2, 6, 10, '#71717a'); part(out, bld, 'box', x, 0, z + face * 11, 6, 3, 4, '#d4d4d8'); break;
    case 'jail': part(out, bld, 'box', x, 0, z, w, 8, d, '#a8a29e'); part(out, bld, 'box', x, 8, z, w, 0.8, d, '#57534e'); break;
    case 'border_post': part(out, bld, 'box', x, 0, z, 10, 5, 8, '#65a30d'); part(out, bld, 'box', x, 0, z + face * 10, 14, 1.2, 0.8, '#fbbf24'); part(out, bld, 'cyl', x + 5, 0, z, 0.3, 14, 0.3, '#e5e7eb'); break;
    default: part(out, bld, 'box', x, 0, z, w, 6, d, TYPES[type]?.cat ? '#e5e7eb' : '#d4d4d8');
  }
}

function drawFacility(out, r, bld) {
  const { x, z, w, d, type } = bld; const W = w, D = d;
  const pave = (c = '#cfc9bb') => ground(out, x, z, W, D, c, 0.07);
  const green = (c = '#7cb86a') => ground(out, x, z, W, D, c, 0.07);
  switch (type) {
    // ---------- housing
    case 'houses': case 'rowhouses': case 'kampung': case 'villas': case 'apartments': case 'public_housing': return housing(out, r, bld);
    case 'worship': pave('#e7e2d3'); part(out, bld, 'box', x, 0, z, 34, 12, 34, '#f8f6ef'); part(out, bld, 'dome', x, 12, z, 14, 13, 14, '#0f766e'); for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { part(out, bld, 'cyl', x + dx * 22, 0, z + dz * 22, 1.6, 30, 1.6, '#f8f6ef'); part(out, bld, 'cone', x + dx * 22, 30, z + dz * 22, 2.2, 4, 2.2, '#0f766e'); } treesIn(out, r, x, z, W - 4, D - 4, 6); label(out, bld, 34); return;
    case 'jail': pave('#c4bdb0'); wall(out, bld, x, z, W - 8, D - 8, 6, '#78716c'); part(out, bld, 'box', x, 0, z, 36, 10, 26, '#a8a29e'); part(out, bld, 'box', x, 10, z, 36, 0.8, 26, '#57534e'); label(out, bld, 16); return;
    // ---------- government
    case 'palace': {
      green('#86c06c'); ground(out, x, z + D * 0.3, 30, D * 0.4, '#e7e2d3', 0.09);
      part(out, bld, 'box', x, 0, z - 10, 90, 14, 34, '#fbfaf5'); part(out, bld, 'box', x, 14, z - 10, 92, 1.5, 36, '#d6d3c4');
      for (let k = -3; k <= 3; k++) part(out, bld, 'cyl', x + k * 7, 0, z + 8.5, 1.5, 13, 1.5, '#ffffff');
      part(out, bld, 'gable', x, 14, z + 6, 54, 6, 8, '#f5f3ea'); part(out, bld, 'dome', x, 15.5, z - 10, 10, 9, 10, '#e9d8a6');
      part(out, bld, 'cyl', x, 0, z + 40, 0.4, 26, 0.4, '#e5e7eb'); part(out, bld, 'box', x + 3.5, 21, z + 40, 7, 4, 0.3, '#ef4444');
      for (const s of [-1, 1]) { part(out, bld, 'box', x + s * 58, 0, z - 6, 22, 10, 40, '#f4f1e7'); }
      treesIn(out, r, x - W / 2 + 18, z + D / 2 - 30, 30, 50, 14); treesIn(out, r, x + W / 2 - 18, z + D / 2 - 30, 30, 50, 14);
      label(out, bld, 40); return;
    }
    case 'vp_office': pave('#e7e2d3'); part(out, bld, 'box', x, 0, z, 44, 12, 30, '#f8f6ef'); part(out, bld, 'gable', x, 12, z, 46, 5, 32, '#9a8f74'); for (let k = -2; k <= 2; k++) part(out, bld, 'cyl', x + k * 7, 0, z + 16, 1, 12, 1, '#fff'); label(out, bld, 26); return;
    case 'parliament': {
      pave('#e7e2d3'); part(out, bld, 'box', x, 0, z, W - 30, 16, 40, '#f1ede1'); part(out, bld, 'box', x, 16, z, W - 28, 1.5, 42, '#cfc6ad');
      part(out, bld, 'cyl', x, 17.5, z, 20, 8, 20, '#f1ede1'); part(out, bld, 'dome', x, 25.5, z, 20, 18, 20, '#4d7c5f'); part(out, bld, 'cyl', x, 43, z, 2, 6, 2, '#e9d8a6');
      for (let k = -5; k <= 5; k++) part(out, bld, 'cyl', x + k * 6, 0, z + 21.5, 1.3, 15, 1.3, '#ffffff');
      label(out, bld, 52); return;
    }
    case 'ministry': {
      pave('#d6d2c4'); const tint = ['#e8e3d3', '#dfe7ec', '#ece2d6', '#dde5d6'][bld.idx % 4];
      part(out, bld, 'box', x, 0, z, 44, 30 + (bld.idx % 3) * 8, 26, tint); part(out, bld, 'box', x, 30 + (bld.idx % 3) * 8, z, 46, 1.5, 28, '#8b8577');
      part(out, bld, 'box', x, 0, z + 14, 18, 5, 4, '#6b7280'); label(out, bld, 45); return;
    }
    case 'const_court': pave('#ded6c2'); part(out, bld, 'box', x, 0, z, 46, 14, 34, '#efe7d4'); part(out, bld, 'gable', x, 14, z + 4, 48, 7, 30, '#d9cba8'); for (let k = -3; k <= 3; k++) part(out, bld, 'cyl', x + k * 6.5, 0, z + 18, 1.3, 14, 1.3, '#fffdf5'); label(out, bld, 26); return;
    case 'election_comm': pave(); part(out, bld, 'box', x, 0, z, 40, 18, 30, '#e0f2fe'); part(out, bld, 'box', x, 18, z, 14, 6, 10, '#0ea5e9'); part(out, bld, 'box', x, 24, z, 6, 0.6, 1.2, '#0c4a6e'); label(out, bld, 28); return;
    case 'central_bank': pave(); part(out, bld, 'box', x, 0, z, 36, 70, 36, '#d6c79a'); part(out, bld, 'box', x, 70, z, 30, 6, 30, '#b59a52'); part(out, bld, 'box', x, 0, z + 20, 44, 8, 6, '#efe6c8'); label(out, bld, 80); return;
    case 'national_archive': pave(); part(out, bld, 'box', x, 0, z, 40, 12, 40, '#d4d4d8'); part(out, bld, 'box', x, 12, z, 24, 10, 24, '#a1a1aa'); label(out, bld, 26); return;
    case 'monument': {
      ground(out, x, z, W, D, '#9ccc7a', 0.07); ground(out, x, z, W * 0.55, D * 0.55, '#e8e1cf', 0.09);
      part(out, bld, 'box', x, 0, z, 24, 6, 24, '#efe8d8'); part(out, bld, 'box', x, 6, z, 7, 70, 7, '#f6f1e3'); part(out, bld, 'cone', x, 76, z, 5, 6, 5, '#fbbf24'); part(out, bld, 'sphere', x, 82, z, 3, 3, 3, '#facc15');
      treesIn(out, r, x, z, W - 10, D - 10, 40); label(out, bld, 92); return;
    }
    case 'square': ground(out, x, z, W, D, '#8fc46f', 0.07); ground(out, x, z, W - 14, D - 14, '#e6dfcc', 0.09); part(out, bld, 'cyl', x, 0, z, 6, 1.2, 6, '#9ca3af'); part(out, bld, 'cyl', x, 0, z, 0.35, 16, 0.35, '#e5e7eb'); part(out, bld, 'box', x + 3, 12, z, 6, 3.5, 0.2, '#ef4444'); for (let k = 0; k < 16; k++) { const a = k / 16 * 6.28; tree(out, r, x + Math.cos(a) * 27, z + Math.sin(a) * 27); } label(out, bld, 22); return;
    case 'city_hall': pave(); part(out, bld, 'box', x, 0, z, 46, 14, 30, '#f5efe0'); part(out, bld, 'gable', x, 14, z, 48, 6, 32, '#9a3412'); part(out, bld, 'box', x, 0, z + 8, 9, 30, 9, '#f5efe0'); part(out, bld, 'cone', x, 30, z + 8, 6.5, 8, 6.5, '#9a3412'); label(out, bld, 40); return;
    case 'court': pave('#ded6c2'); part(out, bld, 'box', x, 0, z, 40, 11, 30, '#ebe3cf'); part(out, bld, 'gable', x, 11, z, 42, 5, 32, '#8d7b5a'); for (let k = -2; k <= 2; k++) part(out, bld, 'cyl', x + k * 7, 0, z + 16, 1.2, 11, 1.2, '#fff'); label(out, bld, 20); return;
    case 'academy': {
      green('#8bc472'); ground(out, x + 30, z + 30, 70, 44, '#c2410c', 0.09); ground(out, x + 30, z + 30, 56, 30, '#65a30d', 0.11);
      bld.extra.track = { x: x + 30, z: z + 30, w: 63, d: 37 }; bld.extra.yard = { x: x + 30, z: z + 30 };
      part(out, bld, 'box', x - 40, 0, z - 30, 50, 18, 26, '#f1ede1'); part(out, bld, 'gable', x - 40, 18, z - 30, 52, 6, 28, '#7c2d12'); part(out, bld, 'box', x - 40, 0, z - 30, 9, 34, 9, '#f1ede1'); part(out, bld, 'cone', x - 40, 34, z - 30, 6.5, 7, 6.5, '#7c2d12');
      part(out, bld, 'box', x + 30, 0, z - 40, 50, 12, 20, '#e7e2d3'); part(out, bld, 'box', x - 45, 0, z + 25, 22, 10, 44, '#e7e2d3');
      treesIn(out, r, x, z, W - 20, D - 20, 18); label(out, bld, 40); return;
    }
    // ---------- police & military
    case 'police_station': pave('#cbd5e1'); part(out, bld, 'box', x, 0, z - 6, 40, bld.extra.main ? 18 : 13, 26, '#f1f5f9'); part(out, bld, 'box', x, bld.extra.main ? 18 : 13, z - 6, 42, 1.4, 28, '#1d4ed8'); part(out, bld, 'box', x, 0, z + 9, 42, 3.5, 1.5, '#1e40af');
      for (let k = -2; k <= 2; k++) { part(out, bld, 'box', x + k * 7, 0, z + 20, 4, 1.6, 2, '#f8fafc'); part(out, bld, 'box', x + k * 7, 1.6, z + 20, 1.2, 0.5, 1, k % 2 ? '#2563eb' : '#dc2626'); }
      part(out, bld, 'cyl', x + 18, 0, z + 14, 0.3, 14, 0.3, '#e5e7eb'); label(out, bld, 26); return;
    case 'police_hq': pave('#cbd5e1'); part(out, bld, 'box', x, 0, z, 36, 52, 30, '#e2e8f0'); part(out, bld, 'box', x, 52, z, 36, 3, 30, '#1d4ed8'); part(out, bld, 'box', x, 0, z + 18, 46, 10, 8, '#1e3a8a'); part(out, bld, 'cyl', x + 10, 55, z, 3, 0.4, 3, '#f8fafc'); label(out, bld, 62); return;
    case 'police_academy': {
      green('#9cc27f'); ground(out, x + 50, z, 110, 60, '#57534e', 0.09); ground(out, x + 50, z, 90, 40, '#9cc27f', 0.11);
      bld.extra.track = { x: x + 50, z, w: 100, d: 50 }; bld.extra.yard = { x: x + 50, z };
      part(out, bld, 'box', x - 70, 0, z - 30, 60, 14, 24, '#e2e8f0'); part(out, bld, 'box', x - 70, 14, z - 30, 62, 1.2, 26, '#1d4ed8');
      part(out, bld, 'box', x - 70, 0, z + 20, 60, 8, 20, '#f1f5f9');
      ground(out, x - 10, z + 52, 90, 12, '#a8a29e', 0.1); for (let k = 0; k < 6; k++) part(out, bld, 'box', x + 30, 0, z + 47 + k * 2, 0.6, 2.2, 1.4, '#f97316'); part(out, bld, 'box', x - 50, 0, z + 52, 6, 3, 12, '#78716c');
      label(out, bld, 26); return;
    }
    case 'military_hq': pave('#bfc8b0'); part(out, bld, 'box', x, 0, z, 44, 30, 44, '#a3ad8c'); part(out, bld, 'box', x, 0, z, 26, 31, 26, '#8b956f'); part(out, bld, 'cyl', x + 18, 30, z + 18, 2, 6, 2, '#e5e7eb'); label(out, bld, 40); return;
    case 'army_base': case 'military_academy': {
      ground(out, x, z, W, D, '#a7b08d', 0.06); wall(out, bld, x, z, W - 4, D - 4, 4, '#6b7258');
      ground(out, x, z, W * 0.35, D * 0.3, '#d6d3c4', 0.09);
      bld.extra.track = { x, z, w: W * 0.35 + 6, d: D * 0.3 + 6 }; bld.extra.yard = { x, z };
      const rows = type === 'army_base' ? 6 : 4;
      for (let k = 0; k < rows; k++) { part(out, bld, 'box', x - W / 2 + 30, 0, z - D / 2 + 30 + k * 26, 44, 8, 14, '#9aa27d'); part(out, bld, 'gable', x - W / 2 + 30, 8, z - D / 2 + 30 + k * 26, 46, 3, 15, '#4d5639'); }
      ground(out, x + W / 2 - 40, z + D / 2 - 30, 60, 40, '#6b7258', 0.09);
      for (let k = 0; k < 8; k++) part(out, bld, 'box', x + W / 2 - 64 + (k % 4) * 12, 0, z + D / 2 - 40 + Math.floor(k / 4) * 16, 6, 3, 9, '#4d5639');
      ground(out, x + W / 2 - 60, z - D / 2 + 22, 100, 10, '#b45309', 0.1); for (let k = 0; k < 5; k++) part(out, bld, 'box', x + W / 2 - 14, 0, z - D / 2 + 16 + k * 3, 0.6, 2.4, 1.6, '#f5f5f4');
      part(out, bld, 'cyl', x, 0, z, 0.4, 22, 0.4, '#e5e7eb'); part(out, bld, 'box', x + 3, 18, z, 6, 3.5, 0.2, '#ef4444');
      label(out, bld, 30); return;
    }
    case 'naval_base': ground(out, x, z, W, D, '#b8b8a8', 0.06); wall(out, bld, x, z - 10, W - 4, D - 24, 3, '#6b7280');
      for (let k = 0; k < 4; k++) { ground(out, x - W / 2 + 40 + k * 50, z + D / 2 + 26, 8, 60, '#9ca3af', 0.5); part(out, bld, 'box', x - W / 2 + 52 + k * 50, 0, z + D / 2 + 40, 6, 5, 34, '#64748b'); part(out, bld, 'box', x - W / 2 + 52 + k * 50, 5, z + D / 2 + 46, 4, 4, 10, '#94a3b8'); }
      for (let k = 0; k < 3; k++) part(out, bld, 'box', x - 60 + k * 60, 0, z - 30, 40, 10, 22, '#94a3b8'); label(out, bld, 30); return;
    case 'air_base': ground(out, x, z, W, D, '#a7b08d', 0.06); ground(out, x, z + 30, W - 20, 26, '#3a3d42', 0.1); for (let k = 0; k < 4; k++) { part(out, bld, 'cyl', x - 110 + k * 50, 0, z - 40, 16, 12, 16, '#6b7258'); } part(out, bld, 'cyl', x + 120, 0, z - 40, 2, 20, 2, '#e5e7eb'); part(out, bld, 'sphere', x + 120, 22, z - 40, 6, 6, 6, '#f1f5f9'); label(out, bld, 30); return;
    case 'prison': ground(out, x, z, W, D, '#b7b1a3', 0.06); wall(out, bld, x, z, W - 6, D - 6, 9, '#78716c');
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) part(out, bld, 'box', x + dx * (W / 2 - 4), 0, z + dz * (D / 2 - 4), 6, 16, 6, '#57534e');
      for (let k = 0; k < 3; k++) part(out, bld, 'box', x - 30 + k * 30, 0, z - 10, 18, 12, 50, '#a8a29e'); ground(out, x, z + 40, 60, 20, '#d6d3d1', 0.1); bld.extra.yard = { x, z: z + 40 }; label(out, bld, 26); return;
    case 'police_housing': case 'military_housing': {
      pave('#d6d3d1'); const col = type === 'police_housing' ? '#dbeafe' : '#d9dfc6'; const roof = type === 'police_housing' ? '#1e40af' : '#4d5639';
      for (let k = 0; k < 3; k++) { part(out, bld, 'box', x, 0, z - 20 + k * 20, 52, 10, 11, col); part(out, bld, 'gable', x, 10, z - 20 + k * 20, 54, 3, 12, roof); }
      part(out, bld, 'cyl', x + 26, 0, z + 28, 0.3, 12, 0.3, '#e5e7eb'); bld.households = 120; return;
    }
    // ---------- education & health
    case 'primary_school': case 'middle_school': case 'high_school': {
      ground(out, x, z, W, D, '#d6d3c4', 0.07); ground(out, x + 12, z + 12, 34, 30, '#65a30d', 0.09);
      const fl = type === 'primary_school' ? 1 : type === 'middle_school' ? 2 : 3; const col = ['#fde68a', '#fed7aa', '#fecaca'][fl - 1];
      part(out, bld, 'box', x - 8, 0, z - 22, 44, 4 * fl + 1, 12, col); part(out, bld, 'box', x - 24, 0, z, 12, 4 * fl + 1, 34, col);
      part(out, bld, 'gable', x - 8, 4 * fl + 1, z - 22, 46, 3, 13, '#c2410c'); part(out, bld, 'cyl', x + 26, 0, z - 26, 0.3, 12, 0.3, '#e5e7eb');
      label(out, bld, 14); return;
    }
    case 'university': {
      green('#8bc472'); for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; part(out, bld, 'box', x + Math.cos(a) * 46, 0, z + Math.sin(a) * 46, k % 2 ? 24 : 54, 16 + k * 4, k % 2 ? 54 : 24, '#ede9e0'); }
      part(out, bld, 'box', x, 0, z, 22, 40, 22, '#d6c9b4'); part(out, bld, 'box', x, 40, z, 16, 6, 16, '#7c2d12'); treesIn(out, r, x, z, W - 30, D - 30, 22); label(out, bld, 50); return;
    }
    case 'hospital': pave('#e2e8f0'); part(out, bld, 'box', x, 0, z, 48, 24, 30, '#f8fafc'); part(out, bld, 'box', x - 12, 0, z + 20, 20, 8, 10, '#e2e8f0'); part(out, bld, 'cyl', x + 12, 24, z, 8, 0.4, 8, '#16a34a'); part(out, bld, 'box', x + 12, 24.4, z, 5, 0.3, 1.2, '#f8fafc'); part(out, bld, 'box', x - 18, 24, z, 3, 0.6, 10, '#dc2626'); part(out, bld, 'box', x - 18, 24, z, 10, 0.6, 3, '#dc2626'); label(out, bld, 30); return;
    // ---------- economy & work
    case 'market': pave('#cfc6b5'); for (let k = 0; k < 3; k++) { part(out, bld, 'box', x, 0, z - 20 + k * 20, 52, 5, 14, '#f5e6c8'); part(out, bld, 'gable', x, 5, z - 20 + k * 20, 54, 4, 16, ['#c2410c', '#b45309', '#9a3412'][k]); } for (let k = 0; k < 10; k++) part(out, bld, 'box', x - 24 + k * 5.3, 0, z + 29, 3.5, 2.2, 2.5, pick(r, PALETTE.shop)); label(out, bld, 18); return;
    case 'mall': pave('#9ca3af'); part(out, bld, 'box', x, 0, z, W - 30, 20, D - 24, '#f5f5f4'); part(out, bld, 'box', x, 20, z, W - 50, 6, D - 40, '#a5b4fc'); part(out, bld, 'box', x, 0, z + D / 2 - 14, 40, 14, 4, '#e05a7a'); label(out, bld, 30); return;
    case 'office': { pave('#cfcac0'); const n = 1 + Math.floor(r() * 2); for (let k = 0; k < n; k++) { const h = range(r, 40, 120) * (bld.extra.cbd ? 1.3 : 1); const s = n === 1 ? 34 : 24; const ox = n === 1 ? 0 : (k ? 15 : -15); part(out, bld, 'box', x + ox, 0, z + (n === 1 ? 0 : (k ? 12 : -12)), s, h, s, pick(r, PALETTE.glass)); part(out, bld, 'box', x + ox, h, z + (n === 1 ? 0 : (k ? 12 : -12)), s - 6, 3, s - 6, '#475569'); } return; }
    case 'factory': pave('#b8b4aa'); for (let k = 0; k < 3; k++) { part(out, bld, 'box', x - 10, 0, z - 20 + k * 16, 40, 10, 14, '#a8a29e'); part(out, bld, 'gable', x - 10, 10, z - 20 + k * 16, 40, 4, 14, '#78716c', Math.PI / 2 * 0); } part(out, bld, 'cyl', x + 20, 0, z - 18, 2.5, 34, 2.5, '#9f3a2b'); part(out, bld, 'cyl', x + 20, 0, z - 6, 6, 12, 6, '#d6d3d1'); return;
    case 'warehouse': pave('#b8b4aa'); part(out, bld, 'box', x, 0, z - 6, 56, 12, 36, '#d6d3d1'); part(out, bld, 'box', x, 12, z - 6, 56, 1, 36, '#64748b'); for (let k = 0; k < 6; k++) part(out, bld, 'box', x - 22 + k * 9, 0, z + 22, 3, 3, 8, pick(r, PALETTE.shop)); return;
    case 'data_center': pave('#c7ccd3'); part(out, bld, 'box', x, 0, z - 4, 54, 12, 40, '#e5e7eb'); for (let k = 0; k < 10; k++) part(out, bld, 'cyl', x - 22 + (k % 5) * 11, 12, z - 14 + Math.floor(k / 5) * 20, 3, 2, 3, '#94a3b8'); part(out, bld, 'box', x, 0, z + 22, 54, 4, 6, '#334155'); return;
    case 'hotel': pave(); part(out, bld, 'box', x, 0, z, 30, range(r, 30, 70), 22, '#f0e1cc'); part(out, bld, 'box', x, 0, z + 18, 40, 6, 10, '#d6c3a5'); ground(out, x + 20, z - 20, 14, 10, '#38bdf8', 0.12); return;
    case 'port': {
      ground(out, x, z, W, D, '#a8a29e', 0.08); ground(out, x, z + D / 2 + 30, W, 60, '#9ca3af', 0.5);
      for (let k = 0; k < 60; k++) part(out, bld, 'box', x - W / 2 + 20 + (k % 15) * 20, Math.floor(k / 30) * 2.6, z - 10 + Math.floor((k % 30) / 15) * 8, 6, 2.6, 2.6, pick(r, ['#dc2626', '#2563eb', '#16a34a', '#f59e0b', '#7c3aed', '#0891b2']));
      for (let k = 0; k < 5; k++) { const cx2 = x - W / 2 + 40 + k * 60; part(out, bld, 'box', cx2 - 6, 0, z + D / 2 + 50, 1.5, 34, 1.5, '#f59e0b'); part(out, bld, 'box', cx2 + 6, 0, z + D / 2 + 50, 1.5, 34, 1.5, '#f59e0b'); part(out, bld, 'box', cx2, 34, z + D / 2 + 46, 16, 3, 50, '#f59e0b'); }
      part(out, bld, 'box', x + W / 2 - 30, 0, z - D / 2 + 20, 30, 10, 20, '#f5f5f4'); label(out, bld, 40); return;
    }
    case 'power_plant': pave('#b8b4aa'); part(out, bld, 'box', x - 20, 0, z, 60, 22, 34, '#a8a29e'); for (let k = 0; k < 2; k++) part(out, bld, 'cyl', x + 40 + k * 26, 0, z, 10, 34, 10, '#d6d3d1'); part(out, bld, 'cyl', x - 40, 0, z - 10, 2.5, 50, 2.5, '#9f3a2b'); label(out, bld, 50); return;
    case 'dam': ground(out, x, z, W, D, '#9ca3af', 0.08); part(out, bld, 'box', x, 0, z, W, 30, 14, '#cbd5e1'); part(out, bld, 'box', x, 30, z, W, 2, 16, '#94a3b8'); for (let k = -1; k <= 1; k++) part(out, bld, 'box', x + k * 30, 0, z + 14, 12, 10, 10, '#e2e8f0'); ground(out, x, z - 50, W, 70, '#3b82b0', 0.3); label(out, bld, 40); return;
    case 'solar_farm': green('#a3b18a'); for (let a = 0; a < 6; a++) for (let c = 0; c < 6; c++) part(out, bld, 'box', x - W / 2 + 18 + a * 24, 1, z - D / 2 + 18 + c * 24, 18, 0.5, 10, '#1e3a8a'); label(out, bld, 14); return;
    case 'train_station': pave('#cfc9bb'); part(out, bld, 'box', x, 0, z - 14, 80, 12, 24, '#f5efe0'); part(out, bld, 'cyl', x, 12, z - 14, 10, 8, 10, '#9a3412'); ground(out, x, z + 20, W, 14, '#57534e', 0.1); for (let k = -2; k <= 2; k++) part(out, bld, 'box', x + k * 18, 0, z + 20, 16, 4, 4, '#dc2626'); label(out, bld, 26); return;
    case 'bus_terminal': pave('#9ca3af'); part(out, bld, 'box', x, 6, z, 54, 1.2, 30, '#f59e0b'); for (const k of [-24, 0, 24]) part(out, bld, 'cyl', x + k, 0, z, 0.8, 6, 0.8, '#e5e7eb'); for (let k = 0; k < 4; k++) part(out, bld, 'box', x - 18 + k * 12, 0, z + 22, 4, 3.4, 11, '#2563eb'); label(out, bld, 14); return;
    case 'water_plant': pave('#c7ccd3'); for (let k = 0; k < 4; k++) { part(out, bld, 'cyl', x - 18 + (k % 2) * 36, 0, z - 14 + Math.floor(k / 2) * 30, 11, 3, 11, '#9ca3af'); part(out, bld, 'cyl', x - 18 + (k % 2) * 36, 3, z - 14 + Math.floor(k / 2) * 30, 10, 0.2, 10, '#60a5fa'); } return;
    case 'landfill': ground(out, x, z, W, D, '#a8a29e', 0.07); part(out, bld, 'box', x - 14, 0, z - 14, 26, 10, 24, '#78716c'); part(out, bld, 'box', x + 16, 0, z + 12, 20, 6, 20, '#65a30d'); return;
    // ---------- public space
    case 'park': {
      green(bld.extra.mall ? '#7fbf6a' : '#78b865');
      if (bld.extra.mall) { ground(out, x, z, 20, D, '#7fb5d8', 0.1); treesIn(out, r, x - W / 2 + 14, z, 14, D - 10, 10); treesIn(out, r, x + W / 2 - 14, z, 14, D - 10, 10); return; }
      ground(out, x, z, 6, D - 6, '#e2dccb', 0.09); ground(out, x, z, W - 6, 6, '#e2dccb', 0.09); if (r() < 0.5) ground(out, x + 16, z - 16, 16, 12, '#60a5c8', 0.1);
      treesIn(out, r, x, z, W - 8, D - 8, 16); part(out, bld, 'box', x - 16, 0, z + 16, 8, 2, 6, '#f59e0b'); return;
    }
    case 'sports_field': green('#7dbb63'); ground(out, x, z, W - 6, D - 16, '#b45309', 0.09); ground(out, x, z, W - 16, D - 26, '#4d9b3a', 0.11); for (const s of [-1, 1]) part(out, bld, 'box', x + s * (W / 2 - 10), 0, z, 0.5, 2.4, 7, '#f8fafc'); return;
    case 'stadium': green('#8bc472'); part(out, bld, 'cyl', x, 0, z, 62, 22, 50, '#e5e7eb'); part(out, bld, 'cyl', x, 0.1, z, 48, 22.4, 36, '#4d9b3a'); label(out, bld, 30); return;
    case 'cemetery': green('#8fae7a'); for (let k = 0; k < 40; k++) part(out, bld, 'box', x - 24 + (k % 8) * 7, 0, z - 22 + Math.floor(k / 8) * 11, 1.6, 1.4, 0.6, '#d6d3d1'); treesIn(out, r, x, z, W - 6, D - 6, 6); return;
    default: pave(); part(out, bld, 'box', x, 0, z, Math.min(W - 10, 44), 12, Math.min(D - 10, 30), '#e5e7eb'); label(out, bld, 16);
  }
}

function wall(out, bld, x, z, W, D, h, c) {
  part(out, bld, 'box', x, 0, z - D / 2, W, h, 1, c); part(out, bld, 'box', x, 0, z + D / 2, W, h, 1, c);
  part(out, bld, 'box', x - W / 2, 0, z, 1, h, D, c); part(out, bld, 'box', x + W / 2, 0, z, 1, h, D, c);
}
function label(out, bld, y) { out.labels.push({ text: bld.name, x: bld.x, y: y + 6, z: bld.z, kind: 'landmark', b: bld.idx }); }

// Housing block: 8 lots of houses, or towers/slabs, sized so that households ~ residents / 3.5.
function housing(out, r, bld) {
  const { x, z, type } = bld;
  ground(out, x, z, BLOCK, BLOCK, type === 'villas' ? '#8cc276' : type === 'kampung' ? '#cdbfa6' : '#d5cfc2', 0.07);
  const lots = [];
  const lotLayout = () => { for (let a = 0; a < 4; a++) for (let c = 0; c < 2; c++) lots.push({ x: x - BLOCK / 2 + LOT_W / 2 + 1 + a * (LOT_W + 0.66), z: z - BLOCK / 2 + LOT_D / 2 + 1 + c * (LOT_D + 2), side: c }); };
  const start = out.parts.length; let households = 0;
  if (type === 'houses' || type === 'rowhouses') {
    lotLayout();
    for (const l of lots) {
      const f = l.side ? 1 : -1; const hgt = type === 'rowhouses' ? 7 : range(r, 4.5, 7.5);
      const wall = pick(r, PALETTE.wall), roof = pick(r, PALETTE.roof);
      const w = type === 'rowhouses' ? LOT_W + 0.6 : 10, d = type === 'rowhouses' ? 12 : 10;
      const p0 = out.parts.length;
      part(out, bld, 'box', l.x, 0, l.z + f * 5, w, hgt, d, wall); part(out, bld, 'gable', l.x, hgt, l.z + f * 5, w + 0.8, 3, d + 0.8, roof);
      if (type === 'houses' && r() < 0.7) tree(out, r, l.x + (r() - 0.5) * 6, l.z - f * 9, 0.8);
      l.parts = [p0, p0 + 1]; households += 1;
    }
  } else if (type === 'kampung') {
    for (let a = 0; a < 5; a++) for (let c = 0; c < 5; c++) {
      if ((a === 2 || c === 2) && r() < 0.7) continue; // lanes
      const px = x - BLOCK / 2 + 6.5 + a * 12.2, pz = z - BLOCK / 2 + 6.5 + c * 12.2, hgt = range(r, 3.2, 6);
      part(out, bld, 'box', px, 0, pz, 9, hgt, 9, pick(r, PALETTE.wall)); part(out, bld, 'gable', px, hgt, pz, 9.8, 2.2, 9.8, pick(r, PALETTE.kampung), r() < 0.5 ? 0 : Math.PI / 2);
      households += 1;
    }
  } else if (type === 'villas') {
    for (let a = 0; a < 2; a++) for (let c = 0; c < 2; c++) {
      const px = x - 15 + a * 30, pz = z - 15 + c * 30;
      part(out, bld, 'box', px, 0, pz, 18, 7, 13, '#faf7f0'); part(out, bld, 'box', px + 4, 7, pz, 10, 4, 10, '#f5f0e6'); part(out, bld, 'box', px + 4, 11, pz, 11, 0.6, 11, '#57534e');
      ground(out, px - 4, pz + 10, 9, 5, '#38bdf8', 0.12); tree(out, r, px + 9, pz + 9); tree(out, r, px - 9, pz - 8); households += 1;
    }
  } else if (type === 'apartments') {
    const n = 1 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const h = range(r, 30, 75), px = x + (n === 1 ? 0 : (k - (n - 1) / 2) * 20), s = n === 1 ? 26 : 16;
      part(out, bld, 'box', px, 0, z, s, h, s + 6, pick(r, ['#e7e2d7', '#d9d4ca', '#ece6dc', '#cfd6dd'])); part(out, bld, 'box', px, h, z, s - 4, 2.5, s, '#6b7280');
      households += Math.round(h / 3) * 4;
    }
  } else if (type === 'public_housing') {
    for (let k = 0; k < 2; k++) { const h = range(r, 15, 24); part(out, bld, 'box', x, 0, z - 14 + k * 28, 54, h, 12, pick(r, ['#fde68a', '#bfdbfe', '#fecaca', '#bbf7d0'])); part(out, bld, 'box', x, h, z - 14 + k * 28, 54, 1, 12, '#64748b'); households += Math.round(h / 3) * 10; }
  }
  bld.households = households;
  if (lots.length && (type === 'houses' || type === 'rowhouses')) {
    const c = out.cities[bld.city]; const bi = Math.round((x - c.cx) / PITCH), bj = Math.round((z - c.cz) / PITCH);
    for (const l of lots) { const lot = { ...l, i: bi, j: bj, b: bld.idx }; c.lots.push(lot); }
  }
}
