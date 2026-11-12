"""Alarm rules for the monitor, each worked out from the latest public data.

Every rule is recomputed from fresh `/api/state`, `/api/health` and `/api/ledger` data at every
observation, so an alarm closes by itself as soon as its condition is gone (no stale snapshot keeps
it alive). An alarm is a dict {key, box, text}; the key is stable, so the monitor reports only
transitions (opened / closed) and never raises an alarm about other alarms.
"""
from __future__ import annotations

import json
import time

REPEAT_WINDOW = 30          # last N street chat lines
REPEAT_SHARE = 0.30         # alarm when this share or more are repeats of a line in the window
PENDING_STALE_S = 3600      # a cabinet nomination unchanged this long is stuck
EXAM_FAIL_SHARE = 0.50      # Academy entrance exams failed in a day
EXAM_MIN_SESSIONS = 4
RULE_RIGHT_SHARE = 0.40     # rule questions answered right in a day
RULE_MIN_ASKED = 10
RECALLS_PER_DAY = 3
LLM_RISING_OBS = 3          # a model's error count rose in this many observations in a row
EXPECTED_ONCE = ("pardon", "correction")  # at most one entry per (citizen, case)


def _alarm(key: str, box: str, text: str) -> dict:
    return {"key": key, "box": box, "text": text}


# ---------------------------------------------------------------- people
def street_repeats(state: dict, window: int = REPEAT_WINDOW, share: float = REPEAT_SHARE) -> dict:
    """Repeated lines among the last `window` street chat messages of this very state."""
    msgs = [m for m in ((state.get("feed") or {}).get("streets") or []) if (m.get("kind") or "chat") == "chat"]
    last = [" ".join(str(m.get("text") or "").lower().split()) for m in msgs[-window:]]
    repeats = len(last) - len(set(last))
    return {"window": len(last), "repeats": repeats, "share": round(repeats / len(last), 3) if last else 0.0}


def local_brain(state: dict) -> dict | None:
    lb = state.get("localBrain") or {}
    if not lb.get("online"):
        return None
    runner = lb.get("runner")
    if not runner:
        return _alarm("rakyat:runner-old", "rakyat",
                      "local brain is online but sends no `runner` info: the old runner is still running, restart it")
    try:
        version = float(runner.get("version") or 0)
    except (TypeError, ValueError):
        version = 0
    if version < 2:
        return _alarm("rakyat:runner-old", "rakyat", f"local brain runner version {runner.get('version')} < 2: restart it")
    return None


# ---------------------------------------------------------------- government
def cabinet_pending(state: dict, memo: dict, now: float) -> dict | None:
    """Alarm only when the same pending nomination (votes included) has not changed for an hour."""
    pending = (state.get("cabinet") or {}).get("pending")
    if not pending:
        memo.pop("pending", None)
        return None
    sig = json.dumps(pending, sort_keys=True)
    seen = memo.get("pending")
    if not seen or seen["sig"] != sig:
        memo["pending"] = {"sig": sig, "since": now}
        return None
    if now - seen["since"] > PENDING_STALE_S:
        mins = int((now - seen["since"]) / 60)
        return _alarm("pemerintah:cabinet-stuck", "pemerintah",
                      f"cabinet nomination unchanged for {mins} min: {sig[:160]}")
    return None


def academy_training(state: dict, memo: dict) -> list[dict]:
    """Per republic day: exam failure share, rule-question accuracy and recalls since the day began."""
    ac, tr = state.get("academy") or {}, state.get("training") or {}
    now = {"day": state.get("day"), "sessions": ac.get("sessions") or 0, "failures": ac.get("failures") or 0,
           "asked": ((ac.get("rules") or {}).get("asked") or 0) + ((tr.get("rules") or {}).get("asked") or 0),
           "right": ((ac.get("rules") or {}).get("right") or 0) + ((tr.get("rules") or {}).get("right") or 0),
           "recalls": tr.get("recalls") or 0}
    base = memo.get("dayBase")
    if not base or base.get("day") != now["day"] or any(now[k] < base[k] for k in ("sessions", "asked", "recalls")):
        memo["dayBase"] = base = dict(now)  # new day, or counters were reset
    d = {k: now[k] - base[k] for k in ("sessions", "failures", "asked", "right", "recalls")}
    memo["today"] = d
    out = []
    if d["sessions"] >= EXAM_MIN_SESSIONS and d["failures"] / d["sessions"] > EXAM_FAIL_SHARE:
        out.append(_alarm("pemerintah:exam-failures", "pemerintah",
                          f"day {now['day']}: {d['failures']}/{d['sessions']} Academy exams failed"))
    if d["asked"] >= RULE_MIN_ASKED and d["right"] / d["asked"] < RULE_RIGHT_SHARE:
        out.append(_alarm("pemerintah:rule-accuracy", "pemerintah",
                          f"day {now['day']}: rule questions {d['right']}/{d['asked']} right"))
    if d["recalls"] > RECALLS_PER_DAY:
        out.append(_alarm("pemerintah:recalls", "pemerintah", f"day {now['day']}: {d['recalls']} officials recalled"))
    return out


# ---------------------------------------------------------------- state
def llm_errors(state: dict, memo: dict) -> list[dict]:
    """A model that answers auth/404 is dead or retired; a model whose errors rise steadily is failing."""
    by = (state.get("llmUsage") or {}).get("errorsByModel") or {}
    hist = memo.setdefault("llm", {})
    out = []
    for model, e in by.items():
        n = e.get("errors") or 0
        h = hist.setdefault(model, {"last": n, "rising": 0})
        h["rising"] = h["rising"] + 1 if n > h["last"] else 0
        h["last"] = n
        if e.get("lastKind") == "auth" or e.get("lastStatus") == 404:
            out.append(_alarm(f"negara:llm-dead:{model}", "negara",
                              f"model {model}: last error {e.get('lastKind')} {e.get('lastStatus') or ''} at {e.get('lastAt')} (dead or retired?)"))
        elif h["rising"] >= LLM_RISING_OBS:
            out.append(_alarm(f"negara:llm-rising:{model}", "negara",
                              f"model {model}: errors rose {h['rising']} observations in a row (now {n}, last {e.get('lastKind')})"))
    return out


def build_restart(health: dict | None, memo: dict) -> dict | None:
    """`startedAt` moving while the deployment and code stay the same means the server restarted by itself."""
    b = (health or {}).get("build") or {}
    if not b.get("startedAt"):
        return None
    prev = memo.get("build")
    memo["build"] = {k: b.get(k) for k in ("deployment", "code", "startedAt")}
    if prev and prev.get("startedAt") != b.get("startedAt") and prev.get("deployment") == b.get("deployment") \
            and prev.get("code") == b.get("code"):
        return _alarm("negara:restart", "negara",
                      f"server restarted without a deploy (crash?): started {prev['startedAt']} → {b['startedAt']}, "
                      f"deployment {b.get('deployment')}")
    return None


def ledger_duplicates(entries_by_kind: dict[str, list[dict]]) -> dict:
    """Count pardon/correction entries and list every (citizen, case) recorded more than once."""
    out = {"counts": {}, "duplicates": []}
    for kind, entries in entries_by_kind.items():
        out["counts"][kind] = len(entries)
        seen: dict[tuple, list[int]] = {}
        for e in entries:
            d = e.get("data") or {}
            seen.setdefault((d.get("citizen"), d.get("case")), []).append(e.get("seq"))
        for (citizen, case), seqs in seen.items():
            if len(seqs) > 1:
                out["duplicates"].append({"kind": kind, "citizen": citizen, "case": case, "seqs": seqs})
    return out


def ledger_alarm(dup: dict) -> dict | None:
    if not dup["duplicates"]:
        return None
    txt = "; ".join(f"{d['kind']} {d['citizen']} case {d['case']} at seq {d['seqs']}" for d in dup["duplicates"])
    return _alarm("negara:ledger-duplicate", "negara", f"duplicate ledger entries (add a correction note): {txt}")


# ---------------------------------------------------------------- all together
def evaluate(state: dict, health: dict | None, ledger_by_kind: dict | None, memo: dict, now: float | None = None) -> dict:
    now = time.time() if now is None else now
    alarms: list[dict] = []
    rep = street_repeats(state)
    if rep["window"] and rep["share"] >= REPEAT_SHARE:
        alarms.append(_alarm("rakyat:repeat", "rakyat",
                             f"{rep['repeats']}/{rep['window']} of the latest street lines are repeats"))
    for a in (local_brain(state), cabinet_pending(state, memo, now), build_restart(health, memo)):
        if a:
            alarms.append(a)
    alarms += academy_training(state, memo)
    alarms += llm_errors(state, memo)
    dup = ledger_duplicates(ledger_by_kind) if ledger_by_kind is not None else None
    if dup and (a := ledger_alarm(dup)):
        alarms.append(a)
    before = set(memo.get("open") or [])
    keys = [a["key"] for a in alarms]
    memo["open"] = keys
    return {"alarms": alarms, "opened": [k for k in keys if k not in before], "closed": sorted(before - set(keys)),
            "streets": rep, "today": memo.get("today"), "ledgerOnce": dup}
