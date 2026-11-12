// Turns the generated country into a neon megacity with three.js instanced meshes (a few draw calls for ~90k
// shapes): five floating districts, dark towers with neon windows, glowing streets, sky-bridges, holograms over
// the landmarks and flying traffic. Anything brighter than 1.0 glows through the bloom pass in main.js.
import * as THREE from '../vendor/three/three.module.js';
import { PITCH, BLOCK, hash } from './gen.js';

function gableGeometry() {
  // unit prism: base 1 x 1 at y=0, ridge along x at y=1
  const v = [
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 1, 0, -0.5, 1, 0, // north slope
    0.5, 0, 0.5, -0.5, 0, 0.5, -0.5, 1, 0, 0.5, 1, 0, // south slope
    -0.5, 0, 0.5, -0.5, 0, -0.5, -0.5, 1, 0, // west gable
    0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 1, 0, // east gable
  ];
  const idx = [0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6, 8, 10, 9, 11, 13, 12];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

export const GEOMS = {
  box: () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  gable: gableGeometry,
  dome: () => new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
  cyl: () => new THREE.CylinderGeometry(1, 1, 1, 14).translate(0, 0.5, 0),
  cone: () => new THREE.ConeGeometry(1, 1, 10).translate(0, 0.5, 0),
  sphere: () => new THREE.SphereGeometry(1, 16, 10).translate(0, 1, 0),
};

const tmp = new THREE.Object3D(); const col = new THREE.Color();
// the neon palette: cute rather than grim (pastel cyan, pink, violet, mint, amber)
export const NEON = ['#22d3ee', '#f472b6', '#a78bfa', '#5eead4', '#fbbf24', '#e879f9', '#60a5fa'];
const neon = (key, k = 2.4) => col.set(NEON[hash(String(key)) % NEON.length]).multiplyScalar(k);
// a facade colour: the generator's colour, darkened and pulled toward night blue (it keeps a hint of its hue)
const hsl = {};
function facade(c, lift = 0) {
  col.set(c).getHSL(hsl);
  return col.setHSL((hsl.h * 0.35 + 0.68 * 0.65) % 1, Math.min(0.5, hsl.s * 0.55 + 0.12), 0.07 + hsl.l * 0.13 + lift);
}

// 0..1: how bright the windows are (always lit a little: a neon city never fully sleeps, brighter at night)
export const night = { value: 0.8 };
export const clock = { value: 0 };
const NO_WINDOWS = new Set(['public', 'infra']);
function windowLights(mat) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uNight = night; sh.uniforms.uTime = clock;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aLit;\nattribute vec3 aGlow;\nvarying float vLit;\nvarying vec3 vGlow;\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vLit = aLit; vGlow = aGlow; vec4 cwP = vec4(transformed, 1.0); vec3 cwN = objectNormal;
        #ifdef USE_INSTANCING
          cwP = instanceMatrix * cwP; cwN = mat3(instanceMatrix) * cwN;
        #endif
        vWP = (modelMatrix * cwP).xyz; vWN = normalize(mat3(modelMatrix) * cwN);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;\nuniform float uTime;\nvarying float vLit;\nvarying vec3 vGlow;\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (vLit > 0.5 && abs(vWN.y) < 0.5) {
          bool sideX = abs(vWN.x) > 0.5; float u = sideX ? vWP.z : vWP.x; float face = floor(sideX ? vWP.x : vWP.z);
          vec2 g = vec2(u / 2.4, vWP.y / 3.1); vec2 cell = floor(g); vec2 f = fract(g);
          float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.34, f.y) * step(f.y, 0.7);
          float rnd = fract(sin(dot(vec3(cell, face), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          float on = step(0.42, rnd) * (0.75 + 0.25 * sin(uTime * (0.6 + rnd * 1.8) + rnd * 40.0));
          vec3 tint = mix(vGlow, vec3(1.0, 0.86, 0.62), step(0.8, rnd));
          // far away a window is smaller than a pixel: show its average glow instead of sparkling noise
          float near = clamp(1.6 - length(fwidth(g)) * 2.2, 0.0, 1.0);
          float lit = mix(0.17, win * on, near);
          totalEmissiveRadiance += tint * lit * (0.55 + 0.9 * uNight);
        }
        if (vLit > 0.5 && vWN.y > 0.5) totalEmissiveRadiance += vGlow * 0.06; // roofs catch the city glow`);
  };
  mat.customProgramCacheKey = () => 'country-ai-neon-windows';
}

export function buildWorld(scene, data, { shadows }) {
  const meshes = []; const pickMap = new Map(); // mesh -> instance index -> building idx
  const glow = []; // neon strips: { x, y, z, sx, sy, sz, c }

  // ---------------------------------------------------------------- districts: floating slabs, not a country of grass
  const flats = [];
  const blockSet = new Set();
  for (const c of Object.values(data.cities)) for (const b of c.blocks) blockSet.add(`${c.id}|${b.i}|${b.j}`);
  const has = (c, i, j) => blockSet.has(`${c.id}|${i}|${j}`);
  const edges = []; // outer edges of each district, for the slab walls and their neon trim
  for (const c of Object.values(data.cities)) {
    for (const b of c.blocks) {
      flats.push({ x: b.x, z: b.z, w: PITCH + 0.5, d: PITCH + 0.5, y: 0.03, color: '#0c1022' }); // street asphalt
      flats.push({ x: b.x, z: b.z, w: BLOCK + 4, d: BLOCK + 4, y: 0.045, color: '#161a30' }); // sidewalk
      // glowing street lines: the east and south street of every block (west/north at the district edge)
      const main = b.i === 0 || b.j === 0;
      const lc = main ? '#f472b6' : '#22d3ee';
      const k = main ? 2.2 : 1.25;
      glow.push({ x: b.x + PITCH / 2, y: 0.12, z: b.z, sx: 0.7, sy: 0.05, sz: PITCH, c: lc, k });
      glow.push({ x: b.x, y: 0.12, z: b.z + PITCH / 2, sx: PITCH, sy: 0.05, sz: 0.7, c: lc, k });
      if (!has(c, b.i - 1, b.j)) { glow.push({ x: b.x - PITCH / 2, y: 0.12, z: b.z, sx: 0.7, sy: 0.05, sz: PITCH, c: lc, k }); edges.push({ x: b.x - PITCH / 2, z: b.z, along: 'z' }); }
      if (!has(c, b.i, b.j - 1)) { glow.push({ x: b.x, y: 0.12, z: b.z - PITCH / 2, sx: PITCH, sy: 0.05, sz: 0.7, c: lc, k }); edges.push({ x: b.x, z: b.z - PITCH / 2, along: 'x' }); }
      if (!has(c, b.i + 1, b.j)) edges.push({ x: b.x + PITCH / 2, z: b.z, along: 'z' });
      if (!has(c, b.i, b.j + 1)) edges.push({ x: b.x, z: b.z + PITCH / 2, along: 'x' });
    }
  }
  for (const w of data.water) flats.push({ x: w.x, z: w.z, w: w.w, d: w.d, y: 0.02, color: '#06213d' });
  for (const g of data.grounds) flats.push({ ...g, color: facade(g.color, 0.03).getStyle() });
  {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), flats.length);
    flats.forEach((f, i) => {
      tmp.position.set(f.x, f.y, f.z); tmp.rotation.set(0, f.rot || 0, 0); tmp.scale.set(f.w, 1, f.d); tmp.updateMatrix();
      mesh.setMatrixAt(i, tmp.matrix); mesh.setColorAt(i, col.set(f.color));
    });
    mesh.receiveShadow = shadows; scene.add(mesh); meshes.push(mesh);
  }
  // slab walls under the edges (the districts float) with a neon trim along the top
  {
    const D = 46;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: '#0a0d1c' }), edges.length);
    edges.forEach((e, i) => {
      tmp.position.set(e.x, -D / 2, e.z); tmp.rotation.set(0, 0, 0); tmp.scale.set(e.along === 'x' ? PITCH + 1 : 3, D, e.along === 'z' ? PITCH + 1 : 3); tmp.updateMatrix(); mesh.setMatrixAt(i, tmp.matrix);
      glow.push({ x: e.x, y: 0.4, z: e.z, sx: e.along === 'x' ? PITCH + 1 : 1.4, sy: 0.8, sz: e.along === 'z' ? PITCH + 1 : 1.4, c: '#a78bfa', k: 2.6 });
      glow.push({ x: e.x, y: -D + 1, z: e.z, sx: e.along === 'x' ? PITCH + 1 : 1.2, sy: 0.6, sz: e.along === 'z' ? PITCH + 1 : 1.2, c: '#22d3ee', k: 1.4 });
    });
    scene.add(mesh); meshes.push(mesh);
  }

  // ---------------------------------------------------------------- sky-bridges between districts
  for (const r of data.roads) {
    const dx = r.b[0] - r.a[0], dz = r.b[1] - r.a[1]; const len = Math.hypot(dx, dz); const rot = -Math.atan2(dz, dx);
    const Y = 16;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(len, 2, r.w), new THREE.MeshLambertMaterial({ color: '#141933' }));
    deck.position.set((r.a[0] + r.b[0]) / 2, Y, (r.a[1] + r.b[1]) / 2); deck.rotation.y = rot; scene.add(deck);
    for (const side of [-1, 1]) {
      const ox = -Math.sin(-rot) * side * (r.w / 2), oz = Math.cos(-rot) * side * (r.w / 2);
      glow.push({ x: deck.position.x + ox, y: Y + 1.6, z: deck.position.z + oz, sx: len, sy: 0.5, sz: 0.5, c: r.w > 18 ? '#f472b6' : '#22d3ee', k: 2.8, rot });
    }
    for (let t = 0.12; t < 0.95; t += Math.min(0.5, 140 / len)) glow.push({ x: r.a[0] + dx * t, y: (Y - 46) / 2, z: r.a[1] + dz * t, sx: 3, sy: Y + 46, sz: 3, c: '#1e1b4b', k: 1 });
  }

  // ---------------------------------------------------------------- buildings, grouped by shape
  const byShape = {};
  for (const p of data.parts) if (!p.hidden) (byShape[p.shape] ||= []).push(p);
  for (const [shape, list] of Object.entries(byShape)) {
    const geo = GEOMS[shape](); const mat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const ids = new Int32Array(list.length); const lit = new Float32Array(list.length); const tint = new Float32Array(list.length * 3);
    list.forEach((p, i) => {
      tmp.position.set(p.x, p.y, p.z); tmp.rotation.set(0, p.rot || 0, 0); tmp.scale.set(p.sx, p.sy, p.sz); tmp.updateMatrix();
      mesh.setMatrixAt(i, tmp.matrix); ids[i] = p.b;
      const b = p.b >= 0 ? data.buildings[p.b] : null;
      mesh.setColorAt(i, facade(p.color, b?.cat === 'housing' ? 0.02 : 0));
      const isLit = b && p.sy >= 4.5 && Math.min(p.sx, p.sz) >= 5 && !NO_WINDOWS.has(b.cat) && b.type !== 'prison';
      lit[i] = isLit ? 1 : 0;
      neon(b ? b.idx : i, 1).toArray(tint, i * 3);
      // neon trim: a glowing crown on taller buildings, a vertical strip on towers, a sign on shops
      if (b && shape === 'box' && p.sy >= 10 && Math.min(p.sx, p.sz) >= 6) {
        const c = NEON[hash(String(b.idx)) % NEON.length];
        glow.push({ x: p.x, y: p.y + p.sy, z: p.z, sx: p.sx + 0.5, sy: 0.7, sz: p.sz + 0.5, c, k: 2.6, rot: p.rot });
        if (p.sy >= 34) glow.push({ x: p.x + p.sx / 2 + 0.2, y: p.y, z: p.z, sx: 0.6, sy: p.sy, sz: 1.1, c, k: 2.4, rot: p.rot });
      }
      if (b && shape === 'box' && b.cat === 'economy' && p.y === 0 && p.sy >= 4) {
        const c = NEON[(hash(String(b.idx)) + 1) % NEON.length];
        glow.push({ x: p.x, y: Math.min(p.sy - 1, 6), z: p.z + p.sz / 2 + 0.4, sx: Math.min(p.sx * 0.6, 12), sy: 2.2, sz: 0.4, c, k: 3, rot: p.rot });
      }
    });
    if (shape === 'box') { geo.setAttribute('aLit', new THREE.InstancedBufferAttribute(lit, 1)); geo.setAttribute('aGlow', new THREE.InstancedBufferAttribute(tint, 3)); windowLights(mat); }
    mesh.castShadow = shadows; mesh.receiveShadow = shadows; mesh.computeBoundingSphere();
    scene.add(mesh); meshes.push(mesh); pickMap.set(mesh, ids);
  }

  // ---------------------------------------------------------------- trees: cute neon-pastel crowns
  if (data.trees.length) {
    const n = data.trees.length;
    const trunk = new THREE.InstancedMesh(GEOMS.cyl(), new THREE.MeshLambertMaterial({ color: '#2a1f3d' }), n);
    const crown = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8).translate(0, 1, 0), new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#1b1240' }), n);
    const crowns = ['#2dd4bf', '#5eead4', '#f9a8d4', '#c4b5fd', '#34d399'];
    data.trees.forEach((t, i) => {
      tmp.rotation.set(0, 0, 0);
      tmp.position.set(t.x, 0, t.z); tmp.scale.set(0.4 * t.s, 2.6 * t.s, 0.4 * t.s); tmp.updateMatrix(); trunk.setMatrixAt(i, tmp.matrix);
      tmp.position.set(t.x, 2.2 * t.s, t.z); tmp.scale.set(2.6 * t.s, 2.4 * t.s, 2.6 * t.s); tmp.updateMatrix(); crown.setMatrixAt(i, tmp.matrix);
      crown.setColorAt(i, col.set(crowns[Math.floor(t.c * crowns.length)]).multiplyScalar(0.55));
    });
    scene.add(trunk, crown); meshes.push(trunk, crown);
  }

  // ---------------------------------------------------------------- every neon strip in one draw call
  {
    const mesh = new THREE.InstancedMesh(GEOMS.box(), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), glow.length);
    glow.forEach((g, i) => {
      tmp.position.set(g.x, g.y, g.z); tmp.rotation.set(0, g.rot || 0, 0); tmp.scale.set(g.sx, g.sy, g.sz); tmp.updateMatrix();
      mesh.setMatrixAt(i, tmp.matrix); mesh.setColorAt(i, col.set(g.c).multiplyScalar(g.k ?? 2));
    });
    scene.add(mesh); meshes.push(mesh);
  }
  return { meshes, pickMap };
}

// Holograms over the landmarks and flying traffic between the towers; update(t) runs every frame.
const HOLO = new Set(['palace', 'parliament', 'const_court', 'central_bank', 'police_hq', 'military_hq', 'city_hall', 'academy', 'university', 'stadium', 'election_comm', 'monument']);
export function buildLife(scene, data, { traffic = 360 } = {}) {
  const holos = data.buildings.filter(b => HOLO.has(b.type));
  const ringGeo = new THREE.TorusGeometry(1, 0.035, 6, 48).rotateX(Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending });
  const rings = new THREE.InstancedMesh(ringGeo, ringMat, holos.length * 2);
  holos.forEach((b, i) => {
    const c = col.set(NEON[hash(b.type) % NEON.length]);
    b.holo = c.clone(); rings.setColorAt(i * 2, c); rings.setColorAt(i * 2 + 1, c); // colours exist from the start (update() dims them)
  });
  rings.frustumCulled = false; scene.add(rings);

  // flying cars: each keeps to one lane over its district's street grid, wrapping at the district's edge
  const cities = Object.values(data.cities);
  const carGeo = new THREE.CapsuleGeometry(1.5, 7, 3, 8).rotateZ(Math.PI / 2); // a hover pod, long along x
  const cars = new THREE.InstancedMesh(carGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), traffic);
  cars.frustumCulled = false;
  const list = [];
  for (let k = 0; k < traffic; k++) {
    const c = cities[k % cities.length]; const h = hash('car' + k);
    const R = c.radius * 0.8; const alongX = h % 2 === 0;
    const lane = ((h >>> 3) % (2 * c.N) - c.N + 0.5) * PITCH;
    list.push({ c, alongX, lane, R, y: 34 + (h >>> 7) % 70, s: 60 + (h >>> 11) % 70, t: ((h >>> 5) % 1000) / 1000 * 2 * R, dir: (h >>> 9) % 2 ? 1 : -1 });
    cars.setColorAt(k, col.set(['#f472b6', '#22d3ee', '#fde047', '#e879f9', '#ffffff'][(h >>> 13) % 5]).multiplyScalar(3));
  }
  scene.add(cars);
  return {
    update(dt, t, cam) {
      holos.forEach((b, i) => {
        // a ring right next to the camera fills the screen: it dims below the glow threshold up close
        const d = cam ? Math.hypot(cam.x - b.x, cam.y - 70, cam.z - b.z) : 2000; const k = Math.min(1, Math.max(0, (d - 180) / 900));
        rings.setColorAt(i * 2, col.copy(b.holo).multiplyScalar(0.55 + 0.95 * k)); rings.setColorAt(i * 2 + 1, col.copy(b.holo).multiplyScalar(0.45 + 0.7 * k));
        const r = Math.max(14, Math.min(b.w, b.d) * 0.45);
        const y1 = 60 + Math.sin(t * 0.8 + i) * 6, y2 = 86 + Math.cos(t * 0.6 + i) * 8;
        tmp.position.set(b.x, y1, b.z); tmp.rotation.set(0.15 * Math.sin(t + i), t * 0.7 + i, 0); tmp.scale.setScalar(r); tmp.updateMatrix(); rings.setMatrixAt(i * 2, tmp.matrix);
        tmp.position.set(b.x, y2, b.z); tmp.rotation.set(-0.12 * Math.cos(t + i), -t * 0.9 - i, 0); tmp.scale.setScalar(r * 0.7); tmp.updateMatrix(); rings.setMatrixAt(i * 2 + 1, tmp.matrix);
      });
      rings.instanceMatrix.needsUpdate = true; if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
      list.forEach((v, k) => {
        v.t = (v.t + v.s * dt) % (2 * v.R); const p = (v.t - v.R) * v.dir;
        if (v.alongX) { tmp.position.set(v.c.cx + p, v.y, v.c.cz + v.lane); tmp.rotation.set(0, 0, 0); }
        else { tmp.position.set(v.c.cx + v.lane, v.y, v.c.cz + p); tmp.rotation.set(0, Math.PI / 2, 0); }
        tmp.scale.setScalar(1); tmp.updateMatrix(); cars.setMatrixAt(k, tmp.matrix);
      });
      cars.instanceMatrix.needsUpdate = true;
    },
  };
}

// Service coverage measured along the street grid (Manhattan distance between block centres), the way
// city builders draw it: full inside 70% of the range, fading to none at the range. Ranges follow SNI 03-1733-2004
// walking radii (kindergarten 500 m, primary 1 km, ...); `all` means a home needs every level, `any` one of them.
export const COVERAGE = {
  police: { label: 'Police', mode: 'any', by: [['police_station', 1500], ['police_hq', 1500], ['police_post', 500]] },
  schools: { label: 'Schools', mode: 'all', by: [['primary_school', 1000], ['middle_school', 2000], ['high_school', 3000]] },
  health: { label: 'Health', mode: 'any', by: [['clinic', 1000], ['hospital', 3000], ['pharmacy', 500]] },
};
const cover = (d, r) => d <= 0.7 * r ? 1 : d >= r ? 0 : 1 - (d - 0.7 * r) / (0.3 * r);
export function coverageScores(data, kind) {
  const spec = COVERAGE[kind]; const out = [];
  for (const c of Object.values(data.cities)) {
    const fac = spec.by.map(([t, r]) => [(c.byType[t] || []), r]);
    for (const b of c.blocks) {
      const per = fac.map(([list, r]) => { let best = 0; for (const f of list) { const s = cover(Math.abs(f.x - b.x) + Math.abs(f.z - b.z), r); if (s > best) best = s; } return list.length ? best : null; }).filter(v => v !== null);
      out.push({ b, s: !per.length ? 0 : spec.mode === 'all' ? Math.min(...per) : Math.max(...per) });
    }
  }
  return out;
}
export function buildCoverage(scene, data) {
  const n = Object.values(data.cities).reduce((t, c) => t + c.blocks.length, 0);
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.62, depthWrite: false }), n);
  mesh.visible = false; mesh.renderOrder = 2; scene.add(mesh);
  const red = new THREE.Color('#ef4444'), amber = new THREE.Color('#f59e0b'), green = new THREE.Color('#22c55e');
  return {
    mesh,
    show(kind) {
      if (!kind || !Object.hasOwn(COVERAGE, kind)) { mesh.visible = false; return null; }
      const scores = coverageScores(data, kind); let full = 0;
      scores.forEach(({ b, s }, i) => {
        tmp.position.set(b.x, 0.2, b.z); tmp.rotation.set(0, 0, 0); tmp.scale.set(PITCH - 4, 1, PITCH - 4); tmp.updateMatrix(); mesh.setMatrixAt(i, tmp.matrix);
        mesh.setColorAt(i, s < 0.5 ? col.copy(red).lerp(amber, s * 2) : col.copy(amber).lerp(green, (s - 0.5) * 2)); if (s >= 0.99) full++;
      });
      mesh.count = scores.length; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; mesh.computeBoundingSphere(); mesh.visible = true;
      return { full, total: scores.length };
    },
  };
}

// Picks the building under the pointer.
export function pick(raycaster, pickMap) {
  const hits = raycaster.intersectObjects([...pickMap.keys()], false);
  for (const h of hits) { const ids = pickMap.get(h.object); if (ids && h.instanceId != null && ids[h.instanceId] >= 0) return { b: ids[h.instanceId], point: h.point }; }
  return null;
}
