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
