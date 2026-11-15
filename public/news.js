// Republic News: a small running ticker for the main page and the map (owner, 16 Nov). The newest headlines come from
// GET /api/news?n=20, new ones from the 'news' event of /api/stream: "headline · city · by <reporter>". Server text is
// only ever set with textContent. Under prefers-reduced-motion the line stands still and scrolls by hand (news.css).
const ID = /^[a-z0-9_-]{1,40}$/;
const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
function clean(x) {
  if (!x || typeof x !== 'object') return null;
  const headline = clip(x.headline, 100); if (!headline) return null;
  return { id: typeof x.id === 'string' && ID.test(x.id) ? x.id : null, headline, ts: Number(x.ts) || 0,
    city: typeof x.city === 'string' && ID.test(x.city) ? x.city : null, reporter: x.reporter && typeof x.reporter === 'object' ? clip(x.reporter.name, 40) || null : null };
}
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// root: an empty element (hidden until there is a headline); cityName: id -> the city's name
export function newsTicker(root, { cityName = id => id, max = 20 } = {}) {
  let items = [];
  const view = el('div', 'nt-view'); const track = el('div', 'nt-track'); view.append(track);
  root.replaceChildren(el('b', 'nt-label', 'REPUBLIC NEWS'), view);
  const item = x => {
    const s = el('span', 'nt-item'); s.append(el('b', null, x.headline));
    const meta = [x.city ? cityName(x.city) || x.city : null, x.reporter ? `by ${x.reporter}` : null].filter(Boolean).join(' · ');
    if (meta) s.append(el('small', null, ` · ${meta}`));
    return s;
  };
  const render = () => {
    root.hidden = !items.length; if (!items.length) return;
    const run = el('div', 'nt-run'); for (const x of items) run.append(item(x));
    const copy = run.cloneNode(true); copy.setAttribute('aria-hidden', 'true'); copy.classList.add('nt-copy'); // the seamless loop
    track.replaceChildren(run, copy);
    // about 70 px a second, whatever the length (CSSOM: the page's CSP allows no style attributes)
    requestAnimationFrame(() => track.style.setProperty('--nt-dur', `${Math.max(18, Math.round(run.scrollWidth / 70))}s`));
  };
  // new headlines first; the same id never twice
  const add = list => {
    const fresh = (Array.isArray(list) ? list : [list]).map(clean).filter(Boolean);
    if (!fresh.length) return;
    const seen = new Set(fresh.map(x => x.id).filter(Boolean));
    items = [...fresh, ...items.filter(x => !x.id || !seen.has(x.id))].sort((a, b) => b.ts - a.ts).slice(0, max);
    render();
  };
  const load = async () => {
    try { const r = await fetch(`/api/news?n=${max}`, { cache: 'no-store' }); if (r.ok) add(await r.json()); } catch { /* no news yet (or an older server): the ticker stays hidden */ }
  };
  // the 'news' event: a list of new headlines, newest first
  const listen = es => es.addEventListener('news', e => { try { add(JSON.parse(e.data)); } catch { /* ignore a bad event */ } });
  return { add, load, listen, get size() { return items.length; } };
}

// ?selftest=news: three made-up headlines (marked as tests) to see the ticker before the newsroom has written any
export const TEST_NEWS = [
  { id: 'test-1', ts: 3, headline: '(test) Council passes the night-market bill 18 to 12', city: 'neura', reporter: { id: 'test-r1', name: 'Test Reporter' } },
  { id: 'test-2', ts: 2, headline: '(test) Port Token cranes work through the night after a record day', city: 'portoken', reporter: { id: 'test-r2', name: 'Test Anchor' } },
  { id: 'test-3', ts: 1, headline: '(test) Kernel Falls farms bring in the first harvest', city: 'kernelfalls', reporter: null },
];
