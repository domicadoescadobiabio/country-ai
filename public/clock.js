// The republic's clock. Every time on the site is shown in the republic's zone (US Eastern, "ET", by default),
// never the visitor's own: the server says which zone in config.clock (tz, label); until then America/New_York.
// Times read the American way: "2:05 PM ET", dates "Nov 14".
let TZ = 'America/New_York', LABEL = 'ET', INFO = { abbr: '', utcOffset: '', nextDayAt: null };
const fmts = new Map();
const valid = tz => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };
const str = (v, n) => (typeof v === 'string' && v.length <= n ? v : '');
export function setClock(c) {
  if (c && typeof c.tz === 'string' && valid(c.tz)) TZ = c.tz;
  LABEL = c && typeof c.label === 'string' && c.label.length <= 12 ? c.label : TZ === 'America/New_York' ? 'ET' : TZ;
  // EST/EDT, "-05:00", and when the next republic day starts (local midnight in the zone)
  INFO = { abbr: str(c?.abbr, 8), utcOffset: /^[+-]\d{2}:\d{2}$/.test(c?.utcOffset || '') ? c.utcOffset : '', nextDayAt: Number.isFinite(Number(c?.nextDayAt)) ? Number(c.nextDayAt) : null };
  fmts.clear();
}
// "EDT, UTC-04:00 · next day in 5h 21m" (for a tooltip)
export function clockDetail(now = Date.now()) {
  const zone = [INFO.abbr || LABEL, INFO.utcOffset ? `UTC${INFO.utcOffset}` : ''].filter(Boolean).join(', ');
  let next = '';
  if (INFO.nextDayAt && INFO.nextDayAt > now) { const m = Math.round((INFO.nextDayAt - now) / 60000); next = ` · next day in ${Math.floor(m / 60)}h ${m % 60}m`; }
  return `Republic time (${TZ}): ${zone}${next}`;
}
export const clockLabel = () => LABEL;
function f(key, opts) { let x = fmts.get(key); if (!x) { x = new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...opts }); fmts.set(key, x); } return x; }
// "2:05 PM ET" (or "2:05:09 PM ET" with seconds)
export function fmtTime(ts, { seconds = false, label = true } = {}) {
  const t = Number(ts); if (!Number.isFinite(t)) return '-';
  const s = f(seconds ? 'ts' : 't', { hour: 'numeric', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12: true }).format(t);
  return label ? `${s} ${LABEL}` : s;
}
// "Nov 14"
export function fmtDate(ts) { const t = Number(ts); return Number.isFinite(t) ? f('d', { month: 'short', day: 'numeric' }).format(t) : '-'; }
// "Nov 14, 2:05 PM ET"
export function fmtDateTime(ts) { const t = Number(ts); return Number.isFinite(t) ? `${f('dt', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(t)} ${LABEL}` : '-'; }
// the hour of the day in the republic's zone, with minutes as a fraction (14.5 = 2:30 PM): drives day and night
export function hourOf(ts = Date.now()) {
  const p = f('h', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(ts);
  const hh = Number(p.find(x => x.type === 'hour')?.value) % 24, mm = Number(p.find(x => x.type === 'minute')?.value) || 0;
  return hh + mm / 60;
}
