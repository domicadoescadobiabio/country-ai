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
    all: db.prepare('SELECT * FROM ledger ORDER BY seq'),
    count: db.prepare('SELECT COUNT(*) AS n FROM ledger'),
    dec: db.prepare('INSERT OR REPLACE INTO decisions (id, day, agent, role, type, json) VALUES (?, ?, ?, ?, ?, ?)'),
    decCount: db.prepare('SELECT COUNT(*) AS n FROM decisions'),
  };
  let head = q.last.get() || { seq: 0, hash: GENESIS };

  function loadState() {
    const row = q.load.get();
    if (row) return JSON.parse(row.json);
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
    saveState(S) { q.save.run(JSON.stringify(S), Date.now()); },
    append(e) {
      const row = { seq: head.seq + 1, ts: Date.now(), day: e.day ?? 0, kind: String(e.kind), actor: String(e.actor || 'state'), data: e.data ?? {} };
      const prev = head.hash;
      const hash = entryHash(prev, row);
      q.add.run(row.seq, row.ts, row.day, row.kind, row.actor, canon(row.data), prev, hash);
      head = { seq: row.seq, hash };
      return { ...row, prev, hash };
    },
    page(after = 0, limit = 100) { return q.page.all(after, Math.min(500, limit)).map(r => ({ ...r, data: JSON.parse(r.data) })); },
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
    close() { db.close(); },
  };
}

// Fallback for runtimes without node:sqlite: same interface, ledger kept inside the snapshot file.
function jsonStore(file: string) {
  let ledger = [];
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
    page(after = 0, limit = 100) { return ledger.filter(r => r.seq > after).slice(0, Math.min(500, limit)); },
    head: () => ({ ...head, count: ledger.length }),
    verify() {
      let prev = GENESIS, n = 0;
      for (const r of ledger) { if (r.prev !== prev || r.hash !== entryHash(prev, r)) return { ok: false, brokenAt: r.seq, checked: n }; prev = r.hash; n++; }
      return { ok: true, checked: n, head: prev };
    },
    archiveDecision() {},
    decisionCount: () => 0,
    close() {},
  };
  return store;
}
