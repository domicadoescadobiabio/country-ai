// Citizens walking on the street grid. A sample of the population is drawn (like city builders do);
// office holders commute or patrol, and every real thought from /api/state (daily.recent) spawns
// that exact citizen walking to the place that matches their action.
import * as THREE from '../vendor/three/three.module.js';
import { ACT_DEST, ACT_COLOR } from './catalog.js';
import { PITCH, hash, rng } from './gen.js';

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
  add(a) { if (this.list.length >= this.max) return null; a.slot = this.list.length; this.list.push(a); this.byId.set(a.id, a); this.mesh.count = this.list.length; return a; }

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
      if (!a) { a = this.list[Math.floor(this.r() * this.list.length)]; } // full: reuse a background walker
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
    if (!dest) { a.target = a.home; } else a.target = dest;
    if (!a.seat || act) a.color = ACT_COLOR[act] || ACT_COLOR.rest;
    a.path = route(this.cityOf(a.city), a.x, a.z, a.target.x, a.target.z, (hash(a.id) % 7) - 3);
    a.seg = 0; a.state = 'walk'; a.dest = dest;
  }
  update(dt, now) {
    const list = this.list;
    for (const a of list) {
      if (a.state === 'home' || a.state === 'stay') {
        a.wait -= dt;
        if (a.wait <= 0) {
          if (a.state === 'stay') { a.target = a.home; a.path = route(this.cityOf(a.city), a.x, a.z, a.home.x, a.home.z, (hash(a.id) % 7) - 3); a.seg = 0; a.state = 'walk'; a.dest = null; }
          else if (a.seat) this.go(a, null);
          else this.go(a, pickWeighted(this.r, this.weights));
        }
      } else if (a.state === 'walk') {
        let step = SPEED * dt;
        while (step > 0 && a.seg < a.path.length - 1) {
          const [x2, z2] = a.path[a.seg + 1]; const dx = x2 - a.x, dz = z2 - a.z; const d = Math.hypot(dx, dz);
          if (d <= step) { a.x = x2; a.z = z2; a.seg++; step -= d; } else { a.x += dx / d * step; a.z += dz / d * step; a.heading = Math.atan2(dx, dz); step = 0; }
        }
        if (a.seg >= a.path.length - 1) {
          const atHome = a.target === a.home;
          a.state = atHome ? 'home' : 'stay';
          a.wait = atHome ? 6 + this.r() * 30 : (a.seat ? 4 + this.r() * 10 : 4 + this.r() * 14);
          if (atHome && !a.seat) { a.color = ACT_COLOR.rest; a.act = 'rest'; }
        }
      }
      const visible = a.state === 'walk' || (a.liveUntil > now);
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
