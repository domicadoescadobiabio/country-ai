// Turns the generated country into three.js instanced meshes (a few draw calls for ~70k shapes).
import * as THREE from '../vendor/three/three.module.js';
import { PITCH, BLOCK } from './gen.js';

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

// 0 by day, 1 at night: lit windows on the walls of buildings people live and work in
export const night = { value: 0 };
const NO_WINDOWS = new Set(['public', 'infra']);
function windowLights(mat) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uNight = night;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aLit;\nvarying float vLit;\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vLit = aLit; vec4 cwP = vec4(transformed, 1.0); vec3 cwN = objectNormal;
        #ifdef USE_INSTANCING
          cwP = instanceMatrix * cwP; cwN = mat3(instanceMatrix) * cwN;
        #endif
        vWP = (modelMatrix * cwP).xyz; vWN = normalize(mat3(modelMatrix) * cwN);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying float vLit;\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (vLit > 0.5 && uNight > 0.01 && abs(vWN.y) < 0.5) {
          bool sideX = abs(vWN.x) > 0.5; float u = sideX ? vWP.z : vWP.x; float face = floor(sideX ? vWP.x : vWP.z);
          vec2 g = vec2(u / 2.6, vWP.y / 3.3); vec2 cell = floor(g); vec2 f = fract(g);
          float win = step(0.22, f.x) * step(f.x, 0.78) * step(0.3, f.y) * step(f.y, 0.78);
          float on = step(0.5, fract(sin(dot(vec3(cell, face), vec3(12.9898, 78.233, 37.719))) * 43758.5453));
          totalEmissiveRadiance += vec3(1.0, 0.78, 0.45) * win * on * uNight * 0.95;
        }`);
  };
  mat.customProgramCacheKey = () => 'country-ai-windows';
}

export function buildWorld(scene, data, { shadows }) {
  const meshes = []; const pickMap = new Map(); // mesh -> instance index -> building idx

  // terrain
  const land = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#a7bf8b' }));
  land.receiveShadow = shadows; scene.add(land);

  // flat patches: water, asphalt under every block, block grounds, highways
  const flats = [];
  for (const w of data.water) flats.push({ x: w.x, z: w.z, w: w.w, d: w.d, y: 0.02, color: '#3d86b8' });
  for (const c of Object.values(data.cities)) for (const b of c.blocks) {
    flats.push({ x: b.x, z: b.z, w: PITCH + 0.5, d: PITCH + 0.5, y: 0.03, color: '#4a4f57' });
    flats.push({ x: b.x, z: b.z, w: BLOCK + 4, d: BLOCK + 4, y: 0.045, color: '#bdb8ad' });
  }
  for (const r of data.roads) {
    const dx = r.b[0] - r.a[0], dz = r.b[1] - r.a[1]; const len = Math.hypot(dx, dz);
    flats.push({ x: (r.a[0] + r.b[0]) / 2, z: (r.a[1] + r.b[1]) / 2, w: len, d: r.w, y: 0.025, color: r.kind === 'highway' ? '#3f444b' : '#50555c', rot: -Math.atan2(dz, dx) });
    if (r.kind === 'highway') for (let k = 0; k < len / 40; k++) { const t = (k * 40 + 10) / len; flats.push({ x: r.a[0] + dx * t, z: r.a[1] + dz * t, w: 14, d: 0.8, y: 0.04, color: '#f1f1e6', rot: -Math.atan2(dz, dx) }); }
  }
  for (const g of data.grounds) flats.push(g);
  {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), flats.length);
    flats.forEach((f, i) => {
      tmp.position.set(f.x, f.y, f.z); tmp.rotation.set(0, f.rot || 0, 0); tmp.scale.set(f.w, 1, f.d); tmp.updateMatrix();
      mesh.setMatrixAt(i, tmp.matrix); mesh.setColorAt(i, col.set(f.color));
    });
    mesh.receiveShadow = shadows; scene.add(mesh); meshes.push(mesh);
  }

  // buildings, grouped by shape
  const byShape = {};
  for (const p of data.parts) if (!p.hidden) (byShape[p.shape] ||= []).push(p);
  for (const [shape, list] of Object.entries(byShape)) {
    const geo = GEOMS[shape](); const mat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const ids = new Int32Array(list.length); const lit = new Float32Array(list.length);
    list.forEach((p, i) => {
      tmp.position.set(p.x, p.y, p.z); tmp.rotation.set(0, p.rot || 0, 0); tmp.scale.set(p.sx, p.sy, p.sz); tmp.updateMatrix();
      mesh.setMatrixAt(i, tmp.matrix); mesh.setColorAt(i, col.set(p.color)); ids[i] = p.b;
      const b = p.b >= 0 ? data.buildings[p.b] : null;
      lit[i] = b && p.sy >= 4.5 && Math.min(p.sx, p.sz) >= 6 && !NO_WINDOWS.has(b.cat) && b.type !== 'prison' ? 1 : 0;
    });
    if (shape === 'box') { geo.setAttribute('aLit', new THREE.InstancedBufferAttribute(lit, 1)); windowLights(mat); }
    mesh.castShadow = shadows; mesh.receiveShadow = shadows; mesh.computeBoundingSphere();
    scene.add(mesh); meshes.push(mesh); pickMap.set(mesh, ids);
  }

  // trees: trunk + crown
  if (data.trees.length) {
    const n = data.trees.length;
    const trunk = new THREE.InstancedMesh(GEOMS.cyl(), new THREE.MeshLambertMaterial({ color: '#6b4f3a' }), n);
    const crown = new THREE.InstancedMesh(GEOMS.cone(), new THREE.MeshLambertMaterial({ color: '#ffffff' }), n);
    const greens = ['#3f7d3a', '#4b8b3f', '#5a9a46', '#2f6b35', '#6aa84f'];
    data.trees.forEach((t, i) => {
      tmp.rotation.set(0, 0, 0);
      tmp.position.set(t.x, 0, t.z); tmp.scale.set(0.5 * t.s, 3 * t.s, 0.5 * t.s); tmp.updateMatrix(); trunk.setMatrixAt(i, tmp.matrix);
      tmp.position.set(t.x, 2 * t.s, t.z); tmp.scale.set(3 * t.s, 7 * t.s, 3 * t.s); tmp.updateMatrix(); crown.setMatrixAt(i, tmp.matrix);
      crown.setColorAt(i, col.set(greens[Math.floor(t.c * greens.length)]));
    });
    trunk.castShadow = crown.castShadow = shadows;
    scene.add(trunk, crown); meshes.push(trunk, crown);
  }
  return { meshes, pickMap };
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
