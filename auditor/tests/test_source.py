"""HTTP source: rate limits (429) are waited out as the server asks, capped at a minute."""
import email.message
import io
import unittest
import urllib.error
from unittest import mock

from auditor import source
from auditor.source import ApiSource, retry_after


def http_error(code, retry=None):
    h = email.message.Message()
    if retry is not None:
        h["retry-after"] = retry
    return urllib.error.HTTPError("http://x/api", code, "err", h, io.BytesIO(b""))


class Ok:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return b'{"ok": true}'


class RetryAfterTest(unittest.TestCase):
    def test_seconds_and_caps(self):
        self.assertEqual(retry_after("12"), 12.0)
        self.assertEqual(retry_after("3600"), 60.0)
        self.assertEqual(retry_after("0"), 1.0)
        self.assertEqual(retry_after(None), source.RATE_LIMIT_DEFAULT)
        self.assertEqual(retry_after("soon"), source.RATE_LIMIT_DEFAULT)
        self.assertEqual(retry_after("nan"), source.RATE_LIMIT_DEFAULT)

    def test_http_date(self):
        self.assertEqual(retry_after("Thu, 12 Nov 2026 10:00:30 GMT", now=1794477600.0), 30.0)


class GetTest(unittest.TestCase):
    def setUp(self):
        self.waits = []
        self.src = ApiSource("http://x")
        self.src.sleep = self.waits.append

    def test_429_waits_and_does_not_spend_retries(self):
        replies = [http_error(429, "7")] * 5 + [Ok()]
        with mock.patch("urllib.request.urlopen", side_effect=replies):
            self.assertEqual(self.src.get("/api/ledger"), {"ok": True})
        self.assertEqual(self.waits, [7.0] * 5)

    def test_429_gives_up_after_limit(self):
        with mock.patch("urllib.request.urlopen", side_effect=lambda *a, **k: (_ for _ in ()).throw(http_error(429, "1"))):
            with self.assertRaises(ConnectionError):
                self.src.get("/api/ledger")
        self.assertEqual(self.waits.count(1.0) >= source.RATE_LIMIT_RETRIES, True)
        self.assertLessEqual(max(self.waits), 60.0)

    def test_404_is_none(self):
        with mock.patch("urllib.request.urlopen", side_effect=http_error(404)):
            self.assertIsNone(self.src.get("/api/nothing"))


if __name__ == "__main__":
    unittest.main()
