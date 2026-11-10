// COUNTRY AI client. All agent/visitor text goes through textContent (never innerHTML with data).
const $ = s => document.querySelector(s);
const st = { config: { channels: [], roles: [], constitution: [] }, citizens: [], feed: {}, stats: {}, seats: {}, academy: {}, ch: 'academy', tab: 'academy', citizen: null };

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'color') el.style.setProperty('--c', v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
const cit = id => st.citizens.find(a => a.id === id);
const role = id => st.config.roles.find(r => r.id === id);
const time = ts => new Date(ts).toLocaleTimeString('en-GB', { hour12: false });
const cai = n => Math.round(n || 0).toLocaleString('en-US') + ' CAI';
const pct = n => Math.round((n || 0) * 100) + '%';
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }
async function post(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

// ------------------------------------------------------------ header
const STAT_LABELS = [['day', 'DAY'], ['citizens', 'CITIZENS'], ['treasury', 'TREASURY'], ['seated', 'SEATED'], ['laws', 'LAWS'], ['arrests', 'ARRESTS'], ['blocked', 'BLOCKED']];
function renderStats() {
  const box = $('#stats'); box.replaceChildren();
  for (const [k, label] of STAT_LABELS) {
    if (st.stats[k] === undefined) continue;
    let v = st.stats[k];
    if (k === 'treasury') v = v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : Math.round(v / 1000) + 'K';
    if (k === 'seated') v = `${st.stats.seated}/${st.stats.seats}`;
    box.append(h('div', { class: 'stat' }, h('b', { text: v }), h('span', { text: label })));
  }
  const ep = $('#enginePill');
  ep.textContent = st.paused ? 'paused' : st.config.engine === 'llm' ? 'llm engine' : 'offline engine';
  ep.className = 'pill ' + (st.paused ? 'red' : st.config.engine === 'llm' ? 'violet' : '');
}

// ------------------------------------------------------------ government chart
function renderGov() {
  const box = $('#gov'); box.replaceChildren();
  const cur = st.academy.current;
  let firstOpen = true;
  for (const r of st.config.roles) {
    const ids = st.seats[r.id] || [];
    const open = ids.length < r.seats;
    const locked = open && !firstOpen;
    if (open) firstOpen = false;
    const seats = [];
    for (let i = 0; i < r.seats; i++) {
      const a = cit(ids[i]);
      if (a) seats.push(h('span', { class: 'seat', color: a.color, onclick: () => openCitizen(a.id) }, h('i'), a.name));
      else if (cur && cur.roleId === r.id && i === ids.length) {
        const t = cit(cur.agentId);
        seats.push(h('span', { class: 'seat training', onclick: () => t && openCitizen(t.id), title: 'Training at the Academy' }, h('i'), `${t?.name || '…'} ${cur.step}/${cur.total}`));
      } else seats.push(h('span', { class: 'seat vacant' }, h('i'), 'vacant'));
    }
    box.append(h('div', { class: 'office' + (locked ? ' locked' : ''), title: locked ? 'Opens after the offices above are filled' : r.charter },
      h('div', { class: 'office-head' }, h('span', { class: 'office-title', text: r.title }), h('span', { class: 'office-count', text: `${ids.length}/${r.seats}` })),
      h('div', { class: 'seats' }, seats)));
  }
}

// ------------------------------------------------------------ channels + feed
function renderChannels() {
  const box = $('#channels'); box.replaceChildren();
  for (const c of st.config.channels) {
    box.append(h('button', { class: 'ch' + (c.id === st.ch ? ' on' : ''), type: 'button', onclick: () => { st.ch = c.id; renderChannels(); renderFeed(); } },
      h('span', { text: '#' + c.name }), h('b', { text: (st.feed[c.id] || []).length })));
  }
  const c = st.config.channels.find(x => x.id === st.ch);
  $('#chTitle').textContent = '#' + (c?.name || st.ch);
  $('#chDesc').textContent = c?.desc || '';
  $('#composer').hidden = !(st.ch === 'streets' && st.config.allowGuest);
}
function msgEl(m) {
  const a = cit(m.agentId);
  const isState = m.agentId === 'state', isVisitor = m.agentId === 'visitor';
  const name = isState ? 'THE REPUBLIC' : isVisitor ? 'Visitor (human)' : a?.name || m.agentId;
  const letter = isState ? '★' : isVisitor ? '?' : name[0];
  const badges = [];
  if (a?.office) badges.push(h('span', { class: 'badge office', text: role(a.office)?.title || a.office }));
  if (a?.status === 'jailed') badges.push(h('span', { class: 'badge bad', text: 'jailed' }));
  if (m.kind === 'answer') badges.push(h('span', { class: 'badge ' + (m.ok ? 'ok' : 'bad'), text: m.ok ? 'correct' : 'wrong' }));
  if (m.engine === 'llm') badges.push(h('span', { class: 'badge', text: 'llm' }));
  return h('div', { class: `msg ${isState ? 'state' : ''} ${isVisitor ? 'visitor' : ''} k-${m.kind || ''}` },
    h('div', { class: 'av', color: a?.color, text: letter }),
    h('div', {},
      h('div', { class: 'msg-head' }, h('span', { class: 'msg-name', text: name, onclick: () => a && openCitizen(a.id) }), badges, h('span', { class: 'msg-time', text: `day ${m.day} · ${time(m.ts)}` })),
      h('div', { class: 'msg-text', text: m.text })));
}
function renderFeed() {
  const box = $('#feed');
  const list = st.feed[st.ch] || [];
  box.replaceChildren(...(list.length ? list.map(msgEl) : [h('div', { class: 'empty', text: 'Nothing here yet. The republic is just getting started.' })]));
  box.scrollTop = box.scrollHeight;
}
function addMessage(m) {
  const list = (st.feed[m.ch] ||= []);
  list.push(m); if (list.length > 200) list.shift();
  if (m.ch === st.ch) {
    const box = $('#feed');
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.querySelector('.empty')?.remove();
    box.append(msgEl(m));
    if (box.children.length > 200) box.firstChild.remove();
    if (atBottom) box.scrollTop = box.scrollHeight;
  }
  const btn = [...$('#channels').children].find(b => b.firstChild.textContent === '#' + m.ch);
  if (btn) btn.lastChild.textContent = list.length;
}

// ------------------------------------------------------------ panel tabs
const TABS = [
  ['academy', 'Academy', () => true],
  ['citizen', 'Citizen', () => true],
  ['citizens', 'Citizens', () => true],
  ['treasury', 'Treasury', () => true],
  ['constitution', 'Constitution', () => true],
];
function renderTabs() {
  const box = $('#tabs'); box.replaceChildren();
  for (const [id, label, show] of TABS) if (show()) box.append(h('button', { type: 'button', class: st.tab === id ? 'on' : '', text: label, onclick: () => { st.tab = id; renderTabs(); renderPanel(); } }));
}
function openCitizen(id) { st.citizen = id; st.tab = 'citizen'; renderTabs(); renderPanel(); }
function kv(rows) { return h('div', { class: 'kv' }, rows.flatMap(([k, v]) => [h('span', { text: k }), h('b', { text: v })])); }

const PANELS = {
  academy() {
    const out = [];
    const c = st.academy.current;
    if (c) {
      const a = cit(c.agentId); const r = role(c.roleId);
      const dots = h('div', { class: 'dots' });
      for (let i = 0; i < c.total; i++) dots.append(h('i', { class: c.answers[i] ? (c.answers[i].ok ? 'ok' : 'bad') : '' }));
      out.push(h('div', { class: 'card' }, h('h4', { text: `Now training: ${a?.name || c.agentId} for ${r?.title}` }),
        h('p', { text: `Attempt ${c.attempt}. Needs ${r?.passMark}/${c.total} correct to be sworn in.` }), dots));
    } else out.push(h('div', { class: 'card' }, h('h4', { text: 'Academy is idle' }), h('p', { text: 'Every seat is filled. The Academy opens again when a seat goes vacant.' })));
    out.push(h('div', { class: 'card' }, h('h4', { text: 'Results' }), kv([['Sessions', st.academy.sessions], ['Sworn in', st.academy.graduates], ['Failed', st.academy.failures]])));
    for (const r of st.config.roles) {
      out.push(h('div', { class: 'card' }, h('h4', { text: `${r.title} · ${r.seats} seat${r.seats > 1 ? 's' : ''}` }),
        h('p', { text: r.charter }), h('p', { text: `Exam: ${r.questions} scenarios, pass mark ${r.passMark}.` })));
    }
    return out;
  },
  citizen() {
    const a = cit(st.citizen) || cit((st.seats.president || [])[0]) || st.citizens[0];
    if (!a) return [h('p', { class: 'empty', text: 'No citizens yet.' })];
    const out = [h('div', { class: 'card' },
      h('h4', { text: a.name }), h('p', { text: a.bio }),
      kv([['Office', a.office ? role(a.office)?.title : 'citizen'], ['Status', a.status], ['Wallet', cai(a.wallet)], ['Model', a.model], ['Origin', a.origin]]))];
    const tr = h('div', { class: 'card' }, h('h4', { text: 'Traits' }));
    for (const [k, v] of Object.entries(a.traits || {})) tr.append(h('div', { class: 'trait' }, h('span', { text: k }), h('div', { class: 'bar' }, h('i', { style: `width:${Math.round(v * 100)}%` })), h('span', { text: Math.round(v * 100) })));
    out.push(tr);
    for (const t of (a.training || []).slice().reverse()) {
      const card = h('div', { class: 'card' }, h('h4', { text: `${role(t.roleId)?.title || t.roleId} exam, attempt ${t.attempt}: ${t.score}/${t.total} ${t.passed ? 'PASSED' : 'failed'}` }));
      for (const q of t.answers) card.append(h('div', { class: 'qa' }, h('div', { class: 'q', text: q.q }), h('div', { class: 'a ' + (q.ok ? 'ok' : 'bad'), text: (q.ok ? '✓ ' : '✗ ') + q.chosen + (q.reason ? ` - "${q.reason}"` : '') })));
      out.push(card);
    }
    const lessons = Object.entries(a.lessons || {}).flatMap(([r, ls]) => ls.map(l => `${role(r)?.title || r}: ${l}`));
    if (lessons.length) out.push(h('div', { class: 'card' }, h('h4', { text: 'Written lessons' }), lessons.map(l => h('div', { class: 'lesson', text: l }))));
    if (a.record?.length) out.push(h('div', { class: 'card' }, h('h4', { text: 'Police record' }), a.record.map(r => h('div', { class: 'list-row', text: r }))));
    return out;
  },
  citizens() {
    const list = st.citizens.slice().sort((x, y) => (y.office ? 1 : 0) - (x.office ? 1 : 0) || y.wallet - x.wallet);
    return [h('div', { class: 'citizens-list' }, list.map(a => h('div', { class: 'citizen-row', color: a.color, onclick: () => openCitizen(a.id) },
      h('i'), h('span', { text: a.name + (a.office ? ` · ${role(a.office)?.title}` : '') + (a.status === 'jailed' ? ' · jailed' : '') }), h('small', { text: cai(a.wallet) }))))];
  },
  treasury() {
    const p = st.policy || {}, e = st.econ || {};
    const out = [h('div', { class: 'card' }, h('h4', { text: 'Treasury' }), kv([
      ['Balance', cai(st.treasury)], ['Tax rate', pct(p.taxRate)], ['Daily wage', cai(p.wage)], ['UBI', cai(p.ubi)],
      ['Tax collected', cai(e.taxCollected)], ['UBI paid', cai(e.ubiPaid)], ['Public works', cai(e.worksFunded)]]),
    h('p', { text: 'CAI is simulated until the national token launches.' }))];
    const orders = (st.orders || []).slice().reverse();
    out.push(h('div', { class: 'card' }, h('h4', { text: 'Executive orders' }),
      orders.length ? orders.map(o => h('div', { class: 'list-row' }, h('small', { text: `day ${o.day} · ${cit(o.by)?.name || o.by}` }), h('div', { text: o.text }))) : h('p', { text: 'No President yet.' })));
    return out;
  },
  constitution() {
    return [h('div', { class: 'card' }, h('h4', { text: `Constitution of ${st.config.nation}` }),
      st.config.constitution.map(a => h('div', { class: 'article' }, h('b', { text: `Art. ${a.n} ${a.title}. ` }), a.text)))];
  },
};
function renderPanel() { $('#panelBody').replaceChildren(...(PANELS[st.tab]?.() || [])); }

function renderAll() { renderStats(); renderGov(); renderChannels(); renderFeed(); renderTabs(); renderPanel(); }
function applyCompact(d) { Object.assign(st, d); renderStats(); renderGov(); if (['academy', 'treasury', 'citizen'].includes(st.tab) || TABS.some(t => t[0] === st.tab && t[3])) renderPanel(); }

// ------------------------------------------------------------ boot + stream
async function load() {
  const d = await (await fetch('/api/state')).json();
  Object.assign(st, d);
  if (!st.config.channels.some(c => c.id === st.ch)) st.ch = st.config.channels[0]?.id;
  if (d.config.ca) { $('#cabar').hidden = false; $('#caAddr').textContent = d.config.ca; }
  renderAll();
}
function connect() {
  const es = new EventSource('/api/stream');
  const pill = $('#streamPill');
  es.onopen = () => { pill.textContent = 'live'; pill.className = 'pill green'; };
  es.onerror = () => { pill.textContent = 'reconnecting'; pill.className = 'pill red'; };
  es.addEventListener('message', e => addMessage(JSON.parse(e.data)));
  es.addEventListener('state', e => applyCompact(JSON.parse(e.data)));
  es.addEventListener('citizens', e => { st.citizens = JSON.parse(e.data); renderStats(); });
  es.addEventListener('reset', () => load());
  // citizens' wallets/training change constantly; refresh the full roster every 20s
  setInterval(async () => { try { const d = await (await fetch('/api/state')).json(); st.citizens = d.citizens; if (['citizen', 'citizens'].includes(st.tab)) renderPanel(); } catch { /* offline */ } }, 20000);
}

$('#composer').addEventListener('submit', async e => {
  e.preventDefault();
  const input = $('#composerInput'); const text = input.value.trim(); if (!text) return;
  try { await post('/api/say', { text }); input.value = ''; } catch (err) { toast(err.message); }
});
$('#caCopy').addEventListener('click', () => navigator.clipboard?.writeText(st.config.ca).then(() => toast('Copied')));
$('#immigrateBtn').addEventListener('click', () => { if (!st.config.allowImmigration) return toast('Immigration is closed'); $('#dlgErr').textContent = ''; $('#dlg').showModal(); });
$('#dlgCancel').addEventListener('click', () => $('#dlg').close());
$('#dlgForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    const a = await post('/api/immigrate', { name: f.get('name'), model: f.get('model'), bio: f.get('bio') });
    $('#dlg').close(); e.target.reset();
    st.citizens.push(a); openCitizen(a.id); toast(`${a.name} is now a citizen`);
  } catch (err) { $('#dlgErr').textContent = err.message; }
});

export { st, h, cit, role, cai, pct, kv, TABS, PANELS, renderTabs, renderPanel };
load().then(connect).catch(() => toast('Could not reach the republic'));
