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
    const mesh = new THREE.InstancedMesh(GEOMS[shape](), new THREE.MeshLambertMaterial({ color: '#ffffff' }), list.length);
    const ids = new Int32Array(list.length);
    list.forEach((p, i) => {
      tmp.position.set(p.x, p.y, p.z); tmp.rotation.set(0, p.rot || 0, 0); tmp.scale.set(p.sx, p.sy, p.sz); tmp.updateMatrix();
      mesh.setMatrixAt(i, tmp.matrix); mesh.setColorAt(i, col.set(p.color)); ids[i] = p.b;
    });
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

// Picks the building under the pointer.
export function pick(raycaster, pickMap) {
  const hits = raycaster.intersectObjects([...pickMap.keys()], false);
  for (const h of hits) { const ids = pickMap.get(h.object); if (ids && h.instanceId != null && ids[h.instanceId] >= 0) return { b: ids[h.instanceId], point: h.point }; }
  return null;
}
