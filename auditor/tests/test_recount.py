"""The recount implements the constitution's counting rules on its own; check it on known cases
and against the server's implementation on random elections."""
import json
import random
import shutil
import subprocess
import unittest
from pathlib import Path

from auditor.canon import ballots_digest
from auditor.recount import _js_round9, irv, parse, recount, stv

ROOT = Path(__file__).resolve().parents[2]


class IrvTest(unittest.TestCase):
    def test_majority_in_first_round(self):
        r = irv([["a"], ["a"], ["b"]], ["a", "b"])
        self.assertEqual(r["winner"], "a")
        self.assertEqual(len(r["rounds"]), 1)

    def test_transfer_decides(self):
        ballots = [["a", "c"]] * 4 + [["b"]] * 5 + [["c", "a"]] * 3
        r = irv(ballots, ["a", "b", "c"])
        self.assertEqual(r["rounds"][0]["eliminated"], "c")
        self.assertEqual(r["winner"], "a")

    def test_no_ballots_falls_to_tie_break(self):
        # same as the server: with no ballots every round is a tie and the id order decides
        self.assertEqual(irv([], ["a", "b"])["winner"], "b")


class StvTest(unittest.TestCase):
    def test_droop_quota_and_surplus(self):
        ballots = [["a", "b"]] * 6 + [["c"]] * 3 + [["d"]] * 2
        r = stv(ballots, ["a", "b", "c", "d"], 2)
        self.assertEqual(r["quota"], 4)
        self.assertEqual(r["elected"][0], "a")
        self.assertIn("c", r["elected"])

    def test_fills_remaining_seats(self):
        r = stv([["a"]], ["a", "b"], 2)
        self.assertEqual(sorted(r["elected"]), ["a", "b"])


class RecountTest(unittest.TestCase):
    def body(self, anon, winners, kind="regular", office="president", seats=1, cands=("a", "b")):
        return {"election": {"id": 1, "office": office, "kind": kind, "seats": seats,
                             "candidates": [{"id": c} for c in cands],
                             "result": {"winners": winners, "digest": ballots_digest(anon), "ballots": len(anon)}},
                "anonymisedBallots": anon}

    def test_matching_result(self):
        r = recount(self.body(sorted(["a>b", "a", "b>a", "BLANK"]), ["a"]))
        self.assertTrue(r.ok, r.problems)
        self.assertEqual(r.blank, 1)

    def test_detects_wrong_winner(self):
        self.assertFalse(recount(self.body(sorted(["a>b", "a", "b>a"]), ["b"])).ok)

    def test_detects_tampered_ballots(self):
        b = self.body(sorted(["a", "a", "b"]), ["a"])
        b["anonymisedBallots"] = ["a", "a", "a"]
        self.assertFalse(recount(b).digest_ok)

    def test_yes_no(self):
        r = recount(self.body(sorted(["yes", "no", "yes"]), ["yes"], kind="recall", cands=()))
        self.assertTrue(r.ok, r.problems)

    def test_unfinished_election_is_skipped(self):
        self.assertIsNone(recount({"election": {"id": 2, "result": None}, "anonymisedBallots": None}))

    def test_parse(self):
        self.assertEqual(parse(["BLANK", "x>y"]), ([["x", "y"]], 1))

    def test_empty_ballot_ranks_nobody(self):
        self.assertEqual(parse(["", "x"]), ([[], ["x"]], 0))
        # a confirmation counts it as a voter: 1 approval of 2 voters is not a majority
        r = recount(self.body(sorted(["", "a"]), [], kind="confirm", office="council", cands=("a",)))
        self.assertTrue(r.ok, r.problems)
        r = recount(self.body(sorted(["", "yes"]), ["yes"], kind="recall", cands=()))
        self.assertTrue(r.ok, r.problems)

    def test_stv_tally_is_rounded_like_the_engine(self):
        self.assertEqual(_js_round9(2.9999999999999996), 3.0)
        # quota 5; a's surplus 2/7 per ballot moves to b seven times, b reaches exactly 3
        r = stv([["a", "b"]] * 7 + [["b"]] * 1 + [["c"]] * 3 + [["d"]] * 1, ["a", "b", "c", "d"], 2)
        self.assertEqual(r["quota"], 5)
        self.assertEqual(r["rounds"][1]["tally"]["b"], 3.0)


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class AgainstServerTest(unittest.TestCase):
    """200 random elections counted by both implementations must agree exactly."""

    def test_random_elections(self):
        rng = random.Random(4663)
        cases = []
        for _ in range(200):
            cands = [f"c{i}" for i in range(rng.randint(2, 7))]
            # some ballots rank nobody (an empty anonymised ballot ''), as the engine allows
            ballots = [rng.sample(cands, rng.randint(0 if rng.random() < 0.1 else 1, len(cands)))
                       for _ in range(rng.randint(0, 40))]
            cases.append({"cands": cands, "ballots": ballots, "seats": rng.randint(1, 3)})
        script = (
            "import { irv, stv } from './src/elections.ts';"
            "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const cs=JSON.parse(s);"
            "process.stdout.write(JSON.stringify(cs.map(c=>({irv:irv(c.ballots,c.cands).winner,"
            "stv:stv(c.ballots,c.cands,c.seats).elected}))));process.exit(0);});"
        )
        out = subprocess.run(["node", "--input-type=module", "-e", script], input=json.dumps(cases),
                             capture_output=True, text=True, cwd=ROOT, timeout=120, encoding="utf-8")
        self.assertEqual(out.returncode, 0, out.stderr[-2000:])
        js = json.loads(out.stdout)
        for c, j in zip(cases, js):
            self.assertEqual(irv(c["ballots"], c["cands"])["winner"], j["irv"], c)
            self.assertEqual(stv(c["ballots"], c["cands"], c["seats"])["elected"], j["stv"], c)


if __name__ == "__main__":
    unittest.main()
