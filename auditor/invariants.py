"""Rules that must hold at every moment, checked from the public state.

Each check returns a list of violations (empty = the rule holds). They mirror the constitution:
nobody holds two offices, nobody in jail holds an office, nobody is detained longer than the
due-process limit, money does not go negative, seats never exceed their size, and so on.
"""
from __future__ import annotations

from collections import Counter
from typing import Callable

DETENTION_LIMIT_DAYS = 3
SEAT_SIZES = {"president": 1, "council": 5, "police_chief": 1, "military_chief": 1}

Check = Callable[[dict], list[str]]
CHECKS: list[tuple[str, Check]] = []


def check(name: str):
    def wrap(fn: Check) -> Check:
        CHECKS.append((name, fn))
        return fn
    return wrap


def _citizens(s: dict) -> dict:
    return {a["id"]: a for a in s.get("citizens") or []}


@check("every seat holder exists and is free")
def seat_holders_exist(s: dict) -> list[str]:
    cs, out = _citizens(s), []
    for office, ids in (s.get("seats") or {}).items():
        for i in ids or []:
            a = cs.get(i)
            if not a:
                out.append(f"{office}: holder {i} is not a citizen")
            elif a.get("status") in ("jailed", "left"):
                out.append(f"{office}: holder {a['name']} is {a['status']}")
    return out


@check("no citizen holds two seats")
def one_seat_each(s: dict) -> list[str]:
    seen = Counter(i for ids in (s.get("seats") or {}).values() for i in ids or [])
    cs = _citizens(s)
    return [f"{cs.get(i, {}).get('name', i)} holds {n} seats" for i, n in seen.items() if n > 1]


@check("seats never exceed their size")
def seat_sizes(s: dict) -> list[str]:
    roles = {r["id"]: r.get("seats") for r in (s.get("config") or {}).get("roles") or []}
    sizes = {**SEAT_SIZES, **{k: v for k, v in roles.items() if isinstance(v, int)}}
    return [f"{o}: {len(ids)} holders for {sizes[o]} seats" for o, ids in (s.get("seats") or {}).items()
            if o in sizes and len(ids or []) > sizes[o]]


@check("office field agrees with the seat table")
def office_matches_seats(s: dict) -> list[str]:
    holders = {i: o for o, ids in (s.get("seats") or {}).items() for i in ids or []}
    out = []
    for a in s.get("citizens") or []:
        o = a.get("office")
        if o and holders.get(a["id"]) != o:
            out.append(f"{a['name']} says office {o} but the seat table says {holders.get(a['id'])}")
    return out


@check("nobody in jail holds an office")
def jailed_no_office(s: dict) -> list[str]:
    return [f"{a['name']} is jailed but holds {a['office']}" for a in s.get("citizens") or []
            if a.get("status") == "jailed" and a.get("office")]


@check("no wallet and no treasury below zero")
def no_negative_money(s: dict) -> list[str]:
    out = [f"{a['name']} wallet {a['wallet']}" for a in s.get("citizens") or [] if (a.get("wallet") or 0) < 0]
    if (s.get("treasury") or 0) < 0:
        out.append(f"treasury {s['treasury']}")
    return out


@check("detention never longer than the limit without a verdict")
def detention_limit(s: dict) -> list[str]:
    day, out = s.get("day") or 0, []
    for a in s.get("citizens") or []:
        since = a.get("detainedDay")
        if a.get("status") == "detained" and since is not None and day - since > DETENTION_LIMIT_DAYS + 1:
            out.append(f"{a['name']} detained since day {since} (today {day})")
    return out


@check("hidden crimes are never published")
def hidden_stays_hidden(s: dict) -> list[str]:
    incidents = (s.get("police") or {}).get("incidents") or []
    return [f"incident {i.get('id')} is public while hidden" for i in incidents if i.get("status") == "hidden"]


@check("tax rate inside the constitutional band")
def tax_band(s: dict) -> list[str]:
    t = (s.get("policy") or {}).get("taxRate")
    return [] if t is None or 0 <= t <= 0.3 else [f"tax rate {t}"]


@check("every finished election has a result and a digest")
def elections_certified(s: dict) -> list[str]:
    out = []
    els = s.get("elections")
    for e in els if isinstance(els, list) else (els or {}).get("list") or []:
        if e.get("stage") == "done" and not (e.get("result") or {}).get("digest"):
            out.append(f"election {e.get('id')} done without a digest")
    return out


def run_all(state: dict) -> dict:
    results = {}
    for name, fn in CHECKS:
        try:
            v = fn(state)
        except Exception as exc:  # a malformed state is itself a finding
            v = [f"check crashed: {exc!r}"]
        results[name] = v
    return {"ok": all(not v for v in results.values()), "checks": results}
