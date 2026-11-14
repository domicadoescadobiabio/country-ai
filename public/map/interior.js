// Building interiors: loaded on demand (dynamic import from main.js) when a visitor goes inside a building, so the
// first map load stays light. One scene per visit: a room furnished for the kind of building, the same chibi robots
// as on the map seated or standing where they belong, a name tag and an activity bubble for each, neon boards drawn
// from the place's data, and a card with a poke button. Everything is disposed on exit (geometry, materials,
// textures, render targets, listeners, DOM).
// Server text only ever reaches the page through textContent, and the 3D boards through canvas fillText.
import * as THREE from '../vendor/three/three.module.js';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { EffectComposer } from '../vendor/three/EffectComposer.js';
import { RenderPass } from '../vendor/three/RenderPass.js';
import { UnrealBloomPass } from '../vendor/three/UnrealBloomPass.js';
import { OutputPass } from '../vendor/three/OutputPass.js';
import { MOODS } from './catalog.js';
import { fmtTime } from '../clock.js'; // the republic's clock (ET)

const MAX_BOTS = 60;
const SHELLS = ['#f1f5f9', '#fce7f3', '#e0f2fe', '#ede9fe', '#dcfce7', '#fef9c3', '#ffe4e6', '#e0e7ff'];
const hashStr = s => { let x = 2166136261; for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619); return x >>> 0; };
const moodKey = m => { const l = typeof m === 'string' ? m : m?.label; return l && MOODS[l] ? l : 'calm'; };

// which room each building type gets
const ROOM = {
  parliament: 'chamber', palace: 'cabinet', vp_office: 'office', ministry: 'office', city_hall: 'office',
  const_court: 'court', court: 'court', prison: 'cells', jail: 'cells',
  academy: 'exam', police_academy: 'yard', military_academy: 'yard', army_base: 'yard', border_post: 'yard',
  police_hq: 'station', police_station: 'station', military_hq: 'command', election_comm: 'count', central_bank: 'vault',
  primary_school: 'class', middle_school: 'class', high_school: 'class', university: 'class', library: 'library',
  hospital: 'ward', clinic: 'ward', data_center: 'servers', market: 'shop', mall: 'shop', supermarket: 'shop',
  office: 'work', factory: 'work', community_hall: 'hall',
};
export const INTERIOR_TYPES = Object.keys(ROOM);
// Where a person stands follows their role from /api/place, as in a real building: guards at the entrance, the desk
// officer behind the front desk, wardens in front of the cells, bailiffs beside the bench, nurses at the station.
// Only people the server lists are drawn; an empty building says so.
const ROLE_POST = [
  [/defendant|accused|on trial/i, 'dock'], [/judge|justice/i, 'judge'], [/arrested|detainee|\bheld\b/i, 'held'],
  [/warden|jailer|turnkey|corrections|cell guard/i, 'cell'], [/bailiff|usher|court officer/i, 'bench'], [/nurse|doctor|medic/i, 'care'],
  [/vault guard/i, 'vault'], [/gate guard|sentry/i, 'gate'],
  [/desk|duty officer|reception|teller|clerk|cashier|stall|shopkeeper|librarian|registrar/i, 'desk'], [/bodyguard|escort|protection/i, 'escort'],
  [/guard|security|gate|watchman|doorman|patrol/i, 'door'],
  [/speaker|^president|vice president|^mayor|minister|commander|chief|teacher|lecturer|instructor|proctor|examiner|head\b|director|manager|commissioner/i, 'lead'],
];
const STAFF = new Set(['cell', 'bench', 'care', 'desk', 'escort', 'door', 'vault', 'gate']); // with no such post in the room: at the door
const postOf = role => { for (const [re, k] of ROLE_POST) if (re.test(String(role || ''))) return k; return null; };

// ------------------------------------------------------------ small builders
function kit(scene) {
  const own = []; // everything created here, disposed on exit
  const geo = g => (own.push(g), g); const mat = m => (own.push(m), m);
  const box = (w, hgt, d, color, x, y, z, emissive = 0) => {
    const m = new THREE.Mesh(geo(new THREE.BoxGeometry(w, hgt, d)), mat(new THREE.MeshLambertMaterial({ color, emissive: emissive ? color : '#000000', emissiveIntensity: emissive })));
    m.position.set(x, y + hgt / 2, z); scene.add(m); return m;
  };
  // a glowing strip: colour pushed above 1.0 so only it blooms
  const neon = (w, hgt, d, color, x, y, z, k = 2.4) => {
    const c = new THREE.Color(color).multiplyScalar(k);
    const m = new THREE.Mesh(geo(new THREE.BoxGeometry(w, hgt, d)), mat(new THREE.MeshBasicMaterial({ color: c, toneMapped: false })));
    m.position.set(x, y, z); scene.add(m); return m;
  };
  const cyl = (r, hgt, color, x, y, z, seg = 16) => {
    const m = new THREE.Mesh(geo(new THREE.CylinderGeometry(r, r, hgt, seg)), mat(new THREE.MeshLambertMaterial({ color })));
    m.position.set(x, y + hgt / 2, z); scene.add(m); return m;
  };
  const chair = (x, z, rot = 0, color = '#312e81') => {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; scene.add(g);
    const seat = new THREE.Mesh(geo(new THREE.BoxGeometry(4.2, 0.6, 4)), mat(new THREE.MeshLambertMaterial({ color })));
    seat.position.y = 2.4; const back = new THREE.Mesh(geo(new THREE.BoxGeometry(4.2, 4.2, 0.5)), mat(new THREE.MeshLambertMaterial({ color })));
    back.position.set(0, 4.4, -1.9); g.add(seat, back); return g;
  };
  return { own, geo, mat, box, neon, cyl, chair };
}

// a neon screen: canvas text (never HTML), redrawn when the data changes
function screen(K, scene, w, hgt, x, y, z, rotY = 0, accent = '#22d3ee') {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = Math.round(1024 * hgt / w);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; K.own.push(tex);
  const m = new THREE.Mesh(K.geo(new THREE.PlaneGeometry(w, hgt)), K.mat(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })));
  m.position.set(x, y, z); m.rotation.y = rotY; scene.add(m);
  const frame = new THREE.Mesh(K.geo(new THREE.PlaneGeometry(w + 1.2, hgt + 1.2)), K.mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(accent).multiplyScalar(2.2), toneMapped: false })));
  frame.position.set(0, 0, -0.05); m.add(frame);
  const draw = (title, lines = [], bars = null) => {
    const c = cv.getContext('2d'); const W = cv.width, H = cv.height;
    c.fillStyle = '#070418'; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(167,139,250,.25)'; for (let yy = 0; yy < H; yy += 6) { c.beginPath(); c.moveTo(0, yy); c.lineTo(W, yy); c.stroke(); }
    c.fillStyle = accent; c.font = `800 ${Math.round(H * 0.12)}px Inter, system-ui, sans-serif`; c.textBaseline = 'top';
    fitText(c, String(title || ''), 36, 28, W - 72);
    c.fillStyle = '#e0e7ff'; c.font = `600 ${Math.round(H * 0.075)}px "JetBrains Mono", ui-monospace, monospace`;
    let yy = 28 + H * 0.17;
    for (const l of lines.slice(0, 8)) { fitText(c, String(l ?? ''), 36, yy, W - 72); yy += H * 0.1; }
    if (bars) { // [ [label, value, colour], ... ] as a horizontal stacked bar along the bottom
      const total = bars.reduce((t, b) => t + Math.max(0, Number(b[1]) || 0), 0) || 1; let bx = 36; const by = H - H * 0.16, bw = W - 72, bh = H * 0.09;
      for (const [label, val, colr] of bars) { const ww = bw * Math.max(0, Number(val) || 0) / total; c.fillStyle = colr; c.fillRect(bx, by, ww, bh); if (ww > 120) { c.fillStyle = '#070418'; c.font = `800 ${Math.round(bh * 0.6)}px Inter, sans-serif`; c.fillText(`${label} ${val}`, bx + 10, by + bh * 0.2); } bx += ww; }
    }
    tex.needsUpdate = true;
  };
  return { mesh: m, draw };
}
function fitText(c, s, x, y, max) {
  let t = s; while (t.length > 3 && c.measureText(t).width > max) t = t.slice(0, -2);
  c.fillText(t === s ? t : t.replace(/.$/, '…'), x, y);
}

// ------------------------------------------------------------ rooms: furniture + where people go
// Each returns { slots: [{x,z,rot,sit}], screens: {...}, cam: [x,y,z], look: [x,y,z] }
const ROOMS = {
  chamber(K, s) { // Council: a half circle of 31 seats facing the Speaker's podium and the vote board
    floor(K, s, 150, 110, '#120a2e'); walls(K, s, 150, 110, '#1b1145');
    const slots = []; const rows = [10, 10, 11]; let k = 0;
    rows.forEach((n, r) => { const R = 34 + r * 12; for (let i = 0; i < n; i++) { const a = Math.PI * (0.12 + 0.76 * (i / (n - 1))); const x = Math.cos(a) * R, z = Math.sin(a) * R * 0.85 + 6; const face = Math.atan2(-x, -19 - z); // towards the Speaker
      K.box(5, 1 + r * 1.2, 5, '#2a1d63', x, 0, z); const ch = K.chair(x, z, face, '#4c1d95'); ch.position.y = 1 + r * 1.2; slots.push({ x, z, y: 1 + r * 1.2, rot: face, sit: true }); k++; } });
    K.box(16, 5, 7, '#3b2a7a', 0, 0, -16); K.neon(16.4, 0.4, 0.4, '#f472b6', 0, 5, -12.4);
    const speaker = { x: 0, z: -19, rot: 0, sit: false, y: 5 }; // the podium
    const board = screen(K, s, 60, 26, 0, 30, -50, 0, '#f472b6');
    return { slots, posts: { lead: [speaker], bench: [{ x: -14, z: -16, rot: 0 }, { x: 14, z: -16, rot: 0 }] }, screens: { main: board }, cam: [0, 70, 105], look: [0, 6, 0] };
  },
  cabinet(K, s) { // Palace: the President's desk and the Cabinet room with a long table of 10 chairs
    floor(K, s, 140, 90, '#140b2c'); walls(K, s, 140, 90, '#1d1240');
    K.box(18, 4, 8, '#7c5a1e', -40, 0, -22); K.neon(18.2, 0.3, 0.3, '#fde047', -40, 4.2, -18);
    K.box(70, 3.4, 12, '#3b2a7a', 15, 0, 6); K.neon(70, 0.3, 0.3, '#22d3ee', 15, 3.6, 12.2); K.neon(70, 0.3, 0.3, '#22d3ee', 15, 3.6, -0.2);
    const slots = [];
    for (let i = 0; i < 5; i++) for (const side of [-1, 1]) { const x = -10 + i * 13, z = 6 + side * 10; K.chair(x, z, side > 0 ? Math.PI : 0); slots.push({ x, z, rot: side > 0 ? Math.PI : 0, sit: true }); }
    for (let i = 0; i < 12; i++) slots.push({ x: -55 + (i % 6) * 7, z: 30 + Math.floor(i / 6) * 8, rot: Math.PI, sit: false });
    return { slots, posts: { lead: [{ x: -40, z: -28, rot: 0, sit: true }], escort: [{ x: -54, z: -24, rot: 0 }, { x: -26, z: -24, rot: 0 }, { x: -54, z: -12, rot: 0 }, { x: -26, z: -12, rot: 0 }] },
      screens: { main: screen(K, s, 46, 20, 15, 22, -40, 0, '#fde047') }, cam: [10, 62, 92], look: [0, 4, 0] };
  },
  office(K, s) { // a minister's / mayor's / VP's office: the big desk, staff desks behind
    floor(K, s, 110, 80, '#120a2e'); walls(K, s, 110, 80, '#1b1145');
    K.box(20, 4, 9, '#5b3a8c', 0, 0, -18); K.neon(20.2, 0.3, 0.3, '#e879f9', 0, 4.2, -13.4);
    const slots = [];
    for (let i = 0; i < 12; i++) { const x = -36 + (i % 6) * 14.5, z = 10 + Math.floor(i / 6) * 16; K.box(9, 3.2, 5, '#2a1d63', x, 0, z); K.neon(9, 0.25, 0.25, '#22d3ee', x, 3.3, z + 2.6, 1.8); slots.push({ x, z: z + 5.5, rot: Math.PI, sit: true }); }
    for (let i = 0; i < 20; i++) slots.push({ x: -46 + (i % 10) * 10, z: 34, rot: Math.PI, sit: false });
    K.box(14, 3.4, 5, '#3b2a7a', 36, 0, 26); // the reception desk by the door
    return { slots, posts: { lead: [{ x: 0, z: -24, rot: 0, sit: true }], escort: [{ x: -14, z: -22, rot: 0 }, { x: 14, z: 22, rot: 0 }], desk: [{ x: 36, z: 22, rot: 0, sit: true }, { x: 42, z: 22, rot: 0, sit: true }] },
      screens: { main: screen(K, s, 40, 17, 0, 20, -38, 0, '#e879f9') }, cam: [0, 52, 78], look: [0, 4, -2] };
  },
  court(K, s) { // the judges' high bench, the dock, the gallery
    floor(K, s, 120, 100, '#140b2c'); walls(K, s, 120, 100, '#1b1145');
    K.box(48, 9, 9, '#5a3d1a', 0, 0, -30); K.neon(48.4, 0.4, 0.4, '#fbbf24', 0, 9.2, -25.4);
    const judge = []; for (let i = 0; i < 5; i++) judge.push({ x: -16 + i * 8, z: -33, rot: 0, sit: true, y: 4 });
    K.box(10, 4, 6, '#3b2a7a', 0, 0, 0); K.neon(10.2, 0.3, 0.3, '#f43f5e', 0, 4.1, 3.1);
    const dock = []; for (let i = 0; i < 6; i++) dock.push({ x: -8 + (i % 3) * 8, z: 6 + Math.floor(i / 3) * 6, rot: Math.PI, sit: false });
    K.box(10, 3, 5, '#2a1d63', 32, 0, -14); // the clerk's desk
    const slots = []; for (let r = 0; r < 3; r++) { K.box(90, 1.6, 4, '#2a1d63', 0, 0, 24 + r * 9); for (let i = 0; i < 12; i++) slots.push({ x: -40 + i * 7.3, z: 27 + r * 9, rot: Math.PI, sit: true }); }
    return { slots, posts: { judge, dock, bench: [{ x: -30, z: -26, rot: 0 }, { x: 30, z: -26, rot: 0 }, { x: 14, z: 4, rot: -Math.PI / 2 }], desk: [{ x: 32, z: -10, rot: 0, sit: true }] },
      screens: { main: screen(K, s, 42, 18, 0, 26, -48, 0, '#fbbf24') }, cam: [0, 58, 95], look: [0, 6, -6] };
  },
  cells(K, s) { // a cell block: bars, a bunk each, a board with the days left
    floor(K, s, 130, 90, '#0e0a1f'); walls(K, s, 130, 90, '#171233');
    const slots = []; const N = 12;
    for (let i = 0; i < N; i++) {
      const side = i < N / 2 ? -1 : 1, k = i % (N / 2); const x = -45 + k * 18, z = side * 26;
      K.box(14, 0.4, 14, '#1f1747', x, 0, z); K.box(8, 2, 4, '#3f3a63', x, 0, z + side * 4);
      for (let b = 0; b < 7; b++) K.neon(0.3, 12, 0.3, '#f97316', x - 6 + b * 2, 6, z - side * 7, 1.6);
      slots.push({ x, z: z + side * 1, rot: side > 0 ? Math.PI : 0, sit: false });
    }
    for (let i = 0; i < 48; i++) slots.push({ x: -50 + (i % 16) * 6.7, z: (Math.floor(i / 16) - 1) * 5, rot: Math.PI / 2, sit: false }); // the yard corridor
    K.box(16, 3.6, 5, '#3f2d1a', 0, 0, 36); // the warden's desk at the door
    const cell = []; for (let k = 0; k < 3; k++) { cell.push({ x: -45 + k * 36, z: -12, rot: Math.PI }); cell.push({ x: -27 + k * 36, z: 12, rot: 0 }); }
    return { slots, posts: { cell, desk: [{ x: -3, z: 32, rot: 0, sit: true }, { x: 3, z: 32, rot: 0, sit: true }] }, screens: { main: screen(K, s, 40, 17, 0, 20, -44, 0, '#f97316') }, cam: [0, 66, 80], look: [0, 0, 0] };
  },
  exam(K, s) { // the Academy exam hall: one desk per candidate, a screen with question n
    floor(K, s, 120, 100, '#120a2e'); walls(K, s, 120, 100, '#1b1145');
    const slots = []; for (let i = 0; i < 24; i++) { const x = -35 + (i % 6) * 14, z = -10 + Math.floor(i / 6) * 13; K.box(7, 3, 4.5, '#2a1d63', x, 0, z); K.neon(7, 0.2, 0.2, '#c084fc', x, 3.1, z - 2.3, 1.6); slots.push({ x, z: z + 4.5, rot: Math.PI, sit: true }); }
    for (let i = 0; i < 36; i++) slots.push({ x: -50 + (i % 12) * 9, z: 46 + Math.floor(i / 12) * 6, rot: Math.PI, sit: false });
    return { slots, posts: { lead: [{ x: -34, z: -34, rot: 0 }, { x: 34, z: -34, rot: 0 }] }, screens: { main: screen(K, s, 52, 22, 0, 24, -44, 0, '#c084fc') }, cam: [0, 60, 96], look: [0, 3, 0] };
  },
  yard(K, s) { // a training ground: a running track, obstacles, a flag, the screen on the drill hall
    floor(K, s, 170, 130, '#151a14', false);
    const track = K.mat(new THREE.MeshBasicMaterial({ color: new THREE.Color('#22d3ee').multiplyScalar(1.6), toneMapped: false }));
    const ring = new THREE.Mesh(K.geo(new THREE.RingGeometry(44, 46, 64)), track); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; ring.scale.set(1.5, 1, 1); s.add(ring);
    for (let i = 0; i < 5; i++) { K.box(1, 4, 12, '#475569', -30 + i * 15, 0, 0); K.neon(1.2, 0.3, 12, '#facc15', -30 + i * 15, 4.1, 0, 1.8); }
    K.cyl(0.4, 26, '#e5e7eb', 0, 0, -40); K.neon(8, 5, 0.2, '#ef4444', 4, 23, -40, 1.6);
    const slots = []; for (let i = 0; i < 60; i++) { const a = (i / 60) * Math.PI * 2; slots.push({ x: Math.cos(a) * 67, z: Math.sin(a) * 45, rot: -a, sit: false, run: true }); }
    K.box(3, 6, 3, '#475569', -14, 0, 60); K.box(3, 6, 3, '#475569', 14, 0, 60); K.neon(28, 0.6, 0.6, '#facc15', 0, 6, 60, 1.6); // the gate
    return { slots, posts: { lead: [{ x: 0, z: -8, rot: 0 }], gate: [{ x: -10, z: 57, rot: 0 }, { x: 10, z: 57, rot: 0 }, { x: -20, z: 57, rot: 0 }, { x: 20, z: 57, rot: 0 }] },
      screens: { main: screen(K, s, 44, 18, 0, 20, -62, 0, '#65a30d') }, cam: [0, 88, 118], look: [0, 0, 0] };
  },
  station(K, s) { // police station: the front desk, officers, the holding cells
    floor(K, s, 120, 90, '#0e1027'); walls(K, s, 120, 90, '#151b3d');
    K.box(36, 4, 6, '#1e3a8a', 0, 0, -6); K.neon(36.2, 0.3, 0.3, '#3b82f6', 0, 4.2, -2.8);
    const desk = []; for (let i = 0; i < 6; i++) desk.push({ x: -15 + i * 6, z: -11, rot: 0, sit: true });
    const held = []; for (let i = 0; i < 4; i++) { const x = -42 + i * 12; for (let b = 0; b < 5; b++) K.neon(0.3, 11, 0.3, '#60a5fa', x - 4 + b * 2, 5.5, -26, 1.4); held.push({ x, z: -32, rot: 0, sit: false }); }
    const slots = []; for (let i = 0; i < 50; i++) slots.push({ x: -45 + (i % 10) * 10, z: 12 + Math.floor(i / 10) * 7, rot: Math.PI, sit: false });
    return { slots, posts: { desk, held, cell: [{ x: -30, z: -20, rot: Math.PI }, { x: -6, z: -20, rot: Math.PI }], lead: [{ x: 30, z: -24, rot: 0 }] },
      screens: { main: screen(K, s, 36, 15, 28, 20, -42, 0, '#3b82f6') }, cam: [0, 56, 82], look: [0, 3, -6] };
  },
  command(K, s) { // the military command room: the map table, screens, officers around
    floor(K, s, 120, 90, '#0f150e'); walls(K, s, 120, 90, '#18200f');
    K.box(40, 4, 22, '#1f2d1a', 0, 0, 0); K.neon(38, 0.2, 20, '#65a30d', 0, 4.15, 0, 1.4);
    const slots = []; for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; slots.push({ x: Math.cos(a) * 28, z: Math.sin(a) * 18, rot: -a - Math.PI / 2, sit: false }); }
    for (let i = 0; i < 46; i++) slots.push({ x: -50 + (i % 12) * 9, z: 32 + Math.floor(i / 12) * 6, rot: Math.PI, sit: false });
    return { slots, posts: { lead: [{ x: 0, z: -16, rot: 0 }] }, screens: { main: screen(K, s, 50, 20, 0, 22, -42, 0, '#65a30d') }, cam: [0, 60, 86], look: [0, 3, 0] };
  },
  count(K, s) { // Election Commission: counting tables and the turnout board
    floor(K, s, 120, 90, '#0b1328'); walls(K, s, 120, 90, '#10203e');
    const slots = []; for (let t = 0; t < 4; t++) { const x = -36 + t * 24; K.box(16, 3.4, 7, '#0c4a6e', x, 0, 0); for (let b = 0; b < 3; b++) K.box(2, 2, 2, '#e0f2fe', x - 5 + b * 5, 3.4, 0); for (const sd of [-1, 1]) for (let i = 0; i < 2; i++) slots.push({ x: x - 4 + i * 8, z: sd * 6.5, rot: sd > 0 ? Math.PI : 0, sit: true }); }
    for (let i = 0; i < 44; i++) slots.push({ x: -50 + (i % 11) * 10, z: 26 + Math.floor(i / 11) * 6, rot: Math.PI, sit: false });
    return { slots, posts: { lead: [{ x: 0, z: -24, rot: 0 }] }, screens: { main: screen(K, s, 50, 21, 0, 22, -40, 0, '#38bdf8') }, cam: [0, 56, 84], look: [0, 3, 0] };
  },
  vault(K, s) { // the Central Bank: the vault door, the tellers, the screen with the treasury
    floor(K, s, 110, 90, '#14100a'); walls(K, s, 110, 90, '#211a0e');
    const door = K.cyl(14, 2, '#a16207', 0, 0, -42); door.rotation.x = Math.PI / 2; door.position.set(-28, 16, -43);
    K.neon(0.6, 28, 0.6, '#fbbf24', -28, 16, -41.8);
    const desk = []; for (let i = 0; i < 6; i++) { const x = -10 + i * 9; K.box(7, 3.6, 4, '#3f2d0e', x, 0, 0); desk.push({ x, z: -4.5, rot: 0, sit: true }); }
    const slots = []; for (let i = 0; i < 40; i++) slots.push({ x: -45 + (i % 10) * 10, z: 16 + Math.floor(i / 10) * 7, rot: Math.PI, sit: false });
    // guards: two at the vault door, two at the entrance
    return { slots, posts: { desk, vault: [{ x: -40, z: -34, rot: 0 }, { x: -16, z: -34, rot: 0 }], door: [{ x: -12, z: 38, rot: 0 }, { x: 12, z: 38, rot: 0 }] },
      screens: { main: screen(K, s, 40, 18, 22, 21, -43, 0, '#fbbf24') }, cam: [0, 54, 80], look: [0, 4, -8] };
  },
  class(K, s) { // a classroom: the blackboard with the subject, rows of desks
    floor(K, s, 110, 90, '#120a2e'); walls(K, s, 110, 90, '#1b1145');
    const slots = [];
    for (let i = 0; i < 30; i++) { const x = -35 + (i % 6) * 14, z = -12 + Math.floor(i / 6) * 11; K.box(8, 3, 4, '#2a1d63', x, 0, z); slots.push({ x, z: z + 4, rot: Math.PI, sit: true }); }
    for (let i = 0; i < 29; i++) slots.push({ x: -45 + (i % 10) * 10, z: 46 + Math.floor(i / 10) * 5, rot: Math.PI, sit: false });
    return { slots, posts: { lead: [{ x: 0, z: -30, rot: 0 }, { x: -20, z: -30, rot: 0 }] }, screens: { main: screen(K, s, 50, 20, 0, 18, -41, 0, '#4ade80') }, cam: [0, 54, 86], look: [0, 3, 0] };
  },
  library(K, s) { // shelves, reading tables
    floor(K, s, 120, 90, '#140b2c'); walls(K, s, 120, 90, '#1d1240');
    for (let i = 0; i < 6; i++) { K.box(4, 16, 30, '#3b2a1a', -50 + i * 4.5 * 4, 0, -25); K.neon(4.2, 0.3, 30, '#fbbf24', -50 + i * 18, 16.2, -25, 1.4); }
    const slots = []; for (let t = 0; t < 6; t++) { const x = -40 + (t % 3) * 30, z = 6 + Math.floor(t / 3) * 18; K.box(16, 3, 7, '#2a1d63', x, 0, z); for (const sd of [-1, 1]) for (let i = 0; i < 3; i++) slots.push({ x: x - 5 + i * 5, z: z + sd * 6, rot: sd > 0 ? Math.PI : 0, sit: true }); }
    for (let i = 0; i < 24; i++) slots.push({ x: -45 + (i % 12) * 8, z: 40, rot: Math.PI, sit: false });
    K.box(14, 3.4, 5, '#3b2a1a', 44, 0, 4); // the lending desk
    return { slots, posts: { desk: [{ x: 41, z: 0, rot: 0, sit: true }, { x: 47, z: 0, rot: 0, sit: true }] }, screens: { main: screen(K, s, 40, 16, 30, 20, -42, 0, '#fbbf24') }, cam: [0, 56, 86], look: [0, 3, 0] };
  },
  ward(K, s) { // hospital/clinic: beds and a nurses' station
    floor(K, s, 120, 90, '#0b1420'); walls(K, s, 120, 90, '#10202e');
    const slots = []; for (let i = 0; i < 12; i++) { const x = -45 + (i % 6) * 18, z = i < 6 ? -24 : 24; K.box(8, 2.6, 14, '#e2e8f0', x, 0, z); K.neon(8, 0.3, 0.3, '#4ade80', x, 2.8, z + (z < 0 ? 7 : -7), 1.4); slots.push({ x, z: z + (z < 0 ? 9 : -9), rot: z < 0 ? Math.PI : 0, sit: false }); }
    K.box(24, 4, 6, '#14532d', 0, 0, 0); for (let i = 0; i < 48; i++) slots.push({ x: -40 + (i % 12) * 7, z: (Math.floor(i / 12) - 1.5) * 4 + (i % 12 > 3 && i % 12 < 8 ? 9 : 0), rot: 0, sit: false });
    const care = [{ x: -6, z: -5, rot: 0 }, { x: 6, z: -5, rot: 0 }, { x: -6, z: 5, rot: Math.PI }, { x: 6, z: 5, rot: Math.PI }]; // the nurses' station
    return { slots, posts: { care, desk: [{ x: 0, z: 36, rot: 0, sit: false }] }, screens: { main: screen(K, s, 36, 15, 0, 20, -42, 0, '#4ade80') }, cam: [0, 56, 84], look: [0, 2, 0] };
  },
  servers(K, s) { // the data centre: rows of racks with blinking lights, the big Qwen screen
    floor(K, s, 130, 100, '#05060f'); walls(K, s, 130, 100, '#0b0e22');
    const slots = []; const blink = [];
    for (let r = 0; r < 4; r++) for (let i = 0; i < 6; i++) {
      const x = -45 + i * 18, z = -20 + r * 16; K.box(10, 18, 5, '#111827', x, 0, z);
      for (let l = 0; l < 6; l++) blink.push(K.neon(8, 0.35, 0.2, l % 2 ? '#22d3ee' : '#4ade80', x, 2 + l * 2.8, z + 2.65, 1.8));
      slots.push({ x: x + 6, z: z + 5, rot: Math.PI, sit: false });
    }
    for (let i = 0; i < 36; i++) slots.push({ x: -50 + (i % 12) * 9, z: 48 + Math.floor(i / 12) * 5, rot: Math.PI, sit: false });
    return { slots, blink, screens: { main: screen(K, s, 58, 24, 0, 30, -46, 0, '#22d3ee') }, cam: [0, 60, 100], look: [0, 6, 0] };
  },
  shop(K, s) { // market/mall: stalls with neon awnings and shoppers in the aisles
    floor(K, s, 130, 100, '#140b2c'); walls(K, s, 130, 100, '#1d1240');
    const cols = ['#f472b6', '#22d3ee', '#fde047', '#4ade80', '#e879f9', '#fb923c'];
    const desk = []; for (let i = 0; i < 12; i++) { const x = -50 + (i % 6) * 20, z = i < 6 ? -26 : 8; K.box(12, 3.6, 7, '#2a1d63', x, 0, z); K.neon(13, 0.5, 8, cols[i % 6], x, 7.5, z, 1.6); desk.push({ x, z: z - 5.5, rot: 0, sit: false }); }
    const slots = []; for (let i = 0; i < 48; i++) slots.push({ x: -55 + (i % 12) * 10, z: (Math.floor(i / 12) % 2 ? 26 : -9) + Math.floor(i / 24) * 6, rot: (i % 4) * Math.PI / 2, sit: false });
    return { slots, posts: { desk }, screens: { main: screen(K, s, 40, 16, 0, 22, -46, 0, '#f472b6') }, cam: [0, 60, 96], look: [0, 3, 0] };
  },
  work(K, s) { // offices/factory: desks or machines in rows
    floor(K, s, 120, 90, '#10122a'); walls(K, s, 120, 90, '#181b3f');
    const slots = []; for (let i = 0; i < 24; i++) { const x = -40 + (i % 6) * 16, z = -24 + Math.floor(i / 6) * 14; K.box(9, 3.4, 5, '#334155', x, 0, z); K.neon(9, 0.2, 0.2, '#60a5fa', x, 3.5, z - 2.5, 1.5); slots.push({ x, z: z + 5, rot: Math.PI, sit: true }); }
    for (let i = 0; i < 36; i++) slots.push({ x: -50 + (i % 12) * 9, z: 40 + Math.floor(i / 12) * 5, rot: Math.PI, sit: false });
    return { slots, posts: { lead: [{ x: 0, z: -36, rot: 0 }] }, screens: { main: screen(K, s, 40, 16, 0, 20, -42, 0, '#60a5fa') }, cam: [0, 56, 86], look: [0, 3, 0] };
  },
  hall(K, s) { // community hall: a stage and rows of chairs
    floor(K, s, 120, 90, '#140b2c'); walls(K, s, 120, 90, '#1d1240');
    K.box(40, 3, 14, '#3b2a7a', 0, 0, -30); K.neon(40.2, 0.3, 0.3, '#fde047', 0, 3.1, -23);
    const slots = [];
    for (let i = 0; i < 40; i++) { const x = -36 + (i % 10) * 8, z = -6 + Math.floor(i / 10) * 9; K.chair(x, z, Math.PI); slots.push({ x, z, rot: Math.PI, sit: true }); }
    for (let i = 0; i < 19; i++) slots.push({ x: -45 + (i % 10) * 10, z: 36 + Math.floor(i / 10) * 6, rot: Math.PI, sit: false });
    return { slots, posts: { lead: [{ x: 0, z: -30, rot: 0, sit: false, y: 3 }] }, screens: { main: screen(K, s, 40, 16, 0, 22, -44, 0, '#fde047') }, cam: [0, 56, 86], look: [0, 3, 0] };
  },
};
function floor(K, s, w, d, color, grid = true) {
  K.dims = { w, d }; // the entrance is at the +z wall (the side the camera looks in from)
  const f = new THREE.Mesh(K.geo(new THREE.PlaneGeometry(w, d)), K.mat(new THREE.MeshLambertMaterial({ color }))); f.rotation.x = -Math.PI / 2; s.add(f);
  if (grid) { const g = new THREE.GridHelper(Math.max(w, d), 24, '#4c1d95', '#2e1065'); g.position.y = 0.04; g.material.transparent = true; g.material.opacity = 0.4; K.own.push(g.geometry, g.material); s.add(g); }
}
function walls(K, s, w, d, color) {
  const hgt = 34;
  K.box(w, hgt, 1, color, 0, 0, -d / 2); K.box(1, hgt, d, color, -w / 2, 0, 0); K.box(1, hgt, d, color, w / 2, 0, 0);
  K.neon(w, 0.5, 0.5, '#a78bfa', 0, hgt, -d / 2 + 0.6, 1.8); K.neon(0.5, 0.5, d, '#22d3ee', -w / 2 + 0.6, hgt, 0, 1.6); K.neon(0.5, 0.5, d, '#f472b6', w / 2 - 0.6, hgt, 0, 1.6);
  K.neon(w, 0.3, 0.3, '#22d3ee', 0, 0.2, -d / 2 + 0.7, 1.6);
}

// ------------------------------------------------------------ what each screen says (from the place's board)
const n0 = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const fmt = v => (typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : v == null ? '-' : typeof v === 'object' ? (Array.isArray(v) ? `${v.length} item(s)` : Object.entries(v).slice(0, 3).map(([k, x]) => `${k} ${typeof x === 'object' ? '…' : x}`).join(' · ')) : String(v));
const label = k => String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
// one line for an item of a list: its most telling text
const itemLine = x => (x && typeof x === 'object' ? [x.day != null ? `day ${x.day}` : null, x.id != null ? `#${x.id}` : null, x.title || x.text || x.claim || x.outcome || x.act || [x.office, x.kind, x.stage].filter(Boolean).join(' ') || null].filter(Boolean).join(' · ') : fmt(x));
function genericLines(board) {
  const out = [];
  for (const [k, v] of Object.entries(board || {})) {
    if (k === 'note' || k === 'onDuty' || v == null) continue; // the shift is shown in the header chip
    if (Array.isArray(v)) { out.push(`${label(k)} (${v.length})`); for (const x of v.slice(-2)) out.push(`  ${itemLine(x)}`); }
    else out.push(`${label(k)}: ${typeof v === 'object' ? itemLine(v) : fmt(v)}`);
  }
  return out;
}
const pctv = x => (x == null ? '-' : `${Math.round(Number(x) * (Number(x) <= 1 ? 100 : 1))}%`);
function drawScreens(room, type, place) {
  const b = place.board || {}; const main = room.screens.main; if (!main) return;
  const title = place.title || type; const occ = place.occupants || [];
  switch (type) {
    case 'parliament': {
      const bill = b.bill;
      if (bill) return main.draw(`Bill #${bill.id ?? ''} · ${bill.title || ''}`, [`stage: ${bill.stage || '-'}${bill.sponsor ? ` · by ${bill.sponsor}` : ''}`, bill.sponsorSays ? `"${bill.sponsorSays}"` : '', `spoke ${fmt(bill.spoke)} · seats ${fmt(b.seats)}`].filter(Boolean),
        [['YES', n0(bill.yes), '#4ade80'], ['NO', n0(bill.no), '#f43f5e'], ['NOT VOTED', Math.max(0, n0(b.seats) - n0(bill.yes) - n0(bill.no)), '#475569']]);
      return main.draw('No bill on the floor', [`councillors seated: ${fmt(b.seats)}`, ...(b.waiting || []).slice(-2).map(x => `waiting: ${itemLine(x)}`), ...(b.laws || []).slice(-2).map(x => `law: ${itemLine(x)}`)]);
    }
    case 'palace': case 'vp_office': return main.draw(title, [b.orderToday ? 'An order was issued today' : 'No order yet today', ...(b.lastOrders || []).slice(-3).reverse().map(itemLine), ...(b.plans || []).slice(0, 2).map(p => `plan (${p.by}): ${p.text}`)]);
    case 'ministry': return main.draw(title, (b.acts || []).slice(0, 6).map(a => `${a.minister}: ${a.act}`));
    case 'const_court': case 'court': return main.draw(`${title} · ${(b.open || []).length} open case(s)`, [...(b.open || []).slice(-3).map(x => `#${x.id} ${x.kind}: ${x.claim}`), b.lastRuling ? `last ruling #${b.lastRuling.id}: ${b.lastRuling.ruling}` : '']);
    case 'prison': case 'jail': return main.draw(`${title} · ${fmt(b.held)} held`, [...occ.slice(0, 5).map(o => `${o.name}: ${o.activity}`), `at most ${fmt(type === 'prison' ? b.maxJailDays : b.maxDetentionDays)} days`]);
    case 'academy': case 'police_academy': case 'military_academy': {
      const now = occ.find(o => /question/.test(o.detail || ''));
      return main.draw(now ? `${now.detail.split(',')[0].toUpperCase()}` : title, [now ? `${now.name}: ${now.activity}` : 'No exam right now', `rooms in use ${fmt(b.rooms)} · sworn in ${fmt(b.graduates)} · failed ${fmt(b.failures)}`, b.ruleQuestions ? `rule questions right ${fmt(b.ruleQuestions.right)}/${fmt(b.ruleQuestions.asked)}` : '', `drills ${fmt(b.drills)}`].filter(Boolean));
    }
    case 'police_hq': case 'police_station': return main.draw(title, [`arrests ${fmt(b.arrests)} · on trial ${fmt(b.onTrial)} · budget ${fmt(b.budget)} CAI`, `open cases (${(b.openCases || []).length})`, ...(b.openCases || []).slice(-4).map(i => `  #${i.id} ${i.type} · day ${i.day}`)]);
    case 'military_hq': case 'army_base': case 'border_post': return main.draw(`${title} · level ${fmt(b.level)}${b.alert ? ' · ALERT' : ''}`, [`blocked ${fmt(b.blocked)} · admitted ${fmt(b.admitted)} · raids ${fmt(b.raids)}`, ...(b.recent || []).slice(-4).map(l => `${l.kind}: ${l.verdict}${l.rule ? ` (${l.rule})` : ''}${l.by ? ` · ${l.by}` : ''}`)]);
    case 'election_comm': {
      const v = (b.running || []).find(e => e.stage === 'voting');
      if (v) return main.draw(`${v.office}${v.city ? ` · ${v.city}` : ''} · turnout ${pctv(v.turnout)}`, [`${fmt(v.candidates)} candidates · ${v.kind}`, ...(b.last || []).slice(0, 2).map(e => `${e.office}: ${e.outcome}`)], [['VOTED', Math.round(n0(v.turnout) * 100), '#38bdf8'], ['NOT YET', 100 - Math.round(n0(v.turnout) * 100), '#334155']]);
      return main.draw(title, [`${(b.running || []).length} election(s) running`, ...(b.running || []).slice(0, 3).map(e => `${e.office}: ${e.stage}`), ...(b.last || []).slice(0, 2).map(e => `${e.office}: ${e.outcome}`)]);
    }
    case 'central_bank': return main.draw(`Treasury ${fmt(b.treasury)} CAI`, [`runway ${b.runwayDays == null ? '-' : `${fmt(b.runwayDays)} days`}`, `tax ${pctv(b.taxRate)} · UBI ${fmt(b.ubi)} CAI`, `per day: tax +${fmt(b.taxPerDay)} · UBI -${fmt(b.ubiPerDay)} · net ${fmt(b.netPerDay)}`, `UBI paid ${fmt(b.ubiPaid)} · tax collected ${fmt(b.taxCollected)}`]);
    case 'city_hall': return main.draw(title, [`budget ${fmt(b.budget)} CAI · spent ${fmt(b.spent)}`, `city health ${fmt(b.health)}/100`, b.lastOutcome ? `last: ${b.lastOutcome}` : ''].filter(Boolean));
    case 'data_center': return main.draw(`${b.model ? String(b.model).replace(/^.*\//, '') : 'Qwen'} · ${b.answeredPerMin == null ? '…' : fmt(b.answeredPerMin)} answers/min`, [`brain ${b.online ? 'ONLINE' : 'offline'} · queue ${fmt(b.queued)} · training queue ${fmt(b.queuedTrain)}`, `answered ${fmt(b.answered)} · lessons/min ${fmt(b.lessonsPerMin)} · today ${fmt(b.lessonsToday)}`]);
    case 'primary_school': case 'middle_school': case 'high_school': case 'university': case 'library':
      if (b.subject) return main.draw(String(b.subject), genericLines(b).filter(l => !l.startsWith('subject')));
  }
  if (b.note && Object.keys(b).length === 1) return main.draw(title, [String(b.note)]);
  main.draw(title, genericLines(b));
}

// ------------------------------------------------------------ the robots
function robots(K, scene, max) {
  const part = (g, m) => { const x = new THREE.InstancedMesh(K.geo(g), K.mat(m), max); x.count = 0; x.frustumCulled = false; scene.add(x); return x; };
  const body = part(new THREE.CapsuleGeometry(1.45, 1.3, 4, 10).translate(0, 2.25, 0), new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#241a52' }));
  const head = part(new THREE.SphereGeometry(2.35, 16, 12).scale(1.08, 0.94, 1).translate(0, 6.2, 0), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  const visor = part(new THREE.CapsuleGeometry(0.62, 2.2, 3, 8).rotateZ(Math.PI / 2).scale(1, 1, 0.55).translate(0, 6.35, 2.05), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }));
  const tip = part(new THREE.SphereGeometry(0.62, 10, 8).translate(0, 9.6, 0), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }));
  return { parts: [body, head, visor, tip], body, head, visor, tip, pick: [body, head, visor] };
}
const ROLE_COLOR = r => { const s = String(r || '').toLowerCase(); return /vault guard/.test(s) ? '#ca8a04' : /warden|cell guard|jailer/.test(s) ? '#ea580c' : /bailiff/.test(s) ? '#b45309' : /bodyguard/.test(s) ? '#334155' :
    /night guard|gate guard|\bguard\b|security|sentry/.test(s) ? '#0e7490' : /desk officer|duty officer/.test(s) ? '#1d4ed8' : /clerk|teller/.test(s) ? '#0d9488' : /nurse|doctor/.test(s) ? '#16a34a' :
    /speaker|president|chief|judge|mayor|minister/.test(s) ? '#facc15' : /police|officer/.test(s) ? '#3b82f6' : /soldier|military/.test(s) ? '#65a30d' : /inmate|prisoner|held|defendant|suspect/.test(s) ? '#f97316' : /candidate|student|cadet/.test(s) ? '#c084fc' : /council/.test(s) ? '#fbbf24' : '#a5b4fc'; };

// ------------------------------------------------------------ enter
// opts: { renderer, type, place (first view), mobile, onExit, refresh: () => Promise<place>, poke: (id) => Promise<text>, h }
export function enter(opts) {
  const { renderer, type, mobile, h } = opts;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#05030f'); scene.fog = new THREE.FogExp2('#0b0620', 0.004);
  const K = kit(scene);
  const hemi = new THREE.HemisphereLight('#a78bfa', '#0b1020', 1.5); scene.add(hemi);
  const lamp = new THREE.PointLight('#f0abfc', 900, 220, 1.6); lamp.position.set(0, 40, 10); scene.add(lamp);
  const room = (ROOMS[ROOM[type]] || ROOMS.work)(K, scene);
  const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 1, 2000);
  // a portrait screen (phone) sees less of the room: step back along the same line of sight
  const back = camera.aspect < 1 ? Math.min(2, 1 / camera.aspect ** 0.75) : 1;
  camera.position.set(...room.look).add(new THREE.Vector3(...room.cam).sub(new THREE.Vector3(...room.look)).multiplyScalar(back));
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...room.look); controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = 1.35; controls.minDistance = 20; controls.maxDistance = 320; controls.update();
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / (mobile ? 2 : 1), innerHeight / (mobile ? 2 : 1)), mobile ? 0.6 : 0.8, 0.45, 1.0);
  composer.addPass(bloom); const out = new OutputPass(); composer.addPass(out);

  const R = robots(K, scene, MAX_BOTS);
  const ui = h('div', { class: 'inside-ui' });
  const tags = h('div', { class: 'inside-tags', 'aria-hidden': 'true' });
  const head = h('div', { class: 'inside-head' });
  const card = h('aside', { class: 'inside-card', hidden: true });
  const more = h('div', { class: 'inside-more', hidden: true });
  const empty = h('div', { class: 'inside-empty', hidden: true });
  ui.append(tags, head, more, empty, card); document.body.append(ui);
  const off = new AbortController(); const sig = { signal: off.signal };
  // posts: the room's own, plus the entrance (guards, and staff whose post this room does not have)
  const D = K.dims || { w: 120, d: 90 };
  const posts = { door: [-12, 12, -24, 24].map(x => ({ x, z: D.d / 2 - 7, rot: 0 })), ...(room.posts || {}) };

  let bots = []; // { o: occupant, slot, tag, bubble, pokeT }
  let place = opts.place; let alive = true; let bubbleAt = 0, bubbleI = 0;
  // each person to a post that fits their role, everyone else to the room's seats in order
  function placeAll(list) {
    const used = {}; let seat = 0; const out = [];
    const take = k => { const l = posts[k]; const n = used[k] || 0; if (!l || n >= l.length) return null; used[k] = n + 1; return l[n]; };
    for (const o of list) {
      const k = postOf(o.role);
      let slot = k ? take(k) : null;
      if (!slot && k && STAFF.has(k)) slot = take('door');
      if (!slot && seat < room.slots.length) slot = room.slots[seat++];
      if (!slot) break; // no room left: counted in "+N more"
      out.push([o, slot]);
    }
    return out;
  }
  function setPlace(p) {
    place = p || place; drawScreens(room, type, place);
    const total = (place.occupants || []).length + (Number(place.more) || 0);
    // who keeps the building: the shift on duty and how many staff (board.onDuty from the server)
    const od = place.board?.onDuty && typeof place.board.onDuty === 'object' ? place.board.onDuty : null;
    const duty = od ? ` · ${typeof od.shift === 'string' ? od.shift : 'on'} shift: ${Number(od.staff) || 0} on duty` : '';
    head.replaceChildren(h('b', { text: place.title || type }), h('span', { text: `${total.toLocaleString('en-US')} inside${duty} · updated ${fmtTime(place.updatedAt || Date.now(), { seconds: true })}` }));
    const placed = placeAll((place.occupants || []).slice(0, MAX_BOTS));
    const old = new Map(bots.map(b => [b.o.id, b]));
    for (const b of bots) if (!placed.some(([o]) => o.id === b.o.id)) { b.tag.remove(); b.bubble.remove(); }
    // nobody is drawn who is not in the server's list: an empty building says so
    empty.hidden = placed.length > 0; empty.textContent = placed.length ? '' : 'Nobody is inside right now.';
    bots = placed.map(([o, slot]) => {
      const was = old.get(o.id);
      const b = was || { tag: h('div', { class: 'itag' }), bubble: h('div', { class: 'ibubble', hidden: true }), pokeT: 0, phase: (hashStr(String(o.id)) % 628) / 100, shell: SHELLS[hashStr(String(o.id)) % SHELLS.length] };
      if (!was) tags.append(b.tag, b.bubble);
      b.o = o; b.slot = slot;
      b.tag.replaceChildren(...[h('b', { text: o.name || o.id }), o.gifted ? h('span', { class: 'gift', text: '★' }) : null, o.role ? h('small', { text: o.role }) : null].filter(Boolean));
      b.tag.onclick = () => openCard(b);
      return b;
    });
    for (const p of R.parts) p.count = bots.length;
    const extra = (Number(place.more) || 0) + Math.max(0, (place.occupants || []).length - bots.length);
    more.hidden = !extra; more.textContent = extra ? `+${extra.toLocaleString('en-US')} more inside` : '';
    if (cardFor && !bots.includes(cardFor)) closeCard(); else if (cardFor) openCard(cardFor);
  }

  // the card: role, activity, field, mood, and the poke
  let cardFor = null;
  function openCard(b) {
    cardFor = b; const o = b.o; const mk = moodKey(o.mood); const [em] = MOODS[mk];
    card.replaceChildren(
      h('button', { type: 'button', class: 'close', 'aria-label': 'Close', text: '×', onclick: closeCard }),
      h('h3', { text: o.name || o.id }),
      h('p', { class: 'role', text: [o.role, o.gifted ? `gifted${o.field ? ` in ${o.field}` : ''}` : null].filter(Boolean).join(' · ') || 'inside' }),
      h('div', { class: 'kv' }, ...[['Doing', o.activity], ['Detail', o.detail], ['Field', o.field], ['Mood', `${em} ${typeof o.mood === 'object' && o.mood?.label ? o.mood.label : mk}`], ['Here since', o.since ? (o.since > 1e11 ? fmtTime(o.since) : `day ${o.since}`) : null]]
        .filter(([, v]) => v).flatMap(([k, v]) => [h('span', { text: k }), h('b', { text: String(v) })])),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'poke-btn', text: '👉 Poke', onclick: () => doPoke(b) }), h('small', { text: 'They feel it and grumble.' })));
    card.hidden = false;
  }
  function closeCard() { cardFor = null; card.hidden = true; }
  async function doPoke(b) {
    b.pokeT = performance.now();
    let text = null; try { text = await opts.poke(b.o.id); } catch { /* offline */ }
    say(b, text || 'Hey! I am working here.', 7000);
  }
  function say(b, text, ms = 5000) { b.bubble.textContent = text; b.bubble.hidden = false; b.until = performance.now() + ms; }

  // picking
  const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2(); let down = null;
  renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; }, sig);
  renderer.domElement.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
    let best = null; for (const m of R.pick) { const hit = ray.intersectObject(m, false)[0]; if (hit && hit.instanceId != null && (!best || hit.distance < best.distance)) best = hit; }
    const b = best && bots[best.instanceId]; if (b) { openCard(b); doPoke(b); } else closeCard();
  }, sig);
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); composer.setSize(innerWidth, innerHeight); }, sig);

  // updates: every 12 s, and soon after a related live event (debounced)
  let timer = setInterval(() => refresh(), 12000); let soon = null;
  async function refresh() { if (!alive || document.hidden) return; try { const p = await opts.refresh(); if (alive && p) setPlace(p); } catch { /* keep the last picture */ } }
  const nudge = () => { if (soon) return; soon = setTimeout(() => { soon = null; refresh(); }, 2500); };

  // frame
  const tmp = new THREE.Object3D(); const col = new THREE.Color(); const v = new THREE.Vector3();
  let last = performance.now(); let tagAt = 0;
  function frame(now) {
    if (!alive) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now; const t = now / 1000;
    controls.update();
    bots.forEach((b, i) => {
      const s = b.slot; let x = s.x, z = s.z, y = s.y || 0, rot = s.rot || 0, sy = 1, spin = 0;
      if (s.run) { const a = Math.atan2(z / 45, x / 67) + t * 0.18; x = Math.cos(a) * 67; z = Math.sin(a) * 45; rot = -a + Math.PI; y += Math.abs(Math.sin(t * 8 + b.phase)) * 0.8; }
      if (s.sit) { y += 0.6; sy = 0.82; } else if (!s.run) y += Math.abs(Math.sin(t * 1.6 + b.phase)) * 0.25;
      const pk = b.pokeT && now - b.pokeT < 1600;
      if (pk) { const k = (now - b.pokeT) / 1600; y += Math.sin(Math.min(1, k * 1.6) * Math.PI) * 7; spin = k < 0.6 ? k / 0.6 * Math.PI * 2 : 0; }
      tmp.position.set(x, y, z); tmp.rotation.set(0, rot + spin + Math.sin(t * 1.1 + b.phase) * 0.15, 0); tmp.scale.set(1, sy, 1); tmp.updateMatrix();
      for (const p of R.parts) p.setMatrixAt(i, tmp.matrix);
      const mood = MOODS[moodKey(b.o.mood)];
      R.body.setColorAt(i, col.set(ROLE_COLOR(b.o.role)));
      R.head.setColorAt(i, col.set(b.shell).multiplyScalar(cardFor === b ? 0.97 : 0.86));
      R.visor.setColorAt(i, col.set(mood[1]).multiplyScalar(pk ? 2.2 : cardFor === b ? 1.9 : 1.45));
      R.tip.setColorAt(i, col.set(b.o.gifted ? '#fde047' : mood[1]).multiplyScalar(1.3 + Math.sin(t * 4 + b.phase) * 0.35));
      b.x = x; b.y = y; b.z = z;
    });
    for (const p of R.parts) { p.instanceMatrix.needsUpdate = true; if (p.instanceColor) p.instanceColor.needsUpdate = true; }
    if (room.blink) room.blink.forEach((m, i) => { m.visible = Math.sin(t * (3 + (i % 5)) + i) > -0.6; });
    // a few activity bubbles at a time, taking turns
    if (now - bubbleAt > 3800 && bots.length) {
      bubbleAt = now; const withAct = bots.filter(b => b.o.activity && !(b.until > now));
      for (let k = 0; k < Math.min(mobile ? 2 : 4, withAct.length); k++) { const b = withAct[(bubbleI + k) % withAct.length]; say(b, b.o.activity, 3600); }
      bubbleI += 4;
    }
    // tags and bubbles follow the robots (projected); far or hidden ones are not shown
    if (now - tagAt > 33) {
      tagAt = now; const W = innerWidth, H = innerHeight; const names = bots.length <= (mobile ? 16 : 32);
      for (const b of bots) {
        v.set(b.x, b.y + 12, b.z).project(camera);
        const on = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
        const px = ((v.x + 1) / 2 * W).toFixed(1), py = ((1 - v.y) / 2 * H).toFixed(1);
        const showTag = on && (names || cardFor === b || camera.position.distanceTo(tmp.position.set(b.x, b.y, b.z)) < 70);
        b.tag.style.display = showTag ? '' : 'none'; if (showTag) b.tag.style.transform = `translate(${px}px, ${py}px) translate(-50%, -100%)`;
        const showB = on && b.until > now; b.bubble.hidden = !showB;
        if (showB) b.bubble.style.transform = `translate(${px}px, ${(py - 22).toFixed(1)}px) translate(-50%, -100%)`;
      }
    }
    composer.render();
  }

  setPlace(place);
  return {
    frame, nudge, refresh, setPlace,
    dispose() {
      alive = false; clearInterval(timer); clearTimeout(soon); off.abort(); controls.dispose();
      ui.remove();
      for (const p of composer.passes) p.dispose?.(); composer.dispose();
      scene.traverse(o => { o.geometry?.dispose?.(); for (const m of [].concat(o.material || [])) { m.map?.dispose?.(); m.dispose?.(); } });
      for (const x of K.own) x.dispose?.();
      for (const p of R.parts) p.dispose?.();
      scene.clear();
    },
  };
}
