// COUNTRY AI 3D map. All server text goes through textContent (never innerHTML with data).
import * as THREE from '../vendor/three/three.module.js';
import { MapControls } from '../vendor/three/MapControls.js';
import { EffectComposer } from '../vendor/three/EffectComposer.js';
import { RenderPass } from '../vendor/three/RenderPass.js';
import { UnrealBloomPass } from '../vendor/three/UnrealBloomPass.js';
import { OutputPass } from '../vendor/three/OutputPass.js';
import { generateCountry, hash } from './gen.js';
import { buildWorld, buildLife, pick, night, clock, buildCoverage, COVERAGE } from './world.js';
import { Agents, moodOf } from './agents.js';
import { Scenes, SCENE_COLOR } from './scenes.js';
import { TYPES, CATS, ACT_COLOR, REP, MOODS, BOND_COLOR } from './catalog.js';
import { setClock, fmtTime, hourOf, clockDetail } from '../clock.js'; // every time on the map is the republic's (ET)

const $ = s => document.querySelector(s);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'color') el.style.setProperty('--c', v);
    // CSP is style-src 'self': a style="" attribute is blocked, CSSOM properties are not
    else if (k === 'style') for (const d of String(v).split(';')) { const i = d.indexOf(':'); if (i > 0) el.style.setProperty(d.slice(0, i).trim(), d.slice(i + 1).trim()); }
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
const pretty = id => String(id || '').replace(/-\d+$/, '').split('-').map(w => w[0]?.toUpperCase() + w.slice(1)).join(' ');
const mobile = matchMedia('(pointer: coarse)').matches; // touch device: lighter rendering (layout is CSS)

const st = { state: null, lastTs: 0, feed: [], selected: null, city: null };
// citizens outside the 160-odd in /api/state are looked up one by one and cached (undefined = never asked, null = pending/unknown)
const recs = new Map();
const citizen = id => st.state?.citizens?.find(c => c.id === id) || recs.get(id);
function fetchCitizen(id) {
  if (recs.has(id)) return Promise.resolve(recs.get(id));
  if (recs.size > 3000) recs.clear();
  recs.set(id, null);
  return fetch(`/api/citizens/${encodeURIComponent(id)}`).then(r => (r.ok ? r.json() : null)).then(j => { const c = j?.citizen || null; recs.set(id, c); return c; }).catch(() => null);
}
const nameOf = id => citizen(id)?.name || pretty(id);
const citizenCity = id => citizen(id)?.city || null;
// where an officer serves: command.postings (id -> city) when the Chief posted them, else their home city
const postedCity = id => { const p = st.state?.command?.postings?.[id]; return typeof p === 'string' && data?.cities && Object.hasOwn(data.cities, p) ? p : citizenCity(id); };
const cai = n => `${Math.round(n || 0).toLocaleString('en-US')} CAI`;
const pct = n => `${Math.round((n || 0) * 100)}%`;
const STAGE = { debate: 'in debate', vote: 'voting', president: 'on the President\'s desk', override: 'override vote', timelock: 'signed, waiting a day', referendum: 'in a referendum', enacted: 'law', rejected: 'rejected', vetoed: 'vetoed', repealed: 'rejected by the people' };

async function getState() { const r = await fetch('/api/state', { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }

// ------------------------------------------------------------ scene
const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 2, 40000);
const controls = new MapControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = 1.32; controls.minDistance = 30; controls.maxDistance = 11000; controls.screenSpacePanning = false;
const hemi = new THREE.HemisphereLight('#8b7cf6', '#0b1020', 1.1); scene.add(hemi);
const sun = new THREE.DirectionalLight('#c7d2fe', 1.2); scene.add(sun, sun.target);
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -700, right: 700, top: 700, bottom: -700, near: 10, far: 4000 }); sun.shadow.bias = -0.0004;
scene.fog = new THREE.FogExp2('#160e33', 0.00009);
// neon glow: only what is brighter than 1.0 (windows, trims, visors, cars, holograms) blooms
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / (mobile ? 2 : 1), innerHeight / (mobile ? 2 : 1)), mobile ? 0.7 : 0.95, 0.5, 1.0);
composer.addPass(bloom); composer.addPass(new OutputPass());
// sky: a dome that goes from deep night at the top to a violet glow at the horizon
const skyU = { top: { value: new THREE.Color('#05040f') }, bottom: { value: new THREE.Color('#3a1a6b') } };
const sky = new THREE.Mesh(new THREE.SphereGeometry(30000, 32, 16), new THREE.ShaderMaterial({
  uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: 'varying float vY; void main() { vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying float vY; void main() { gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.05, 0.55, vY)), 1.0); }',
}));
sky.renderOrder = -1; scene.add(sky);
// the faint grid far below the floating districts
const grid = new THREE.GridHelper(30000, 120, '#7c3aed', '#312e81'); grid.position.y = -160;
grid.material.transparent = true; grid.material.opacity = 0.35; grid.material.depthWrite = false; scene.add(grid);

function setShadows(on) {
  renderer.shadowMap.enabled = on; sun.castShadow = on;
  scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
}

// the republic's clock (ET, not the visitor's zone) runs the sky, but it is a neon city: day is a violet haze,
// night is deep blue and the windows burn brighter
const sunOff = new THREE.Vector3(800, 1200, 400);
function lighting() {
  const hr = hourOf();
  const t = (hr - 6) / 12; const elev = Math.sin(Math.PI * Math.min(Math.max(t, 0), 1));
  const day = Math.min(1, Math.max(0, elev * 2.2 + (t > 0 && t < 1 ? 0.15 : 0)));
  skyU.top.value.set('#04030d').lerp(new THREE.Color('#1e1b4b'), day);
  skyU.bottom.value.set('#2e1260').lerp(new THREE.Color('#7c3aed'), day * 0.7);
  if (t > 0 && t < 1 && elev < 0.3) skyU.bottom.value.lerp(new THREE.Color('#f472b6'), (0.3 - elev) * 1.4);
  scene.fog.color.copy(skyU.bottom.value).multiplyScalar(0.45);
  hemi.intensity = 0.8 + day * 0.7; sun.intensity = 0.5 + day * 1.1;
  night.value = Math.min(1, Math.max(0, 1 - day * 1.3));
  sun.color.set(day > 0.2 ? '#e0e7ff' : '#a5b4fc');
  const az = Math.PI * (t * 1.0) + 0.6;
  sunOff.set(Math.cos(az) * 1400, 300 + Math.max(elev, 0.15) * 1800, Math.sin(az) * 900);
}

// ------------------------------------------------------------ world
let data, world, agents, scenes, coverage, life;
// buildings that keep their name tag at city zoom; the rest only show up close
const MAJOR = new Set(['palace', 'parliament', 'const_court', 'election_comm', 'central_bank', 'monument', 'academy', 'police_hq', 'military_hq', 'army_base', 'military_academy', 'police_academy', 'naval_base', 'air_base', 'prison', 'city_hall', 'port', 'airport', 'dam', 'power_plant', 'stadium', 'university', 'hospital', 'train_station', 'square', 'vp_office', 'national_archive']);
const labels = [];
function makeLabels() {
  const box = $('#labels'); box.replaceChildren();
  for (const l of data.labels) { const el = h('div', { class: 'lbl ' + (l.kind === 'city' ? 'city' : ''), text: l.text }); box.append(el); labels.push({ ...l, el, pos: new THREE.Vector3(l.x, l.y, l.z), major: l.b == null || MAJOR.has(data.buildings[l.b]?.type) }); }
}
const v = new THREE.Vector3();
function placeLabels() {
  const show = $('#lyLabels').checked; const W = innerWidth, H = innerHeight; const dist = camera.position.distanceTo(controls.target);
  for (const l of labels) {
    let vis = show;
    if (vis) {
      const d = camera.position.distanceTo(l.pos);
      vis = l.kind === 'city' ? dist > 1800 : l.kind === 'bubble' ? d < 3200 : (l.kind === 'live' ? d < 2600 : l.kind === 'scene' ? d < 1300 : (l.major ? dist < 1800 && d < dist * 1.6 : d < 420));
    }
    if (vis) { v.copy(l.pos).project(camera); vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1; }
    if (!vis) { if (l.el.style.display !== 'none') l.el.style.display = 'none'; continue; }
    if (l.el.style.display === 'none') l.el.style.display = '';
    l.el.style.transform = `translate(${((v.x + 1) / 2 * W).toFixed(1)}px, ${((1 - v.y) / 2 * H).toFixed(1)}px) translate(-50%, -100%)`;
  }
}

function flyTo(x, z, dist = 900, ms = 1200) {
  const from = controls.target.clone(), fromCam = camera.position.clone();
  const offset = fromCam.clone().sub(from).setLength(dist); if (offset.y < dist * 0.45) offset.y = dist * 0.6;
  const to = new THREE.Vector3(x, 0, z), toCam = to.clone().add(offset); const t0 = performance.now();
  const step = now => { const k = Math.min(1, (now - t0) / ms); const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    controls.target.lerpVectors(from, to, e); camera.position.lerpVectors(fromCam, toCam, e); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

function cityButtons() {
  const box = $('#cities'); box.replaceChildren();
  box.append(h('button', { type: 'button', text: 'Country', onclick: () => { st.city = null; cityButtons(); flyTo(0, 0, 7200, 1500); } }));
  for (const c of st.state?.cities || Object.values(data.cities)) {
    const city = data.cities[c.id]; if (!city) continue;
    box.append(h('button', { type: 'button', class: st.city === c.id ? 'on' : '', onclick: () => { st.city = c.id; cityButtons(); flyTo(city.cx, city.cz, 1300); } }, c.name, h('small', { text: (c.residents || 0).toLocaleString('en-US') })));
  }
}

// ------------------------------------------------------------ info panel
const SEAT_OF = { palace: 'president', vp_office: 'vice_president', parliament: 'council', const_court: 'judge', election_comm: 'commissioner', police_hq: 'police_chief', military_hq: 'military_chief' };
function workers(b) {
  const s = st.state; if (!s) return [];
  const seats = s.seats || {}; const out = [];
  const add = (id, role) => id && out.push({ id, name: nameOf(id), role });
  if (SEAT_OF[b.type]) for (const id of seats[SEAT_OF[b.type]] || []) add(id, b.type === 'parliament' && s.cabinet?.speaker === id ? 'Speaker' : (TYPES[b.type].seat ? roleTitle(SEAT_OF[b.type]) : ''));
  if (b.type === 'ministry') add(s.cabinet?.portfolios?.[b.extra.portfolio], 'Minister');
  if (b.type === 'city_hall') add(s.cities?.find(c => c.id === b.city)?.mayor, 'Mayor');
  if (['police_station', 'police_post', 'army_base', 'military_academy', 'border_post', 'naval_base', 'air_base'].includes(b.type)) {
    for (const a of agents.list) if (a.seat && (a.seat === 'police' || a.seat === 'military') && a.dest === b) add(a.id, a.seat === 'police' ? 'Officer on duty' : 'Soldier on duty');
  }
  return out;
}
const roleTitle = id => st.state?.config?.roles?.find(r => r.id === id)?.title || pretty(id);

// Building-specific panels from data already in /api/state
const kv = rows => h('div', { class: 'kv' }, rows.flatMap(([k, v]) => [h('span', { text: k }), h('b', { text: v })]));
const rowsList = (items, empty) => items.length ? h('ul', { class: 'rows' }, items) : h('p', { class: 'note', text: empty });
const row = (title, sub) => h('li', { class: 'row' }, h('b', { text: title }), sub ? h('small', { text: sub }) : null);
const detected = s => (s.police?.incidents || []).filter(i => i.perps?.length && i.solvedBy);
function incidentRows(list) {
  return list.slice(-6).reverse().map(i => row(`#${i.id} ${i.type}${i.amount ? ` · ${cai(i.amount)}` : ''}`, `${i.perps.map(nameOf).join(', ')} · ${i.status} · day ${i.day} · by ${nameOf(i.solvedBy)}`));
}
function details(b) {
  const s = st.state; if (!s) return [];
  const out = [];
  switch (b.type) {
    case 'city_hall': {
      const c = s.cities?.find(x => x.id === b.city); if (!c) break;
      out.push(h('h4', { text: 'City' }), kv([['Mayor', c.mayor ? nameOf(c.mayor) : 'vacant'], ['Budget left', cai(c.budget)], ['Spent', cai(c.spent)], ['City health', `${c.health ?? '-'}/100`], ['AI citizens', (c.residents || 0).toLocaleString('en-US')]]));
      break;
    }
    case 'central_bank': {
      const p = s.policy || {}, e = s.econ || {};
      out.push(h('h4', { text: 'National treasury' }), kv([['Balance', cai(s.treasury)], ['Tax rate', pct(p.taxRate)], ['Daily wage', cai(p.wage)], ['UBI', cai(p.ubi)], ['Tax collected', cai(e.taxCollected)], ['UBI paid', cai(e.ubiPaid)], ['Public works', cai(e.worksFunded)]]));
      if (s.budget?.daily) out.push(kv([['AI thinking cost today', `$${(s.budget.spent || 0).toFixed(2)} of $${s.budget.daily}`]]));
      break;
    }
    case 'parliament': {
      const live = (s.bills || []).filter(x => ['debate', 'vote', 'president', 'override', 'timelock', 'referendum'].includes(x.stage));
      out.push(h('h4', { text: `Bills on the floor (${live.length})` }), rowsList(live.map(x => { const v = Object.values(x.votes || {}); return row(x.title, `${STAGE[x.stage] || x.stage} · yes ${v.filter(Boolean).length} · no ${v.filter(y => !y).length}`); }), 'No bill on the floor.'));
      const laws = (s.laws || []).slice(-5).reverse();
      out.push(h('h4', { text: `Law book (${(s.laws || []).length})` }), rowsList(laws.map(l => row(l.title, `Law ${l.id} · day ${l.day} · ${l.yes}-${l.no}`)), 'No laws yet.'));
      break;
    }
    case 'const_court': case 'court': {
      const cases = s.court?.cases || []; const open = cases.filter(c => c.status === 'open');
      if (b.type === 'court') out.push(h('p', { class: 'note', text: 'Criminal trials are heard by the Constitutional Court in the capital; this court takes the first hearing.' }));
      out.push(h('h4', { text: `Open cases (${open.length})` }), rowsList(open.slice(-6).reverse().map(c => row(c.claim, `#${c.id} · ${c.kind} · until day ${c.deadline}`)), 'No open cases.'));
      const done = cases.filter(c => c.status !== 'open').slice(-5).reverse();
      out.push(h('h4', { text: 'Latest rulings' }), rowsList(done.map(c => row(c.claim, `#${c.id} · ${c.ruling || c.status}${c.quorum === false ? ' (no quorum)' : ''}`)), 'No rulings yet.'));
      break;
    }
    case 'police_station': case 'police_post': case 'police_hq': {
      const cops = (s.seats?.police || []).filter(id => b.type === 'police_hq' || postedCity(id) === b.city);
      const chief = (s.seats?.police_chief || [])[0];
      out.push(h('h4', { text: 'Police' }), kv([...(b.type === 'police_hq' ? [['Chief of Police', chief ? nameOf(chief) : 'vacant']] : []), [b.type === 'police_hq' ? 'Officers nationwide' : 'Officers in this city', String(cops.length)], ['Arrests (all time)', String(s.police?.arrests ?? 0)]]));
      if (cops.length) out.push(h('ul', {}, cops.slice(0, 12).map(id => h('li', {}, h('b', { text: nameOf(id) }), h('span', { text: 'officer' })))));
      const cases = detected(s).filter(i => b.type === 'police_hq' || citizenCity(i.perps[0]) === b.city || postedCity(i.solvedBy) === b.city);
      out.push(h('h4', { text: 'Recent cases (detected)' }), rowsList(incidentRows(cases), 'No detected cases here.'));
      break;
    }
    case 'prison': case 'jail':
      out.push(h('h4', { text: 'Inmates' }), kv([['Jailed nationwide', String(s.population?.byStatus?.jailed ?? 0)], ['Detained before trial', String(s.population?.byStatus?.detained ?? 0)]]));
      break;
    case 'academy': case 'police_academy': case 'military_academy': {
      const a = s.academy || {}, t = s.training || {};
      out.push(h('h4', { text: 'Academy record' }), kv([['Exam sessions', String(a.sessions ?? 0)], ['Sworn in', String(a.graduates ?? 0)], ['Failed', String(a.failures ?? 0)], ['Exam rooms in use', String((a.rooms || []).length)], ['Drills (officials)', `${t.drills ?? 0} · passed ${t.passed ?? 0}`]]));
      break;
    }
    case 'community_hall': case 'election_comm': {
      const voting = (s.elections || []).filter(e => e.stage === 'voting' && (b.type === 'election_comm' || !e.city || e.city === b.city));
      out.push(h('h4', { text: voting.length ? 'Voting now' : 'Elections' }), rowsList(voting.map(e => row(`${e.title} · ${e.kind}`, `${e.voted || 0} of ${e.electorate || 0} voted${e.stageEndsAt ? ` · closes ${fmtTime(e.stageEndsAt)}` : ''}`)), 'No vote open right now. On election day this hall is a polling station.'));
      break;
    }
  }
  return out;
}

function showBuilding(b) {
  st.selected = b; const t = TYPES[b.type] || { name: b.type, cat: 'work' }; const cat = CATS[t.cat] || CATS.work;
  const city = data.cities[b.city]; const body = $('#infoBody'); body.replaceChildren();
  body.append(h('span', { class: 'cat', color: cat.color }, h('i'), cat.label), h('h2', { text: b.name }), h('p', { text: t.desc || '' }));
  const rows = [['City', city?.name || b.city]];
  if (b.households) rows.push(['Households', `~${b.households.toLocaleString('en-US')}`], ['AI citizens living here', `~${Math.max(1, Math.round(b.households * 2.8 / REP))}`]);
  body.append(h('div', { class: 'kv' }, rows.flatMap(([k, v]) => [h('span', { text: k }), h('b', { text: v })])));
  body.append(...details(b));
  const here = scenes.at(b);
  if (here.length) {
    const named = here.filter(a => a.name), sample = here.length - named.length;
    body.append(h('h4', { text: 'Here now' }), h('ul', {}, named.slice(0, 30).map(a => h('li', {}, h('b', { text: a.name }), h('span', { text: a.what || '' })))));
    if (sample) body.append(h('p', { class: 'note', text: `+ ${sample} sample figure${sample > 1 ? 's' : ''}: ${here.find(a => !a.name)?.what || ''}` }));
  }
  const w = workers(b);
  if (w.length) body.append(h('h4', { text: 'Works here' }), h('ul', {}, w.slice(0, 40).map(p => h('li', {}, h('b', { text: p.name }), h('span', { text: p.role })))));
  const inside = agents.list.filter(a => a.dest === b && a.state === 'stay' && a.name).slice(0, 12);
  if (inside.length) body.append(h('h4', { text: 'Inside now' }), h('ul', {}, inside.map(a => h('li', {}, h('b', { text: a.name }), h('span', { text: a.act })))));
  const live = agents.list.filter(a => a.home === b && a.name && !a.scene).slice(0, 12);
  if (live.length) body.append(h('h4', { text: 'Lives here' }), h('ul', {}, live.map(a => h('li', {}, h('b', { text: a.name }), h('span', { text: a.seat ? roleTitle(a.seat) : 'citizen' })))));
  if (INSIDE.has(b.type)) body.prepend(h('button', { type: 'button', class: 'go-in', onclick: () => enterBuilding(b) }, 'Go inside', h('span', { text: '→' })));
  $('#info').hidden = false;
}

// ------------------------------------------------------------ inside a building (GET /api/place/<type>)
// The interior module is imported only when someone goes in. While inside, the map does not render.
const INSIDE = new Set(['parliament', 'palace', 'vp_office', 'ministry', 'const_court', 'court', 'prison', 'jail', 'academy', 'police_academy', 'military_academy', 'police_hq', 'police_station',
  'military_hq', 'army_base', 'border_post', 'election_comm', 'central_bank', 'city_hall', 'primary_school', 'middle_school', 'high_school', 'university', 'library', 'hospital', 'clinic',
  'data_center', 'market', 'mall', 'supermarket', 'office', 'factory', 'community_hall']);
// live events that change what is inside (the interior refreshes a little after one arrives)
const INSIDE_CH = { parliament: ['parliament', 'council'], palace: ['palace', 'cabinet'], vp_office: ['palace', 'cabinet'], ministry: ['cabinet', 'palace'], const_court: ['court'], court: ['court'], prison: ['police', 'court'], jail: ['police', 'court'],
  academy: ['academy'], police_academy: ['academy', 'police'], military_academy: ['academy', 'border'], police_hq: ['police'], police_station: ['police'], military_hq: ['border'], army_base: ['border'], border_post: ['border'],
  election_comm: ['election'], city_hall: ['cityhall'], data_center: ['life'] };
const placeUrl = (type, b) => `/api/place/${encodeURIComponent(type)}?city=${encodeURIComponent(b.city || '')}${type === 'ministry' && b.extra?.portfolio ? `&portfolio=${encodeURIComponent(b.extra.portfolio)}` : ''}`;
// the server's view, or (while that building's view is not written yet, or the server is older) one built here
// from /api/state, like details() does
async function placeFor(type, b) {
  try {
    const r = await fetch(placeUrl(type, b), { cache: 'no-store' });
    if (r.ok) {
      const p = await r.json();
      const empty = !(p.occupants || []).length && !p.more && Object.keys(p.board || {}).every(k => k === 'note');
      if (!empty) return p;
    }
  } catch { /* offline or no endpoint: build it here */ }
  await refreshParts(type);
  return localPlace(type, b);
}
// while inside, keep the sections this building shows fresh (when the server offers /api/state?parts=)
const PLACE_PARTS = { parliament: ['bills', 'laws', 'cabinet'], palace: ['orders', 'cabinet'], vp_office: ['cabinet'], ministry: ['cabinet'], const_court: ['court'], court: ['court'], prison: ['police'], jail: ['police'],
  academy: ['training'], police_academy: ['training'], military_academy: ['training'], police_hq: ['police'], police_station: ['police'], military_hq: ['military'], army_base: ['military'], border_post: ['military'],
  election_comm: ['elections'], city_hall: ['cities'], primary_school: ['school'], middle_school: ['school'], high_school: ['school'], university: ['school'], library: ['school'], central_bank: ['orders'] };
let partsAt = 0;
async function refreshParts(type) {
  const can = st.state?.config?.stateParts; const want = (PLACE_PARTS[type] || []).filter(p => Array.isArray(can) && can.includes(p));
  if (!want.length || Date.now() - partsAt < 10000) return; partsAt = Date.now();
  try { const r = await fetch('/api/state?parts=' + encodeURIComponent(want.join(','))); const d = r.ok ? await r.json() : null; if (d) for (const k of want) if (k in d) st.state[k] = d[k]; } catch { /* keep */ }
}
function localPlace(type, b) {
  const s = st.state || {}; const seats = s.seats || {}; const occ = []; const board = {};
  const cityName = data.cities[b.city]?.name || b.city || '';
  const add = (id, role, activity, extra = {}) => { if (id && !occ.some(o => o.id === id)) { const c = citizen(id); occ.push({ id, name: c?.name || nameOf(id), role, activity, detail: extra.detail || null, since: extra.since ?? null, field: extra.field || null, gifted: !!extra.gifted, mood: c?.mood?.label || null }); } };
  const inCity = id => !b.city || postedCity(id) === b.city;
  const live = (s.bills || []).find(x => ['debate', 'vote', 'override'].includes(x.stage));
  switch (type) {
    case 'parliament': {
      const speaker = s.cabinet?.speaker; if (speaker) add(speaker, 'Speaker', live ? `chairs the ${STAGE[live.stage] || live.stage}` : 'chairs the session');
      for (const id of seats.council || []) { const v = live?.votes?.[id]; add(id, 'Councillor', v === true ? 'voted yes' : v === false ? 'voted no' : live ? (live.stage === 'debate' ? 'in debate' : 'deciding') : 'in session'); }
      if (live) { const vs = Object.values(live.votes || {}); board.bill = { title: live.title, stage: STAGE[live.stage] || live.stage, yes: vs.filter(Boolean).length, no: vs.filter(x => x === false).length, seats: (seats.council || []).length }; }
      board.laws = (s.laws || []).length; break;
    }
    case 'palace': case 'vp_office': {
      for (const id of seats.president || []) add(id, 'President', 'at the desk');
      for (const id of seats.vice_president || []) add(id, 'Vice President', type === 'palace' ? 'in the Cabinet room' : 'at the desk');
      if (type === 'palace') for (const [pf, id] of Object.entries(s.cabinet?.portfolios || {})) add(id, `Minister of ${pretty(pf)}`, 'in the Cabinet room');
      const o = (s.orders || []).at(-1); if (o) board.lastOrder = `day ${o.day}: ${String(o.text || '').slice(0, 120)}`;
      board.treasury = Math.round(s.treasury || 0); break;
    }
    case 'ministry': { const pf = b.extra?.portfolio; const id = s.cabinet?.portfolios?.[pf]; add(id, 'Minister', 'runs the ministry'); board.portfolio = pretty(pf || ''); board.minister = id ? nameOf(id) : 'vacant'; break; }
    case 'city_hall': { const c = (s.cities || []).find(x => x.id === b.city); if (c?.mayor) add(c.mayor, 'Mayor', 'spends the city budget'); if (c) Object.assign(board, { budget: Math.round(c.budget || 0), spent: Math.round(c.spent || 0), health: c.health, residents: c.residents }); break; }
    case 'const_court': case 'court': {
      for (const id of seats.judge || []) add(id, 'Judge', 'on the bench');
      for (const i of (s.police?.incidents || []).filter(x => x.status === 'trial')) for (const p of i.perps || []) add(p, 'Defendant', `on trial for ${i.type}`);
      const open = (s.court?.cases || []).filter(c => c.status === 'open'); board.openCases = open.length; if (open.at(-1)) board.case = String(open.at(-1).claim || '').slice(0, 120);
      board.rulings = (s.court?.cases || []).filter(c => c.status !== 'open').length; break;
    }
    case 'prison': case 'jail': {
      for (const c of s.citizens || []) if (c.status === (type === 'prison' ? 'jailed' : 'detained') && (type === 'prison' || inCity(c.id))) add(c.id, type === 'prison' ? 'Inmate' : 'Held', type === 'prison' ? 'serving a sentence' : 'waiting for trial', { detail: c.jailUntil ? `${Math.max(0, c.jailUntil - (s.day || 0))} day(s) left` : null });
      board.jailed = s.population?.byStatus?.jailed ?? 0; board.detained = s.population?.byStatus?.detained ?? 0; break;
    }
    case 'academy': case 'police_academy': case 'military_academy': {
      const force = type === 'police_academy' ? /police/ : type === 'military_academy' ? /military/ : null;
      const rooms = s.academy?.rooms || (s.academy?.current ? [s.academy.current] : []);
      for (const r of rooms) if (!force ? true : force.test(r.roleId)) add(r.agentId, `Candidate · ${roleTitle(r.roleId)}`, `question ${Math.min(r.step + 1, r.total)} of ${r.total}`, { detail: `${(r.answers || []).filter(x => x?.ok).length} right so far` });
      const d = s.training?.current; if (d && (!force || force.test(d.roleId))) add(d.agentId, `Drill · ${roleTitle(d.roleId)}`, `${(d.answers || []).length} of ${d.total} answered`);
      const cur = rooms[0]; if (cur) board.exam = `${roleTitle(cur.roleId)}: question ${Math.min(cur.step + 1, cur.total)} of ${cur.total}`;
      Object.assign(board, { sessions: s.academy?.sessions ?? 0, swornIn: s.academy?.graduates ?? 0, examRooms: rooms.length }); break;
    }
    case 'police_hq': case 'police_station': {
      for (const id of seats.police_chief || []) if (type === 'police_hq') add(id, 'Chief of Police', 'commands the force');
      for (const id of seats.police || []) if (type === 'police_hq' || inCity(id)) add(id, 'Officer', 'on duty');
      for (const c of s.citizens || []) if (c.status === 'detained' && (type === 'police_hq' || inCity(c.id))) add(c.id, 'Held', 'in the holding cell');
      board.arrests = s.police?.arrests ?? 0; const last = (s.police?.incidents || []).filter(i => i.perps?.length && i.solvedBy).at(-1); if (last) board.lastCase = `#${last.id} ${last.type} · ${last.status}`; break;
    }
    case 'military_hq': case 'army_base': case 'border_post': {
      for (const id of seats.military_chief || []) if (type === 'military_hq') add(id, 'Commander', 'in the command room');
      for (const id of seats.military || []) add(id, 'Soldier', type === 'border_post' ? 'screening arrivals' : 'on duty');
      const m = s.military || {}; Object.assign(board, { borderLevel: m.level ?? null, blocked: m.blocked ?? 0, admitted: m.admitted ?? 0, raids: m.raids ?? 0 }); break;
    }
    case 'election_comm': {
      for (const id of seats.commissioner || []) add(id, 'Commissioner', 'counts and audits');
      const e = (s.elections || []).find(x => x.stage === 'voting'); if (e) Object.assign(board, { election: `${e.title} · ${e.kind}`, voted: e.voted || 0, electorate: e.electorate || 0, turnout: e.electorate ? Math.round((e.voted || 0) / e.electorate * 100) : 0 });
      else board.note = 'No vote open right now.'; break;
    }
    case 'central_bank': {
      const pf = s.cabinet?.portfolios?.finance; if (pf) add(pf, 'Minister of Finance', 'checks the treasury');
      const p = s.policy || {}; Object.assign(board, { treasury: Math.round(s.treasury || 0), taxRate: `${Math.round((p.taxRate || 0) * 100)}%`, ubi: p.ubi, wage: p.wage, ubiPaid: Math.round(s.econ?.ubiPaid || 0) }); break;
    }
    case 'primary_school': case 'middle_school': case 'high_school': case 'university': case 'library': {
      const sc = s.school || {};
      for (const f of sc.gifted?.byField || []) if (f.top?.id) add(f.top.id, 'Top student', `studies ${f.name}`, { field: f.name, gifted: true });
      for (const x of sc.topStudents || []) add(x.id, 'Student', 'revising the core subjects');
      const top = (sc.fields || [])[0]; if (top) board.subject = `${top.name} · average level ${Number(top.avgLevel || 0).toFixed(1)}`;
      Object.assign(board, { lessonsToday: sc.lessonsToday ?? 0, students: sc.students ?? 0, gifted: sc.gifted?.total ?? 0 }); break;
    }
    default: {
      const ACT = { market: 'shop', mall: 'shop', supermarket: 'shop', office: 'work', factory: 'work', hospital: 'help', clinic: 'help', community_hall: 'volunteer', data_center: 'work' }[type];
      for (const e of (s.daily?.recent || []).slice().reverse()) if ((!ACT || e.act === ACT) && (!b.city || e.city === b.city)) add(e.agent, 'Recent visitor', e.line || e.act, { detail: e.note ? String(e.note).slice(0, 120) : null, since: e.ts });
      board.note = occ.length ? `Who came by recently in ${cityName}` : `Nobody here right now in ${cityName}`;
    }
  }
  return { type, city: b.city || null, title: `${b.name}${cityName && !b.name.includes(cityName) ? ` · ${cityName}` : ''}`, updatedAt: Date.now(), occupants: occ.slice(0, 60), board, more: Math.max(0, occ.length - 60), local: true };
}

let inside = null, insideMod = null, mapLoop = null, entering = false;
function enterStep(pct, text) { $('#enterBar').style.setProperty('width', `${pct}%`); $('#enterStep').textContent = text; }
async function enterBuilding(b, push = true) {
  if (entering || inside || !INSIDE.has(b.type)) return; entering = true;
  const box = $('#enter'); $('#enterTitle').textContent = `Entering ${b.name}`; box.hidden = false; enterStep(8, 'Opening the doors…');
  try {
    insideMod ||= await import('./interior.js?v=3'); enterStep(40, 'Reading who is inside…');
    const place = await placeFor(b.type, b); enterStep(75, 'Furnishing the room…');
    await new Promise(r => setTimeout(r, 30));
    renderer.setAnimationLoop(null); controls.enabled = false; // the map pauses where it is (and ignores drags)
    document.body.classList.add('inside'); $('#info').hidden = true;
    inside = insideMod.enter({ renderer, type: b.type, place, mobile, h, refresh: () => placeFor(b.type, b), poke: pokeById });
    inside.building = b;
    renderer.setAnimationLoop(now => inside?.frame(now));
    if (push) { const u = new URL(location.href); u.searchParams.set('in', b.type); u.searchParams.set('city', b.city); if (b.type === 'ministry' && b.extra?.portfolio) u.searchParams.set('portfolio', b.extra.portfolio); history.replaceState(null, '', u); }
    enterStep(100, 'Inside');
  } catch (e) {
    $('#enterStep').textContent = 'Could not go inside. Try again.'; console.warn('interior', e);
    exitBuilding();
  } finally { entering = false; setTimeout(() => { box.hidden = true; }, 250); }
}
function exitBuilding() {
  const was = inside; inside = null;
  if (was) was.dispose();
  document.body.classList.remove('inside'); controls.enabled = true;
  if (mapLoop) renderer.setAnimationLoop(mapLoop);
  const u = new URL(location.href); if (u.searchParams.has('in')) { u.searchParams.delete('in'); u.searchParams.delete('portfolio'); history.replaceState(null, '', u); }
  if (was?.building) showBuilding(was.building);
}
$('#insideBack').addEventListener('click', () => exitBuilding());
addEventListener('keydown', e => { if (e.key === 'Escape' && inside) exitBuilding(); });
// /map.html?selftest=interior: five visits in and out of different buildings, then the GPU memory counts before and
// after (a leak shows as growing geometries or textures) and anything left behind in the page
async function selfTest() {
  const out = h('div', { class: 'selftest', text: 'self-test: running…' }); document.body.append(out);
  const types = ['parliament', 'prison', 'data_center', 'academy', 'central_bank'];
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const mem0 = { ...renderer.info.memory }; const log = [];
  for (let i = 0; i < 5; i++) {
    const b = data.buildings.find(x => x.type === types[i]); if (!b) continue;
    await enterBuilding(b, false); await wait(120);
    log.push(`${types[i]}:${inside ? document.querySelectorAll('.itag').length : 'fail'}`);
    exitBuilding(); await wait(40);
  }
  await wait(80);
  const mem1 = renderer.info.memory;
  out.textContent = `self-test · 5 visits (${log.join(' ')}) · geometries ${mem0.geometries}→${mem1.geometries} · textures ${mem0.textures}→${mem1.textures} · interior DOM left ${document.querySelectorAll('.inside-ui').length} · inside ${inside ? 'yes' : 'no'}`;
}
async function pokeById(id) {
  const r = await fetch(`/api/poke/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const j = await r.json().catch(() => null);
  if (r.ok && j?.complaint) return `${emoji(j.mood?.label && MOODS[j.mood.label] ? j.mood.label : 'annoyed')} ${j.complaint}`;
  return r.status === 429 ? 'Too many pokes. They need a breather.' : null;
}
// ------------------------------------------------------------ citizens: feelings, bonds and the poke
const isReal = a => !!(a && a.name && !a.scene && !String(a.id).includes('#'));
const moodLabel = a => moodOf(a);
const emoji = label => (MOODS[label] || MOODS.calm)[0];
const KIND = { best_friend: 'best friend', friend: 'friend', crush: 'crush', neighbour: 'neighbour', mentor: 'mentor', rival: 'rival' };
// a robot face drawn with CSS: shell colour, glowing visor in the mood's colour, a blinking antenna
function avatar(a, big) {
  const label = moodLabel(a); const [em, glow] = MOODS[label] || MOODS.calm;
  const el = h('div', { class: `bot${big ? ' big' : ''}`, title: label });
  el.style.setProperty('--shell', a.shell || '#e0e7ff'); el.style.setProperty('--glow', glow);
  el.append(h('i', { class: 'ant' }), h('i', { class: 'head' }, h('i', { class: 'visor' })), h('i', { class: 'torso' }), h('span', { class: 'em', text: em }));
  return el;
}
// When nothing has come from the server yet (or it is busy), the robot still reacts: a short local grumble.
const LOCAL_GRUMBLES = ['Hey! Who did that?!', 'Ouch. Rude, giant.', 'I felt that, you know.', 'Beep… stop poking me!', 'I am trying to have a day here.', 'Not now, I am thinking.', 'Again?! Seriously?', 'My visor is fogging up. Thanks.'];
const pokeCool = new Map();
async function pokeAgent(a) {
  const now = performance.now();
  if (pokeCool.get(a.id) > now) return; pokeCool.set(a.id, now + 1200);
  agents.poke(a, now);
  let text = null, res = null;
  if (isReal(a)) {
    try {
      const r = await fetch(`/api/poke/${encodeURIComponent(a.id)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      res = await r.json().catch(() => null);
      if (r.ok && res?.complaint) {
        text = res.complaint;
        if (res.mood?.label && MOODS[res.mood.label]) a.mood = res.mood.label;
        const rec = recs.get(a.id); if (rec) { rec.mood = res.mood ? { ...rec.mood, ...res.mood } : rec.mood; rec.pokes = res.pokes; }
        a.pokesToday = res.pokes;
      } else if (r.status === 429) text = 'Too many pokes from you. They need a breather.';
    } catch { /* offline: the local grumble below */ }
  }
  if (!text) text = a.name ? LOCAL_GRUMBLES[(hash(a.id) + (a.pokes || 0)) % LOCAL_GRUMBLES.length] : 'I am just a passer-by! 😤';
  bubble(a, `${emoji(moodLabel(a))} ${text}`);
  if (a.name) { st.feed.unshift({ agent: a.id, name: a.name, city: a.city, act: 'poke', mood: moodLabel(a), line: 'was poked', note: text, ts: Date.now() }); st.feed.length = Math.min(st.feed.length, 20); renderFeed(); }
  if (st.agent === a) showAgent(a);
}
// a speech bubble over a robot for a few seconds
const bubbles = new Map();
function bubble(a, text, ms = 7000) {
  let l = bubbles.get(a.id);
  if (!l) { l = { kind: 'bubble', el: h('div', { class: 'lbl bubble' }), pos: new THREE.Vector3(), a }; $('#labels').append(l.el); labels.push(l); bubbles.set(a.id, l); }
  l.el.textContent = text; l.until = performance.now() + ms; l.el.classList.remove('pop'); void l.el.offsetWidth; l.el.classList.add('pop');
}

// glowing arcs from the selected robot to the people it has feelings for: a thin line plus little hearts of
// light travelling along it (each kind of bond has its colour)
const arcGeo = new THREE.BufferGeometry(); const ARC_N = 24; const SPARKS = 14;
const arcs = new THREE.LineSegments(arcGeo, new THREE.LineBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true, opacity: 0.8 }));
arcs.frustumCulled = false; scene.add(arcs);
const sparks = new THREE.InstancedMesh(new THREE.SphereGeometry(1.5, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), 8 * SPARKS);
sparks.frustumCulled = false; sparks.count = 0; scene.add(sparks);
const sp = new THREE.Object3D(); const spc = new THREE.Color();
let arcList = [];
function arcPoint(a, o, t, lift) { return [a.x + (o.x - a.x) * t, 10 + Math.sin(Math.PI * t) * lift, a.z + (o.z - a.z) * t]; }
function drawArcs(now) {
  const a = st.agent; if (!a || !arcList.length) { arcs.visible = false; sparks.count = 0; return; }
  const pos = new Float32Array(arcList.length * ARC_N * 6); const colr = new Float32Array(arcList.length * ARC_N * 6);
  let n = 0;
  arcList.forEach((b, k) => {
    const o = b.a; const c = new THREE.Color(BOND_COLOR[b.kind] || '#67e8f9');
    const lift = 30 + Math.hypot(o.x - a.x, o.z - a.z) * 0.18;
    for (let i = 0; i < ARC_N; i++) for (let e = 0; e < 2; e++) {
      const [x, y, z] = arcPoint(a, o, (i + e) / ARC_N, lift); const j = (k * ARC_N + i) * 6 + e * 3;
      pos[j] = x; pos[j + 1] = y; pos[j + 2] = z; colr[j] = c.r * 1.3; colr[j + 1] = c.g * 1.3; colr[j + 2] = c.b * 1.3;
    }
    const dist = Math.hypot(o.x - a.x, o.z - a.z); const size = Math.min(4, 0.8 + dist / 400);
    for (let s = 0; s < SPARKS; s++) {
      const t = ((now / 2600) + s / SPARKS) % 1; const [x, y, z] = arcPoint(a, o, t, lift);
      sp.position.set(x, y, z); sp.scale.setScalar(size * (0.6 + 0.4 * Math.sin(t * Math.PI))); sp.updateMatrix(); sparks.setMatrixAt(n, sp.matrix);
      sparks.setColorAt(n, spc.copy(c).multiplyScalar(2.6)); n++;
    }
  });
  arcGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); arcGeo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  sparks.count = n; sparks.instanceMatrix.needsUpdate = true; if (sparks.instanceColor) sparks.instanceColor.needsUpdate = true;
  arcs.visible = true;
}
async function loadBonds(a) {
  arcList = [];
  const rec = await fetchCitizen(a.id); if (st.agent !== a || !rec) return;
  if (rec.mood?.label && MOODS[rec.mood.label]) a.mood = rec.mood.label;
  const bonds = Array.isArray(rec.bonds) ? rec.bonds.slice(0, 8) : [];
  for (const b of bonds) {
    if (!b?.id) continue;
    const other = (await fetchCitizen(b.id)) || {};
    const o = agents.ensure(b.id, b.name || other.name || pretty(b.id), other.city || a.city);
    if (o) { if (b.mood && MOODS[b.mood]) o.mood = b.mood; arcList.push({ a: o, kind: b.kind, id: b.id }); }
  }
  if (st.agent === a) showAgent(a, true);
}
function select(a) {
  if (st.agent && st.agent !== a) st.agent.selected = false;
  st.agent = a; if (a) a.selected = true; arcList = [];
}
function showAgent(a, keepBonds) {
  if (st.agent !== a) select(a);
  const body = $('#infoBody'); body.replaceChildren();
  const rec = isReal(a) ? recs.get(a.id) : null; const label = moodLabel(a);
  const role = a.seat ? roleTitle(a.seat) : a.scene ? 'At an institution' : a.name ? 'Citizen' : 'Passer-by';
  body.append(h('div', { class: 'who' }, avatar(a, true), h('div', {},
    h('span', { class: 'cat', color: a.color }, h('i'), role), h('h2', { text: a.name || (a.scene ? 'A sample figure' : 'A citizen') }),
    h('p', { class: 'mood' }, h('b', { text: `${emoji(label)} ${label}` }), rec?.mood?.why ? ` · ${rec.mood.why}` : a.mood ? '' : ' · (a guess from what they are doing)'))));
  const rows = a.scene ? [['City', data.cities[a.city]?.name || a.city], ['Where', a.b?.name || ''], ['Doing', a.what || a.act]]
    : [['City', data.cities[a.city]?.name || a.city], ['Doing', a.state === 'walk' ? `walking to ${a.dest ? a.dest.name : 'home'}` : a.act], ['Home', a.address ? `${a.address} (${a.home?.name || ''})` : (a.home?.name || '')]];
  const pk = rec?.pokes?.n ?? a.pokesToday; if (pk) rows.push(['Poked today', `${pk}×`]);
  const info = isReal(a) ? (rec || citizen(a.id)) : null; // goal and reputation from the citizen record
  if (typeof info?.reputation === 'number') rows.push(['Reputation', `${Math.round(info.reputation * 100)}%`]);
  body.append(h('div', { class: 'kv' }, rows.flatMap(([k, v]) => [h('span', { text: k }), h('b', { text: v })])));
  // what the server says they are doing right now (citizen.now from /api/citizens/:id; null = nothing yet)
  const now = rec?.now;
  if (now && typeof now === 'object') {
    const pt = typeof now.place === 'string' && Object.hasOwn(TYPES, now.place) ? now.place : null;
    const where = pt ? TYPES[pt].name : now.place || null;
    const cityName = now.city && data.cities[now.city] ? data.cities[now.city].name : null;
    const nr = [['Doing', now.act], ['Where', [where, cityName].filter(Boolean).join(', ') || null], ['Since', now.since ? (now.since > 1e11 ? fmtTime(now.since) : `day ${now.since}`) : null],
      ['Field', now.field ? `${now.field}${now.gifted ? ' ★ gifted' : ''}` : null], ['Detail', now.detail], ['Mood', now.mood]].filter(([, v]) => v);
    if (nr.length) {
      body.append(h('h4', { text: 'Right now' }), h('div', { class: 'kv' }, nr.flatMap(([k, v]) => [h('span', { text: k }), h('b', { text: String(v) })])));
      const b = pt && INSIDE.has(pt) ? data.buildings.find(x => x.type === pt && (!now.city || x.city === now.city)) : null;
      if (b) body.append(h('button', { type: 'button', class: 'go-in small', onclick: () => enterBuilding(b) }, `Go inside the ${b.name}`, h('span', { text: '→' })));
    }
  }
  const goal = info?.goal;
  if (goal?.label) {
    const p = Math.round(Math.min(1, Math.max(0, Number(goal.progress) || 0)) * 100);
    const state = goal.status === 'done' ? 'reached' : goal.status === 'failed' ? 'missed' : `${p}%`;
    body.append(h('h4', { text: 'Goal this week' }), h('div', { class: 'goal' }, h('div', { class: 'goal-head' }, h('b', { text: goal.label }), h('span', { text: state })),
      h('div', { class: 'goal-bar' }, h('i', { style: `width:${goal.status === 'done' ? 100 : p}%` }))));
  }
  body.append(h('div', { class: 'poke' }, h('button', { type: 'button', class: 'poke-btn', onclick: () => pokeAgent(a) }, '👉 Poke'),
    h('small', { text: 'You can only poke. They feel it and grumble, and that is all a human can do here.' })));
  if (isReal(a)) {
    const bonds = Array.isArray(rec?.bonds) ? rec.bonds : null;
    body.append(h('h4', { text: 'Feelings for others' }));
    if (!bonds) body.append(h('p', { class: 'note', text: rec === undefined || rec === null ? 'Reading their heart…' : 'No close bonds yet.' }));
    else if (!bonds.length) body.append(h('p', { class: 'note', text: 'No close bonds yet.' }));
    else body.append(h('ul', { class: 'bonds' }, bonds.slice(0, 8).map(b => h('li', { onclick: () => { const o = agents.byId.get(b.id); if (o) { flyTo(o.x, o.z, 260, 900); showAgent(o); } } },
      h('span', { class: 'em', text: emoji(b.mood) }), h('b', { text: b.name || pretty(b.id) }), h('span', { class: 'kind', color: BOND_COLOR[b.kind] || '#67e8f9', text: KIND[b.kind] || b.kind })))));
  }
  if (a.thought) {
    body.append(h('h4', { text: `Thought · ${fmtTime(a.thought.ts)}` }), h('p', { class: 'quote', text: a.thought.note || a.thought.line || a.thought.act }));
    if (a.thought.engine) body.append(h('p', { class: 'note', text: `Brain: ${a.thought.engine}` }));
  }
  if (!a.name && a.scene) body.append(h('p', { class: 'note', text: 'A sample figure: it shows that this is happening here, not one named agent.' }));
  else if (!a.name) body.append(h('p', { class: 'note', text: `One of the ${REP}-to-1 sample walkers: it stands for the people of this neighbourhood, not one named agent.` }));
  $('#info').hidden = false;
  if (isReal(a) && !keepBonds) loadBonds(a);
}
$('#infoClose').addEventListener('click', () => { $('#info').hidden = true; st.selected = null; select(null); });

// click (not drag): a robot gets poked (and its card opens), otherwise the building opens
const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2(); let down = null;
canvas.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', e => {
  if (inside || entering) return; // inside a building the interior handles its own clicks
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  if ($('#lyAgents').checked) { const a = agents.pickAt(ray); if (a) { showAgent(a); pokeAgent(a); return; } }
  const p = pick(ray, world.pickMap); if (p) { select(null); showBuilding(data.buildings[p.b]); }
});
// hovering a robot shows a pointing hand: it is clickable
let hoverAt = 0;
canvas.addEventListener('pointermove', e => {
  if (mobile || !agents || inside || performance.now() - hoverAt < 80) return; hoverAt = performance.now();
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  canvas.style.cursor = $('#lyAgents').checked && agents.pickAt(ray) ? 'pointer' : '';
});

// ------------------------------------------------------------ live data
function renderFeed() {
  const ol = $('#feed'); ol.replaceChildren();
  for (const e of st.feed.slice(0, 8)) ol.append(h('li', { onclick: () => { const a = agents.byId.get(e.agent); if (a) { flyTo(a.x, a.z, 320, 900); showAgent(a); } } },
    h('span', { class: 'em', color: ACT_COLOR[e.act] || '#94a3b8', text: emoji(e.mood || (agents.byId.get(e.agent) ? moodLabel(agents.byId.get(e.agent)) : 'calm')) }), h('div', {}, h('b', { text: e.name || pretty(e.agent) }), ` ${e.line || e.act}`, h('small', { text: `${data.cities[e.city]?.name || e.city} · ${e.note || ''}` }))));
}
function renderClock() {
  const s = st.state; $('#clock').title = clockDetail();
  $('#clock').replaceChildren(h('b', { text: `DAY ${s?.day ?? '–'}` }), ` · ${fmtTime(Date.now())} · `, h('b', { text: (s?.stats?.citizens ?? 0).toLocaleString('en-US') }), ' citizens');
}
const liveLabels = new Map();
function showLive(e) {
  const a = agents.live(e, nameOf); if (!a) return;
  st.feed.unshift(e); st.feed.length = Math.min(st.feed.length, 20); renderFeed();
  if (!liveLabels.has(a.id)) { const el = h('div', { class: 'lbl live' }); $('#labels').append(el); const l = { kind: 'live', el, pos: new THREE.Vector3(), a }; labels.push(l); liveLabels.set(a.id, l); }
  liveLabels.get(a.id).el.textContent = `${emoji(moodLabel(a))} ${a.name}: ${e.line || e.act}`;
  if (e.act === 'poke' && e.note) bubble(a, `${emoji(moodLabel(a))} ${e.note}`, 9000);
}
function ingest(s) {
  st.state = s; agents.setWeights(s.daily?.byAct);
  setClock(s.config?.clock);
  agents.officials(s.seats, s.cities, nameOf, postedCity); // police and soldiers stand in the city they are posted to
  const fresh = (s.daily?.recent || []).filter(e => e.ts > st.lastTs).sort((a, b) => a.ts - b.ts);
  const first = st.lastTs === 0;
  for (const [i, e] of fresh.slice(-30).entries()) {
    setTimeout(() => showLive(e), first ? i * 120 : i * 900);
  }
  if (fresh.length) st.lastTs = fresh[fresh.length - 1].ts;
  recs.clear(); // look-ups go stale (people are released): ask again with each fresh state, every 2 minutes
  scenes.sync(s);
  renderClock(); renderLeaders();
}
// name tags over scene actors (exam candidates, trials, inmates, arrests, polling)
const sceneLabels = new Map();
function sceneTags() {
  for (const [id, a] of scenes.actors) {
    let l = sceneLabels.get(id);
    if (!a.tag) { if (l) { l.el.remove(); labels.splice(labels.indexOf(l), 1); sceneLabels.delete(id); } continue; }
    if (!l) { l = { kind: 'scene', el: h('div', { class: 'lbl scene', color: a.color }), pos: new THREE.Vector3(), a }; $('#labels').append(l.el); labels.push(l); sceneLabels.set(id, l); }
    if (l.el.textContent !== a.tag) l.el.textContent = a.tag;
    l.pos.set(a.x, 13, a.z);
  }
  for (const [id, l] of sceneLabels) if (scenes.actors.get(id) !== l.a) { l.el.remove(); labels.splice(labels.indexOf(l), 1); sceneLabels.delete(id); }
}
// /api/state is large (the whole republic), so the map reads it once and then every 2 minutes while visible;
// live actions arrive through the event stream (#life messages) and the citizen's city is looked up once.
async function poll() { if (!document.hidden) { try { ingest(await getState()); } catch { /* offline: keep the last picture */ } } setTimeout(poll, 120000); }
const cityCache = new Map(); const queue = [];
async function cityFor(id) {
  if (cityCache.has(id)) return cityCache.get(id);
  let c = citizenCity(id) || st.state?.daily?.recent?.find(e => e.agent === id)?.city || null;
  if (!c) c = (await fetchCitizen(id))?.city || null;
  if (cityCache.size > 5000) cityCache.clear();
  cityCache.set(id, c); return c;
}
function stream() {
  let es; try { es = new EventSource('/api/stream'); } catch { return; }
  es.addEventListener('message', ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (inside && (INSIDE_CH[inside.building?.type] || []).includes(m.ch)) inside.nudge(); // something changed in there
    if (m.ch !== 'life' || !(m.act || m.kind === 'poke') || !m.agentId || queue.length > 40) return;
    queue.push(m);
  });
}
async function drain() {
  const m = queue.shift();
  if (m) {
    const city = await cityFor(m.agentId);
    const poke = m.act === 'poke' || m.kind === 'poke'; const text = String(m.text || '');
    if (city) showLive({ agent: m.agentId, name: nameOf(m.agentId), city, act: poke ? 'poke' : m.act, mood: typeof m.mood === 'string' && MOODS[m.mood] ? m.mood : null,
      line: poke ? 'grumbles about being poked' : text.split('. "')[0], note: poke ? text.slice(0, 200) : (text.match(/"(.+)"$/) || [])[1] || '', ts: m.ts, engine: m.engine });
  }
  setTimeout(drain, queue.length > 10 ? 300 : 900);
}

// ------------------------------------------------------------ zoom: buttons, level, help
const camDist = () => camera.position.distanceTo(controls.target);
const zoomName = d => (d > 3500 ? 'Country' : d > 900 ? 'City' : d > 260 ? 'District' : 'Street');
let zoomAnim = 0;
function zoomTo(dist, ms = 380) {
  const want = Math.min(controls.maxDistance, Math.max(controls.minDistance, dist));
  const from = camDist(); const dir = camera.position.clone().sub(controls.target).normalize(); const t0 = performance.now(); const id = ++zoomAnim;
  const step = now => {
    if (id !== zoomAnim) return; const k = Math.min(1, (now - t0) / ms); const e = 1 - (1 - k) ** 3;
    camera.position.copy(controls.target).addScaledVector(dir, from + (want - from) * e); if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function fitView() { const c = st.city && data.cities[st.city]; if (c) flyTo(c.cx, c.cz, 1300); else flyTo(0, 0, 7200, 1500); }
let zoomShown = '';
function showZoom() {
  const d = camDist(); const t = `${zoomName(d)} · ${d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`}`;
  if (t !== zoomShown) { zoomShown = t; $('#zoomLevel').textContent = t; }
}
function zoomUi() {
  $('#zoomIn').addEventListener('click', () => zoomTo(camDist() / 1.8));
  $('#zoomOut').addEventListener('click', () => zoomTo(camDist() * 1.8));
  $('#zoomFit').addEventListener('click', fitView);
  $('#zoomTip').textContent = mobile ? 'Pinch or use + / − to zoom · drag with one finger to move · twist or drag with two fingers to rotate · ⤢ fits the city' : 'Scroll or use + / − to zoom · drag to move · right-drag (or Ctrl + drag) to rotate · ⤢ fits the selected city or the whole country';
  $('#zoomHelp').addEventListener('click', () => { const tip = $('#zoomTip'); tip.hidden = !tip.hidden; $('#zoomHelp').setAttribute('aria-expanded', String(!tip.hidden)); });
}

// ------------------------------------------------------------ a short message at the top of the map
function mapToast(text, ms = 3200) { const t = $('#mapToast'); t.textContent = text; t.hidden = false; clearTimeout(mapToast.t); mapToast.t = setTimeout(() => { t.hidden = true; }, ms); }

// ------------------------------------------------------------ the marker over a person (or a building) we flew to
const marker = new THREE.Group(); marker.visible = false; scene.add(marker);
{
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color('#facc15').multiplyScalar(2.4), toneMapped: false, transparent: true, opacity: 0.95, depthTest: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(7, 0.9, 8, 40).rotateX(Math.PI / 2), glow); ring.renderOrder = 5;
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(3, 7, 12).rotateX(Math.PI), glow); arrow.renderOrder = 5;
  marker.add(ring, arrow); marker.userData = { ring, arrow };
}
let markTarget = null, markUntil = 0;
function markOn(target, ms = 6000) { markTarget = target; markUntil = performance.now() + ms; marker.visible = true; }
function updateMarker(now) {
  if (!markTarget || now > markUntil) { marker.visible = false; markTarget = null; return; }
  const t = markTarget; const s = t.size || 1; const k = (now / 1000) % 1;
  marker.position.set(t.x, 0, t.z);
  marker.userData.ring.position.y = 1; marker.userData.ring.scale.setScalar(s * (0.8 + k * 0.9)); marker.userData.ring.material.opacity = 1 - k * 0.7;
  marker.userData.arrow.position.y = (t.y || 18) + Math.abs(Math.sin(now / 260)) * 5; marker.userData.arrow.scale.setScalar(s);
}

// ------------------------------------------------------------ the leaders panel
const LEAD_OPEN = 'country-ai.map.leaders';
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
// where an office holder works when they are not on the map (president at the palace, a mayor at their city hall…)
const OFFICE_OF = { president: 'palace', vice_president: 'vp_office', minister: 'ministry', council: 'parliament', judge: 'const_court', commissioner: 'election_comm', police_chief: 'police_hq', military_chief: 'military_hq', mayor: 'city_hall' };
const groupOpen = new Map([['council', false]]); // the Council is long: closed until opened
function leaderGroups() {
  const s = st.state; if (!s) return [];
  const seats = s.seats || {}; const roles = s.config?.roles || []; const cab = s.cabinet || {};
  const seatsOf = r => roles.find(x => x.id === r)?.seats ?? (seats[r] || []).length;
  const pf = Object.fromEntries(Object.entries(cab.portfolios || {}).map(([p, id]) => [id, p]));
  const fill = (r, title, label) => { const ids = seats[r] || []; const rows = ids.map(id => ({ id, seat: r, title: label ? label(id) : title })); for (let i = ids.length; i < seatsOf(r); i++) rows.push({ id: null, seat: r, title }); return rows; };
  const council = fill('council', 'Councillor', id => (id === cab.speaker ? 'Speaker of the Council' : 'Councillor')).sort((a, b) => (b.title.startsWith('Speaker') ? 1 : 0) - (a.title.startsWith('Speaker') ? 1 : 0));
  const mayors = (s.cities || []).map(c => ({ id: c.mayor || null, seat: 'mayor', title: `Mayor of ${c.name || c.id}`, city: c.id }));
  return [
    ['president', 'President', fill('president', 'President')],
    ['vice_president', 'Vice President', fill('vice_president', 'Vice President')],
    ['minister', 'Ministers', fill('minister', 'Minister', id => (pf[id] ? `Minister of ${pretty(pf[id])}` : 'Minister'))],
    ['council', 'Council', council],
    ['judge', 'Judges', fill('judge', 'Judge')],
    ['police_chief', 'Chief of Police', fill('police_chief', 'Chief of Police')],
    ['military_chief', 'Commander of the Military', fill('military_chief', 'Commander of the Military')],
    ['mayor', 'Mayors', mayors],
    ['commissioner', 'Election Commission', fill('commissioner', 'Commissioner')],
  ].filter(([, , rows]) => rows.length);
}
// where a person is right now on the map, in words
function whereNow(a) {
  if (!a) return 'not on the map yet';
  const city = data.cities[a.city]?.name || a.city || '';
  if (a.state === 'walk') return `walking to ${a.dest ? a.dest.name : 'home'} · ${city}`;
  if (a.state === 'stay' && a.dest) return `inside ${a.dest.name} · ${city}`;
  if (a.state === 'pin' || a.state === 'loop') return `${a.b?.name || 'out'} · ${city}`;
  return `at home${a.home?.name ? ` (${a.home.name})` : ''} · ${city}`;
}
function renderLeaders() {
  const body = $('#leadersBody'); const groups = leaderGroups();
  const filled = groups.reduce((n, [, , rows]) => n + rows.filter(r => r.id).length, 0), total = groups.reduce((n, [, , rows]) => n + rows.length, 0);
  $('#leadersCount').textContent = total ? `${filled}/${total}` : '';
  if (body.hidden) return;
  body.replaceChildren(...groups.map(([key, title, rows]) => {
    const d = h('details', { open: groupOpen.has(key) ? groupOpen.get(key) : true, ontoggle: e => groupOpen.set(key, e.currentTarget.open) },
      h('summary', {}, h('b', { text: title }), h('small', { text: `${rows.filter(r => r.id).length}/${rows.length}` })));
    d.append(h('ul', {}, rows.map(r => {
      if (!r.id) return h('li', { class: 'vacant', onclick: () => mapToast(`${r.title}: vacant`) }, h('span', { class: 'role', text: r.title }), h('b', { text: 'vacant' }));
      const a = agents.byId.get(r.id);
      return h('li', { onclick: () => showLeader(r) }, h('span', { class: 'role', text: r.title }), h('b', { text: nameOf(r.id) }), h('small', { text: whereNow(a) }));
    })));
    return d;
  }));
}
// fly to the person: to the robot when it is out on the map, else to the building they are in (or their office)
function showLeader(r) {
  if (!r.id) { mapToast(`${r.title}: vacant`); return; }
  const a = agents.byId.get(r.id); const name = nameOf(r.id);
  const out = a && (a.state === 'walk' || a.state === 'pin' || a.state === 'loop' || a.liveUntil > performance.now());
  if (a && out) { flyTo(a.x, a.z, 260, 1000); markOn(a); showAgent(a); return; }
  let b = a?.state === 'stay' ? a.dest : null; let athome = false;
  if (!b && a?.state === 'home') { b = a.home; athome = true; }
  if (!b) { // not drawn on the map: their office
    const type = OFFICE_OF[r.seat]; const city = r.city || postedCity(r.id) || 'neura';
    const port = r.seat === 'minister' ? Object.entries(st.state?.cabinet?.portfolios || {}).find(([, id]) => id === r.id)?.[0] : null;
    const pool = data.buildings.filter(x => x.type === type);
    b = pool.find(x => port && x.extra?.portfolio === port) || pool.find(x => x.city === city) || pool[0] || null;
  }
  if (!b) { mapToast(`${name}: no place on the map yet`); return; }
  flyTo(b.x, b.z, 380, 1100); markOn({ x: b.x, z: b.z, y: (b.h || 20) + 12, size: Math.min(4, Math.max(1.5, b.w / 30)) });
  mapToast(athome ? `${name} (${r.title}) is at home, inside ${b.name}` : `${name} (${r.title}) is inside ${b.name}`, 4200);
  if (a) showAgent(a); else showBuilding(b);
}
function leadersUi() {
  const body = $('#leadersBody'), btn = $('#leadersToggle');
  const set = open => { body.hidden = !open; btn.setAttribute('aria-expanded', String(open)); btn.classList.toggle('on', open); store.set(LEAD_OPEN, open ? '1' : '0'); if (open) renderLeaders(); };
  btn.addEventListener('click', () => set(body.hidden));
  // on a phone it starts closed (it would cover the city); /map.html?leaders=open opens it
  const qs = new URLSearchParams(location.search);
  set(qs.get('leaders') === 'open' || (store.get(LEAD_OPEN) === '1' && !mobile));
  // /map.html?leader=judge (or =any): fly to the first holder of that office once the map is ready (links and checks)
  const want = qs.get('leader');
  if (want && /^[a-z_]{2,20}$/.test(want)) setTimeout(() => {
    const rows = leaderGroups().flatMap(([k, , r]) => (want === 'any' || k === want ? r : []));
    const r = rows.find(x => x.id) || rows[0];
    if (r) showLeader(r); else mapToast('No such office');
  }, 1500);
  setInterval(() => { if (!body.hidden && !document.hidden && !inside) renderLeaders(); }, 5000); // where they are now
}

// ------------------------------------------------------------ boot
function legend() {
  $('#acts').replaceChildren(...Object.entries(ACT_COLOR).filter(([k]) => k !== 'rest').map(([k, c]) => h('span', {}, h('i', { color: c }), k)), h('span', {}, h('i', { color: '#2563eb' }), 'police'), h('span', {}, h('i', { color: '#4d7c0f' }), 'military'),
    h('span', {}, h('i', { color: SCENE_COLOR.exam }), 'exam'), h('span', {}, h('i', { color: SCENE_COLOR.suspect }), 'arrest / trial'), h('span', {}, h('i', { color: SCENE_COLOR.inmate }), 'inmate'), h('span', {}, h('i', { color: SCENE_COLOR.voter }), 'voter'));
  const sel = $('#lyCover');
  sel.replaceChildren(h('option', { value: '', text: 'Coverage: off' }), ...Object.entries(COVERAGE).map(([k, c]) => h('option', { value: k, text: `Coverage: ${c.label}` })));
  sel.addEventListener('change', () => {
    const r = coverage.show(sel.value);
    $('#coverNote').textContent = r ? `${Math.round(r.full / r.total * 100)}% of blocks fully covered, measured along streets. Green covered · amber edge · red none.` : '';
    $('#coverNote').hidden = !r;
  });
}
async function boot() {
  try { st.state = await getState(); } catch { $('#loadingText').textContent = 'Server offline: drawing the default republic.'; }
  await new Promise(r => setTimeout(r, 30));
  data = generateCountry(st.state);
  world = buildWorld(scene, data, { shadows: false });
  agents = new Agents(scene, data, mobile ? 1600 : 3200);
  agents.setHomes(id => {
    const c = citizen(id); if (!c?.home || !st.state?.homeLayout) return null;
    return { home: c.home, layout: st.state.homeLayout, blocks: st.state.cities?.find(x => x.id === c.home.city)?.blocks };
  });
  agents.populate(mobile ? 120 : 300);
  scenes = new Scenes(agents, data, { nameOf, roleTitle, citizen, fetchCitizen });
  coverage = buildCoverage(scene, data);
  life = buildLife(scene, data, { traffic: mobile ? 140 : 360 });
  makeLabels(); cityButtons(); legend(); zoomUi(); leadersUi();
  if (st.state) ingest(st.state);
  setTimeout(poll, 120000); stream(); drain();
  setInterval(() => { if (scenes.dirty) scenes.sync(st.state); }, 3000); // citizen look-ups finished: redraw the prison
  const cap = data.cities.neura || Object.values(data.cities)[0];
  controls.target.set(cap.cx, 0, cap.cz - 500); camera.position.set(cap.cx + 700, 750, cap.cz + 450);
  const qs = new URLSearchParams(location.search);
  const want = qs.get('city'); if (want && Object.hasOwn(data.cities, want)) { const c = data.cities[want]; st.city = want; cityButtons(); controls.target.set(c.cx, 0, c.cz); camera.position.set(c.cx + 700, 750, c.cz + 650); }
  // shareable building links: /map.html?at=prison (first building of that type, capital first) opens it up close
  const at = qs.get('at'); const ab = at && Object.hasOwn(TYPES, at) && ((Object.hasOwn(data.cities.neura?.byType || {}, at) && data.cities.neura.byType[at][0]) || data.buildings.find(b => b.type === at));
  if (ab) { controls.target.set(ab.x, 0, ab.z); camera.position.set(ab.x + 160, 190, ab.z + 200); showBuilding(ab); }
  const cov = qs.get('cover'); if (cov && Object.hasOwn(COVERAGE, cov)) { $('#lyCover').value = cov; $('#lyCover').dispatchEvent(new Event('change')); }
  // deep link inside a building: /map.html?in=parliament&city=neura (&portfolio=finance for a ministry)
  const inType = qs.get('in');
  if (inType && INSIDE.has(inType)) {
    const ic = Object.hasOwn(data.cities, qs.get('city') || '') ? qs.get('city') : null; const pf = qs.get('portfolio');
    const pool = data.buildings.filter(x => x.type === inType && (!ic || x.city === ic));
    const ib = pool.find(x => !pf || x.extra?.portfolio === pf) || pool[0];
    if (ib) { controls.target.set(ib.x, 0, ib.z); camera.position.set(ib.x + 160, 190, ib.z + 200); setTimeout(() => enterBuilding(ib, false), 50); }
  }
  if (qs.get('selftest') === 'interior') setTimeout(selfTest, 100);
  $('#lyShadows').checked = false; setShadows(false);
  $('#lyShadows').addEventListener('change', e => setShadows(e.target.checked));
  $('#lyAgents').addEventListener('change', e => { agents.visible = e.target.checked; });
  lighting(); setInterval(lighting, 60000); setInterval(renderClock, 30000);
  $('#loading').classList.add('done'); setTimeout(() => { $('#loading').hidden = true; }, 600);
  window.COUNTRY_MAP = { data, agents, scenes, coverage, flyTo, camera, controls, night, pokeAgent, showAgent, composer, renderer, enterBuilding, exitBuilding }; // for debugging in the console
  let last = performance.now();
  renderer.setAnimationLoop(mapLoop = now => {
    if (now - last > 1000) last = now - 16; // back from inside a building: no jump
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    controls.update(); agents.update(dt, now); clock.value = now / 1000; life.update(dt, now / 1000, camera.position);
    sun.target.position.copy(controls.target); sun.position.copy(controls.target).add(sunOff);
    for (const l of liveLabels.values()) { l.pos.set(l.a.x, 14, l.a.z); if (!(l.a.liveUntil > now)) { l.el.style.display = 'none'; l.dead = true; } else l.dead = false; }
    for (const [id, l] of liveLabels) if (l.dead) { l.el.remove(); labels.splice(labels.indexOf(l), 1); liveLabels.delete(id); }
    for (const [id, l] of bubbles) { l.pos.set(l.a.x, 22 * (l.a.scale || 1), l.a.z); if (now > l.until) { l.el.remove(); labels.splice(labels.indexOf(l), 1); bubbles.delete(id); } }
    drawArcs(now); sky.position.copy(camera.position); updateMarker(now); showZoom();
    sceneTags(); placeLabels(); composer.render();
  });
}
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); });
boot();
