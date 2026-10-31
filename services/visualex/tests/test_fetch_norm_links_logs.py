"""POST /fetch_norm_links logs counts only: never an act, an article or an address, in the route
and in everything it calls, failures included (design 2026-10-31-document-hyperlinks §3.1).

The network is faked at the HTTP layer (the shared client's `request`), not by stubbing
`get_tree` or the date lookup, so `treextractor`'s, `act_dates`' and `eurlex_fetch`'s own lines
run. Records are captured at INFO, the level the deployed app logs at (`asgi:app`: the root
logger's first configuration, by the modules app.py imports, is INFO): both structlog's, routed
to the standard library by app.py, and the standard `logging` module's.
"""
import logging
import re
from datetime import date
from pathlib import Path
from unittest.mock import AsyncMock, patch

import aiohttp
import pytest

import app as app_module
from app import NormaController
from visualex_api.services import act_dates, eurlex_fetch
from visualex_api.services.http_client import http_client
from visualex_api.tools import treextractor
from visualex_api.tools.exceptions import NetworkError

pytestmark = pytest.mark.asyncio

FIXTURES = Path(__file__).parent / "fixtures"
LANDING = (FIXTURES / "akn" / "landing_legge_241_1990.html").read_text(encoding="utf-8")
GDPR = (FIXTURES / "eurlex" / "gdpr_oj_trimmed.html").read_text(encoding="utf-8")
GDPR_URL = "https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita"

NORMS = [
    # the year completed by the resolver, the index read, the act's spelling of the ordinal (the fixture's)
    {"act_type": "legge", "date": "1990", "act_number": "241", "article": "21-nonies"},
    {"act_type": "legge", "date": "1990-08-07", "act_number": "241", "article": "9999"},
    # Normattiva has no such page for the resolver (404); the index cannot be reached
    {"act_type": "decreto legislativo", "date": "2001", "act_number": "231", "article": "25-undecies"},
    {"act_type": "decreto legislativo", "date": "2001-06-08", "act_number": "231", "article": "5"},
    # the EU act from the scraper's copy; another that CELLAR and the browser do not serve
    {"act_type": "regolamento ue", "date": "2016", "act_number": "679", "article": "4"},
    {"act_type": "direttiva ue", "date": "2019", "act_number": "790", "article": "17"},
    {"act_type": "codice civile", "article": "2043"},
]
# What would name a norm of the request, or its address (a source's host alone names none).
WORDS = ("legge", "decreto", "regolamento", "direttiva", "codice", "urn:nir", "n2ls", "uri-res", "/eli/",
         "celex:", "resource/celex", "1990-08-07", "2001-06-08", "1942-03-16", "nonies", "novies", "undecies",
         "32016r0679", "32019l0790")
NUMBERS = re.compile(r"(?<![\d.])(241|231|679|790|262|2043|9999|1990|2001|2016|2019)(?![\d])")


class MemoryCache:
    def __init__(self, data=None):
        self.data = dict(data or {})

    async def get(self, key):
        return self.data.get(key)

    async def set(self, key, value, *args, **kwargs):
        self.data[key] = value


class Manager:
    def __init__(self, caches):
        self.caches = caches

    def get_persistent(self, namespace):
        return self.caches.setdefault(namespace, MemoryCache())


class FakeResponse:
    def __init__(self, text, status=200):
        self._text, self.status, self.headers = text, status, {"Content-Type": "text/html"}

    async def text(self, encoding=None):
        return self._text

    def raise_for_status(self):
        if self.status >= 400:
            raise aiohttp.ClientResponseError(None, (), status=self.status, message="error")

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class FakeSession:
    """The aiohttp session under the shared client: its retries, errors and log lines run."""

    def request(self, method, url, **kwargs):
        if "legge:1990" in url and ";241" in url:
            return FakeResponse(LANDING)
        if "decreto.legislativo:2001;231" in url:
            return FakeResponse("Not here", status=404)
        # Every other source fails, the address in the error as aiohttp's errors carry it.
        raise aiohttp.ClientConnectionError(f"Cannot connect to {url}")


async def _no_wait(*args, **kwargs):
    return None


class NoBrowser:
    async def __aenter__(self):
        raise NetworkError("no browser in tests", status_code=503)

    async def __aexit__(self, *exc):
        return False


@pytest.fixture
async def isolated():
    manager = Manager({"eurlex": MemoryCache({GDPR_URL: GDPR})})
    await treextractor.get_tree.cache.clear()
    with patch.object(treextractor, "_tree_cache", MemoryCache()), \
            patch.object(treextractor, "get_cache_manager", lambda: manager), \
            patch.object(act_dates, "get_cache_manager", lambda: manager), \
            patch.object(http_client, "_get_session", AsyncMock(return_value=FakeSession())), \
            patch.object(http_client, "_wait_before", _no_wait), \
            patch.object(http_client, "_respect_min_interval", _no_wait), \
            patch.object(eurlex_fetch, "async_playwright", lambda: NoBrowser()), \
            patch.object(app_module, "today_in_rome", return_value=date(2026, 10, 31)):
        yield
    await treextractor.get_tree.cache.clear()


def _plain(record):
    text = record.getMessage()
    if record.args:
        text += " " + " ".join(map(str, record.args))
    text = re.sub(r"\x1b\[[0-9;]*m", "", text)
    return re.sub(r"duration_ms=\S+", "", text)


async def test_the_route_and_what_it_calls_log_no_norm(isolated, caplog):
    caplog.set_level(logging.INFO)
    client = NormaController().app.test_client()
    response = await client.post("/fetch_norm_links", json={"norms": NORMS})
    assert response.status_code == 200
    results = (await response.get_json())["results"]
    assert [r["reason"] for r in results] == [
        "ok", "article_missing", "date_incomplete", "source_unavailable", "ok", "source_unavailable",
        "source_unavailable",
    ]
    assert results[0]["href"].endswith("legge:1990-08-07;241~art21novies!vig=2026-10-31")
    assert results[4]["href"] == GDPR_URL

    texts = [_plain(r) for r in caplog.records if r.levelno >= logging.INFO]
    # The capture sees both kinds of record: the route's summary (structlog) and the tree's
    # parse (the standard module), so an empty capture cannot pass for a clean one.
    assert any("fetch_norm_links" in t and "reasons" in t for t in texts)
    assert any("Parsing Normattiva structure" in t for t in texts)
    leaks = [t for t in texts if any(w in t.lower() for w in WORDS) or NUMBERS.search(t)]
    assert leaks == [], "\n".join(leaks)
