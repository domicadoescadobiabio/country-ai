// Republic News: a small running ticker for the main page and the map (owner, 16 Nov). The newest headlines come from
// GET /api/news?n=20, new ones from the 'news' event of /api/stream: "headline · city · by <reporter>". Server text is
// only ever set with textContent. Under prefers-reduced-motion the line stands still and scrolls by hand (news.css).
// Breaking news (owner, 16 Nov: "TV breaking news"): an item with breaking === true (decided by the server from the
// kind of event, rare by design) also opens a small live-TV window in the top-right corner for about 45 s.
const ID = /^[a-z0-9_-]{1,40}$/;
const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const nameOf = p => (p && typeof p === 'object' ? clip(p.name, 40) || null : null);
function clean(x) {
  if (!x || typeof x !== 'object') return null;
  const headline = clip(x.headline, 100); if (!headline) return null;
  return { id: typeof x.id === 'string' && ID.test(x.id) ? x.id : null, headline, ts: Number(x.ts) || 0,
    city: typeof x.city === 'string' && ID.test(x.city) ? x.city : null, reporter: nameOf(x.reporter), anchor: nameOf(x.anchor),
    breaking: x.breaking === true }; // an item without the field is not breaking
}
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

const SPEED = 32;              // px a second: slow enough to read on a phone (it was 70)
const TV_MS = 45000;           // the TV window closes by itself after this long
const TV_FRESH = 10 * 60000;   // on opening the page: show the last breaking item only if it is this recent

// root: an empty element (hidden until there is a headline); cityName: id -> the city's name;
// tv: { anchor: selector the window sits under (and right-aligns to), avoid: selectors it must not cover }
export function newsTicker(root, { cityName = id => id, max = 20, tv = null } = {}) {
  let items = [];
  const view = el('div', 'nt-view'); const track = el('div', 'nt-track'); view.append(track);
  root.replaceChildren(el('b', 'nt-label', 'REPUBLIC NEWS'), view);
  const item = x => {
    const s = el('span', `nt-item${x.breaking ? ' nt-breaking' : ''}`);
    if (x.breaking) s.append(el('i', 'nt-tag', 'BREAKING'));
    s.append(el('b', null, x.headline));
    const meta = [x.city ? cityName(x.city) || x.city : null, x.reporter ? `by ${x.reporter}` : null].filter(Boolean).join(' · ');
    if (meta) s.append(el('small', null, ` · ${meta}`));
    return s;
  };
  const render = () => {
    root.hidden = !items.length; if (!items.length) return;
    const run = el('div', 'nt-run'); for (const x of items) run.append(item(x));
    const copy = run.cloneNode(true); copy.setAttribute('aria-hidden', 'true'); copy.classList.add('nt-copy'); // the seamless loop
    track.replaceChildren(run, copy);
    // about SPEED px a second, whatever the length (CSSOM: the page's CSP allows no style attributes)
    requestAnimationFrame(() => track.style.setProperty('--nt-dur', `${Math.max(30, Math.round(run.scrollWidth / SPEED))}s`));
  };
  const box = tv ? breakingTV({ cityName, ...tv }) : null;
  // new headlines first; the same id never twice. live: they came in just now (the stream), so a breaking one goes on TV
  const add = (list, { live = false } = {}) => {
    const fresh = (Array.isArray(list) ? list : [list]).map(clean).filter(Boolean);
    if (!fresh.length) return;
    const seen = new Set(fresh.map(x => x.id).filter(Boolean));
    items = [...fresh, ...items.filter(x => !x.id || !seen.has(x.id))].sort((a, b) => b.ts - a.ts).slice(0, max);
    render();
    const hot = fresh.filter(x => x.breaking).sort((a, b) => b.ts - a.ts)[0];
    if (box && hot && (live || Date.now() - hot.ts < TV_FRESH)) box.show(hot);
  };
  const load = async () => {
    try { const r = await fetch(`/api/news?n=${max}`, { cache: 'no-store' }); if (r.ok) add(await r.json()); } catch { /* no news yet (or an older server): the ticker stays hidden */ }
  };
  // the 'news' event: a list of new headlines, newest first
  const listen = es => es.addEventListener('news', e => { try { add(JSON.parse(e.data), { live: true }); } catch { /* ignore a bad event */ } });
  return { add, load, listen, tv: box, get size() { return items.length; } };
}

// The live-TV window: a red blinking dot + LIVE + BREAKING NEWS, "with <anchor> · <city>", the headline, and a small
// studio drawn with CSS (no video, no sound, nothing from outside). One at a time: a new breaking item replaces it.
function breakingTV({ anchor = null, avoid = [], cityName = id => id } = {}) {
  const box = el('aside', 'news-tv'); box.id = 'newsTv'; box.hidden = true; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); box.setAttribute('aria-label', 'Breaking news');
  const studio = el('div', 'tv-studio'); studio.setAttribute('aria-hidden', 'true');
  studio.append(el('i', 'tv-wall'), el('i', 'tv-light'), el('i', 'tv-desk'), el('i', 'tv-host'), el('i', 'tv-scan'));
  const close = el('button', 'tv-close', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close the breaking news');
  const top = el('div', 'tv-top'); top.append(el('i', 'tv-dot'), el('b', 'tv-live', 'LIVE'), el('span', 'tv-kind', 'BREAKING NEWS'), close);
  const who = el('small', 'tv-who'); const head = el('b', 'tv-head');
  const lower = el('div', 'tv-lower'); lower.append(who, head);
  box.append(studio, top, lower); document.body.append(box);
  let timer = 0;
  const hide = () => { clearTimeout(timer); box.hidden = true; box.classList.remove('on'); };
  close.addEventListener('click', hide);
  // right under the anchor (the day and citizens line), right-aligned to it, and below anything in `avoid` it would cover
  const place = () => {
    if (box.hidden) return;
    // (shown = has a box on screen; offsetParent would not do: it is null for every position:fixed element)
    const shown = o => o && !o.hidden && o.getClientRects().length > 0;
    const a = anchor && document.querySelector(anchor); const ar = shown(a) ? a.getBoundingClientRect() : null;
    const w = box.offsetWidth, h = box.offsetHeight, W = innerWidth;
    const right = Math.max(10, ar && ar.width ? W - ar.right : 14);
    const x0 = W - right - w, x1 = W - right;
    let y = ar && ar.height ? ar.bottom + 8 : 70;
    for (let pass = 0; pass < 4; pass++) { // move down past whatever it would cover (a few passes: one may push into the next)
      let moved = false;
      for (const sel of avoid) for (const o of document.querySelectorAll(sel)) {
        if (!shown(o)) continue; const r = o.getBoundingClientRect(); if (!r.width || !r.height) continue;
        if (r.right > x0 && r.left < x1 && r.bottom > y && r.top < y + h) { y = r.bottom + 8; moved = true; }
      }
      if (!moved) break;
    }
    box.style.setProperty('--tv-top', `${Math.round(y)}px`); box.style.setProperty('--tv-right', `${Math.round(right)}px`);
  };
  addEventListener('resize', place);
  const show = x => {
    who.textContent = [x.anchor ? `with ${x.anchor}` : 'Republic News', x.city ? cityName(x.city) || x.city : null].filter(Boolean).join(' · ');
    head.textContent = x.headline;
    box.hidden = false; box.classList.remove('on'); void box.offsetWidth; box.classList.add('on'); // restart the entrance
    place(); clearTimeout(timer); timer = setTimeout(hide, TV_MS);
  };
  return { show, hide, place, el: box };
}

// ?selftest=news: three made-up headlines (marked as tests) to see the ticker before the newsroom has written any
export const TEST_NEWS = [
  { id: 'test-1', ts: 3, headline: '(test) Council passes the night-market bill 18 to 12', city: 'neura', reporter: { id: 'test-r1', name: 'Test Reporter' } },
  { id: 'test-2', ts: 2, headline: '(test) Port Token cranes work through the night after a record day', city: 'portoken', reporter: { id: 'test-r2', name: 'Test Anchor' } },
  { id: 'test-3', ts: 1, headline: '(test) Kernel Falls farms bring in the first harvest', city: 'kernelfalls', reporter: null },
];
// ?selftest=breaking: the same, plus one breaking item that arrives "live" (marked as a test)
export const testBreaking = () => [{ id: 'test-b1', ts: Date.now(), breaking: true, headline: '(test) Election certified: a new President takes office in Neura City', city: 'neura',
  reporter: { id: 'test-r1', name: 'Test Reporter' }, anchor: { id: 'test-a1', name: 'Test Anchor' } }];
