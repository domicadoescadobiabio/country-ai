"""Command line for the independent auditor.

    python -m auditor verify    URL|country.db        recompute the ledger hash chain
    python -m auditor recount   URL [--election N]    recount finished elections from anonymised ballots
    python -m auditor check     URL                   run the constitutional invariants once
    python -m auditor monitor   URL --hours 24 --interval 3600 --out audit/run.jsonl
    python -m auditor report    audit/run.jsonl --url URL --out audit/REPORT.md

Standard library only; it reads public endpoints and never needs the admin token.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

from . import invariants, monitor, recount, report
from .ledger import summarise, verify_chain
from .source import ApiSource, open_source

DEFAULT_URL = os.environ.get("COUNTRY_URL", "http://localhost:8080")


def cmd_verify(a) -> int:
    src = open_source(a.target)
    entries = list(src.ledger())
    rep = verify_chain(entries)
    out = rep.as_dict()
    if a.summary:
        out["summary"] = summarise(entries)
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0 if rep.ok else 2


def cmd_recount(a) -> int:
    src = ApiSource(a.url)
    if a.election:
        body = src.election(a.election)
        rs = [recount.recount(body)] if body else []
        rs = [r for r in rs if r]
    else:
        rs = recount.recount_all(src)
    print(json.dumps([r.as_dict() for r in rs], indent=2, ensure_ascii=False))
    return 0 if all(r.ok for r in rs) else 2


def cmd_check(a) -> int:
    res = invariants.run_all(ApiSource(a.url).state())
    print(json.dumps(res, indent=2, ensure_ascii=False))
    return 0 if res["ok"] else 2


def cmd_monitor(a) -> int:
    n = monitor.run(a.url, a.out, a.hours, a.interval)
    print(f"done: {n} observations in {a.out}")
    return 0


def cmd_report(a) -> int:
    obs = report.load(a.log)
    ledger, names = None, {}
    if a.url:
        src = ApiSource(a.url)
        ledger = list(src.ledger())
        names = {c["id"]: c["name"] for c in (src.state().get("citizens") or [])}
    md = report.build(obs, ledger, names)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(md)
        print(f"wrote {a.out}")
    else:
        sys.stdout.write(md)
    return 0


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):  # Windows consoles default to a legacy code page
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    p = argparse.ArgumentParser(prog="auditor", description="Independent auditor for COUNTRY AI")
    sub = p.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("verify", help="recompute the ledger hash chain")
    v.add_argument("target", nargs="?", default=DEFAULT_URL, help="server URL or path to country.db")
    v.add_argument("--summary", action="store_true", help="also summarise what the ledger records")
    v.set_defaults(fn=cmd_verify)
    r = sub.add_parser("recount", help="recount finished elections")
    r.add_argument("url", nargs="?", default=DEFAULT_URL)
    r.add_argument("--election", type=int)
    r.set_defaults(fn=cmd_recount)
    c = sub.add_parser("check", help="run the invariants once")
    c.add_argument("url", nargs="?", default=DEFAULT_URL)
    c.set_defaults(fn=cmd_check)
    m = sub.add_parser("monitor", help="observe the republic for a period")
    m.add_argument("url", nargs="?", default=DEFAULT_URL)
    m.add_argument("--hours", type=float, default=24.0)
    m.add_argument("--interval", type=float, default=3600.0, help="seconds between observations")
    m.add_argument("--out", default="audit/run.jsonl")
    m.set_defaults(fn=cmd_monitor)
    rp = sub.add_parser("report", help="write a Markdown report from a monitor log")
    rp.add_argument("log")
    rp.add_argument("--url", help="also verify and summarise the full ledger from this server")
    rp.add_argument("--out")
    rp.set_defaults(fn=cmd_report)
    a = p.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
