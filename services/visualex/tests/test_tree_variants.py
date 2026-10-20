"""One page, one download: the tree variants of a page share a single visit.

`get_tree` is asked for three variants of the same Normattiva page in one reading (the
existence check with metadata, a range without, the index the web opens with the section
labels), and each used to download the page again; on EUR-Lex the tree and the article
each launched a browser on the same page (measured 2026-10-20 with
scripts/collector_timing.py: 3.4 s and 3.7 s). The variants are now read from the widest
tree, and the EUR-Lex page from the scraper's own copy, and they must be the answers the
direct parse gives.
"""
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from bs4 import BeautifulSoup

from visualex_api.tools import treextractor
from visualex_api.tools.exceptions import NetworkError
from visualex_api.tools.treextractor import _narrow, _parse_normattiva_tree

pytestmark = pytest.mark.asyncio

FIXTURES = Path(__file__).parent / "fixtures"
LANDING = (FIXTURES / "akn" / "landing_legge_241_1990.html").read_text(encoding="utf-8")
GDPR = (FIXTURES / "eurlex" / "gdpr_oj_trimmed.html").read_text(encoding="utf-8")
L241 = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241"
VARIANTS = [(link, details, metadata)
            for link in (False, True) for details in (False, True) for metadata in (False, True)]


class MemoryCache:
    def __init__(self):
        self.data = {}

    async def get(self, key):
        return self.data.get(key)

    async def set(self, key, value):
        self.data[key] = value


class Manager:
    def __init__(self, cache):
        self.cache = cache

    def get_persistent(self, namespace):
        assert namespace == "eurlex"
        return self.cache


class FakeClient:
    """The shared client's `request` as get_tree uses it, counting the pages it serves."""
    visits = []
    page = LANDING

    @classmethod
    async def request(cls, method, url, **kwargs):
        cls.visits.append((method, url, kwargs))
        return SimpleNamespace(text=cls.page)


@pytest.fixture
async def isolated():
    """Empty tree and EUR-Lex caches, and get_tree's memory cache cleared around the test."""
    tree_cache, eurlex_cache = MemoryCache(), MemoryCache()
    FakeClient.visits, FakeClient.page = [], LANDING
    await treextractor.get_tree.cache.clear()
    with patch.object(treextractor, "_tree_cache", tree_cache), \
            patch.object(treextractor, "get_cache_manager", lambda: Manager(eurlex_cache)), \
            patch.object(treextractor.http_client, "request", FakeClient.request):
        yield tree_cache, eurlex_cache
    await treextractor.get_tree.cache.clear()


@pytest.mark.parametrize("link,details,metadata", VARIANTS)
async def test_every_variant_is_the_narrowed_widest_tree(link, details, metadata):
    direct = await _parse_normattiva_tree(BeautifulSoup(LANDING, "html.parser"), L241, link,
                                          details, return_metadata=metadata)
    full = await _parse_normattiva_tree(BeautifulSoup(LANDING, "html.parser"), L241, link,
                                        True, return_metadata=True)
    assert full[1] > 0 and any(isinstance(entry, str) for entry in full[0])
    assert _narrow(*full, details, metadata) == direct


async def test_three_variants_of_a_normattiva_page_cost_one_visit(isolated):
    answers = [await treextractor.get_tree(L241, link=False, details=d, return_metadata=m)
               for d, m in ((False, True), (False, False), (True, True))]
    assert [url for _, url, _ in FakeClient.visits] == [L241]
    for (d, m), answer in zip(((False, True), (False, False), (True, True)), answers):
        direct = await _parse_normattiva_tree(BeautifulSoup(LANDING, "html.parser"), L241, False,
                                              d, return_metadata=m)
        assert tuple(answer) == direct


async def test_a_tree_kept_before_is_still_read(isolated):
    tree_cache, _ = isolated
    kept = {"result": [{"numero": "1", "allegato": None}], "count": 1, "metadata": {"annexes": []}}
    tree_cache.data[f"{L241}|link=False|details=False|metadata=True"] = kept
    answer = await treextractor.get_tree(L241, link=False, details=False, return_metadata=True)
    assert answer == ([{"numero": "1", "allegato": None}], 1, {"annexes": []})
    assert FakeClient.visits == []


async def test_a_failed_normattiva_page_keeps_nothing(isolated):
    tree_cache, _ = isolated
    FakeClient.page = "x" * 600
    answer = await treextractor.get_tree(L241, link=False, details=False, return_metadata=True)
    assert answer[1] == 0 and tree_cache.data == {}


GDPR_URL = "https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita"


async def test_the_eurlex_tree_reads_the_scraper_copy(isolated):
    _, eurlex_cache = isolated
    eurlex_cache.data[GDPR_URL] = GDPR
    fetch = AsyncMock(return_value=GDPR)
    with patch.object(treextractor, "_fetch_with_playwright", fetch):
        _, count, metadata = await treextractor.get_tree(GDPR_URL, details=True, return_metadata=True)
    assert count > 0 and metadata["rubriche"]["1"] == "Oggetto e finalità"
    assert fetch.await_count == 0


async def test_the_eurlex_page_a_tree_visited_is_left_for_the_scraper(isolated):
    _, eurlex_cache = isolated
    with patch.object(treextractor, "_fetch_with_playwright", AsyncMock(return_value=GDPR)):
        await treextractor.get_tree(GDPR_URL, details=False, return_metadata=True)
    assert eurlex_cache.data[GDPR_URL] == GDPR


async def test_a_refused_eurlex_page_is_never_left_for_the_scraper(isolated):
    _, eurlex_cache = isolated
    refused = "<html><body>" + "Request rejected. " * 100 + "</body></html>"
    with patch.object(treextractor, "_fetch_with_playwright", AsyncMock(return_value=refused)):
        _, count, _ = await treextractor.get_tree(GDPR_URL, details=False, return_metadata=True)
    assert count == 0 and eurlex_cache.data == {}


async def test_a_scraper_copy_without_articles_is_visited_again(isolated):
    _, eurlex_cache = isolated
    eurlex_cache.data[GDPR_URL] = "<html><body>" + "Request rejected. " * 100 + "</body></html>"
    fetch = AsyncMock(return_value=GDPR)
    with patch.object(treextractor, "_fetch_with_playwright", fetch):
        _, count, _ = await treextractor.get_tree(GDPR_URL, details=False, return_metadata=True)
    assert count > 0 and fetch.await_count == 1
    assert eurlex_cache.data[GDPR_URL] == GDPR


# The Normattiva page goes through the shared client (G-337, 21 October 2026): its rate limit
# and its host check, with the one attempt the tree's own session made. A URL from the caller
# (POST /fetch_tree) is visited only on a declared host and only for a source the tree parses.

async def test_a_normattiva_tree_goes_through_the_shared_client_once(isolated):
    await treextractor.get_tree(L241, details=True, return_metadata=True)
    assert FakeClient.visits == [("GET", L241, {"source": "normattiva", "max_retries": 0})]


async def test_a_page_the_client_could_not_fetch_is_a_failure_kept_nowhere(isolated):
    tree_cache, _ = isolated
    refused = AsyncMock(side_effect=NetworkError("Exceeded retry budget", status_code=503))
    with patch.object(treextractor.http_client, "request", refused):
        answer = await treextractor.get_tree(L241, details=True, return_metadata=True)
    assert answer[1] == 0 and answer[0].startswith("Failed to retrieve the page: ")
    assert tree_cache.data == {}


@pytest.mark.parametrize("url", [
    "http://127.0.0.1:5000/normattiva",
    "http://169.254.169.254/latest/meta-data/eur-lex",
    "https://www.normattiva.it.evil.com/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241",
    "http://169.254.169.254\\@eur-lex.europa.eu/eli/reg/2016/679/oj/ita",  # Chromium's host
])
async def test_an_undeclared_host_is_never_visited(isolated, url):
    browser = AsyncMock(return_value=GDPR)
    with patch.object(treextractor, "_fetch_with_playwright", browser):
        answer = await treextractor.get_tree(url, details=True, return_metadata=True)
    assert answer[1] == 0 and answer[0].startswith("Host non consentito")
    assert FakeClient.visits == [] and browser.await_count == 0


@pytest.mark.parametrize("url", [
    "https://dati.cortecostituzionale.it/",
    "https://dati.cortecostituzionale.it/normattiva",
    "https://www.italgiure.giustizia.it/?eur-lex",
])
async def test_a_declared_host_the_tree_does_not_parse_is_not_visited(isolated, url):
    browser = AsyncMock(return_value=GDPR)
    with patch.object(treextractor, "_fetch_with_playwright", browser):
        answer = await treextractor.get_tree(url, return_metadata=True)
    assert answer == ("Unrecognized norm URN format", 0, {})
    assert FakeClient.visits == [] and browser.await_count == 0
