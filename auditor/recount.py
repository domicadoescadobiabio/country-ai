"""Independent recount of every election from the anonymised ballots.

Written from the rules in the constitution (Art. 14), not by calling the server's code:
  * single-seat offices: instant-runoff voting (IRV), majority of continuing ballots;
  * the Council: single transferable vote, Droop quota, Gregory fractional surplus transfers;
  * confirmations: a candidate is confirmed by more than half of the valid ballots;
  * recall / referendum / impeachment: more "yes" than "no".
Tie-breaks follow the published rule: the lowest tally is eliminated first, ties broken by
fewer first preferences, then by id order. A recount that differs from the certified result is
exactly what the Audit Office would send to the Constitutional Court.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .canon import ballots_digest

YESNO = ("recall", "referendum", "impeachment")


def parse(anonymised: list[str]) -> tuple[list[list[str]], int]:
    """Anonymised ballots are 'a>b>c' strings or 'BLANK'. Returns (rankings, blank count)."""
    rankings, blank = [], 0
    for b in anonymised:
        if b == "BLANK":
            blank += 1
        elif b:
            rankings.append(b.split(">"))
    return rankings, blank


def irv(ballots: list[list[str]], candidates: list[str]) -> dict:
    alive = list(candidates)
    first0 = {c: 0 for c in candidates}
    for b in ballots:
        if b and b[0] in first0:
            first0[b[0]] += 1
    rounds = []
    while alive:
        tally = {c: 0 for c in alive}
        active = 0
        for b in ballots:
            top = next((x for x in b if x in tally), None)
            if top is not None:
                tally[top] += 1
                active += 1
        rounds.append({"tally": dict(tally), "active": active})
        best = sorted(alive, key=lambda c: -tally[c])[0]  # stable: earlier candidate wins a tie at the top
        if len(alive) == 1 or tally[best] * 2 > active:
            return {"winner": best, "rounds": rounds}
        low = sorted(alive, key=lambda c: (tally[c], first0[c], c))[0]
        alive.remove(low)
        rounds[-1]["eliminated"] = low
    return {"winner": None, "rounds": rounds}


def stv(raw: list[list[str]], candidates: list[str], seats: int) -> dict:
    ballots = [{"prefs": b, "w": 1.0} for b in raw if b]
    quota = len(ballots) // (seats + 1) + 1
    elected: list[str] = []
    hopeful = list(candidates)
    rounds = []

    def top(b):
        return next((x for x in b["prefs"] if x in hopeful), None)

    guard = 0
    while len(elected) < seats and hopeful and guard < 100:
        guard += 1
        if len(hopeful) <= seats - len(elected):
            elected.extend(hopeful)
            rounds.append({"note": "remaining candidates fill the remaining seats", "elected": list(hopeful)})
            break
        tally = {c: 0.0 for c in hopeful}
        for b in ballots:
            t = top(b)
            if t is not None:
                tally[t] += b["w"]
        reached = sorted([c for c in hopeful if tally[c] >= quota], key=lambda c: -tally[c])
        r = {"tally": {k: round(v, 3) for k, v in tally.items()}, "quota": quota}
        if reached:
            c = reached[0]
            elected.append(c)
            r["elected"] = c
            ratio = (tally[c] - quota) / tally[c] if tally[c] > 0 else 0.0
            for b in ballots:
                if top(b) == c:
                    b["w"] *= ratio
            hopeful.remove(c)
        else:
            low = sorted(hopeful, key=lambda c: (tally[c], c))[0]
            hopeful.remove(low)
            r["eliminated"] = low
        rounds.append(r)
    return {"elected": elected[:seats], "quota": quota, "rounds": rounds}


@dataclass
class Recount:
    election: int
    office: str
    kind: str
    certified: list[str]
    recounted: list[str]
    digest_ok: bool
    ballots: int
    blank: int
    note: str = ""
    problems: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.problems

    def as_dict(self) -> dict:
        return {"election": self.election, "office": self.office, "kind": self.kind, "certified": self.certified,
                "recounted": self.recounted, "digestOk": self.digest_ok, "ballots": self.ballots, "blank": self.blank,
                "note": self.note, "ok": self.ok, "problems": self.problems}


def recount(body: dict) -> Recount | None:
    """Recount one election from the body of GET /api/elections/<id>. None if it is not finished."""
    e = body.get("election") or {}
    res = e.get("result")
    anon = body.get("anonymisedBallots")
    if not res or anon is None:
        return None
    rankings, blank = parse(anon)
    cands = [c["id"] for c in e.get("candidates") or []]
    kind, seats = e.get("kind"), e.get("seats") or 1
    certified = list(res.get("winners") or [])
    digest_ok = ballots_digest(anon) == res.get("digest")
    out = Recount(e.get("id"), e.get("office"), kind, certified, [], digest_ok, len(anon), blank)
    if not digest_ok:
        out.problems.append("published ballots do not match the certified digest")
    if res.get("ballots") is not None and res["ballots"] != len(anon):
        out.problems.append(f"certified ballot count {res['ballots']} but {len(anon)} published")

    if res.get("void"):
        # declared void (no ballots): no mandate was given, nothing to recount
        out.recounted, out.note = [], "void: no valid ballots, no mandate"
        out.certified = []
        return out
    if kind in YESNO:
        yes = sum(1 for r in rankings if r[0] == "yes")
        no = sum(1 for r in rankings if r[0] == "no")
        out.recounted = ["yes"] if yes > no else ["no"]
        out.note = f"{yes} yes, {no} no, {blank} blank"
    elif kind == "confirm":
        voters = len(rankings)
        out.recounted = [c for c in cands if sum(1 for r in rankings if c in r) * 2 > voters]
        out.note = f"{voters} valid ballots"
    elif seats == 1:
        r = irv(rankings, cands)
        winner = r["winner"]
        spread = res.get("spread")
        if e.get("office") == "president" and kind != "runoff" and spread and not certified:
            # the count had a winner but failed the 20%-in-2-cities rule: a runoff, nobody certified here
            out.recounted = []
            out.note = f"IRV winner {winner} failed the spread rule ({spread.get('citiesOver20')} cities over 20%); runoff"
        else:
            out.recounted = [winner] if winner else []
            out.note = f"IRV in {len(r['rounds'])} round(s)"
    else:
        r = stv(rankings, cands, seats)
        out.recounted = r["elected"]
        out.note = f"STV quota {r['quota']}"

    if sorted(out.recounted) != sorted(certified):
        out.problems.append(f"recount gives {out.recounted}, certified {certified}")
    return out


def recount_all(source) -> list[Recount]:
    results = []
    for e in source.elections():
        if e.get("stage") not in ("certify", "done"):
            continue
        body = source.election(e["id"])
        if body:
            r = recount(body)
            if r:
                results.append(r)
    return results
