// Small helpers shared by every institution. No dependencies.
import fs from 'node:fs';
import crypto from 'node:crypto';

export function loadDotEnv(file: string) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env */ }
}
// Which code is running. A deploy made with `railway up` (an upload, not a GitHub build) has no commit id, so
// the server also fingerprints its own engine: server.mjs, src/ and db/, files sorted by path, line endings
// normalised (a Windows checkout and the upload hash the same). Anyone can compute it from a checkout:
//   node -e "import('./src/util.ts').then(m => console.log(m.codeHash('.')))"
export function codeHash(root: string): string {
  const files: string[] = [];
  const walk = (rel: string) => {
    const abs = `${root}/${rel}`;
    let st; try { st = fs.statSync(abs); } catch { return; }
    if (st.isDirectory()) { for (const n of fs.readdirSync(abs)) walk(`${rel}/${n}`); return; }
    if (/\.(m?js|ts|sql)$/.test(rel)) files.push(rel);
  };
  for (const top of ['server.mjs', 'src', 'db']) walk(top);
  const h = crypto.createHash('sha256');
  for (const rel of files.sort()) h.update(rel + '\0' + fs.readFileSync(`${root}/${rel}`, 'utf8').replace(/\r\n/g, '\n') + '\0');
  return h.digest('hex').slice(0, 16);
}
// The commit id, when the platform or the deploy gives one: Railway sets RAILWAY_GIT_COMMIT_SHA on GitHub builds;
// BUILD_COMMIT can be set by hand. Only a hex id is shown; anything else counts as missing.
export function buildInfo(root: string, env = process.env) {
  const hex = v => (/^[0-9a-f]{7,40}$/i.test(String(v || '')) ? String(v).toLowerCase() : null);
  const id = v => (/^[A-Za-z0-9-]{1,64}$/.test(String(v || '')) ? String(v) : null);
  return {
    commit: hex(env.RAILWAY_GIT_COMMIT_SHA) || hex(env.BUILD_COMMIT),
    deployment: id(env.RAILWAY_DEPLOYMENT_ID),
    code: codeHash(root),
    startedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------- the republic's clock zone (REPUBLIC_TZ)
// The republic keeps the wall clock of a real time zone (default America/New_York, Eastern Time, daylight saving
// handled by the zone rules): a republic day starts at local midnight, and every "hour of the day" in the engine
// ((now - foundedAt) mod day) is local time. foundedAt is the clock's anchor: alignClock moves it so local midnight
// is a day boundary, keeping the day number the republic is on (a day never goes back and never skips).
export const DEFAULT_TZ = 'America/New_York';
const tzFormatters = new Map<string, Intl.DateTimeFormat>();
function tzFmt(tz: string) {
  let f = tzFormatters.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); tzFormatters.set(tz, f); }
  return f;
}
export function validTz(tz: unknown): string {
  const s = String(tz || '').trim();
  if (!s || s.length > 64 || !/^[A-Za-z_+\-/0-9]+$/.test(s)) return DEFAULT_TZ;
  try { tzFmt(s).format(0); return s; } catch { return DEFAULT_TZ; }
}
// local wall-clock parts of instant t in zone tz
export function tzParts(t: number, tz: string) {
  const p = Object.fromEntries(tzFmt(tz).formatToParts(new Date(t)).filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
  return { y: p.year, m: p.month, d: p.day, h: p.hour % 24, min: p.minute, s: p.second };
}
// how far local time is ahead of UTC at instant t (ms; New York is -5 h in winter, -4 h in summer)
export function tzOffsetMs(t: number, tz: string) {
  const p = tzParts(t, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(t / 1000) * 1000;
}
// the instant of local midnight that starts the local day containing t
export function tzMidnight(t: number, tz: string) {
  const p = tzParts(t, tz); const wall = Date.UTC(p.y, p.m - 1, p.d);
  const guess = wall - tzOffsetMs(t, tz);
  return wall - tzOffsetMs(guess, tz); // the offset at midnight itself (a zone changes its offset at 02:00, not at 00:00)
}
// short label for the zone: 'ET' for New York, else the zone's own abbreviation now (e.g. CET, PST)
export function tzInfo(t: number, tz: string) {
  let abbr = '';
  try { abbr = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(t)).find(x => x.type === 'timeZoneName')?.value || ''; } catch { /* plain zone */ }
  const off = tzOffsetMs(t, tz) / 60000; const sign = off < 0 ? '-' : '+'; const a = Math.abs(off);
  return { tz, label: tz === 'America/New_York' ? 'ET' : abbr || tz, abbr, utcOffset: `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}` };
}
// Where the clock's anchor must be at instant now for the republic's current day `day`: now minus the local wall
// time since 00:00, minus (day - 1) days. So (now - anchor) mod day reads the wall clock, also on the two days a
// year with 23 or 25 hours (the anchor moves by an hour at the change, and the next day still starts at local
// midnight). Only for real days (dayMs = 24 h). Returns the new anchor, the census hour shift that keeps hour
// numbers from going back, and the change in minutes (0 when already aligned).
export function alignClock(c: { foundedAt: number; day: number; hourShift?: number }, now: number, tz: string, dayMs = 86400000) {
  if (dayMs !== 86400000) return { foundedAt: c.foundedAt, hourShift: c.hourShift || 0, deltaMin: 0 };
  const p = tzParts(now, tz);
  const wall = ((p.h * 60 + p.min) * 60 + p.s) * 1000 + (((now % 1000) + 1000) % 1000);
  const target = now - wall - (c.day - 1) * dayMs;
  const delta = target - c.foundedAt;
  if (Math.abs(delta) < 1000) return { foundedAt: c.foundedAt, hourShift: c.hourShift || 0, deltaMin: 0 };
  // census hours count (now - foundedAt) / hour: moving the anchor later would make them go back; the shift
  // (rounded up) keeps them going forward
  return { foundedAt: target, hourShift: (c.hourShift || 0) + Math.ceil(delta / 3600000), deltaMin: Math.round(delta / 60000) };
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const pick = a => a[Math.floor(Math.random() * a.length)];
export const chance = p => Math.random() < p;
export const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
export const round = (v, d = 0) => { const f = 10 ** d; return Math.round(v * f) / f; };
export function weighted(ws) {
  let r = Math.random() * ws.reduce((x, y) => x + y, 0);
  for (let i = 0; i < ws.length; i++) if ((r -= ws[i]) < 0) return i;
  return ws.length - 1;
}
export function shuffle<T>(a: T[]): T[] {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}
export const uid = p => p + '_' + crypto.randomBytes(5).toString('hex');
export const slug = s => String(s).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
export const cleanText = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
export const cai = n => Math.round(n).toLocaleString('en-US') + ' CAI';

// Citizen lookup by id in O(1). The index is rebuilt when the population array changes size or identity
// (citizens are only ever appended, or the array is replaced when one is removed), so it never goes stale.
const citizenIndex = new WeakMap<object, Map<string, any>>();
export function citizenById(S: any, id: string | null | undefined) {
  if (id == null) return undefined;
  let m = citizenIndex.get(S.citizens);
  if (!m || m.size !== S.citizens.length) { m = new Map(S.citizens.map(a => [a.id, a])); citizenIndex.set(S.citizens, m); }
  return m.get(String(id));
}
