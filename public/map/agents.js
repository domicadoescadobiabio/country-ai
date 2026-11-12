// Citizens walking on the street grid. A sample of the population is drawn (like city builders do);
// office holders commute or patrol, and every real thought from /api/state (daily.recent) spawns
// that exact citizen walking to the place that matches their action.
import * as THREE from '../vendor/three/three.module.js';
import { ACT_DEST, ACT_COLOR } from './catalog.js';
import { PITCH, BLOCK, hash, rng } from './gen.js';

const SPEED = 46; // metres per second on screen (time-lapse)
const tmp = new THREE.Object3D(); const col = new THREE.Color();
const HOUSING = ['houses', 'rowhouses', 'apartments', 'public_housing', 'kampung', 'villas'];
const SEAT_PLACE = {
  president: ['palace'], vice_president: ['vp_office'], minister: ['ministry'], council: ['parliament'], judge: ['const_court'],
  commissioner: ['election_comm'], police_chief: ['police_hq'], military_chief: ['military_hq'], mayor: ['city_hall'],
  police: ['police_station', 'police_post'], military: ['army_base', 'military_academy', 'border_post', 'naval_base', 'air_base'],
};
const SEAT_COLOR = { police: '#2563eb', police_chief: '#1d4ed8', military: '#4d7c0f', military_chief: '#365314', president: '#facc15', vice_president: '#fde047', minister: '#e9d5ff', council: '#fbbf24', judge: '#a16207', commissioner: '#38bdf8', mayor: '#fb7185' };

export class Agents {
  constructor(scene, data, max = 3200) {
    this.data = data; this.max = max; this.list = []; this.byId = new Map(); this.r = rng('agents');
    const geo = new THREE.CapsuleGeometry(1.8, 3.2, 3, 8).translate(0, 3.4, 0);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: '#ffffff' }), max);
    this.mesh.count = 0; this.mesh.frustumCulled = false; scene.add(this.mesh);
    this.weights = { work: 3, shop: 2, study: 2, talk: 2, help: 1, volunteer: 1 };
  }
  cityOf(id) { return this.data.cities[id] || Object.values(this.data.cities)[0]; }
  buildingsOf(cityId, types) { const c = this.cityOf(cityId); const out = []; for (const t of types) for (const b of c.byType[t] || []) out.push(b); return out; }
  anyCity(types) { const out = []; for (const c of Object.values(this.data.cities)) for (const t of types) for (const b of c.byType[t] || []) out.push(b); return out; }
  homeFor(id, cityId, seat) {
    const h = hash(id); let pool;
    if (seat === 'police' || seat === 'police_chief') pool = this.buildingsOf(cityId, ['police_housing']);
    else if (seat === 'military' || seat === 'military_chief') { pool = this.buildingsOf(cityId, ['military_housing']); if (!pool.length) pool = this.buildingsOf('neura', ['military_housing']); }
    else if (seat === 'president') pool = this.buildingsOf('neura', ['palace']);
    else if (seat && ['minister', 'council', 'judge', 'vice_president', 'commissioner'].includes(seat)) pool = this.buildingsOf('neura', ['villas', 'apartments']);
    if (!pool?.length) pool = this.buildingsOf(cityId, HOUSING);
    return pool[h % pool.length];
  }
  setWeights(byAct) {
    if (!byAct) return; const w = {};
    for (const k of Object.keys(this.weights)) w[k] = Math.max(0.3, byAct[k] || 0);
    this.weights = w;
  }
  // Real addresses from the server (citizen.home: col/row on the city's house grid, see homeLayout in
  // /api/state). The house grid is laid over the city's outline and the house goes to the nearest housing
  // block, at its place inside that block. Without an address (older server) the hash-based home stays.
  setHomes(lookup) { this.lookup = lookup; }
  realHome(id, cityId) {
    const r = this.lookup?.(id); const h = r?.home; const L = r?.layout;
    if (!h || !L || h.city !== cityId || !Number.isFinite(h.col) || !Number.isFinite(h.row) || !(L.blockCols > 0 && L.blockW > 0 && L.blockH > 0)) return null;
    const c = this.data.cities[cityId]; if (!c?.blocks?.length) return null;
    const bb = c.bbox ||= c.blocks.reduce((m, b) => ({ x0: Math.min(m.x0, b.x), x1: Math.max(m.x1, b.x), z0: Math.min(m.z0, b.z), z1: Math.max(m.z1, b.z) }), { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
    const W = L.blockCols * L.blockW, H = Math.max(1, Math.ceil((r.blocks || L.minBlocks || 100) / L.blockCols)) * L.blockH;
    const px = bb.x0 + Math.min(1, (h.col + 0.5) / W) * (bb.x1 - bb.x0), pz = bb.z0 + Math.min(1, (h.row + 0.5) / H) * (bb.z1 - bb.z0);
    const pool = c.homes ||= HOUSING.flatMap(t => c.byType[t] || []); if (!pool.length) return null;
    let b = pool[0], bd = Infinity; for (const q of pool) { const d = (q.x - px) ** 2 + (q.z - pz) ** 2; if (d < bd) { bd = d; b = q; } }
    const step = (BLOCK - 10); // spread the houses of one server block over the map block
    return { b, x: b.x + ((h.col % L.blockW) + 0.5 - L.blockW / 2) * step / L.blockW, z: b.z + ((h.row % L.blockH) + 0.5 - L.blockH / 2) * step / L.blockH, address: typeof h.address === 'string' ? h.address : null };
  }
  add(a) {
    if (this.list.length >= this.max) return null;
    if (a.name && !a.scene) { const r = this.realHome(a.id, a.city); if (r) { a.home = r.b; a.door = { x: r.x, z: r.z }; a.address = r.address; a.x = r.x; a.z = r.z; } }
    a.slot = this.list.length; this.list.push(a); this.byId.set(a.id, a); this.mesh.count = this.list.length; return a;
  }
  // swap-remove keeps the instanced mesh dense (slot = index in list)
  remove(a) {
    if (!a || this.list[a.slot] !== a) return;
    const last = this.list.pop();
    if (last !== a) { this.list[a.slot] = last; last.slot = a.slot; }
    this.byId.delete(a.id); this.mesh.count = this.list.length;
  }
  // Scripted actors driven by real state (exams, trials, prison, polling queues). They stand still ('pin'),
  // run a training track ('loop'), or walk a route first and then stand ('walk' with a.after).
  pin(a, x, z) { a.state = 'pin'; a.x = x; a.z = z; a.path = null; }
  loop(a, track, phase) { a.state = 'loop'; a.track = track; a.t = phase; }
  walkTo(a, x, z, after) { a.path = route(this.cityOf(a.city), a.x, a.z, x, z, 0); a.seg = 0; a.state = 'walk'; a.target = { x, z }; a.after = after; }

  // background population: n per city
  populate(perCity) {
    for (const c of Object.values(this.data.cities)) for (let k = 0; k < perCity; k++) {
      const id = `${c.id}#${k}`; const home = this.homeFor(id, c.id);
      if (!home) continue;
      this.add({ id, name: null, city: c.id, home, x: home.x, z: home.z, state: 'home', wait: this.r() * 20, act: 'rest', color: ACT_COLOR.rest, scale: 1 });
    }
  }
  // office holders from /api/state seats
  officials(seats, cities, nameOf, cityOfCitizen) {
    const mayors = new Map((cities || []).map(c => [c.mayor, c.id]));
    for (const [seat, ids] of Object.entries(seats || {})) for (const id of ids || []) {
      if (this.byId.has(id)) continue;
      const cityId = mayors.get(id) || cityOfCitizen(id) || 'neura';
      const home = this.homeFor(id, cityId, seat);
      if (!home) continue;
      this.add({ id, name: nameOf(id), seat, city: cityId, home, x: home.x, z: home.z, state: 'home', wait: this.r() * 6, act: seat, color: SEAT_COLOR[seat] || '#ffffff', scale: 1.25 });
    }
  }
  // a real thought from the simulation
  live(e, nameOf) {
    let a = this.byId.get(e.agent);
    if (!a) {
      const home = this.homeFor(e.agent, e.city);
      if (!home) return null;
      a = this.add({ id: e.agent, name: e.name || nameOf(e.agent), city: e.city, home, x: home.x, z: home.z, state: 'home', wait: 0, scale: 1 });
      if (!a) { // full: reuse a background walker (never a scene actor or an office holder)
        for (let k = 0; k < 20 && (!a || a.scene || a.seat || a.name); k++) a = this.list[Math.floor(this.r() * this.list.length)];
        if (!a || a.scene || a.seat) return null;
      }
    }
    a.liveUntil = performance.now() + 45000; a.thought = e; a.name = e.name || a.name;
    this.go(a, e.act === 'rest' ? null : e.act, true);
    return a;
  }

  destFor(a, act) {
    if (a.seat && !act) { const places = a.seat === 'military' ? (this.buildingsOf(a.city, SEAT_PLACE.military).length ? this.buildingsOf(a.city, SEAT_PLACE.military) : this.buildingsOf('neura', SEAT_PLACE.military)) : (['council', 'minister', 'president', 'vice_president', 'judge', 'commissioner', 'police_chief', 'military_chief'].includes(a.seat) ? this.buildingsOf('neura', SEAT_PLACE[a.seat]) : this.buildingsOf(a.city, SEAT_PLACE[a.seat])); return places[Math.floor(this.r() * places.length)]; }
    const types = ACT_DEST[act] || []; let pool = this.buildingsOf(a.city, types);
    if (!pool.length) pool = this.anyCity(types);
    if (!pool.length) return null;
    // prefer nearby places (people shop at the closest market)
    let best = null, bd = 1e12; for (let k = 0; k < 6; k++) { const b = pool[Math.floor(this.r() * pool.length)]; const d = (b.x - a.x) ** 2 + (b.z - a.z) ** 2; if (d < bd) { bd = d; best = b; } }
    return best;
  }
  go(a, act, force) {
    const dest = act || a.seat ? this.destFor(a, act) : null;
    a.act = act || (a.seat ? a.seat : 'rest');
    if (!dest) { a.target = a.door || a.home; } else a.target = dest;
    if (!a.seat || act) a.color = ACT_COLOR[act] || ACT_COLOR.rest;
    a.path = route(this.cityOf(a.city), a.x, a.z, a.target.x, a.target.z, (hash(a.id) % 7) - 3);
    a.seg = 0; a.state = 'walk'; a.dest = dest;
  }
  update(dt, now) {
    const list = this.list;
    for (const a of list) {
      if (a.state === 'pin') { /* stands where the scene put it */ }
      else if (a.state === 'loop') {
        const { x, z, w, d } = a.track; const per = 2 * (w + d);
        a.t = (a.t + (a.pace || 9) * dt) % per; let s = a.t;
        if (s < w) { a.x = x - w / 2 + s; a.z = z - d / 2; a.heading = Math.PI / 2; }
        else if ((s -= w) < d) { a.x = x + w / 2; a.z = z - d / 2 + s; a.heading = 0; }
        else if ((s -= d) < w) { a.x = x + w / 2 - s; a.z = z + d / 2; a.heading = -Math.PI / 2; }
        else { s -= w; a.x = x - w / 2; a.z = z + d / 2 - s; a.heading = Math.PI; }
      } else if (a.state === 'home' || a.state === 'stay') {
        a.wait -= dt;
        if (a.wait <= 0) {
          if (a.state === 'stay') { const hm = a.door || a.home; a.target = hm; a.path = route(this.cityOf(a.city), a.x, a.z, hm.x, hm.z, (hash(a.id) % 7) - 3); a.seg = 0; a.state = 'walk'; a.dest = null; }
          else if (a.seat) this.go(a, null);
          else this.go(a, pickWeighted(this.r, this.weights));
        }
      } else if (a.state === 'walk') {
        let step = SPEED * dt;
        while (step > 0 && a.seg < a.path.length - 1) {
          const [x2, z2] = a.path[a.seg + 1]; const dx = x2 - a.x, dz = z2 - a.z; const d = Math.hypot(dx, dz);
          if (d <= step) { a.x = x2; a.z = z2; a.seg++; step -= d; } else { a.x += dx / d * step; a.z += dz / d * step; a.heading = Math.atan2(dx, dz); step = 0; }
        }
        if (a.seg >= a.path.length - 1 && a.after) { const f = a.after; a.after = null; f(a); }
        else if (a.seg >= a.path.length - 1) {
          const atHome = a.target === a.home || (a.door && a.target === a.door);
          a.state = atHome ? 'home' : 'stay';
          a.wait = atHome ? 6 + this.r() * 30 : (a.seat ? 4 + this.r() * 10 : 4 + this.r() * 14);
          if (atHome && !a.seat) { a.color = ACT_COLOR.rest; a.act = 'rest'; }
        }
      }
      const visible = a.state === 'walk' || a.state === 'pin' || a.state === 'loop' || (a.liveUntil > now);
      const s = visible ? a.scale * (a.liveUntil > now ? 1.9 : 1) : 0;
      tmp.position.set(a.x, 0, a.z); tmp.rotation.set(0, a.heading || 0, 0); tmp.scale.set(s, s, s); tmp.updateMatrix();
      this.mesh.setMatrixAt(a.slot, tmp.matrix);
      this.mesh.setColorAt(a.slot, col.set(a.liveUntil > now ? '#ffffff' : a.color).lerp(col.clone().set(a.color), a.liveUntil > now ? 0.55 : 1));
    }
    this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  at(instanceId) { return this.list[instanceId]; }
}

function pickWeighted(r, w) { let sum = 0; for (const v of Object.values(w)) sum += v; let x = r() * sum; for (const [k, v] of Object.entries(w)) { x -= v; if (x <= 0) return k; } return 'talk'; }

// Walk along the street grid: out to the nearest street corner, along x, along z, into the destination.
function route(city, x1, z1, x2, z2, lane) {
  if (!city) return [[x1, z1], [x2, z2]];
  const snap = (v, c) => c + (Math.round((v - c) / PITCH - 0.5) + 0.5) * PITCH;
  const rx1 = snap(x1, city.cx) + lane, rz1 = snap(z1, city.cz) + lane, rx2 = snap(x2, city.cx) + lane, rz2 = snap(z2, city.cz) + lane;
  return [[x1, z1], [rx1, z1], [rx1, rz1], [rx2, rz1], [rx2, rz2], [x2, rz2], [x2, z2]];
}
