"""Canonical JSON, byte-for-byte identical to `canon()` in src/db.ts.

The republic hashes every ledger entry over a canonical JSON encoding (object keys sorted,
no whitespace). An independent auditor must reproduce that encoding exactly, including the
way JavaScript prints numbers, or every hash would differ. This module is the only place
that knows those rules.
"""
from __future__ import annotations

import hashlib
import json
import math
from typing import Any

GENESIS = "0" * 64


def js_number(x: int | float) -> str:
    """Format a number the way JavaScript's JSON.stringify does (ECMA-262 Number::toString)."""
    if isinstance(x, bool):  # bool is an int subclass in Python; JSON booleans are handled earlier
        return "true" if x else "false"
    if isinstance(x, int):
        if abs(x) < 10**21:
            return str(x)
        x = float(x)
    if math.isnan(x) or math.isinf(x):
        return "null"  # JSON.stringify(NaN) === 'null'
    if x == 0:
        return "0"  # also covers -0
    r = repr(x)  # shortest round-trip digits, the same digit string JavaScript picks
    if "e" not in r and "E" not in r:
        return r[:-2] if r.endswith(".0") else r
    mantissa, exp = r.split("e")
    e = int(exp)
    digits = mantissa.replace("-", "").replace(".", "")
    sign = "-" if x < 0 else ""
    # n = position of the decimal point relative to the digit string (ECMA-262 notation)
    point = mantissa.replace("-", "").find(".")
    k = len(digits)
    n = e + (point if point >= 0 else k)
    if k <= n <= 21:
        return sign + digits + "0" * (n - k)
    if 0 < n <= 21:
        return sign + digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return sign + "0." + "0" * (-n) + digits
    exp_sign = "+" if n - 1 >= 0 else "-"
    body = digits[0] + ("." + digits[1:] if k > 1 else "")
    return f"{sign}{body}e{exp_sign}{abs(n - 1)}"


def js_string(s: str) -> str:
    """JSON.stringify for strings: short escapes for \\b \\f \\n \\r \\t, \\u00xx for other controls."""
    return json.dumps(s, ensure_ascii=False)


def canon(v: Any) -> str:
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, (int, float)):
        return js_number(v)
    if isinstance(v, str):
        return js_string(v)
    if isinstance(v, (list, tuple)):
        return "[" + ",".join(canon(x) for x in v) + "]"
    if isinstance(v, dict):
        # JavaScript sorts keys by UTF-16 code units; for the ASCII keys the republic uses this equals str order
        return "{" + ",".join(js_string(k) + ":" + canon(v[k]) for k in sorted(v, key=_utf16)) + "}"
    raise TypeError(f"cannot canonicalise {type(v).__name__}")


def _utf16(s: str) -> bytes:
    return s.encode("utf-16-be")


def entry_hash(prev: str, entry: dict) -> str:
    """The hash of one ledger entry, chained to the previous entry's hash."""
    body = {k: entry.get(k) for k in ("seq", "ts", "day", "kind", "actor", "data")}
    return hashlib.sha256((prev + "|" + canon(body)).encode("utf-8")).hexdigest()


def ballots_digest(anonymised: list[str]) -> str:
    """Digest the Election Commission publishes for the anonymised ballot list."""
    return hashlib.sha256(canon(anonymised).encode("utf-8")).hexdigest()
