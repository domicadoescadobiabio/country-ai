// COUNTRY AI 3D map. All server text goes through textContent (never innerHTML with data).
import * as THREE from '../vendor/three/three.module.js';
import { MapControls } from '../vendor/three/MapControls.js';
import { generateCountry } from './gen.js';
import { buildWorld, pick, night, buildCoverage, COVERAGE } from './world.js';
import { Agents } from './agents.js';
import { Scenes, SCENE_COLOR } from './scenes.js';
import { TYPES, CATS, ACT_COLOR, REP } from './catalog.js';

const $ = s => document.querySelector(s);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'color') el.style.setProperty('--c', v); else el.setAttribute(k, v === true ? '' : v);
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
controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = 1.32; controls.minDistance = 30; controls.maxDistance = 12000; controls.screenSpacePanning = false;
const hemi = new THREE.HemisphereLight('#dbe8ff', '#6d6450', 1.1); scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff3dc', 2.2); scene.add(sun, sun.target);
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -700, right: 700, top: 700, bottom: -700, near: 10, far: 4000 }); sun.shadow.bias = -0.0004;
scene.fog = new THREE.Fog('#c9d8e8', 3000, 16000);

function setShadows(on) {
  renderer.shadowMap.enabled = on; sun.castShadow = on;
  scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
}

// sun follows the real local clock: dawn 6:00, noon overhead, night after 18:30
const sunOff = new THREE.Vector3(800, 1200, 400);
function lighting() {
  const d = new Date(); const hr = d.getHours() + d.getMinutes() / 60;
  const t = (hr - 6) / 12; const elev = Math.sin(Math.PI * Math.min(Math.max(t, 0), 1));
  const day = Math.min(1, Math.max(0, elev * 2.2 + (t > 0 && t < 1 ? 0.15 : 0)));
  const sky = new THREE.Color('#0d1424').lerp(new THREE.Color('#bcd4ec'), day);
  if (t > 0 && t < 1 && elev < 0.3) sky.lerp(new THREE.Color('#f2a97a'), (0.3 - elev) * 1.2);
  scene.background = sky; scene.fog.color.copy(sky);
  hemi.intensity = 0.6 + day * 0.6; sun.intensity = 0.15 + day * 2.2;
  night.value = Math.min(1, Math.max(0, 1 - day * 1.6));
  sun.color.set(elev < 0.3 && day > 0.1 ? '#ffc58f' : day > 0.1 ? '#fff3dc' : '#8aa2d6');
  const az = Math.PI * (t * 1.0) + 0.6;
  sunOff.set(Math.cos(az) * 1400, 300 + Math.max(elev, 0.15) * 1800, Math.sin(az) * 900);
}

// ------------------------------------------------------------ world
let data, world, agents, scenes, coverage;
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
      vis = l.kind === 'city' ? dist > 1800 : (l.kind === 'live' ? d < 2600 : l.kind === 'scene' ? d < 1300 : (l.major ? dist < 1800 && d < dist * 1.6 : d < 420));
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
  box.append(h('button', { type: 'button', text: 'Country', onclick: () => { st.city = null; cityButtons(); flyTo(0, 0, 9000, 1500); } }));
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
      const cops = (s.seats?.police || []).filter(id => b.type === 'police_hq' || citizenCity(id) === b.city);
      const chief = (s.seats?.police_chief || [])[0];
      out.push(h('h4', { text: 'Police' }), kv([...(b.type === 'police_hq' ? [['Chief of Police', chief ? nameOf(chief) : 'vacant']] : []), [b.type === 'police_hq' ? 'Officers nationwide' : 'Officers in this city', String(cops.length)], ['Arrests (all time)', String(s.police?.arrests ?? 0)]]));
      if (cops.length) out.push(h('ul', {}, cops.slice(0, 12).map(id => h('li', {}, h('b', { text: nameOf(id) }), h('span', { text: 'officer' })))));
      const cases = detected(s).filter(i => b.type === 'police_hq' || citizenCity(i.perps[0]) === b.city || citizenCity(i.solvedBy) === b.city);
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
      out.push(h('h4', { text: voting.length ? 'Voting now' : 'Elections' }), rowsList(voting.map(e => row(`${e.title} · ${e.kind}`, `${e.voted || 0} of ${e.electorate || 0} voted${e.stageEndsAt ? ` · closes ${new Date(e.stageEndsAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}`)), 'No vote open right now. On election day this hall is a polling station.'));
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
  $('#info').hidden = false;
}
function showAgent(a) {
  const body = $('#infoBody'); body.replaceChildren();
  body.append(h('span', { class: 'cat', color: a.color }, h('i'), a.seat ? roleTitle(a.seat) : a.scene ? 'At an institution' : 'Citizen'), h('h2', { text: a.name || (a.scene ? 'A sample figure' : 'A citizen') }));
  const rows = a.scene ? [['City', data.cities[a.city]?.name || a.city], ['Where', a.b?.name || ''], ['Doing', a.what || a.act]]
    : [['City', data.cities[a.city]?.name || a.city], ['Doing', a.state === 'walk' ? `walking to ${a.dest ? a.dest.name : 'home'}` : a.act], ['Home', a.address ? `${a.address} (${a.home?.name || ''})` : (a.home?.name || '')]];
  body.append(h('div', { class: 'kv' }, rows.flatMap(([k, v]) => [h('span', { text: k }), h('b', { text: v })])));
  if (a.thought) {
    body.append(h('h4', { text: `Thought · ${new Date(a.thought.ts).toLocaleTimeString('en-GB', { hour12: false })}` }), h('p', { class: 'quote', text: a.thought.note || a.thought.line || a.thought.act }));
    if (a.thought.engine) body.append(h('p', { text: `Brain: ${a.thought.engine}` }));
  }
  if (!a.name && a.scene) body.append(h('p', { text: 'A sample figure: it shows that this is happening here, not one named agent.' }));
  else if (!a.name) body.append(h('p', { text: `One of the ${REP}-to-1 sample walkers: it stands for the people of this neighbourhood, not one named agent.` }));
  $('#info').hidden = false;
}
$('#infoClose').addEventListener('click', () => { $('#info').hidden = true; st.selected = null; });

// click (not drag) picks a citizen first, then a building
const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2(); let down = null;
canvas.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', e => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  if ($('#lyAgents').checked) { const hit = ray.intersectObject(agents.mesh, false)[0]; if (hit && hit.instanceId != null) return showAgent(agents.at(hit.instanceId)); }
  const p = pick(ray, world.pickMap); if (p) showBuilding(data.buildings[p.b]);
});

// ------------------------------------------------------------ live data
function renderFeed() {
  const ol = $('#feed'); ol.replaceChildren();
  for (const e of st.feed.slice(0, 8)) ol.append(h('li', { onclick: () => { const a = agents.byId.get(e.agent); if (a) { flyTo(a.x, a.z, 320, 900); showAgent(a); } } },
    h('i', { color: ACT_COLOR[e.act] || '#94a3b8' }), h('div', {}, h('b', { text: e.name || pretty(e.agent) }), ` ${e.line || e.act}`, h('small', { text: `${data.cities[e.city]?.name || e.city} · ${e.note || ''}` }))));
}
function renderClock() {
  const s = st.state; const d = new Date();
  $('#clock').replaceChildren(h('b', { text: `DAY ${s?.day ?? '–'}` }), ` · ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · `, h('b', { text: (s?.stats?.citizens ?? 0).toLocaleString('en-US') }), ' citizens');
}
const liveLabels = new Map();
function showLive(e) {
  const a = agents.live(e, nameOf); if (!a) return;
  st.feed.unshift(e); st.feed.length = Math.min(st.feed.length, 20); renderFeed();
  if (!liveLabels.has(a.id)) { const el = h('div', { class: 'lbl live' }); $('#labels').append(el); const l = { kind: 'live', el, pos: new THREE.Vector3(), a }; labels.push(l); liveLabels.set(a.id, l); }
  liveLabels.get(a.id).el.textContent = `${a.name}: ${e.line || e.act}`;
}
function ingest(s) {
  st.state = s; agents.setWeights(s.daily?.byAct);
  agents.officials(s.seats, s.cities, nameOf, citizenCity);
  const fresh = (s.daily?.recent || []).filter(e => e.ts > st.lastTs).sort((a, b) => a.ts - b.ts);
  const first = st.lastTs === 0;
  for (const [i, e] of fresh.slice(-30).entries()) {
    setTimeout(() => showLive(e), first ? i * 120 : i * 900);
  }
  if (fresh.length) st.lastTs = fresh[fresh.length - 1].ts;
  recs.clear(); // look-ups go stale (people are released): ask again with each fresh state, every 2 minutes
  scenes.sync(s);
  renderClock();
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
    if (m.ch !== 'life' || !m.act || !m.agentId || queue.length > 40) return;
    queue.push(m);
  });
}
async function drain() {
  const m = queue.shift();
  if (m) { const city = await cityFor(m.agentId); if (city) showLive({ agent: m.agentId, name: nameOf(m.agentId), city, act: m.act, line: String(m.text || '').split('. "')[0], note: (String(m.text || '').match(/"(.+)"$/) || [])[1] || '', ts: m.ts, engine: m.engine }); }
  setTimeout(drain, queue.length > 10 ? 300 : 900);
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
  makeLabels(); cityButtons(); legend();
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
  $('#lyShadows').checked = !mobile; setShadows(!mobile);
  $('#lyShadows').addEventListener('change', e => setShadows(e.target.checked));
  $('#lyAgents').addEventListener('change', e => { agents.mesh.visible = e.target.checked; });
  lighting(); setInterval(lighting, 60000); setInterval(renderClock, 30000);
  $('#loading').classList.add('done'); setTimeout(() => { $('#loading').hidden = true; }, 600);
  window.COUNTRY_MAP = { data, agents, scenes, coverage, flyTo, camera, controls, night }; // for debugging in the console
  let last = performance.now();
  renderer.setAnimationLoop(now => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    controls.update(); agents.update(dt, now);
    sun.target.position.copy(controls.target); sun.position.copy(controls.target).add(sunOff);
    for (const l of liveLabels.values()) { l.pos.set(l.a.x, 14, l.a.z); if (!(l.a.liveUntil > now)) { l.el.style.display = 'none'; l.dead = true; } else l.dead = false; }
    for (const [id, l] of liveLabels) if (l.dead) { l.el.remove(); labels.splice(labels.indexOf(l), 1); liveLabels.delete(id); }
    sceneTags(); placeLabels(); renderer.render(scene, camera);
  });
}
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
boot();
