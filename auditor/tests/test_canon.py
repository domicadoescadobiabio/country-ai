"""Canonical JSON must match JavaScript byte for byte, or no hash would ever verify."""
import json
import shutil
import subprocess
import unittest
from pathlib import Path

from auditor.canon import GENESIS, ballots_digest, canon, entry_hash, js_number

ROOT = Path(__file__).resolve().parents[2]
SAMPLES = [
    None, True, False, 0, -0.0, 1, -7, 12.5, 0.1, 1 / 3, 1e21, 1.5e-7, 123456789012345680000.0, 5e-324, 2**53,
    "plain", "quote \" and backslash \\", "line\nbreak\ttab", "\u0001 control", "emoji \U0001f642 and é", " ",
    [], [1, [2, [3]]], {}, {"b": 1, "a": {"d": [1, 2], "c": None}}, {"Z": 1, "a": 2, "_": 3, "0": 4},
]


class JsNumberTest(unittest.TestCase):
    def test_integers_and_floats(self):
        self.assertEqual(js_number(5.0), "5")
        self.assertEqual(js_number(0.1), "0.1")
        self.assertEqual(js_number(1e21), "1e+21")
        self.assertEqual(js_number(1.5e-7), "1.5e-7")
        self.assertEqual(js_number(0.000001), "0.000001")
        self.assertEqual(js_number(123e-20), "1.23e-18")
        self.assertEqual(js_number(float("nan")), "null")

    def test_canon_sorts_keys_without_spaces(self):
        self.assertEqual(canon({"b": 1, "a": [True, None]}), '{"a":[true,null],"b":1}')


def run_node(script: str, payload) -> subprocess.CompletedProcess:
    return subprocess.run(["node", "--input-type=module", "-e", script], input=json.dumps(payload),
                          capture_output=True, text=True, cwd=ROOT, timeout=120, encoding="utf-8")


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class CrossLanguageTest(unittest.TestCase):
    """Run the server's own canon() in Node on the same values and compare."""

    def test_same_bytes_as_javascript(self):
        script = (
            "import { canon } from './src/db.ts';"
            "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{"
            "const vals=JSON.parse(s);process.stdout.write(JSON.stringify(vals.map(v=>canon(v))));});"
        )
        out = run_node(script, SAMPLES)
        self.assertEqual(out.returncode, 0, out.stderr)
        js = json.loads(out.stdout)
        for v, expected in zip(SAMPLES, js):
            # values that went through JSON (like -0.0) are compared after the same round trip
            self.assertEqual(canon(json.loads(json.dumps(v))), expected, repr(v))

    def test_same_hash_as_javascript(self):
        entry = {"seq": 7, "ts": 1794325035851, "day": 3, "kind": "law", "actor": "council",
                 "data": {"title": "Tax 12%", "value": 0.12, "votes": {"aurel": "yes", "kite": "no"}}}
        script = (
            "import { entryHash } from './src/db.ts';"
            "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{"
            "const e=JSON.parse(s);process.stdout.write(entryHash('0'.repeat(64), e));});"
        )
        out = run_node(script, entry)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(entry_hash(GENESIS, entry), out.stdout.strip())


class DigestTest(unittest.TestCase):
    def test_digest_is_order_sensitive(self):
        a = ballots_digest(["BLANK", "x>y"])
        self.assertNotEqual(a, ballots_digest(["x>y", "BLANK"]))
        self.assertEqual(len(a), 64)


if __name__ == "__main__":
    unittest.main()
