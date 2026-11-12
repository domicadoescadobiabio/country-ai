"""Turn a monitor log (JSON Lines) plus the full ledger into a Markdown report.

The report answers, for the observed period: did the republic stay up, did its records stay
intact, did every election recount to the certified result, did any constitutional invariant
break, and what did each institution and each brain actually do.
"""
from __future__ import annotations

import json
import statistics
import time
from collections import Counter

from .ledger import summarise, verify_chain


def load(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def _fmt_ts(ms: int | None) -> str:
    return time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(ms / 1000)) if ms else "?"


def _delta(first: dict, last: dict, key: str) -> int:
    a, b = (first.get("stats") or {}).get(key) or 0, (last.get("stats") or {}).get(key) or 0
    return b - a


def build(obs: list[dict], ledger: list[dict] | None, names: dict[str, str] | None = None) -> str:
    names = names or {}
    nm = lambda i: names.get(i, i)  # noqa: E731
    ok_obs = [o for o in obs if "error" not in o]
    if not ok_obs:
        return "# COUNTRY AI audit report\n\nNo successful observation: the server was never reachable.\n"
    first, last = ok_obs[0], ok_obs[-1]
    hours = (last["ts"] - first["ts"]) / 3_600_000
    L: list[str] = []
    w = L.append
    w("# COUNTRY AI: 24-hour audit report")
    w("")
    w(f"Observed from **{_fmt_ts(first['ts'])}** to **{_fmt_ts(last['ts'])}** ({hours:.1f} hours, {len(obs)} observations).")
    w(f"Republic day {first.get('day')} → {last.get('day')}. Engine: {last.get('engine')}.")
    w("")

    # ---- availability
    down = [o for o in obs if "error" in o]
    lat = [o["latencyMs"] for o in ok_obs if "latencyMs" in o]
    w("## 1. Availability")
    w(f"- Reachable in {len(ok_obs)}/{len(obs)} observations ({100 * len(ok_obs) / len(obs):.1f}%).")
    if lat:
        w(f"- `/api/state` latency: median {statistics.median(lat):.0f} ms, max {max(lat)} ms.")
    if down:
        w(f"- Unreachable at: {', '.join(_fmt_ts(o['ts']) for o in down[:10])}.")
    w(f"- Engine step errors at the end: {last.get('stepErrors') or 0}"
      + (f" (last: `{(last.get('lastStepError') or {}).get('message')}`)" if last.get("lastStepError") else "") + ".")
    builds = [o["build"] for o in ok_obs if o.get("build")]
    if builds:
        deploys = len({b.get("deployment") for b in builds})
        starts = len({b.get("startedAt") for b in builds})
        w(f"- Builds seen: code {', '.join(sorted({str(b.get('code')) for b in builds}))}; "
          f"{deploys} deployment(s), {starts} server start(s), so {max(0, starts - deploys)} restart(s) without a deploy.")
    paused = [o for o in ok_obs if o.get("paused")]
    if paused:
        w(f"- The nation was paused in {len(paused)} observations.")
    w("")

    # ---- integrity
    w("## 2. Integrity of the record")
    if ledger is not None:
        rep = verify_chain(ledger)
        w(f"- Independent chain check (Python, own canonical JSON): **{'INTACT' if rep.ok else 'BROKEN'}**, "
          f"{rep.checked} entries, head `{rep.head[:16]}…`.")
        if not rep.ok:
            w(f"  - Broken at seq {rep.broken_at}: {rep.reason}.")
    chain_breaks = [o for o in ok_obs if (o.get("chain") or {}).get("broken")]
    w(f"- Hourly incremental checks: {len(ok_obs) - len(chain_breaks)}/{len(ok_obs)} clean.")
    server_bad = [o for o in ok_obs if (o.get("serverChain") or {}).get("ok") is False]
    w(f"- Server self-check disagreed with ours: {'never' if not server_bad else len(server_bad)}.")
    w("")

    # ---- elections
    recounts = [r for o in ok_obs for r in o.get("recounts") or []]
    w("## 3. Elections and recounts")
    if not recounts:
        w("- No election finished during the period.")
    else:
        bad = [r for r in recounts if not r["ok"]]
        w(f"- {len(recounts)} finished elections recounted independently; **{len(recounts) - len(bad)} match** the certified result.")
        w("")
        w("| # | office | kind | ballots | blank | certified | recount | check |")
        w("|---|---|---|---|---|---|---|---|")
        for r in recounts:
            w(f"| {r['election']} | {r['office']} | {r['kind']} | {r['ballots']} | {r['blank']} | "
              f"{', '.join(nm(x) for x in r['certified']) or '-'} | {', '.join(nm(x) for x in r['recounted']) or '-'} | "
              f"{'ok' if r['ok'] else '; '.join(r['problems'])} |")
    w("")

    # ---- invariants
    w("## 4. Constitutional invariants")
    tally: Counter = Counter()
    examples: dict[str, str] = {}
    for o in ok_obs:
        for name, v in ((o.get("invariants") or {}).get("checks") or {}).items():
            if v:
                tally[name] += 1
                examples.setdefault(name, v[0])
    names_all = list(((last.get("invariants") or {}).get("checks") or {}).keys())
    for name in names_all:
        n = tally[name]
        w(f"- {'✅' if not n else '⚠️'} {name}" + (f": broken in {n} observations, e.g. {examples[name]}" if n else ""))
    w("")

    # ---- what happened
    w("## 5. What the republic did")
    for key, label in (("laws", "laws enacted"), ("orders", "presidential orders"), ("crimes", "crimes recorded"),
                       ("arrests", "arrests"), ("rulings", "court rulings"), ("elections", "elections held"),
                       ("blocked", "threats blocked at the border"), ("drills", "training drills"), ("messages", "public messages")):
        w(f"- {label}: +{_delta(first, last, key)} (total {(last.get('stats') or {}).get(key, 0)})")
    w(f"- Treasury: {first.get('treasury'):,.0f} → {last.get('treasury'):,.0f} CAI.")
    w(f"- Seats filled: {(first.get('stats') or {}).get('seated')}/{(first.get('stats') or {}).get('seats')} → "
      f"{(last.get('stats') or {}).get('seated')}/{(last.get('stats') or {}).get('seats')}.")
    w(f"- Citizens at the end: {last.get('status')} · factions {last.get('factions')}.")
    w("")
    w("Office holders at the end:")
    for office, ids in (last.get("holders") or {}).items():
        w(f"- {office}: {', '.join(nm(i) for i in ids) if ids else '(vacant)'}")
    w("")

    if ledger is not None:
        s = summarise([e for e in ledger if e.get("ts", 0) >= first["ts"] - 3_600_000])
        if s["laws"]:
            w("Laws:")
            for x in s["laws"][:15]:
                w(f"- day {x['day']}: {x['title']} ({x.get('how')})")
            w("")
        if s["appointments"]:
            w(f"Appointments and oaths: {len(s['appointments'])}. Latest:")
            for x in s["appointments"][-10:]:
                w(f"- day {x['day']}: {nm(x['agent'])} → {x['office']} ({x.get('how')})")
            w("")
        if s["sentences"]:
            w(f"Sentences: {len(s['sentences'])} (all ≤3 days: {all((x['days'] or 0) <= 3 for x in s['sentences'])}).")
        w(f"Crimes by type: {s['crimes'] or 'none'} · arrests {s['arrests']} · audits {s['audits']} · census hours {s['census']}.")
        w("")

    # ---- brains
    w("## 6. Brains")
    l0, l1 = first.get("llm") or {}, last.get("llm") or {}
    calls = (l1.get("calls") or 0) - (l0.get("calls") or 0)
    errs = (l1.get("errors") or 0) - (l0.get("errors") or 0)
    w(f"- Model calls during the period: {calls} (Claude {(l1.get('claude') or 0) - (l0.get('claude') or 0)}, "
      f"OpenRouter {(l1.get('openrouter') or 0) - (l0.get('openrouter') or 0)}, fallbacks {(l1.get('fallbacks') or 0) - (l0.get('fallbacks') or 0)}), "
      f"errors {errs}" + (f" ({100 * errs / calls:.1f}%)" if calls else "") + ".")
    w(f"- Tokens: {(l1.get('inputTokens') or 0) - (l0.get('inputTokens') or 0):,} in, "
      f"{(l1.get('outputTokens') or 0) - (l0.get('outputTokens') or 0):,} out.")
    engines: Counter = Counter()
    seen: set = set()
    for o in ok_obs:
        for d in o.get("recentDecisions") or []:
            if d.get("id") in seen:
                continue
            seen.add(d.get("id"))
            engines[d.get("engine") or "?"] += 1
    if engines:
        w(f"- Decisions sampled: {sum(engines.values())}; by engine: " + ", ".join(f"{k} {v}" for k, v in engines.most_common()) + ".")
    w("")
    w("Sample of decisions (latest):")
    for d in (last.get("recentDecisions") or [])[-8:]:
        w(f"- day {d.get('day')} · {nm(d.get('agentId'))} ({d.get('role')}) · {d.get('title')} → **{d.get('chosen')}** "
          f"[{d.get('engine')}]: {str(d.get('reason') or '')[:160]}")
    w("")

    # ---- alarms (opened/closed transitions; the last observation shows what is still open)
    opened: dict[str, dict] = {}
    for o in ok_obs:
        for a in (o.get("watch") or {}).get("alarms") or []:
            opened.setdefault(a["key"], a)
    still = {a["key"] for a in (last.get("watch") or {}).get("alarms") or []}
    if opened:
        w("## Alarms")
        for k, a in opened.items():
            w(f"- {'**open**' if k in still else 'resolved'} · {a['box']} · {a['text']}")
        w("")

    # ---- verdict
    problems = []
    if down:
        problems.append(f"{len(down)} unreachable observations")
    if chain_breaks or (ledger is not None and not verify_chain(ledger).ok):
        problems.append("ledger chain broken")
    if any(not r["ok"] for r in recounts):
        problems.append("recount mismatch")
    if tally:
        problems.append(f"{len(tally)} invariant(s) broken at some point")
    if last.get("stepErrors"):
        problems.append(f"{last['stepErrors']} engine step errors")
    w("## 7. Verdict")
    w("- " + ("**Clean run**: no availability, integrity, election or invariant problem found." if not problems
              else "**Findings**: " + "; ".join(problems) + "."))
    w("")
    return "\n".join(L)
