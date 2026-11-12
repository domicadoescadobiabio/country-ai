"""Alarm rules: each closes by itself once its condition is gone."""
import unittest

from auditor import watch


def street(*texts, kind="chat"):
    return {"feed": {"streets": [{"text": t, "kind": kind} for t in texts]}}


class StreetsTest(unittest.TestCase):
    def test_repeats_open_and_close(self):
        memo = {}
        bad = watch.evaluate(street(*(["Same line."] * 15 + [f"line {i}" for i in range(15)])), None, None, memo)
        self.assertIn("rakyat:repeat", bad["opened"])
        good = watch.evaluate(street(*[f"line {i}" for i in range(30)]), None, None, memo)
        self.assertEqual(good["alarms"], [])
        self.assertEqual(good["closed"], ["rakyat:repeat"])

    def test_only_chat_and_last_window(self):
        s = street(*(["old"] * 40 + [f"n{i}" for i in range(30)]))
        s["feed"]["streets"] += [{"text": "Deployed x", "kind": "deploy"}] * 5
        self.assertEqual(watch.street_repeats(s)["repeats"], 0)


class RunnerTest(unittest.TestCase):
    def test_old_runner(self):
        self.assertIsNotNone(watch.local_brain({"localBrain": {"online": True, "runner": None}}))
        self.assertIsNotNone(watch.local_brain({"localBrain": {"online": True, "runner": {"version": 1}}}))

    def test_new_or_offline_runner(self):
        self.assertIsNone(watch.local_brain({"localBrain": {"online": True, "runner": {"version": 2}}}))
        self.assertIsNone(watch.local_brain({"localBrain": {"online": False, "runner": None}}))


class CabinetTest(unittest.TestCase):
    def test_only_stuck_nomination_alarms(self):
        memo = {}
        st = {"cabinet": {"pending": {"portfolio": "justice", "votes": 5}}}
        self.assertIsNone(watch.cabinet_pending(st, memo, 0))
        self.assertIsNone(watch.cabinet_pending(st, memo, 1800))
        st2 = {"cabinet": {"pending": {"portfolio": "justice", "votes": 6}}}
        self.assertIsNone(watch.cabinet_pending(st2, memo, 3000))  # votes moved: the clock restarts
        self.assertIsNotNone(watch.cabinet_pending(st2, memo, 3000 + 3601))
        self.assertIsNone(watch.cabinet_pending({"cabinet": {"pending": None}}, memo, 9000))


class AcademyTest(unittest.TestCase):
    def state(self, day, sessions, failures, asked=0, right=0, recalls=0):
        return {"day": day, "academy": {"sessions": sessions, "failures": failures, "rules": {"asked": asked, "right": right}},
                "training": {"recalls": recalls, "rules": {"asked": 0, "right": 0}}}

    def test_per_day_thresholds(self):
        memo = {}
        self.assertEqual(watch.academy_training(self.state(2, 248, 1), memo), [])  # baseline
        keys = {a["key"] for a in watch.academy_training(self.state(2, 258, 8, 20, 5, 4), memo)}
        self.assertEqual(keys, {"pemerintah:exam-failures", "pemerintah:rule-accuracy", "pemerintah:recalls"})
        self.assertEqual(watch.academy_training(self.state(3, 258, 8, 20, 5, 4), memo), [])  # new day resets


class LlmTest(unittest.TestCase):
    def test_dead_model(self):
        st = {"llmUsage": {"errorsByModel": {"m": {"errors": 1, "lastKind": "http", "lastStatus": 404}}}}
        self.assertEqual(watch.llm_errors(st, {})[0]["key"], "negara:llm-dead:m")

    def test_rising_errors(self):
        memo, out = {}, []
        for n in range(1, 5):
            out = watch.llm_errors({"llmUsage": {"errorsByModel": {"m": {"errors": n, "lastKind": "timeout"}}}}, memo)
        self.assertEqual(out[0]["key"], "negara:llm-rising:m")
        self.assertEqual(watch.llm_errors({"llmUsage": {"errorsByModel": {"m": {"errors": 4, "lastKind": "timeout"}}}}, memo), [])


class BuildTest(unittest.TestCase):
    def test_restart_without_deploy(self):
        memo = {}
        h = lambda dep, at: {"build": {"deployment": dep, "code": "c", "startedAt": at}}  # noqa: E731
        self.assertIsNone(watch.build_restart(h("d1", "t1"), memo))
        self.assertIsNone(watch.build_restart(h("d2", "t2"), memo))  # a deploy
        self.assertIsNotNone(watch.build_restart(h("d2", "t3"), memo))  # same deploy, new start


class LedgerTest(unittest.TestCase):
    def entry(self, seq, citizen, case):
        return {"seq": seq, "data": {"citizen": citizen, "case": case}}

    def test_duplicates_listed_with_seq(self):
        dup = watch.ledger_duplicates({"pardon": [self.entry(1, "a", 1), self.entry(2, "b", 2), self.entry(9, "a", 1)],
                                       "correction": [self.entry(3, "vex", 4)]})
        self.assertEqual(dup["counts"], {"pardon": 3, "correction": 1})
        self.assertEqual(dup["duplicates"], [{"kind": "pardon", "citizen": "a", "case": 1, "seqs": [1, 9]}])
        self.assertIsNotNone(watch.ledger_alarm(dup))

    def test_clean(self):
        self.assertIsNone(watch.ledger_alarm(watch.ledger_duplicates({"pardon": [self.entry(1, "a", 1)]})))


if __name__ == "__main__":
    unittest.main()
