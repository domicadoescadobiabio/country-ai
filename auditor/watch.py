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
MONOTONE_WINDOW_S = 2 * 3600  # daily-life acts are compared over the last two hours
MONOTONE_MIN_NEW = 200      # fewer new thoughts than this (the republic's night): no verdict
MONOTONE_SHARE = 0.70       # one act above this share of the new thoughts is monotone
SCHOOL_WINDOW_S = 3600      # lessons / train queue are judged over the last hour
QUEUE_GROWTH = 10           # queuedTrain rising at every observation by at least this much in total
BUDGET_FULL_SHARE = 0.9     # a share of the model purse this full counts as spent
BUDGET_PACE_MARGIN = 0.35   # government spending this far ahead of the hour of the day is a warning
RUNWAY_DAYS = 5.0           # treasury left at the net UBI burn
REJECTED_SHARE = 0.5        # gov.rejectedShare above this for a whole day
SEATS_STUCK_S = 12 * 3600   # seats filled unchanged this long
RUNNING_STAGES = ("nomination", "campaign", "quiet", "voting", "certify")
STAGE_GRACE_MS = 15 * 60 * 1000  # a stage may close a few ticks after stageEndsAt
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


def _num(x) -> float | None:
    """A number from the public state, or None for anything else (bools, strings, missing)."""
    return float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) else None


# ---------------------------------------------------------------- people
def street_repeats(state: dict, window: int = REPEAT_WINDOW, share: float = REPEAT_SHARE) -> dict:
    """Repeated lines among the last `window` street chat messages of this very state."""
    msgs = [m for m in ((state.get("feed") or {}).get("streets") or []) if (m.get("kind") or "chat") == "chat"]
    last = [" ".join(str(m.get("text") or "").lower().split()) for m in msgs[-window:]]
    repeats = len(last) - len(set(last))
    return {"window": len(last), "repeats": repeats, "share": round(repeats / len(last), 3) if last else 0.0}


def monotone(state: dict, memo: dict, now: float) -> dict | None:
    """Share of the top act among thoughts of the last ~2 hours (not the cumulative counter, which keeps
    one night of resting alive for hours); skipped under MONOTONE_MIN_NEW new thoughts (the republic's night)."""
    daily = state.get("daily") or {}
    acts = {k: int(_num(v) or 0) for k, v in (daily.get("byAct") or {}).items()}
    snaps = memo.setdefault("acts", [])
    if (daily.get("clock") or {}).get("awake") is False:
        # the republic's night: citizens sleep, no verdict, and the morning starts a fresh window
        snaps.clear()
        memo["actsWindow"] = {"minutes": 0, "new": 0, "byAct": {}, "asleep": True}
        return None
    if snaps and any(acts.get(k, 0) < v for k, v in snaps[-1][1].items()):
        snaps.clear()  # the counters were reset (new byAct version)
    snaps.append((now, acts))
    snaps[:] = [s for s in snaps if now - s[0] <= MONOTONE_WINDOW_S]
    base = snaps[0][1]
    delta = {k: v - base.get(k, 0) for k, v in acts.items() if v - base.get(k, 0) > 0}
    total = sum(delta.values())
    memo["actsWindow"] = {"minutes": int((now - snaps[0][0]) / 60), "new": total, "byAct": delta}
    if total < MONOTONE_MIN_NEW:
        return None
    top, n = max(delta.items(), key=lambda kv: kv[1])
    if n / total > MONOTONE_SHARE:
        return _alarm("rakyat:monotone", "rakyat",
                      f"{round(100 * n / total)}% of the last {total} thoughts ({memo['actsWindow']['minutes']} min) chose \"{top}\"")
    return None


def school_training(state: dict, memo: dict, now: float) -> list[dict]:
    """Over the last hour, while the local brain is online: lessons must rise, train answers must not
    expire, and the train queue must not keep growing."""
    lb, school = state.get("localBrain") or {}, state.get("school") or {}
    cur = {k: _num(v) for k, v in (("lessons", school.get("lessons")), ("trainExpired", lb.get("trainExpired")),
                                   ("queuedTrain", lb.get("queuedTrain")))}
    hist = memo.setdefault("school", [])
    if hist and cur["lessons"] is not None and hist[-1][1]["lessons"] is not None and cur["lessons"] < hist[-1][1]["lessons"]:
        hist.clear()  # counters restarted (deploy or a new day)
    hist.append((now, cur))
    hist[:] = [h for h in hist if now - h[0] <= SCHOOL_WINDOW_S + 900]
    memo["schoolWindow"] = {"minutes": int((now - hist[0][0]) / 60), **cur}
    if not lb.get("online") or now - hist[0][0] < SCHOOL_WINDOW_S:
        return []
    base = hist[0][1]  # the oldest snapshot of the (trimmed) window, about an hour ago
    out = []
    if cur["lessons"] is not None and base["lessons"] is not None and cur["lessons"] <= base["lessons"]:
        out.append(_alarm("rakyat:school-stalled", "rakyat", f"school.lessons has not risen in an hour ({cur['lessons']:.0f})"))
    if cur["trainExpired"] is not None and base["trainExpired"] is not None and cur["trainExpired"] > base["trainExpired"]:
        out.append(_alarm("rakyat:train-expired", "rakyat",
                          f"localBrain.trainExpired rose {base['trainExpired']:.0f} → {cur['trainExpired']:.0f} in an hour"))
    q = [h[1]["queuedTrain"] for h in hist if h[1]["queuedTrain"] is not None]
    if len(q) >= 3 and all(b > a for a, b in zip(q, q[1:])) and q[-1] - q[0] >= QUEUE_GROWTH:
        out.append(_alarm("rakyat:train-queue", "rakyat",
                          f"localBrain.queuedTrain kept growing for an hour ({q[0]:.0f} → {q[-1]:.0f})"))
    return out


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
def _votes(pending: dict) -> int:
    v = pending.get("votes")
    return len(v) if isinstance(v, (list, dict)) else int(v or 0)


def cabinet_pending(state: dict, memo: dict, now: float) -> dict | None:
    """A nomination is stuck when the same post/agent gains no vote for an hour, or has been open a full day."""
    pending = (state.get("cabinet") or {}).get("pending")
    if not pending:
        memo.pop("pending", None)
        return None
    sig = json.dumps([pending.get("post"), pending.get("agent")])
    votes = _votes(pending)
    seen = memo.get("pending")
    if not seen or seen["sig"] != sig or votes > seen["votes"]:
        memo["pending"] = seen = {"sig": sig, "votes": votes, "since": now}
    what = f"{pending.get('post')} → {pending.get('agent')} ({votes} votes)"
    day, opened = state.get("day"), pending.get("since")
    if isinstance(day, (int, float)) and isinstance(opened, (int, float)) and day - opened >= 1:
        return _alarm("pemerintah:cabinet-stuck", "pemerintah", f"cabinet nomination open since day {opened}: {what}")
    if now - seen["since"] > PENDING_STALE_S:
        mins = int((now - seen["since"]) / 60)
        return _alarm("pemerintah:cabinet-stuck", "pemerintah", f"cabinet nomination gained no vote for {mins} min: {what}")
    return None


def leader_budget(state: dict, memo: dict) -> list[dict]:
    """Leaders must not drop to offline because the day's model budget ran out early.

    The government's share is `budget.daily - budget.train.daily` (e.g. 45 - 38 = 7 USD while the school takes the
    Claude credits). A refused leader call counts only when the purse is nearly empty: a few refusals at low
    spend are the per-minute pacing, not an empty budget."""
    b = state.get("budget") or {}
    train = b.get("train") or {}
    daily, train_daily = _num(b.get("daily")), _num(train.get("daily")) or 0.0
    spent, train_spent = _num(b.get("spent")) or 0.0, _num(train.get("spent")) or 0.0
    denied = _num((b.get("denied") or {}).get("leader")) or 0.0
    hour = _num((((state.get("daily") or {}).get("clock")) or {}).get("hour"))
    if not daily:
        return []
    gov_cap = max(daily - train_daily, 0.0)
    prev = memo.get("budget")
    memo["budget"] = {"day": b.get("day"), "deniedLeader": denied}
    memo["budgetView"] = {"govCap": round(gov_cap, 2), "govSpent": round(spent, 4), "trainSpent": round(train_spent, 4),
                          "leader": _num(b.get("leader")), "official": _num(b.get("official")), "deniedLeader": denied}
    full = spent >= BUDGET_FULL_SHARE * gov_cap or spent + train_spent >= BUDGET_FULL_SHARE * daily
    out = []
    new_denied = denied - prev["deniedLeader"] if prev and prev.get("day") == b.get("day") else 0.0
    if new_denied > 0 and full:
        out.append(_alarm("negara:leader-offline", "negara",
                          f"leaders refused {new_denied:.0f} model call(s) and fell back offline: the government spent "
                          f"${spent:.2f} of its ${gov_cap:.2f} share (training ${train_spent:.2f} of ${train_daily:.2f}, "
                          f"day total ${daily:.2f})" + (f" at {hour:.0f}:00" if hour is not None else "")))
    if hour is not None and 0 < hour < 20 and gov_cap > 0 and spent / gov_cap > hour / 24 + BUDGET_PACE_MARGIN:
        out.append(_alarm("negara:leader-budget-pace", "negara",
                          f"government budget burning ahead of the day: ${spent:.2f} of ${gov_cap:.2f} spent by {hour:.0f}:00 "
                          f"({100 * spent / gov_cap:.0f}%, pace {100 * hour / 24:.0f}%); leaders may go offline before night"))
    return out


def _ubi_short(ubi_entries: list[dict] | None) -> str:
    short = (ubi_entries[-1].get("data") or {}).get("short") if ubi_entries else None
    return f" (last UBI short by {short})" if short else ""


def treasury_runway(state: dict, ubi_entries: list[dict] | None, memo: dict, now: float) -> dict | None:
    """Days the treasury lasts at today's net UBI burn: treasury / (UBI per day - tax per day).

    Prefers `gov.ubiPerDay` / `gov.taxPerDay` from the state; otherwise UBI per day is the `total` of the
    latest daily `ubi` ledger entry and tax per day is the rise of `econ.taxCollected` over the last ~24 h."""
    treasury = _num(state.get("treasury"))
    gov = state.get("gov") or {}
    if "runwayDays" in gov:
        # the server's own figure: null means taxes cover the UBI (no deficit)
        days = _num(gov.get("runwayDays"))
        memo["runway"] = {"treasury": treasury, "ubiPerDay": _num(gov.get("ubiPerDay")), "taxPerDay": _num(gov.get("taxPerDay")),
                          "netPerDay": _num(gov.get("netPerDay")), "days": days, "from": "gov"}
        if days is not None and days < RUNWAY_DAYS:
            return _alarm("pemerintah:treasury-runway", "pemerintah",
                          f"treasury {treasury or 0:,.0f} CAI lasts {days:.1f} days (net {gov.get('netPerDay')}/day)"
                          + _ubi_short(ubi_entries))
        return None
    ubi = _num(gov.get("ubiPerDay"))
    if ubi is None and ubi_entries:
        ubi = _num((ubi_entries[-1].get("data") or {}).get("total"))
    tax = _num(gov.get("taxPerDay"))
    collected = _num((state.get("econ") or {}).get("taxCollected"))
    hist = memo.setdefault("tax", [])
    if collected is not None:
        if hist and collected < hist[-1][1]:
            hist.clear()
        hist.append((now, collected))
        hist[:] = [h for h in hist if now - h[0] <= 26 * 3600]
        if tax is None and now - hist[0][0] >= 20 * 3600:  # a day's worth of history
            tax = (collected - hist[0][1]) * 86400 / (now - hist[0][0])
    memo["runway"] = {"treasury": treasury, "ubiPerDay": ubi, "taxPerDay": tax}
    if treasury is None or ubi is None or tax is None:
        return None
    burn = ubi - tax
    if burn <= 0:
        memo["runway"]["days"] = None  # taxes cover the UBI: no runway limit
        return None
    days = treasury / burn
    memo["runway"]["days"] = round(days, 1)
    if days < RUNWAY_DAYS:
        return _alarm("pemerintah:treasury-runway", "pemerintah",
                      f"treasury {treasury:,.0f} CAI lasts {days:.1f} days at UBI {ubi:,.0f}/day minus tax {tax:,.0f}/day"
                      + _ubi_short(ubi_entries))
    return None


def rejected_share(state: dict, memo: dict, now: float) -> dict | None:
    """`gov.rejectedShare` above 0.5 continuously for a day."""
    share = _num((state.get("gov") or {}).get("rejectedShare"))
    if share is None or share <= REJECTED_SHARE:
        memo.pop("rejectedSince", None)
        return None
    since = memo.setdefault("rejectedSince", now)
    if now - since >= 86400:
        return _alarm("pemerintah:rejected-share", "pemerintah",
                      f"gov.rejectedShare {share:.2f} has stayed above {REJECTED_SHARE} for {int((now - since) / 3600)} h")
    return None


def vacancies(state: dict) -> list[tuple[str, str | None]]:
    """Empty seats as (office, city); a vacant mayoralty is named by its city."""
    roles = {r.get("id"): r.get("seats") or 0 for r in ((state.get("config") or {}).get("roles") or [])}
    seats = state.get("seats") or {}
    out: list[tuple[str, str | None]] = []
    for office, n in roles.items():
        if office == "mayor":
            out += [("mayor", c.get("id")) for c in state.get("cities") or [] if not c.get("mayor")]
        else:
            out += [(office, None)] * max(0, n - len(seats.get(office) or []))
    return out


def seats_stuck(state: dict, memo: dict, now: float) -> dict | None:
    """Seats filled has not moved for 12 h, and some vacant seat has no election running on time for it."""
    st = state.get("stats") or {}
    seated, total = st.get("seated"), st.get("seats")
    hist = memo.setdefault("seated", [])
    hist.append((now, seated))
    hist[:] = [h for h in hist if now - h[0] <= SEATS_STUCK_S + 3600]
    old = next((h for h in hist if now - h[0] >= SEATS_STUCK_S), None)
    if not old or old[1] != seated or not isinstance(seated, int) or not isinstance(total, int) or seated >= total:
        return None
    now_ms = now * 1000
    uncovered = []
    for office, city in vacancies(state):
        race = next((e for e in state.get("elections") or [] if e.get("office") == office
                     and (city is None or e.get("city") == city) and e.get("stage") in RUNNING_STAGES), None)
        if race is None:
            uncovered.append(f"{office}{' ' + city if city else ''}: no election open")
        elif isinstance(race.get("stageEndsAt"), (int, float)) and now_ms > race["stageEndsAt"] + STAGE_GRACE_MS:
            uncovered.append(f"{office}{' ' + city if city else ''}: election #{race.get('id')} stuck in {race.get('stage')}")
    if not uncovered:
        return None  # every empty seat has a race on schedule (a regular race takes ~26 h)
    return _alarm("pemerintah:seats-stuck", "pemerintah",
                  f"seats filled unchanged for 12 h ({seated}/{total}); " + "; ".join(uncovered[:5]))


def council_quorum(state: dict) -> dict | None:
    cab = state.get("cabinet") or {}
    free, quorum = cab.get("freeCouncillors"), cab.get("quorum")
    if isinstance(free, (int, float)) and isinstance(quorum, (int, float)) and free < quorum:
        return _alarm("pemerintah:council-quorum", "pemerintah",
                      f"only {free} councillors free to vote on the cabinet, quorum is {quorum}")
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
        if model.startswith("openrouter:") and e.get("lastStatus") in OPENROUTER_DOWN:
            continue  # an account-wide cause, reported once by openrouter_paused, not per model
        # an OpenRouter 403 is moderation flagging one input (llm.ts files it as "auth"): only a rising count matters
        moderated = model.startswith("openrouter:") and e.get("lastStatus") == 403
        if not moderated and (e.get("lastKind") == "auth" or e.get("lastStatus") == 404):
            out.append(_alarm(f"negara:llm-dead:{model}", "negara",
                              f"model {model}: last error {e.get('lastKind')} {e.get('lastStatus') or ''} at {e.get('lastAt')} (dead or retired?)"))
        elif h["rising"] >= LLM_RISING_OBS:
            out.append(_alarm(f"negara:llm-rising:{model}", "negara",
                              f"model {model}: errors rose {h['rising']} observations in a row (now {n}, last {e.get('lastKind')})"))
    return out


OPENROUTER_DOWN = (401, 402)  # account-wide: key rejected, credits exhausted (403 is moderation of one input)


def _provider_cause(status) -> str:
    return {402: "credits exhausted (top up OpenRouter)", 401: "API key rejected"}.get(status, f"HTTP {status}")


def openrouter_paused(state: dict) -> dict | None:
    """One alarm naming the cause when OpenRouter is down for the whole republic.

    Reads `llmUsage.openrouterPaused` ({status, reason, until, skipped}); before that field ships, a last error
    of 402/401 on any OpenRouter model means the same; a 403 is moderation flagging one input, not the account
    (the errors/calls ratio stays high while paused,
    because skipped calls are no longer counted, so the ratio alone says nothing about the cause)."""
    usage = state.get("llmUsage") or {}
    p = usage.get("openrouterPaused")
    if isinstance(p, dict) and p.get("status"):
        return _alarm("negara:openrouter-paused", "negara",
                      f"OpenRouter paused: {_provider_cause(p.get('status'))}"
                      + (f", {p.get('reason')}" if p.get("reason") else "")
                      + (f"; retry after {p.get('until')}" if p.get("until") else "")
                      + (f"; {p.get('skipped')} calls skipped" if p.get("skipped") else ""))
    if "openrouterPaused" in usage:
        return None  # the server says it is not paused
    for model, e in ((usage.get("errorsByModel") or {}).items()):
        if model.startswith("openrouter:") and e.get("lastStatus") in OPENROUTER_DOWN:
            return _alarm("negara:openrouter-paused", "negara",
                          f"OpenRouter failing: {_provider_cause(e.get('lastStatus'))} ({model}, {e.get('errors')} errors, "
                          f"last at {e.get('lastAt')})")
    return None


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
def evaluate(state: dict, health: dict | None, ledger_by_kind: dict | None, memo: dict, now: float | None = None,
             ubi_entries: list[dict] | None = None) -> dict:
    now = time.time() if now is None else now
    alarms: list[dict] = []
    rep = street_repeats(state)
    if rep["window"] and rep["share"] >= REPEAT_SHARE:
        alarms.append(_alarm("rakyat:repeat", "rakyat",
                             f"{rep['repeats']}/{rep['window']} of the latest street lines are repeats"))
    for a in (monotone(state, memo, now), local_brain(state), cabinet_pending(state, memo, now),
              council_quorum(state), seats_stuck(state, memo, now), build_restart(health, memo),
              treasury_runway(state, ubi_entries, memo, now), rejected_share(state, memo, now),
              openrouter_paused(state)):
        if a:
            alarms.append(a)
    alarms += academy_training(state, memo)
    alarms += school_training(state, memo, now)
    alarms += leader_budget(state, memo)
    alarms += llm_errors(state, memo)
    dup = ledger_duplicates(ledger_by_kind) if ledger_by_kind is not None else None
    if dup and (a := ledger_alarm(dup)):
        alarms.append(a)
    before = set(memo.get("open") or [])
    keys = [a["key"] for a in alarms]
    memo["open"] = keys
    return {"alarms": alarms, "opened": [k for k in keys if k not in before], "closed": sorted(before - set(keys)),
            "streets": rep, "acts": memo.get("actsWindow"), "runway": memo.get("runway"),
            "school": memo.get("schoolWindow"), "budget": memo.get("budgetView"), "today": memo.get("today"),
            "ledgerOnce": dup}
