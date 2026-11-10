import copy
import unittest

from auditor.canon import GENESIS, entry_hash
from auditor.invariants import run_all
from auditor.ledger import summarise, verify_chain


def chain(n=5):
    out, prev = [], GENESIS
    for i in range(1, n + 1):
        e = {"seq": i, "ts": 1000 + i, "day": 1, "kind": "law" if i % 2 else "incident", "actor": "council",
             "data": {"title": f"law {i}", "type": "theft"}}
        e["prev"], e["hash"] = prev, entry_hash(prev, e)
        prev = e["hash"]
        out.append(e)
    return out


class ChainTest(unittest.TestCase):
    def test_intact(self):
        rep = verify_chain(chain())
        self.assertTrue(rep.ok)
        self.assertEqual(rep.checked, 5)

    def test_altered_entry(self):
        c = chain()
        c[2]["data"]["title"] = "forged"
        rep = verify_chain(c)
        self.assertFalse(rep.ok)
        self.assertEqual(rep.broken_at, 3)

    def test_deleted_entry(self):
        c = chain()
        del c[1]
        self.assertFalse(verify_chain(c).ok)

    def test_summary(self):
        s = summarise(chain())
        self.assertEqual(len(s["laws"]), 3)
        self.assertEqual(s["crimes"], {"theft": 2})


STATE = {
    "day": 5, "treasury": 1000, "policy": {"taxRate": 0.1},
    "seats": {"president": ["a"], "council": ["b", "c"]},
    "citizens": [
        {"id": "a", "name": "A", "office": "president", "status": "free", "wallet": 10},
        {"id": "b", "name": "B", "office": "council", "status": "free", "wallet": 10},
        {"id": "c", "name": "C", "office": "council", "status": "free", "wallet": 10},
        {"id": "d", "name": "D", "office": None, "status": "detained", "detainedDay": 4, "wallet": 0},
    ],
    "police": {"incidents": [{"id": 1, "status": "open"}]},
    "elections": [{"id": 1, "stage": "done", "result": {"digest": "x"}}],
}


class InvariantTest(unittest.TestCase):
    def test_clean_state(self):
        r = run_all(STATE)
        self.assertTrue(r["ok"], r)

    def test_breaks_are_found(self):
        s = copy.deepcopy(STATE)
        s["seats"]["council"].append("a")
        s["citizens"][1]["status"] = "jailed"
        s["citizens"][2]["wallet"] = -1
        s["citizens"][3]["detainedDay"] = 0
        s["police"]["incidents"].append({"id": 2, "status": "hidden"})
        s["policy"]["taxRate"] = 0.5
        bad = [k for k, v in run_all(s)["checks"].items() if v]
        for name in ("no citizen holds two seats", "every seat holder exists and is free", "no wallet and no treasury below zero",
                     "detention never longer than the limit without a verdict", "hidden crimes are never published",
                     "tax rate inside the constitutional band"):
            self.assertIn(name, bad)


if __name__ == "__main__":
    unittest.main()
