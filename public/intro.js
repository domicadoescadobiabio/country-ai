// The opening: a scroll-driven flight through the neon megacity (the same city as the 3D map), with a short
// lore hook on each beat, ending on live numbers from the republic and then fading into the dashboard.
// Server text never goes into innerHTML: every number is set with textContent.
import * as THREE from './vendor/three/three.module.js';
import { EffectComposer } from './vendor/three/EffectComposer.js';
import { RenderPass } from './vendor/three/RenderPass.js';
import { UnrealBloomPass } from './vendor/three/UnrealBloomPass.js';
import { OutputPass } from './vendor/three/OutputPass.js';
import { generateCountry } from './map/gen.js';
import { buildWorld, buildLife, night, clock } from './map/world.js';
import { Agents } from './map/agents.js';

const $ = s => document.querySelector(s);
const intro = $('#intro');
const SEEN = 'country-ai.intro.seen';
const store = { get() { try { return sessionStorage.getItem(SEEN); } catch { return null; } }, set() { try { sessionStorage.setItem(SEEN, '1'); } catch { /* private mode */ } } };
const force = new URLSearchParams(location.search).has('intro');

function leave(instant) {
  if (!intro || intro.hidden) return;
  store.set(); running = false; delete window.COUNTRY_INTRO;
  if (instant) { intro.hidden = true; document.body.classList.remove('intro-on'); return; }
  intro.classList.add('leaving'); document.body.classList.remove('intro-on');
  setTimeout(() => { intro.hidden = true; cleanup?.(); }, 900);
}
// after the opening, nothing of it stays in memory: listeners off, every geometry, material and render target
// disposed, and the WebGL context given back (the dashboard does not need the city)
let running = false, renderer = null, cleanup = null;

if (intro && (force || !store.get())) start();
else if (intro) leave(true);

function start() {
  document.body.classList.add('intro-on');
  running = true;
  const mobile = matchMedia('(pointer: coarse)').matches;
  const canvas = $('#introCanvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.4 : 1.75));
  renderer.setSize(innerWidth, innerHeight);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2('#140b30', 0.0001);
  const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 2, 40000);
  scene.add(new THREE.HemisphereLight('#8b7cf6', '#0b1020', 1.25));
  const moon = new THREE.DirectionalLight('#c7d2fe', 0.9); moon.position.set(1400, 2200, 900); scene.add(moon);
  const skyU = { top: { value: new THREE.Color('#04030d') }, bottom: { value: new THREE.Color('#3b1670') } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(30000, 32, 16), new THREE.ShaderMaterial({
    uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying float vY; void main() { vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying float vY; void main() { gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.05, 0.55, vY)), 1.0); }',
  }));
  scene.add(sky);
  const grid = new THREE.GridHelper(30000, 120, '#7c3aed', '#312e81'); grid.position.y = -160;
  grid.material.transparent = true; grid.material.opacity = 0.35; grid.material.depthWrite = false; scene.add(grid);
  night.value = 1;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth / (mobile ? 2 : 1), innerHeight / (mobile ? 2 : 1)), mobile ? 0.75 : 1.0, 0.55, 1.0));
  composer.addPass(new OutputPass());

  // the city: same generator as the map, so the opening flies over the real layout
  const data = generateCountry(null);
  buildWorld(scene, data, { shadows: false });
  const life = buildLife(scene, data, { traffic: mobile ? 160 : 420 });
  const agents = new Agents(scene, data, mobile ? 900 : 2200);
  agents.populate(mobile ? 140 : 380);
  // a few robots stay out on the street, lit up, so the street-level shot has faces in it
  for (const a of agents.list.slice(0, 120)) a.liveUntil = Infinity;

  // camera path: one key per beat (camera position, look-at point), smoothed with Catmull-Rom curves
  const C = data.cities; const neura = C.neura, pt = C.portoken;
  const find = t => data.buildings.find(b => b.type === t && b.city === 'neura') || data.buildings.find(b => b.type === t) || { x: 0, z: 0 };
  const parl = find('parliament'), prison = find('prison'), academy = find('academy');
  const keys = [
    [[600, 6200, 9200], [0, 0, 0]],                                   // the whole megacity from the clouds
    [[neura.cx - 1500, 760, neura.cz + 1100], [neura.cx - 900, 0, neura.cz + 40]], // falling into the capital's west side
    [[neura.cx - 1180, 24, neura.cz + 40], [neura.cx - 400, 20, neura.cz + 40]], // street level with the robots (down a main street)
    [[neura.cx - 900, 170, neura.cz + 40], [academy.x, 30, academy.z]],  // lifting straight up out of the street
    [[academy.x - 120, 260, academy.z + 330], [academy.x, 20, academy.z]], // the Academy: offices are earned (above the roofs)
    [[parl.x + 300, 240, parl.z + 340], [parl.x, 30, parl.z]],          // Council and Palace under the holograms
    [[prison.x + 240, 210, prison.z + 280], [prison.x, 10, prison.z]],  // the prison: crime and courts
    [[pt.cx + 1400, 1300, pt.cz + 2200], [neura.cx, 0, neura.cz]],     // pulling back over the port
    [[0, 3800, 6200], [0, 0, 0]],                                     // the whole country, live
  ];
  const camCurve = new THREE.CatmullRomCurve3(keys.map(k => new THREE.Vector3(...k[0])), false, 'centripetal');
  const tgtCurve = new THREE.CatmullRomCurve3(keys.map(k => new THREE.Vector3(...k[1])), false, 'centripetal');
  const look = new THREE.Vector3();
  window.COUNTRY_INTRO = { camCurve, tgtCurve, camera, data, scene, composer, renderer }; // for debugging in the console

  // scroll: the overlay scrolls on its own; the flight follows with a little inertia
  const beats = [...document.querySelectorAll('#beats .beat')];
  const bar = $('#introBar'); let want = 0, at = 0;
  const onScroll = () => {
    const max = intro.scrollHeight - intro.clientHeight;
    want = max > 0 ? intro.scrollTop / max : 0;
    if (want > 0.995) leave();
  };
  const off = new AbortController(); const signal = off.signal;
  intro.addEventListener('scroll', onScroll, { passive: true, signal });
  $('#introSkip')?.addEventListener('click', () => leave(), { signal });
  for (const b of document.querySelectorAll('[data-enter]')) b.addEventListener('click', () => leave(), { signal });
  addEventListener('keydown', e => { if (e.key === 'Escape' && running) leave(); }, { signal });
  addEventListener('resize', () => { if (!running) return; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); }, { signal });
  cleanup = () => {
    off.abort();
    scene.traverse(o => {
      o.geometry?.dispose();
      for (const m of [].concat(o.material || [])) { for (const v of Object.values(m)) if (v?.isTexture) v.dispose(); m.dispose(); }
    });
    composer.dispose();
    renderer.dispose(); renderer.forceContextLoss(); renderer = null; cleanup = null;
  };

  // each beat is shown around its own point of the scroll and fades either side
  const showBeats = p => {
    for (const el of beats) {
      const c = Number(el.dataset.at); const w = Number(el.dataset.w || 0.075);
      const o = Math.max(0, 1 - Math.abs(p - c) / w);
      el.style.opacity = o.toFixed(3);
      el.style.transform = `translateY(${((c - p) * 220).toFixed(1)}px)`;
      el.classList.toggle('on', o > 0.5);
    }
    if (bar) bar.style.transform = `scaleX(${p.toFixed(4)})`;
  };

  // live numbers for the last beat
  fetch('/api/map').then(r => (r.ok ? r.json() : null)).then(s => {
    if (!s) return;
    const seats = Object.values(s.seats || {}).reduce((n, ids) => n + (Array.isArray(ids) ? ids.length : 0), 0);
    const by = s.population?.byStatus || {}; const people = Object.values(by).reduce((n, v) => n + (Number(v) || 0), 0);
    const held = (Number(by.jailed) || 0) + (Number(by.detained) || 0);
    const set = (id, v) => { const el = $(id); if (el) el.textContent = Number(v).toLocaleString('en-US'); };
    set('#liveDay', s.day || 1); set('#livePeople', people || 10000); set('#liveSeats', seats); set('#liveHeld', held);
    set('#liveThoughts', (s.daily?.recent || []).length);
  }).catch(() => { /* the beat keeps its placeholders */ });

  let last = performance.now();
  const frame = now => {
    if (!running) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    at += (want - at) * Math.min(1, dt * 4.5);
    const p = Math.min(1, Math.max(0, at));
    camCurve.getPoint(p, camera.position); tgtCurve.getPoint(p, look);
    camera.position.y += Math.sin(now / 1400) * 1.5;
    camera.lookAt(look); sky.position.copy(camera.position);
    clock.value = now / 1000; agents.update(dt, now); life.update(dt, now / 1000, camera.position);
    showBeats(p);
    composer.render();
    requestAnimationFrame(frame);
  };
  showBeats(0);
  requestAnimationFrame(frame);
  // the stage shows as soon as the first frame is drawn
  requestAnimationFrame(() => requestAnimationFrame(() => intro.classList.add('ready')));
}
