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


class MonotoneTest(unittest.TestCase):
    def st(self, **acts):
        return {"daily": {"byAct": acts}}

    def test_old_night_does_not_hold_the_alarm(self):
        memo = {}
        # a night of resting is in the cumulative counter: 3500 rest of 3700
        self.assertIsNone(watch.monotone(self.st(rest=3500, work=200), memo, 0))
        # the next two hours are varied: no alarm, although the cumulative share is still ~80% rest
        self.assertIsNone(watch.monotone(self.st(rest=3600, work=300, study=100, talk=100), memo, 3600))

    def test_monotone_window_alarms_and_closes(self):
        memo = {}
        watch.monotone(self.st(rest=0, work=0), memo, 0)
        self.assertIsNotNone(watch.monotone(self.st(rest=300, work=20), memo, 3600))
        # window slides past the monotone hour and the new thoughts are varied
        later = watch.monotone(self.st(rest=400, work=200, study=200), memo, 3600 + 2 * 3600)
        self.assertIsNone(later)

    def test_quiet_night_is_skipped(self):
        memo = {}
        watch.monotone(self.st(rest=1000), memo, 0)
        self.assertIsNone(watch.monotone(self.st(rest=1150), memo, 3600))  # only 150 new thoughts

    def test_counter_reset(self):
        memo = {}
        watch.monotone(self.st(rest=5000), memo, 0)
        self.assertIsNone(watch.monotone(self.st(rest=10), memo, 60))
        self.assertEqual(memo["actsWindow"]["new"], 0)


class AwakeTest(unittest.TestCase):
    def test_night_is_skipped_and_morning_starts_fresh(self):
        memo = {}
        watch.monotone({"daily": {"byAct": {"rest": 0}, "clock": {"awake": True}}}, memo, 0)
        night = {"daily": {"byAct": {"rest": 900}, "clock": {"awake": False}}}
        self.assertIsNone(watch.monotone(night, memo, 3600))
        self.assertTrue(memo["actsWindow"]["asleep"])
        # the evening's resting does not count in the morning window
        morning = {"daily": {"byAct": {"rest": 900, "work": 150, "study": 100}, "clock": {"awake": True}}}
        self.assertIsNone(watch.monotone(morning, memo, 7200))
        self.assertEqual(memo["actsWindow"]["new"], 0)


class RunwayTest(unittest.TestCase):
    def test_from_gov_figures(self):
        st = {"treasury": 400_000, "gov": {"ubiPerDay": 300_000, "taxPerDay": 200_000}}
        a = watch.treasury_runway(st, None, {}, 0)
        self.assertEqual(a["key"], "pemerintah:treasury-runway")  # 4 days
        st["treasury"] = 600_000
        self.assertIsNone(watch.treasury_runway(st, None, {}, 0))  # 6 days

    def test_server_runway_days(self):
        gov = {"taxPerDay": 1, "ubiPerDay": 2, "netPerDay": -1, "rejectedShare": 0.1}
        a = watch.treasury_runway({"treasury": 3, "gov": {**gov, "runwayDays": 3.0}}, None, {}, 0)
        self.assertEqual(a["key"], "pemerintah:treasury-runway")
        self.assertIsNone(watch.treasury_runway({"treasury": 3, "gov": {**gov, "runwayDays": 12.0}}, None, {}, 0))
        self.assertIsNone(watch.treasury_runway({"treasury": 3, "gov": {**gov, "runwayDays": None}}, None, {}, 0))

    def test_taxes_cover_ubi(self):
        self.assertIsNone(watch.treasury_runway({"treasury": 1, "gov": {"ubiPerDay": 1, "taxPerDay": 2}}, None, {}, 0))

    def test_from_ledger_and_tax_history(self):
        memo, ubi = {}, [{"seq": 5, "data": {"total": 300_000, "short": 0}}]
        st = lambda tax: {"treasury": 400_000, "econ": {"taxCollected": tax}}  # noqa: E731
        self.assertIsNone(watch.treasury_runway(st(0), ubi, memo, 0))  # no day of tax history yet
        self.assertIsNotNone(watch.treasury_runway(st(200_000), ubi, memo, 86400))
        self.assertEqual(memo["runway"]["days"], 4.0)

    def test_missing_data(self):
        self.assertIsNone(watch.treasury_runway({"treasury": 5}, None, {}, 0))


class RejectedShareTest(unittest.TestCase):
    def test_a_full_day_above_half(self):
        memo, st = {}, {"gov": {"rejectedShare": 0.7}}
        self.assertIsNone(watch.rejected_share(st, memo, 0))
        self.assertIsNone(watch.rejected_share(st, memo, 3600))
        self.assertIsNotNone(watch.rejected_share(st, memo, 86400))
        self.assertIsNone(watch.rejected_share({"gov": {"rejectedShare": 0.3}}, memo, 90000))
        self.assertIsNone(watch.rejected_share(st, memo, 90001))  # the day starts again


class SeatsStuckTest(unittest.TestCase):
    H = 3600

    def st(self, elections, mayor=None):
        return {"stats": {"seated": 1, "seats": 2},
                "config": {"roles": [{"id": "president", "seats": 1}, {"id": "mayor", "seats": 1}]},
                "seats": {"president": ["p"], "mayor": []},
                "cities": [{"id": "datahaven", "mayor": mayor}], "elections": elections}

    def run12(self, state):
        memo = {}
        watch.seats_stuck(state, memo, 0)
        return watch.seats_stuck(state, memo, 12 * self.H)

    def test_running_race_holds_the_alarm(self):
        race = {"id": 28, "office": "mayor", "city": "datahaven", "stage": "campaign", "stageEndsAt": 13 * self.H * 1000}
        self.assertIsNone(self.run12(self.st([race])))

    def test_no_race_alarms(self):
        other = {"id": 9, "office": "mayor", "city": "neura", "stage": "voting", "stageEndsAt": 13 * self.H * 1000}
        a = self.run12(self.st([other]))
        self.assertIn("no election open", a["text"])

    def test_race_past_its_stage_end_alarms(self):
        race = {"id": 28, "office": "mayor", "city": "datahaven", "stage": "nomination", "stageEndsAt": 1 * self.H * 1000}
        self.assertIn("stuck in nomination", self.run12(self.st([race]))["text"])

    def test_seats_moved(self):
        memo = {}
        watch.seats_stuck(self.st([]), memo, 0)
        moved = self.st([])
        moved["stats"]["seated"] = 2
        self.assertIsNone(watch.seats_stuck(moved, memo, 12 * self.H))


class SchoolTest(unittest.TestCase):
    def st(self, lessons, expired=0, queued=5, online=True):
        return {"school": {"lessons": lessons},
                "localBrain": {"online": online, "trainExpired": expired, "queuedTrain": queued}}

    def keys(self, states):
        memo, out = {}, []
        for i, s in enumerate(states):
            out = watch.school_training(s, memo, i * 900)  # every 15 min, 5 observations = 1 h
        return {a["key"] for a in out}

    def test_healthy_hour(self):
        self.assertEqual(self.keys([self.st(100 + 50 * i, queued=5 + (i % 2)) for i in range(5)]), set())

    def test_stalled_expiring_and_growing(self):
        keys = self.keys([self.st(100, expired=i, queued=5 + 10 * i) for i in range(5)])
        self.assertEqual(keys, {"rakyat:school-stalled", "rakyat:train-expired", "rakyat:train-queue"})

    def test_offline_or_short_window_is_silent(self):
        self.assertEqual(self.keys([self.st(100, online=False) for _ in range(5)]), set())
        self.assertEqual(self.keys([self.st(100) for _ in range(3)]), set())

    def test_counter_restart(self):
        self.assertEqual(self.keys([self.st(9000), self.st(9100), self.st(10), self.st(60), self.st(120)]), set())


class RunnerTest(unittest.TestCase):
    def test_old_runner(self):
        self.assertIsNotNone(watch.local_brain({"localBrain": {"online": True, "runner": None}}))
        self.assertIsNotNone(watch.local_brain({"localBrain": {"online": True, "runner": {"version": 1}}}))

    def test_new_or_offline_runner(self):
        self.assertIsNone(watch.local_brain({"localBrain": {"online": True, "runner": {"version": 2}}}))
        self.assertIsNone(watch.local_brain({"localBrain": {"online": False, "runner": None}}))


class CabinetTest(unittest.TestCase):
    def st(self, votes, agent="a", day=2, since=2):
        return {"day": day, "cabinet": {"pending": {"post": "justice", "agent": agent, "votes": votes, "since": since}}}

    def test_only_stuck_nomination_alarms(self):
        memo = {}
        self.assertIsNone(watch.cabinet_pending(self.st(5), memo, 0))
        self.assertIsNone(watch.cabinet_pending(self.st(5), memo, 1800))
        self.assertIsNone(watch.cabinet_pending(self.st(6), memo, 3000))  # a vote came in: the clock restarts
        self.assertIsNotNone(watch.cabinet_pending(self.st(6), memo, 3000 + 3601))
        self.assertIsNone(watch.cabinet_pending(self.st(6, agent="b"), memo, 9000))  # a new nominee
        self.assertIsNone(watch.cabinet_pending({"cabinet": {"pending": None}}, memo, 9000))

    def test_open_for_a_day(self):
        self.assertIsNotNone(watch.cabinet_pending(self.st(5, day=3, since=2), {}, 0))

    def test_quorum(self):
        self.assertIsNone(watch.council_quorum({"cabinet": {"freeCouncillors": 30, "quorum": 16}}))
        self.assertIsNotNone(watch.council_quorum({"cabinet": {"freeCouncillors": 15, "quorum": 16}}))
        self.assertIsNone(watch.council_quorum({"cabinet": {}}))


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


class OpenRouterPausedTest(unittest.TestCase):
    def test_paused_field_names_the_cause(self):
        st = {"llmUsage": {"openrouterPaused": {"status": 402, "reason": "insufficient credits", "until": "15:00", "skipped": 40}}}
        a = watch.openrouter_paused(st)
        self.assertEqual(a["key"], "negara:openrouter-paused")
        self.assertIn("credits exhausted", a["text"])
        self.assertIn("40 calls skipped", a["text"])
        st["llmUsage"]["openrouterPaused"]["status"] = 401
        self.assertIn("key rejected", watch.openrouter_paused(st)["text"])

    def test_403_is_moderation_not_the_account(self):
        st = {"llmUsage": {"errorsByModel": {"openrouter:m": {"errors": 3, "lastKind": "http", "lastStatus": 403}}}}
        self.assertIsNone(watch.openrouter_paused(st))

    def test_403_filed_as_auth_is_not_a_dead_model(self):
        memo = {}
        st = lambda n: {"llmUsage": {"errorsByModel": {"openrouter:m": {"errors": n, "lastKind": "auth", "lastStatus": 403}}}}  # noqa: E731
        self.assertEqual(watch.llm_errors(st(1), memo), [])
        for n in range(2, 5):
            out = watch.llm_errors(st(n), memo)
        self.assertEqual([a["key"] for a in out], ["negara:llm-rising:openrouter:m"])  # only a steady rise alarms
        # a real auth failure elsewhere still counts as dead
        self.assertEqual(watch.llm_errors({"llmUsage": {"errorsByModel": {"claude:x": {"errors": 1, "lastKind": "auth", "lastStatus": 401}}}}, {})[0]["key"],
                         "negara:llm-dead:claude:x")

    def test_not_paused(self):
        st = {"llmUsage": {"openrouterPaused": None,
                           "errorsByModel": {"openrouter:m": {"errors": 9, "lastStatus": 402}}}}
        self.assertIsNone(watch.openrouter_paused(st))  # the server's own field wins

    def test_fallback_from_errors_and_no_duplicate_per_model(self):
        st = {"llmUsage": {"errorsByModel": {"openrouter:m": {"errors": 434, "lastKind": "http", "lastStatus": 402}}}}
        self.assertIn("credits exhausted", watch.openrouter_paused(st)["text"])
        self.assertEqual(watch.llm_errors(st, {}), [])
        keys = {a["key"] for a in watch.evaluate(st, None, None, {})["alarms"]}
        self.assertIn("negara:openrouter-paused", keys)


class LeaderBudgetTest(unittest.TestCase):
    def st(self, spent, denied, train_spent=5.0, hour=13.0, day=9):
        return {"budget": {"day": day, "daily": 45, "spent": spent, "leader": spent / 2, "official": spent / 2,
                           "denied": {"leader": denied}, "train": {"daily": 38, "spent": train_spent}},
                "daily": {"clock": {"hour": hour}}}

    def keys(self, *states):
        memo, out = {}, []
        for s in states:
            out = watch.leader_budget(s, memo)
        return {a["key"] for a in out}

    def test_pacing_refusals_at_low_spend_are_not_an_empty_purse(self):
        self.assertEqual(self.keys(self.st(2.6, 2), self.st(2.7, 4)), set())

    def test_leaders_offline_when_the_share_is_spent(self):
        self.assertIn("negara:leader-offline", self.keys(self.st(6.0, 2, hour=21), self.st(6.5, 5, hour=21)))

    def test_whole_purse_spent_by_training_counts_too(self):
        self.assertIn("negara:leader-offline", self.keys(self.st(3.0, 0, train_spent=38, hour=21),
                                                          self.st(3.1, 1, train_spent=38, hour=21)))

    def test_a_new_day_does_not_count_yesterdays_refusals(self):
        self.assertEqual(self.keys(self.st(6.5, 9, hour=23, day=9), self.st(0.1, 12, hour=1, day=10)), set())

    def test_pace_warning(self):
        self.assertIn("negara:leader-budget-pace", self.keys(self.st(5.0, 0, hour=6)))  # 71% spent at 25% of the day
        self.assertEqual(self.keys(self.st(3.0, 0, hour=12)), set())  # 43% at half the day


class MischiefTest(unittest.TestCase):
    def st(self, today, per_day=60, taken=None):
        d = {"mischief": {"today": today, "perDay": per_day, "tried": 3, "caught": 1}}
        if taken is not None:
            d["moments"] = {"temptation": {"taken": taken}}
        return {"day": 11, "daily": d, "court": {"cases": [
            {"kind": "criminal", "openedDay": 11}, {"kind": "criminal", "openedDay": 10}, {"kind": "civil", "openedDay": 11}]}}

    def test_at_or_under_the_cap(self):
        view, a = watch.mischief(self.st(60))
        self.assertIsNone(a)
        self.assertEqual(view["criminalTrialsToday"], 1)

    def test_over_the_cap(self):
        view, a = watch.mischief(self.st(61, taken=70))
        self.assertEqual(a["key"], "rakyat:mischief-cap")
        self.assertEqual(view["temptationTaken"], 70.0)

    def test_trials_counted_from_the_ledger(self):
        cases = [{"day": 11, "data": {"kind": "criminal"}}] * 45 + [{"day": 11, "data": {"kind": "policy"}},
                                                                    {"day": 10, "data": {"kind": "criminal"}}]
        by_day = watch.criminal_trials_by_day(cases)
        self.assertEqual(by_day, {11: 45, 10: 1})
        view, _ = watch.mischief(self.st(41), by_day)
        self.assertEqual((view["criminalTrialsToday"], view["trialsFrom"]), (45, "ledger"))

    def test_fields_not_live_yet(self):
        view, a = watch.mischief({"daily": {}})
        self.assertIsNone(a)
        self.assertIsNone(view["temptationTaken"])


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
