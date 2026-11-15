// Walking routes (owner, 16 Nov: "nobody walks through the empty space; only across the bridges").
// Every walk stays on the ground that is drawn: a district's blocks and streets, a river bridge in Kernel Falls, or a
// bridge between districts. Inside a district: along the street grid (corners between blocks), never across the river
// except on its bridges. Between districts: to the nearest bridge, across it (the shortest chain of bridges, through the
// capital if need be), then along the streets of the next district. Pure data, no three.js: testable on its own.
import { PITCH } from './gen.js';

const HALF = PITCH / 2 + 0.25; // a block cell with its street asphalt (world.js draws PITCH + 0.5)

export class Routes {
  constructor(data) {
    this.data = data; this.cities = Object.values(data.cities);
    for (const c of this.cities) {
      c.rb = new Set((c.riverBridges || []).map(r => `${r.i},${r.j}`));
      c.rbList = (c.riverBridges || []).map(r => [c.cx + r.i * PITCH, c.cz + (r.j + 0.5) * PITCH]);
      c.W = 2 * c.N + 4; c.u0 = -c.N - 2; // corner (u, v) for u, v in u0 .. u0 + W - 1
    }
    // bridges between districts, each end a street corner of its district
    this.bridges = [];
    for (const r of data.roads) if (r.kind === 'bridge') {
      const A = this.cityAt(r.a[0], r.a[1]), B = this.cityAt(r.b[0], r.b[1]); if (!A || !B || A === B) continue;
      this.bridges.push({ a: { c: A, x: r.a[0], z: r.a[1] }, b: { c: B, x: r.b[0], z: r.b[1] }, w: r.w, len: Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]) });
    }
    this.made = 0; this.ms = 0; // how many routes, and the time spent making them
  }
  // ---------------------------------------------------------------- ground
  land(c, i, j) { return c.grid.has(i + ',' + j); }
  // the district whose ground (a block cell with its streets) is under this point, or null
  cityAt(x, z) {
    for (const c of this.cities) {
      const fi = (x - c.cx) / PITCH, fj = (z - c.cz) / PITCH;
      for (const i of [Math.floor(fi), Math.ceil(fi)]) for (const j of [Math.floor(fj), Math.ceil(fj)])
        if (this.land(c, i, j) && Math.abs(x - c.cx - i * PITCH) <= HALF && Math.abs(z - c.cz - j * PITCH) <= HALF) return c;
    }
    return null;
  }
  // is a point on drawn ground: a district, a river bridge, or a bridge between districts (tol: extra margin)
  onGround(x, z, tol = 0) {
    for (const c of this.cities) if (this.groundIn(c, x, z, tol)) return true;
    for (const b of this.bridges) if (segDist(x, z, b.a.x, b.a.z, b.b.x, b.b.z) <= b.w / 2 + tol) return true;
    return false;
  }
  // one district's ground: its block cells with their streets, and its river bridges (deck PITCH + 4 by 16)
  groundIn(c, x, z, tol = 0) {
    const fi = (x - c.cx) / PITCH, fj = (z - c.cz) / PITCH, h = HALF + tol;
    const i0 = Math.floor(fi), j0 = Math.floor(fj);
    for (let i = i0; i <= i0 + 1; i++) for (let j = j0; j <= j0 + 1; j++)
      if (Math.abs(x - c.cx - i * PITCH) <= h && Math.abs(z - c.cz - j * PITCH) <= h && this.land(c, i, j)) return true;
    for (const [bx, bz] of c.rbList) if (Math.abs(x - bx) <= PITCH / 2 + 2 + tol && Math.abs(z - bz) <= 8 + tol) return true;
    return false;
  }
  // ---------------------------------------------------------------- inside one district
  cx(c, u) { return c.cx + (u + 0.5) * PITCH; }
  cz(c, v) { return c.cz + (v + 0.5) * PITCH; }
  // a street between two neighbouring corners: walkable when a block is beside it, or a river bridge carries it
  edgeOk(c, u, v, du, dv) {
    if (du) { const i = du > 0 ? u + 1 : u; return this.land(c, i, v) || this.land(c, i, v + 1) || c.rb.has(`${i},${v}`); }
    const j = dv > 0 ? v + 1 : v; return this.land(c, u, j) || this.land(c, u + 1, j);
  }
  // the corner of the cell under (x, z) nearest to it, and the two legs from the point to that corner
  entry(c, x, z) {
    // the cell (i, j) under the point; its corners are u in {i-1, i}, v in {j-1, j}: take the nearer of each
    const fi = (x - c.cx) / PITCH, fj = (z - c.cz) / PITCH, i = Math.round(fi), j = Math.round(fj);
    const u = fi < i ? i - 1 : i, v = fj < j ? j - 1 : j;
    return { u, v, x: this.cx(c, u), z: this.cz(c, v) };
  }
  // corners from (u1, v1) to (u2, v2) along the streets: fewest turns among the shortest (Dijkstra on corner+heading)
  corners(c, u1, v1, u2, v2) {
    const W = c.W, u0 = c.u0, idx = (u, v) => (v - u0) * W + (u - u0);
    if (u1 === u2 && v1 === v2) return [[u1, v1]];
    // Float64: the costs (1 + 0.35 per turn) are float64 in the heap; float32 storage would round some down and the
    // `cost > dist` check would then skip those corners, cutting the street grid in two
    const n = W * W * 4, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
    const D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const heap = new Heap();
    for (let d = 0; d < 4; d++) { const s = idx(u1, v1) * 4 + d; dist[s] = 0; heap.push(0, s); }
    let end = -1;
    while (heap.size) {
      const [cost, s] = heap.pop(); if (cost > dist[s]) continue;
      const node = s >> 2, d0 = s & 3, u = node % W + u0, v = Math.floor(node / W) + u0;
      if (u === u2 && v === v2) { end = s; break; }
      for (let d = 0; d < 4; d++) {
        const nu = u + D[d][0], nv = v + D[d][1];
        if (nu < u0 || nv < u0 || nu >= u0 + W || nv >= u0 + W || !this.edgeOk(c, u, v, D[d][0], D[d][1])) continue;
        const t = idx(nu, nv) * 4 + d, nc = cost + 1 + (d === d0 ? 0 : 0.35);
        if (nc < dist[t]) { dist[t] = nc; prev[t] = s; heap.push(nc, t); }
      }
    }
    if (end < 0) return null;
    const out = []; for (let s = end; s >= 0; s = prev[s]) { const node = s >> 2; out.push([node % W + u0, Math.floor(node / W) + u0]); }
    return out.reverse();
  }
  // a walk inside one district: the old L along the streets when all of it is on the ground (with the walker's lane),
  // else street corner to street corner
  inCity(c, x1, z1, x2, z2, lane) {
    const snap = (v, o) => o + (Math.round((v - o) / PITCH - 0.5) + 0.5) * PITCH;
    for (const ln of lane ? [lane, 0] : [0]) {
      const rx1 = snap(x1, c.cx) + ln, rz1 = snap(z1, c.cz) + ln, rx2 = snap(x2, c.cx) + ln, rz2 = snap(z2, c.cz) + ln;
      for (const p of [[[x1, z1], [rx1, z1], [rx1, rz1], [rx2, rz1], [rx2, rz2], [x2, rz2], [x2, z2]], [[x1, z1], [x1, rz1], [rx1, rz1], [rx1, rz2], [rx2, rz2], [rx2, z2], [x2, z2]]])
        if (this.pathOk(p, 0, c)) return p;
    }
    const a = this.entry(c, x1, z1), b = this.entry(c, x2, z2);
    const cs = this.corners(c, a.u, a.v, b.u, b.v);
    if (!cs) { this.lastWhy = `no street between corners ${a.u},${a.v} and ${b.u},${b.v} in ${c.id}`; return null; }
    const mid = simplify(cs.map(([u, v]) => [this.cx(c, u), this.cz(c, v)]));
    return [[x1, z1], [a.x, z1], ...mid, [x2, b.z], [x2, z2]];
  }
  // every point of the path on the ground (inside one district when c is given: quicker), sampled every `step` units
  pathOk(p, tol = 0, c = null, step = 6) {
    for (let k = 0; k + 1 < p.length; k++) {
      const [x1, z1] = p[k], [x2, z2] = p[k + 1]; const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / step));
      for (let s = 0; s <= n; s++) { const x = x1 + (x2 - x1) * s / n, z = z1 + (z2 - z1) * s / n; if (!(c ? this.groundIn(c, x, z, tol) : this.onGround(x, z, tol))) return false; }
    }
    return true;
  }
  // how many sample points (every `step` units) of a path are off the ground
  offPoints(p, step = 2, tol = 0) {
    let off = 0, n = 0;
    for (let k = 0; k + 1 < p.length; k++) {
      const [x1, z1] = p[k], [x2, z2] = p[k + 1]; const m = Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / step));
      for (let s = 0; s <= m; s++) { n++; if (!this.onGround(x1 + (x2 - x1) * s / m, z1 + (z2 - z1) * s / m, tol)) off++; }
    }
    return { off, n };
  }
  // ---------------------------------------------------------------- the whole walk
  route(x1, z1, x2, z2, lane = 0) {
    const t0 = performance.now(); this.made++;
    try { return this.make(x1, z1, x2, z2, lane); } finally { this.ms += performance.now() - t0; }
  }
  make(x1, z1, x2, z2, lane) {
    let A = this.cityAt(x1, z1), B = this.cityAt(x2, z2);
    // a point off the ground (should not happen): step onto the nearest street corner of the nearest district first
    const head = [];
    if (!A) { const c = this.nearestCity(x1, z1); const e = this.edgeCorner(c, x1, z1); head.push([x1, z1]); x1 = e[0]; z1 = e[1]; A = c; }
    let tail = null;
    if (!B) { const c = this.nearestCity(x2, z2); const e = this.edgeCorner(c, x2, z2); tail = [x2, z2]; x2 = e[0]; z2 = e[1]; B = c; }
    let path;
    if (A === B) path = this.inCity(A, x1, z1, x2, z2, lane) || [[x1, z1], [x2, z2]];
    else {
      const chain = this.bridgeChain(A, x1, z1, B, x2, z2);
      if (!chain) path = [[x1, z1], [x2, z2]];
      else {
        path = []; let c = A, x = x1, z = z1;
        for (const [from, to] of chain) {
          path.push(...(this.inCity(c, x, z, from.x, from.z, lane) || [[x, z], [from.x, from.z]]));
          path.push([to.x, to.z]); c = to.c; x = to.x; z = to.z;
        }
        path.push(...(this.inCity(c, x, z, x2, z2, lane) || [[x, z], [x2, z2]]));
      }
    }
    if (head.length) path = [...head, ...path];
    if (tail) path.push(tail);
    return dedupe(path);
  }
  nearestCity(x, z) { let best = this.cities[0], bd = Infinity; for (const c of this.cities) { const d = (c.cx - x) ** 2 + (c.cz - z) ** 2; if (d < bd) { bd = d; best = c; } } return best; }
  edgeCorner(c, x, z) {
    let best = null, bd = Infinity;
    for (const k of c.grid.keys()) { const [i, j] = k.split(',').map(Number); for (const du of [-1, 0]) for (const dv of [-1, 0]) { const px = this.cx(c, i + du), pz = this.cz(c, j + dv); const d = (px - x) ** 2 + (pz - z) ** 2; if (d < bd) { bd = d; best = [px, pz]; } } }
    return best;
  }
  // the bridges to take from district A to district B: shortest by street distance (Manhattan) plus bridge length
  bridgeChain(A, x1, z1, B, x2, z2) {
    const ends = []; this.bridges.forEach((b, k) => { ends.push({ k, side: 'a', p: b.a, o: b.b }, { k, side: 'b', p: b.b, o: b.a }); });
    const N = ends.length; const dist = new Array(N).fill(Infinity), prev = new Array(N).fill(-1), done = new Array(N).fill(false);
    const man = (p, x, z) => Math.abs(p.x - x) + Math.abs(p.z - z);
    for (let i = 0; i < N; i++) if (ends[i].p.c === A) dist[i] = man(ends[i].p, x1, z1);
    let best = Infinity, last = -1;
    for (;;) {
      let i = -1; for (let k = 0; k < N; k++) if (!done[k] && dist[k] < Infinity && (i < 0 || dist[k] < dist[i])) i = k;
      if (i < 0) break; done[i] = true;
      const e = ends[i]; const across = dist[i] + this.bridges[e.k].len; const o = e.o;
      if (o.c === B) { const total = across + man(o, x2, z2); if (total < best) { best = total; last = i; } }
      for (let k = 0; k < N; k++) if (!done[k] && ends[k].p.c === o.c && ends[k].k !== e.k) { const d = across + man(ends[k].p, o.x, o.z); if (d < dist[k]) { dist[k] = d; prev[k] = i; } }
    }
    if (last < 0) return null;
    const chain = []; for (let i = last; i >= 0; i = prev[i]) chain.push([ends[i].p, ends[i].o]);
    return chain.reverse();
  }
}

function segDist(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz; let t = L ? ((x - ax) * dx + (z - az) * dz) / L : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}
function simplify(p) { // drop corners in the middle of a straight line
  const out = []; for (const q of p) { const n = out.length; if (n >= 2) { const [a, b] = [out[n - 2], out[n - 1]]; if ((a[0] === b[0] && b[0] === q[0]) || (a[1] === b[1] && b[1] === q[1])) { out[n - 1] = q; continue; } } out.push(q); }
  return out;
}
function dedupe(p) { const out = []; for (const q of p) { const l = out[out.length - 1]; if (!l || Math.abs(l[0] - q[0]) > 0.01 || Math.abs(l[1] - q[1]) > 0.01) out.push(q); } return out; }
class Heap { // a small binary min-heap of [cost, id]
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(c, id) { const a = this.a; a.push([c, id]); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a; const top = a[0]; const last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
}
