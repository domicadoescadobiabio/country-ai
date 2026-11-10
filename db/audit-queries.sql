-- Ready-made audit queries for a copy of country.db:
--   sqlite3 -readonly country.db < db/audit-queries.sql

.headers on
.mode column

-- 1. What the ledger contains
SELECT * FROM ledger_by_kind ORDER BY entries DESC;

-- 2. The chain must be gap-free: any row printed here is a missing sequence number
SELECT l.seq + 1 AS missing_after
FROM ledger l LEFT JOIN ledger n ON n.seq = l.seq + 1
WHERE n.seq IS NULL AND l.seq < (SELECT MAX(seq) FROM ledger);

-- 3. Every entry must point at the hash of the entry before it
SELECT l.seq, l.prev, p.hash AS previous_hash
FROM ledger l JOIN ledger p ON p.seq = l.seq - 1
WHERE l.prev <> p.hash;

-- 4. Laws enacted, in order
SELECT day, json_extract(data, '$.title') AS law, json_extract(data, '$.how') AS how
FROM ledger WHERE kind = 'law' ORDER BY seq;

-- 5. Who holds power: appointments and oaths
SELECT day, kind, json_extract(data, '$.office') AS office,
       COALESCE(json_extract(data, '$.agent'), actor) AS agent,
       COALESCE(json_extract(data, '$.how'), json_extract(data, '$.mandate')) AS how
FROM ledger WHERE kind IN ('appointed', 'sworn') ORDER BY seq;

-- 6. Elections and their published ballot digests
SELECT day, json_extract(data, '$.election') AS election, json_extract(data, '$.office') AS office,
       json_extract(data, '$.kind') AS kind, json_extract(data, '$.winners') AS winners,
       json_extract(data, '$.ballots') AS ballots, json_extract(data, '$.metrics.turnout') AS turnout
FROM ledger WHERE kind = 'election_result' ORDER BY seq;

-- 7. Due process: every sentence must follow a guilty ruling in the same case
SELECT s.seq, json_extract(s.data, '$.court') AS court_case,
       (SELECT json_extract(r.data, '$.ruling') FROM ledger r
        WHERE r.kind = 'court_ruling' AND json_extract(r.data, '$.case') = json_extract(s.data, '$.court')
          AND r.seq < s.seq) AS ruling,
       json_extract(s.data, '$.days') AS jail_days
FROM ledger s WHERE s.kind = 'sentence';

-- 8. Crime by type, and how much was taken
SELECT json_extract(data, '$.type') AS type, COUNT(*) AS incidents, SUM(json_extract(data, '$.amount')) AS amount,
       SUM(json_extract(data, '$.hidden')) AS hidden_at_first
FROM ledger WHERE kind = 'incident' GROUP BY type ORDER BY incidents DESC;

-- 9. The day hour by hour
SELECT * FROM census_hours ORDER BY seq;

-- 10. Which brains made the decisions
SELECT * FROM decisions_by_engine ORDER BY decisions DESC;
