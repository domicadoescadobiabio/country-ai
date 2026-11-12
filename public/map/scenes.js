// Institutions made visible from the real /api/state: exam candidates and drills at the academies,
// arrests (officer walks the suspect from the station to the remand jail), trials at the court,
// inmates in the prison yard, and queues at the community halls while an election is voting.
// Crime only appears once the police have detected it (an incident with known perpetrators).
// Ambient cadets on the training tracks are a labelled sample, not named agents.

const TRAIN_AT = { police: 'police_academy', police_chief: 'police_academy', military: 'military_academy', military_chief: 'military_academy' };
export const SCENE_COLOR = { exam: '#c084fc', drill: '#fb923c', cadet: '#3b82f6', soldier: '#65a30d', officer: '#2563eb', suspect: '#ef4444', judge: '#a16207', inmate: '#f97316', detained: '#fca5a5', voter: '#38bdf8' };
const SHOWN = new Set(['trial', 'convicted']); // incident states that mean "detected and charged"

export class Scenes {
  constructor(agents, data, h) {
    this.ag = agents; this.data = data; this.h = h; // h: { nameOf, roleTitle, citizen(id) -> record|null|undefined, fetchCitizen(id) }
    this.actors = new Map(); this.seen = new Set(); this.first = true; this.dirty = false; this.state = null;
  }
  find(type, cityId) {
    const c = cityId && this.data.cities[cityId]; const l = c?.byType?.[type]; if (l?.length) return l[0];
    for (const cc of Object.values(this.data.cities)) if (cc.byType?.[type]?.length) return cc.byType[type][0];
    return null;
  }
  // where the k-th person stands at a building: the yard if it has one, else in rows in front of it
  spot(b, k) {
    const y = b.extra?.yard || { x: b.x, z: b.z + b.d / 2 - 5 };
    return [y.x + ((k % 8) - 3.5) * 5.5, y.z + Math.floor(k / 8) * 5.5];
  }
  cityOfCitizen(id) { return this.h.citizen(id)?.city || null; }

  sync(s) {
    if (!s) return; this.state = s; this.dirty = false;
    const want = new Map(); const nameOf = this.h.nameOf; const count = new Map();
    const at = (b, spec) => { const k = count.get(b) || 0; count.set(b, k + 1); want.set(spec.id, { ...spec, b, k }); };

    // 1. Academy exams (several rooms) and in-service drills
    const rooms = s.academy?.rooms?.length ? s.academy.rooms : (s.academy?.current ? [s.academy.current] : []);
    for (const r of rooms) {
      const b = this.find(TRAIN_AT[r.roleId] || 'academy', 'neura'); if (!b) continue;
      const right = (r.answers || []).filter(x => x?.ok).length;
      at(b, { id: `scene:exam:${r.agentId}`, kind: 'exam', name: nameOf(r.agentId), loop: !!TRAIN_AT[r.roleId], what: `${this.h.roleTitle(r.roleId)} exam, question ${Math.min(r.step + 1, r.total)}/${r.total} (${right} right)`, tag: true });
    }
    const d = s.training?.current;
    if (d) {
      const b = this.find(TRAIN_AT[d.roleId] || 'academy', 'neura');
      if (b) at(b, { id: `scene:drill:${d.agentId}`, kind: 'drill', name: nameOf(d.agentId), loop: !!TRAIN_AT[d.roleId], what: `${this.h.roleTitle(d.roleId)} drill, ${(d.answers || []).length}/${d.total} answered`, tag: true });
    }
    // ambient cadets: a sample so the training grounds are never empty
    for (const [type, kind, n] of [['police_academy', 'cadet', 10], ['military_academy', 'soldier', 12], ['army_base', 'soldier', 8]]) {
      const b = this.find(type, 'neura'); if (!b?.extra?.track) continue;
      for (let k = 0; k < n; k++) at(b, { id: `scene:amb:${type}:${k}`, kind, name: null, loop: true, what: kind === 'cadet' ? 'police recruit on the training course (sample)' : 'soldier on the training ground (sample)', ambient: true, n });
    }

    // 2. Trials: incidents the police charged and the court is hearing
    const inc = s.police?.incidents || [];
    const court = this.find('const_court', 'neura');
    const trials = inc.filter(i => i.status === 'trial' && i.perps?.length);
    if (court) {
      for (const i of trials) for (const p of i.perps) at(court, { id: `scene:trial:${p}`, kind: 'suspect', name: nameOf(p), what: `on trial for ${i.type}${i.amount ? ` (${Math.round(i.amount).toLocaleString('en-US')} CAI)` : ''}`, tag: true });
      if (trials.length) for (const j of s.seats?.judge || []) at(court, { id: `scene:judge:${j}`, kind: 'judge', name: nameOf(j), what: 'judge hearing the case' });
    }

    // 3. Prison and remand jail: who is locked up right now
    const prison = this.find('prison', 'neura');
    const jailed = new Set(), detained = new Set();
    for (const c of s.citizens || []) { if (c.status === 'jailed') jailed.add(c.id); if (c.status === 'detained') detained.add(c.id); }
    for (const i of inc) {
      if (i.status !== 'convicted' || !i.perps?.length || (i.verdictDay ?? i.solvedDay ?? 0) < (s.day || 0) - 3) continue;
      for (const p of i.perps) { const rec = this.h.citizen(p); if (rec === undefined) this.h.fetchCitizen(p).then(() => { this.dirty = true; }); else if (rec?.status === 'jailed') jailed.add(p); }
    }
    if (prison) for (const p of jailed) at(prison, { id: `scene:inmate:${p}`, kind: 'inmate', name: nameOf(p), what: 'serving a sentence', tag: true });
    for (const p of detained) {
      if (want.has(`scene:trial:${p}`)) continue;
      const jail = this.find('jail', this.cityOfCitizen(p)); if (jail) at(jail, { id: `scene:held:${p}`, kind: 'detained', name: nameOf(p), what: 'held before trial', tag: true });
    }

    // 4. Elections in the voting stage: queues at the community halls
    const voting = (s.elections || []).filter(e => e.stage === 'voting');
    if (voting.length) {
      const cities = new Set(voting.flatMap(e => e.city ? [e.city] : Object.keys(this.data.cities)));
      const title = voting.map(e => `${e.title}${e.electorate ? ` ${Math.round((e.voted || 0) / e.electorate * 100)}%` : ''}`).join(' · ');
      for (const cid of cities) (this.data.cities[cid]?.byType?.community_hall || []).slice(0, 3).forEach((b, hk) => {
        for (let k = 0; k < 5; k++) at(b, { id: `scene:vote:${b.idx}:${k}`, kind: 'voter', name: null, queue: true, what: `queueing to vote: ${title}`, tag: hk === 0 && k === 0 ? `Polling: ${title}` : null });
      });
    }

    // one tag per group (same building, same kind) so labels do not stack: "Exams: Sela Mux, Xia Fork +2"
    const GROUP = { exam: 'Exams', drill: 'Drill', suspect: 'On trial', inmate: 'In prison', detained: 'Held before trial' };
    const groups = new Map();
    for (const w of want.values()) if (w.tag === true && GROUP[w.kind]) { const g = `${w.b.idx}|${w.kind}`; (groups.get(g) || groups.set(g, []).get(g)).push(w); }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const names = list.map(w => w.name); const k = list[0].kind;
      list.forEach((w, n) => { w.tag = n ? null : `${GROUP[k]}: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}`; });
    }

    // apply: drop what is gone, add what is new, refresh the rest
    for (const [id, a] of this.actors) if (!a.transient && !want.has(id)) { this.ag.remove(a); this.actors.delete(id); }
    for (const [id, w] of want) {
      let a = this.actors.get(id);
      if (!a) {
        a = this.ag.add({ id, scene: true, name: w.name, city: w.b.city, home: w.b, x: w.b.x, z: w.b.z, act: w.kind, color: SCENE_COLOR[w.kind] || '#ffffff', scale: w.name ? 1.25 : 1, pace: w.kind === 'soldier' ? 7 : 9 });
        if (!a) continue; this.actors.set(id, a);
        if (w.loop && w.b.extra?.track) { const t = w.b.extra.track; this.ag.loop(a, t, (2 * (t.w + t.d)) * (w.k / (w.n || 6)) + (w.n ? 0 : w.k * 7)); }
        else if (w.queue) this.ag.pin(a, w.b.x + 10, w.b.z - 12 + w.k * 3.2);
        else this.ag.pin(a, ...this.spot(w.b, w.k));
      }
      a.b = w.b; a.what = w.what; a.name = w.name; a.tag = w.tag === true ? `${w.name}: ${w.what}` : (w.tag || null);
    }

    // 5. Arrests: new detected incidents animate once (officer escorts the suspect station -> remand jail)
    const fresh = inc.filter(i => SHOWN.has(i.status) && i.perps?.length && i.solvedBy && i.solvedDay === s.day && !this.seen.has(i.id)).sort((a, b) => a.id - b.id);
    const play = this.first ? fresh.slice(-3) : fresh.slice(-6);
    for (const i of fresh) if (!play.includes(i)) this.seen.add(i.id);
    play.forEach((i, n) => {
      // the suspect's city when known, else the arresting officer's, else the capital
      const cid = this.cityOfCitizen(i.perps[0]) || this.cityOfCitizen(i.solvedBy) || 'neura';
      this.seen.add(i.id);
      setTimeout(() => this.escort(i, cid), n * 2500);
    });
    this.first = false;
  }

  escort(i, cid) {
    const station = this.find('police_station', cid), jail = this.find('jail', cid); if (!station || !jail) return;
    const officer = this.h.nameOf(i.solvedBy), perp = this.h.nameOf(i.perps[0]);
    const mk = (id, kind, name, dx, what, tag) => {
      const a = this.ag.add({ id, scene: true, transient: true, name, city: cid, home: station, x: station.x + dx, z: station.z + station.d / 2 - 4, act: kind, color: SCENE_COLOR[kind], scale: 1.3 });
      if (!a) return null; a.b = jail; a.what = what; a.tag = tag; this.actors.set(id, a);
      this.ag.walkTo(a, jail.x + dx, jail.z + jail.d / 2 - 4, () => { this.ag.pin(a, a.x, a.z); setTimeout(() => this.drop(a), 9000); });
      return a;
    };
    mk(`scene:esc:${i.id}:o`, 'officer', officer, 0, `escorting ${perp} to the jail`, `${officer} arrests ${perp} (${i.type})`);
    mk(`scene:esc:${i.id}:p`, 'suspect', perp, 2.5, `arrested for ${i.type}`, null);
  }
  drop(a) { if (this.actors.get(a.id) === a) { this.ag.remove(a); this.actors.delete(a.id); } }
  // people the scenes put at one building (for the info panel)
  at(b) { const out = []; for (const a of this.actors.values()) if (a.b === b) out.push(a); return out; }
}
