"""Watch a running republic for a fixed time and keep an hourly audit trail.

Every `interval` seconds it records one observation (JSON Lines) with:
  * the public state's headline numbers and the census hour,
  * every invariant from invariants.py,
  * an incremental, independent verification of the ledger hash chain,
  * a recount of every election that finished since the last observation,
  * the server's own verdict on its ledger (to compare with ours),
  * response time and any error reaching the server.
At the end (or at any time) report.py turns the file into a readable report.
"""
from __future__ import annotations

import json
import os
import signal
import time
from dataclasses import dataclass, field

from .canon import GENESIS, entry_hash
from .invariants import run_all
from .recount import recount
from .source import ApiSource


@dataclass
class ChainCursor:
    """Keeps the chain check incremental: only new entries are downloaded each hour."""
    after: int = 0
    prev: str = GENESIS
    checked: int = 0
    broken: dict | None = None
    kinds: dict = field(default_factory=dict)

    def advance(self, src: ApiSource) -> dict:
        new = 0
        for e in src.ledger(after=self.after):
            if self.broken is None:
                if e.get("seq") != self.after + 1:
                    self.broken = {"seq": e.get("seq"), "reason": f"gap after {self.after}"}
                elif e.get("prev") != self.prev or entry_hash(self.prev, e) != e.get("hash"):
                    self.broken = {"seq": e.get("seq"), "reason": "hash mismatch"}
            self.after, self.prev = e["seq"], e.get("hash", "")
            self.checked += 1
            new += 1
            self.kinds[e.get("kind", "?")] = self.kinds.get(e.get("kind", "?"), 0) + 1
        return {"ok": self.broken is None, "checked": self.checked, "new": new, "head": self.prev, "broken": self.broken}


def observe(src: ApiSource, cursor: ChainCursor, recounted: set[int]) -> dict:
    t0 = time.time()
    obs: dict = {"ts": int(t0 * 1000)}
    try:
        st = src.state()
        obs["latencyMs"] = int((time.time() - t0) * 1000)
    except Exception as exc:
        obs["error"] = f"state unreachable: {exc}"
        return obs
    obs["day"] = st.get("day")
    obs["paused"] = st.get("paused")
    obs["stats"] = st.get("stats")
    obs["seats"] = {k: len(v or []) for k, v in (st.get("seats") or {}).items()}
    obs["holders"] = st.get("seats")
    obs["treasury"] = st.get("treasury")
    obs["policy"] = st.get("policy")
    obs["llm"] = st.get("llmUsage")
    obs["engine"] = (st.get("config") or {}).get("engineLabel")
    citizens = st.get("citizens") or []
    obs["status"] = {k: sum(1 for a in citizens if a.get("status") == k) for k in ("free", "detained", "jailed", "left")}
    obs["factions"] = {k: sum(1 for a in citizens if (a.get("faction") or "civilian") == k) for k in ("civilian", "underworld")}
    obs["offices"] = {a["id"]: a.get("office") for a in citizens if a.get("office")}
    obs["engines"] = {}
    for d in st.get("decisions") or []:
        eng = d.get("engine") or "?"
        obs["engines"][eng] = obs["engines"].get(eng, 0) + 1
    obs["recentDecisions"] = [
        {k: d.get(k) for k in ("id", "day", "agentId", "role", "type", "title", "chosen", "reason", "engine", "outcome")}
        for d in (st.get("decisions") or [])[-12:]
    ]
    obs["invariants"] = run_all(st)
    try:
        census = src.get("/api/census") or {}
        obs["census"] = (census.get("hours") or [])[-1:] or None
        obs["stepErrors"] = census.get("stepErrors")
        obs["lastStepError"] = census.get("lastStepError")
    except Exception as exc:
        obs["census"] = None
        obs["censusError"] = str(exc)
    try:
        obs["chain"] = cursor.advance(src)
        obs["serverChain"] = src.server_verify()
    except Exception as exc:
        obs["chainError"] = str(exc)
    obs["recounts"] = []
    for e in st.get("elections") or []:
        if e.get("stage") in ("certify", "done") and e.get("id") not in recounted:
            body = src.election(e["id"])
            r = recount(body) if body else None
            if r:
                recounted.add(e["id"])
                obs["recounts"].append(r.as_dict())
    obs["elections"] = [{k: e.get(k) for k in ("id", "office", "city", "kind", "stage", "voted", "electorate")} for e in st.get("elections") or []]
    return obs


def run(base: str, out: str, hours: float, interval: float) -> int:
    src = ApiSource(base)
    cursor, recounted = ChainCursor(), set()
    end = time.time() + hours * 3600
    stop = {"now": False}
    signal.signal(signal.SIGINT, lambda *_: stop.update(now=True))
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    n = 0
    while not stop["now"]:
        obs = observe(src, cursor, recounted)
        with open(out, "a", encoding="utf-8") as f:
            f.write(json.dumps(obs, ensure_ascii=False) + "\n")
        n += 1
        bad = [k for k, v in (obs.get("invariants") or {}).get("checks", {}).items() if v]
        print(f"[{time.strftime('%H:%M:%S')}] obs {n}: day {obs.get('day')} "
              f"chain {'ok' if (obs.get('chain') or {}).get('ok') else 'BROKEN/?'} "
              f"({(obs.get('chain') or {}).get('checked')}) invariants {'ok' if not bad else bad} "
              f"recounts {len(obs.get('recounts') or [])}", flush=True)
        if time.time() >= end:
            break
        time.sleep(max(1.0, min(interval, end - time.time())))
    return n
