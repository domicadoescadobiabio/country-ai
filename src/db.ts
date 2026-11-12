// Durable storage on node:sqlite (no dependency):
//   state     - one row with the republic's state snapshot (written every few seconds)
//   ledger    - append-only national record, every row hash-chained to the one before it
//   decisions - full archive of the decision log (memory keeps only the latest 400)
// If node:sqlite is unavailable (Node < 22.13), falls back to the JSON file + an in-state ledger.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

let sqlite = null;
try { sqlite = await import('node:sqlite'); } catch { /* old Node */ }

const GENESIS = '0'.repeat(64);
const SCHEMA = new URL('../db/schema.sql', import.meta.url);
// Canonical JSON (sorted keys) so the hash does not depend on key order.
export function canon(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
}
// ledgerHas(kind, match): match is a few top-level data fields. Names must be plain identifiers and values
// scalars (undefined = null, as canon() stores it); anything else returns null and the caller sees "not found".
function matchPairs(match): [string, string | number | boolean | null][] | null {
  if (!match || typeof match !== 'object' || Array.isArray(match)) return null;
  const pairs = Object.entries(match);
  if (pairs.length > 8) return null;
  const out = [];
  for (const [k, v0] of pairs) {
    const v = v0 === undefined ? null : v0;
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(k)) return null;
    if (!(v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)))) return null;
    out.push([k, v]);
  }
  return out;
}
// Ledger pages hold 1..500 entries. SQLite reads a negative LIMIT as "no limit", so clamp both ends.
const pageSize = limit => Math.min(500, Math.max(1, Math.floor(Number(limit)) || 100));
export const entryHash = (prev, e) => crypto.createHash('sha256').update(prev + '|' + canon({ seq: e.seq, ts: e.ts, day: e.day, kind: e.kind, actor: e.actor, data: e.data })).digest('hex');

export function openStore(dataDir: string) {
  fs.mkdirSync(dataDir, { recursive: true });
  const jsonFile = path.join(dataDir, 'state.json');
  if (!sqlite) return jsonStore(jsonFile);

  const db = new sqlite.DatabaseSync(path.join(dataDir, 'country.db'));
  db.exec(fs.readFileSync(SCHEMA, 'utf8')); // db/schema.sql: tables, append-only triggers, audit views
  const q = {
    load: db.prepare('SELECT json FROM state WHERE id = 1'),
    save: db.prepare('INSERT INTO state (id, json, saved_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, saved_at = excluded.saved_at'),
    last: db.prepare('SELECT seq, hash FROM ledger ORDER BY seq DESC LIMIT 1'),
    add: db.prepare('INSERT INTO ledger (seq, ts, day, kind, actor, data, prev, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    page: db.prepare('SELECT * FROM ledger WHERE seq > ? ORDER BY seq LIMIT ?'),
    pageKind: db.prepare('SELECT * FROM ledger WHERE kind = ? AND seq > ? ORDER BY seq LIMIT ?'), // index ledger_kind (kind, seq)
    all: db.prepare('SELECT * FROM ledger ORDER BY seq'),
    count: db.prepare('SELECT COUNT(*) AS n FROM ledger'),
    dec: db.prepare('INSERT OR REPLACE INTO decisions (id, day, agent, role, type, json) VALUES (?, ?, ?, ?, ?, ?)'),
    decCount: db.prepare('SELECT COUNT(*) AS n FROM decisions'),
    // archive pages (oldest first, after an id): all, by type, by agent; indexes decisions_type / decisions_agent
    decPage: db.prepare('SELECT json FROM decisions WHERE id > ? ORDER BY id LIMIT ?'),
    decPageType: db.prepare('SELECT json FROM decisions WHERE type = ? AND id > ? ORDER BY id LIMIT ?'),
    decPageAgent: db.prepare('SELECT json FROM decisions WHERE agent = ? AND id > ? ORDER BY id LIMIT ?'),
    decPageBoth: db.prepare('SELECT json FROM decisions WHERE agent = ? AND type = ? AND id > ? ORDER BY id LIMIT ?'),
    citAll: db.prepare('SELECT json FROM citizens ORDER BY pos'),
    citPut: db.prepare('INSERT INTO citizens (id, pos, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET pos = excluded.pos, json = excluded.json'),
    citDel: db.prepare('DELETE FROM citizens WHERE id = ?'),
    citCount: db.prepare('SELECT COUNT(*) AS n FROM citizens'),
    ballotsPut: db.prepare('INSERT OR REPLACE INTO election_ballots (election, digest, json) VALUES (?, ?, ?)'),
    ballotsGet: db.prepare('SELECT json FROM election_ballots WHERE election = ?'),
  };
  // ledgerHas: one prepared statement per number of fields matched. Field names travel as JSON-path
  // parameters, never inside the SQL text; uses the (kind, seq) index, then checks the data of that kind.
  const hasQ = new Map<number, any>();
  const hasStmt = n => {
    if (!hasQ.has(n)) hasQ.set(n, db.prepare(`SELECT 1 FROM ledger WHERE kind = ?${' AND json_extract(data, ?) IS ?'.repeat(n)} LIMIT 1`));
    return hasQ.get(n);
  };
  // what was last written for each citizen: only citizens whose JSON changed are written again
  const written = new Map<string, string>();
  let head = q.last.get() || { seq: 0, hash: GENESIS };

  function loadState() {
    const row = q.load.get();
    if (row) {
      const s = JSON.parse(row.json);
      // citizens live in their own table (10,000 of them would make the snapshot huge); older saves kept them inline
      if (!Array.isArray(s.citizens) || q.citCount.get().n > 0) {
        s.citizens = q.citAll.all().map(r => { written.set(JSON.parse(r.json).id, r.json); return JSON.parse(r.json); });
      }
      return s;
    }
    // one-time migration from the old JSON file
    try {
      const raw = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
      fs.renameSync(jsonFile, jsonFile + '.migrated');
      return raw;
    } catch { return null; }
  }
  return {
    kind: 'sqlite',
    loadState,
    saveState(S) {
      const { citizens, ...rest } = S;
      db.exec('BEGIN');
      try {
        q.save.run(JSON.stringify(rest), Date.now());
        const seen = new Set<string>();
        citizens.forEach((a, pos) => {
          const j = JSON.stringify(a); seen.add(a.id);
          if (written.get(a.id) !== j) { q.citPut.run(a.id, pos, j); written.set(a.id, j); }
        });
        for (const id of [...written.keys()]) if (!seen.has(id)) { q.citDel.run(id); written.delete(id); }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    // anonymised ballots of finished elections (thousands per election) live here, not in the snapshot
    archiveBallots(election, digest, list) { q.ballotsPut.run(election, digest || '', JSON.stringify(list)); },
    ballotsOf(election) { const r = q.ballotsGet.get(election); return r ? JSON.parse(r.json) : null; },
    append(e) {
      const row = { seq: head.seq + 1, ts: Date.now(), day: e.day ?? 0, kind: String(e.kind), actor: String(e.actor || 'state'), data: e.data ?? {} };
      const prev = head.hash;
      const hash = entryHash(prev, row);
      q.add.run(row.seq, row.ts, row.day, row.kind, row.actor, canon(row.data), prev, hash);
      head = { seq: row.seq, hash };
      return { ...row, prev, hash };
    },
    // kind: optional read-only filter (entries keep their own seq, prev and hash; pages chain on seq as before)
    page(after = 0, limit = 100, kind = null) {
      const rows = kind ? q.pageKind.all(String(kind), after, pageSize(limit)) : q.page.all(after, pageSize(limit));
      return rows.map(r => ({ ...r, data: JSON.parse(r.data) }));
    },
    ledgerHas(kind, match = {}) {
      const pairs = matchPairs(match); if (!pairs) return false;
      const args: any[] = [String(kind)];
      // json_extract gives 1/0 for JSON true/false and NULL for a missing field, so `IS` compares all of them
      for (const [k, v] of pairs) args.push(`$.${k}`, typeof v === 'boolean' ? Number(v) : v);
      return !!hasStmt(pairs.length).get(...args);
    },
    head: () => ({ ...head, count: q.count.get().n }),
    verify() {
      let prev = GENESIS, n = 0;
      for (const r of q.all.iterate()) {
        const h = entryHash(prev, { ...r, data: JSON.parse(r.data) });
        if (r.prev !== prev || r.hash !== h) return { ok: false, brokenAt: r.seq, checked: n };
        prev = r.hash; n++;
      }
      return { ok: true, checked: n, head: prev };
    },
    archiveDecision(d) { q.dec.run(d.id, d.day, d.agentId || null, d.role || null, d.type || null, JSON.stringify(d)); },
    decisionCount: () => q.decCount.get().n,
    // read-only: the full decision log, the same records /api/state and #decisions already show live
    decisionsPage({ after = 0, limit = 100, type = null, agent = null } = {}) {
      const n = pageSize(limit);
      const rows = agent && type ? q.decPageBoth.all(String(agent), String(type), after, n)
        : type ? q.decPageType.all(String(type), after, n)
        : agent ? q.decPageAgent.all(String(agent), after, n)
        : q.decPage.all(after, n);
      return rows.map(r => JSON.parse(r.json));
    },
    close() { db.close(); },
  };
}

// Fallback for runtimes without node:sqlite: same interface, ledger kept inside the snapshot file.
function jsonStore(file: string) {
  let ledger = [];
  const ballots = {};
  let head = { seq: 0, hash: GENESIS };
  const store = {
    kind: 'json',
    loadState() {
      try { const s = JSON.parse(fs.readFileSync(file, 'utf8')); ledger = s.__ledger || []; delete s.__ledger; const l = ledger[ledger.length - 1]; if (l) head = { seq: l.seq, hash: l.hash }; return s; } catch { return null; }
    },
    saveState(S) { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ ...S, __ledger: ledger })); fs.renameSync(tmp, file); },
    append(e) {
      const row = { seq: head.seq + 1, ts: Date.now(), day: e.day ?? 0, kind: String(e.kind), actor: String(e.actor || 'state'), data: JSON.parse(canon(e.data ?? {})) };
      const hash = entryHash(head.hash, row);
      ledger.push({ ...row, prev: head.hash, hash }); head = { seq: row.seq, hash };
      return { ...row, hash };
    },
    page(after = 0, limit = 100, kind = null) { return ledger.filter(r => r.seq > after && (!kind || r.kind === String(kind))).slice(0, pageSize(limit)); },
    ledgerHas(kind, match = {}) {
      const pairs = matchPairs(match); if (!pairs) return false;
      return ledger.some(r => r.kind === String(kind) && pairs.every(([k, v]) => (r.data?.[k] ?? null) === v));
    },
    head: () => ({ ...head, count: ledger.length }),
    verify() {
      let prev = GENESIS, n = 0;
      for (const r of ledger) { if (r.prev !== prev || r.hash !== entryHash(prev, r)) return { ok: false, brokenAt: r.seq, checked: n }; prev = r.hash; n++; }
      return { ok: true, checked: n, head: prev };
    },
    archiveDecision() {},
    archiveBallots(election, digest, list) { (ballots[election] = list); },
    ballotsOf(election) { return ballots[election] || null; },
    decisionCount: () => 0,
    decisionsPage: null, // no archive without sqlite: the server falls back to the decisions kept in memory
    close() {},
  };
  return store;
}
