"""Independent verification of the national ledger's hash chain.

The server can verify itself (`/api/ledger/verify`), but a citizen should not have to trust it.
This module downloads every entry and recomputes the chain from the genesis hash with its own
canonical-JSON implementation. It also summarises what the ledger says happened.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Iterable

from .canon import GENESIS, entry_hash


@dataclass
class ChainReport:
    ok: bool = True
    checked: int = 0
    head: str = GENESIS
    broken_at: int | None = None
    reason: str | None = None
    gaps: list[int] = field(default_factory=list)
    kinds: Counter = field(default_factory=Counter)
    first_ts: int | None = None
    last_ts: int | None = None

    def as_dict(self) -> dict:
        return {
            "ok": self.ok, "checked": self.checked, "head": self.head, "brokenAt": self.broken_at,
            "reason": self.reason, "gaps": self.gaps[:20], "kinds": dict(self.kinds.most_common()),
            "firstTs": self.first_ts, "lastTs": self.last_ts,
        }


def verify_chain(entries: Iterable[dict]) -> ChainReport:
    rep = ChainReport()
    prev, expected_seq = GENESIS, 1
    for e in entries:
        seq = e.get("seq")
        if seq != expected_seq:
            rep.gaps.append(expected_seq)
            if rep.ok:
                rep.ok, rep.broken_at, rep.reason = False, seq, f"sequence jumps from {expected_seq - 1} to {seq}"
        if e.get("prev") != prev:
            if rep.ok:
                rep.ok, rep.broken_at, rep.reason = False, seq, "prev hash does not match the previous entry"
        h = entry_hash(prev, e)
        if h != e.get("hash"):
            if rep.ok:
                rep.ok, rep.broken_at, rep.reason = False, seq, "content does not match its hash (entry altered)"
        prev = e.get("hash") or h
        expected_seq = (seq or expected_seq) + 1
        rep.checked += 1
        rep.kinds[e.get("kind", "?")] += 1
        ts = e.get("ts")
        if ts is not None:
            rep.first_ts = ts if rep.first_ts is None else min(rep.first_ts, ts)
            rep.last_ts = ts if rep.last_ts is None else max(rep.last_ts, ts)
    rep.head = prev
    return rep


def summarise(entries: list[dict]) -> dict:
    """What the ledger records, grouped for a human report."""
    out: dict = {
        "laws": [], "appointments": [], "elections": [], "rulings": [], "sentences": [], "amendments": [],
        "orders": [], "qualified": 0, "vacated": 0, "crimes": Counter(), "arrests": 0, "audits": 0, "census": 0,
    }
    for e in entries:
        k, d = e.get("kind"), e.get("data") or {}
        if k == "law":
            out["laws"].append({"day": e.get("day"), "title": d.get("title"), "type": d.get("type"), "value": d.get("value"), "how": d.get("how")})
        elif k == "order":
            out["orders"].append({"day": e.get("day"), "president": e.get("actor"), "order": d.get("order"), "spend": d.get("spend")})
        elif k in ("qualified", "vacated"):
            out[k] += 1
        elif k in ("appointed", "sworn"):
            out["appointments"].append({"day": e.get("day"), "kind": k, "by": e.get("actor"), "office": d.get("office"),
                                         "agent": d.get("agent") or e.get("actor"), "how": d.get("how") or d.get("mandate") or d.get("slot")})
        elif k == "election_result":
            out["elections"].append({"day": e.get("day"), "id": d.get("election"), "office": d.get("office"), "kind": d.get("kind"),
                                      "winners": d.get("winners"), "ballots": d.get("ballots"), "digest": d.get("digest"),
                                      "turnout": (d.get("metrics") or {}).get("turnout")})
        elif k == "court_ruling":
            out["rulings"].append({"day": e.get("day"), "case": d.get("case"), "kind": d.get("kind"), "ruling": d.get("ruling")})
        elif k == "sentence":
            out["sentences"].append({"day": e.get("day"), "perps": d.get("perps"), "type": d.get("type"), "days": d.get("days"), "court": d.get("court")})
        elif k == "amendment":
            out["amendments"].append({"day": e.get("day"), "version": d.get("version"), "title": d.get("title")})
        elif k == "incident":
            out["crimes"][d.get("type", "?")] += 1
        elif k == "arrest":
            out["arrests"] += 1
        elif k == "audit_report":
            out["audits"] += 1
        elif k == "census":
            out["census"] += 1
    out["crimes"] = dict(out["crimes"])
    return out
