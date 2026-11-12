"""Where the auditor reads from: the public HTTP API of a running republic, or its SQLite file.

Only public, read-only endpoints are used. The auditor never sends the admin token and never
writes to the database (the SQLite file is opened read-only through a URI).
"""
from __future__ import annotations

import json
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Iterator

USER_AGENT = "country-ai-auditor/1.0"


class ApiSource:
    def __init__(self, base: str, timeout: float = 30.0, retries: int = 3):
        parsed = urllib.parse.urlparse(base)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError(f"not an http(s) URL: {base!r}")
        self.base = base.rstrip("/")
        self.timeout = timeout
        self.retries = retries

    def get(self, path: str, **params: Any) -> Any:
        query = ("?" + urllib.parse.urlencode(params)) if params else ""
        url = self.base + path + query
        last: Exception | None = None
        for attempt in range(self.retries):
            try:
                req = urllib.request.Request(url, headers={"user-agent": USER_AGENT, "accept": "application/json"})
                with urllib.request.urlopen(req, timeout=self.timeout) as res:  # noqa: S310 (scheme checked above)
                    return json.loads(res.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return None
                last = e
            except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError) as e:
                last = e
            time.sleep(1.5 * (attempt + 1))
        raise ConnectionError(f"GET {url} failed after {self.retries} attempts: {last}")

    def state(self) -> dict:
        return self.get("/api/state")

    def ledger(self, after: int = 0, page: int = 500) -> Iterator[dict]:
        while True:
            body = self.get("/api/ledger", after=after, limit=page)
            entries = (body or {}).get("entries") or []
            yield from entries
            if len(entries) < page:
                return
            after = entries[-1]["seq"]

    def ledger_kind(self, kind: str, after: int = 0, page: int = 500) -> Iterator[dict]:
        """Entries of one kind only (server-side filter); the chain check still needs the full ledger."""
        while True:
            body = self.get("/api/ledger", kind=kind, after=after, limit=page)
            entries = (body or {}).get("entries") or []
            yield from (e for e in entries if e.get("kind") == kind)  # ignore the filter if a server lacks it
            if len(entries) < page:
                return
            after = entries[-1]["seq"]

    def decisions(self, after: int = 0, type: str | None = None, agent: str | None = None, page: int = 500) -> Iterator[dict]:
        """The full decision log (`/api/state.decisions` holds only the last 120)."""
        params = {k: v for k, v in (("type", type), ("agent", agent)) if v}
        while True:
            body = self.get("/api/decisions", after=after, limit=page, **params)
            if body is None:
                raise LookupError("/api/decisions not available")
            entries = body.get("entries") or []
            yield from entries
            if len(entries) < page:
                return
            after = entries[-1]["id"]

    def health(self) -> dict:
        return self.get("/api/health") or {}

    def ledger_head(self) -> dict:
        return (self.get("/api/ledger", after=0, limit=1) or {}).get("head") or {}

    def server_verify(self) -> dict:
        return self.get("/api/ledger/verify") or {}

    def elections(self) -> list[dict]:
        return (self.get("/api/elections") or {}).get("elections") or []

    def election(self, eid: int) -> dict | None:
        return self.get(f"/api/elections/{int(eid)}")


class SqliteSource:
    """Read a copy of the republic's country.db (for example a backup pulled from the volume)."""

    def __init__(self, file: str):
        uri = "file:" + urllib.parse.quote(file.replace("\\", "/")) + "?mode=ro"
        self.db = sqlite3.connect(uri, uri=True)
        self.db.row_factory = sqlite3.Row

    def ledger(self, after: int = 0, page: int = 500) -> Iterator[dict]:
        for row in self.db.execute("SELECT * FROM ledger WHERE seq > ? ORDER BY seq", (after,)):
            yield {**dict(row), "data": json.loads(row["data"])}

    def state(self) -> dict:
        row = self.db.execute("SELECT json FROM state WHERE id = 1").fetchone()
        return json.loads(row["json"]) if row else {}

    def close(self) -> None:
        self.db.close()


class JsonlSource:
    """A ledger exported as JSON Lines (scripts/ops/export-ledger.sh)."""

    def __init__(self, file: str):
        self.file = file

    def ledger(self, after: int = 0, page: int = 500) -> Iterator[dict]:
        with open(self.file, encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    e = json.loads(line)
                    if e.get("seq", 0) > after:
                        yield e


def open_source(target: str) -> ApiSource | SqliteSource | JsonlSource:
    if target.startswith(("http://", "https://")):
        return ApiSource(target)
    if target.endswith((".jsonl", ".ndjson")):
        return JsonlSource(target)
    return SqliteSource(target)
