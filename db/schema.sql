-- COUNTRY AI storage schema (node:sqlite / SQLite 3).
-- Loaded by src/db.ts on every start; every statement is idempotent.

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

-- The republic's live state: a single row holding the latest snapshot (written every few seconds).
CREATE TABLE IF NOT EXISTS state (
  id        INTEGER PRIMARY KEY CHECK (id = 1),
  json      TEXT    NOT NULL,
  saved_at  INTEGER NOT NULL
);

-- The national ledger. Append-only: every row carries the hash of the row before it,
--   hash = sha256(prev || '|' || canonical_json({seq, ts, day, kind, actor, data}))
-- so changing or removing any entry breaks every hash after it. The triggers below make the
-- database itself refuse edits; the hash chain makes any edit made around them detectable.
CREATE TABLE IF NOT EXISTS ledger (
  seq    INTEGER PRIMARY KEY,
  ts     INTEGER NOT NULL,
  day    INTEGER NOT NULL,
  kind   TEXT    NOT NULL,
  actor  TEXT    NOT NULL,
  data   TEXT    NOT NULL,          -- canonical JSON
  prev   TEXT    NOT NULL,          -- hash of seq - 1 (64 zeros for the first entry)
  hash   TEXT    NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS ledger_kind ON ledger (kind, seq);
CREATE INDEX IF NOT EXISTS ledger_day  ON ledger (day, seq);

CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger
BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON ledger
BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;

-- Citizens, one row each (10,000+): only the citizens that changed are written on each save.
CREATE TABLE IF NOT EXISTS citizens (
  id    TEXT    PRIMARY KEY,
  pos   INTEGER NOT NULL,           -- order in the population (founders first)
  json  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS citizens_pos ON citizens (pos);

-- Anonymised ballots of every finished election (thousands per election), for public recounts.
CREATE TABLE IF NOT EXISTS election_ballots (
  election INTEGER PRIMARY KEY,
  digest   TEXT    NOT NULL,
  json     TEXT    NOT NULL           -- sorted list of 'a>b>c' rankings or 'BLANK'
);

-- Full archive of the decision log (memory keeps only the latest few hundred decisions).
CREATE TABLE IF NOT EXISTS decisions (
  id     INTEGER PRIMARY KEY,
  day    INTEGER NOT NULL,
  agent  TEXT,
  role   TEXT,
  type   TEXT,
  json   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS decisions_agent ON decisions (agent, id);
CREATE INDEX IF NOT EXISTS decisions_type  ON decisions (type, id);

-- The school's distillation set: a question, the paid teacher's answer and explanation, the local student's
-- answer and its grade. Rows are never edited; the oldest are dropped past TRAIN_EXAMPLES_MAX (rotation).
-- No agent ids, owners or keys: text is masked before it is written (src/brains.ts saveExample).
CREATE TABLE IF NOT EXISTS train_examples (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              INTEGER NOT NULL,
  day             INTEGER NOT NULL,
  purpose         TEXT    NOT NULL,
  question        TEXT    NOT NULL,
  teacher         TEXT    NOT NULL,
  explanation     TEXT    NOT NULL DEFAULT '',
  student         TEXT    NOT NULL DEFAULT '',
  score           REAL,
  teacher_engine  TEXT    NOT NULL DEFAULT '',
  student_engine  TEXT    NOT NULL DEFAULT '',
  domain          TEXT    NOT NULL DEFAULT 'general', -- field of study (math, biology, law...): one LoRA per field
  teacher_kind    TEXT    NOT NULL DEFAULT '',        -- claude / openrouter: which teacher wrote it
  verified        TEXT    NOT NULL DEFAULT '',        -- key (the server's answer key matched) / rubric (graded by the teacher's rubric)
  qhash           TEXT                                -- sha256 of the normalised question: one example per question
);
-- the indexes on domain and qhash are created in src/db.ts, after older databases get those columns
CREATE TRIGGER IF NOT EXISTS train_examples_no_update BEFORE UPDATE ON train_examples
BEGIN SELECT RAISE(ABORT, 'train_examples is append-only'); END;

-- Read-only views for auditors working on a copy of the database.
CREATE VIEW IF NOT EXISTS ledger_by_kind AS
  SELECT kind, COUNT(*) AS entries, MIN(day) AS first_day, MAX(day) AS last_day
  FROM ledger GROUP BY kind;

CREATE VIEW IF NOT EXISTS census_hours AS
  SELECT seq, day,
         json_extract(data, '$.hour')       AS hour,
         json_extract(data, '$.citizens')   AS citizens,
         json_extract(data, '$.seated')     AS seated,
         json_extract(data, '$.treasury')   AS treasury,
         json_extract(data, '$.crimes')     AS crimes,
         json_extract(data, '$.arrests')    AS arrests,
         json_extract(data, '$.laws')       AS laws,
         json_extract(data, '$.llm.calls')  AS llm_calls,
         json_extract(data, '$.llm.errors') AS llm_errors
  FROM ledger WHERE kind = 'census';

CREATE VIEW IF NOT EXISTS decisions_by_engine AS
  SELECT json_extract(json, '$.engine') AS engine, role, COUNT(*) AS decisions
  FROM decisions GROUP BY engine, role;
