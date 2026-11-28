"""The first read of an act takes the act's tree from the article's own page (owner, G-646; T133).

The existence check downloaded the act's page for its index (2.6 MB and 6.6 s for a code), then
the read downloaded the article's page, which carries the same index: identical trees on 27 of 27
pairs measured offline (c.c., c.p.c., c.p., l. 241/1990, d.lgs. 231/2001, the 18 articles of l.
24/2017). On an act whose tree is not cached, the article's page is read first and the tree taken
from it: one request instead of two. Only for the text in force, and when no annex is named.
"""
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

import app as app_module
from app import NormaController
from visualex_api.tools import treextractor
from visualex_api.tools.cache import PersistentCache
from visualex_api.tools.exceptions import NetworkError
from visualex_api.tools.norma import Norma

pytestmark = pytest.mark.asyncio

LANDING = (Path(__file__).parent / "fixtures" / "akn" / "landing_legge_241_1990.html").read_text(encoding="utf-8")
ACT = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241"


@pytest.fixture
async def caches(tmp_path):
    tree = PersistentCache("tree")
    tree.directory = tmp_path / "tree"
    tree.directory.mkdir()
    pages = PersistentCache("normattiva")
    pages.directory = tmp_path / "normattiva"
    pages.directory.mkdir()
    await treextractor.get_tree.cache.clear()
    with patch.object(treextractor, "_tree_cache", tree), \
            patch.object(app_module.normattiva_scraper, "cache", pages):
        yield tree, pages
    await treextractor.get_tree.cache.clear()


class Source:
    """The shared client: every request counted, every Normattiva page answered with `page`."""

    def __init__(self, page=LANDING):
        self.page, self.asked = page, []

    async def request(self, method, url, **kwargs):
        self.asked.append((url, kwargs.get("max_retries")))
        return SimpleNamespace(text=self.page, status=200, headers={})


def l241():
    return Norma(tipo_atto="legge", data="1990-08-07", numero_atto="241")


def controller():
    return NormaController.__new__(NormaController)


async def test_the_tree_is_stored_as_the_act_pages_tree_would_be(caches):
    """The key and the shape `_tree_from_page` stores, from whatever page carries the index (that
    an article's page carries the act's index identically was measured offline on 27 pairs of
    real pages, too large for the repository)."""
    tree_cache, _ = caches
    assert await treextractor.seed_tree_from_page(ACT, LANDING)
    seeded = await tree_cache.get(treextractor._full_key(ACT, False))
    direct = await treextractor._parse_normattiva_tree(
        treextractor.BeautifulSoup(LANDING, "html.parser"), ACT, False, True, return_metadata=True)
    assert (seeded["result"], seeded["count"], seeded["metadata"]) == tuple(direct)


async def test_a_cold_act_costs_the_article_page_alone(caches):
    _, pages = caches
    source = Source()
    with patch.object(app_module.http_client, "request", source.request), \
            patch.object(treextractor.http_client, "request", source.request):
        await controller()._tree_from_article_page(l241(), "3", None, {})
        assert await treextractor.tree_is_cached(l241().url)
        tree = await treextractor.get_tree(l241().url, link=False, details=False, return_metadata=True)
    urn = ACT + "~art3"
    assert source.asked == [(urn, 0)]                # one attempt, as the tree's own download
    assert await pages.get(urn) == LANDING            # where get_document reads it next
    assert tree[1] > 0 and any(isinstance(e, dict) and e.get("numero") == "3" for e in tree[0])


@pytest.mark.parametrize("data", [
    {"version_date": "2010-01-01"},
    {"version": "originale"},
    {"upcoming": True},
])
async def test_a_dated_request_reads_the_act_page_as_before(caches, data):
    source = Source()
    with patch.object(app_module.http_client, "request", source.request):
        await controller()._tree_from_article_page(l241(), "3", None, data)
    assert source.asked == []
    assert not await treextractor.tree_is_cached(l241().url)


async def test_an_act_whose_tree_is_cached_is_left_alone(caches):
    tree_cache, _ = caches
    await tree_cache.set(treextractor._full_key(l241().url, False), {"result": [{"numero": "1"}], "count": 1, "metadata": {}})
    source = Source()
    with patch.object(app_module.http_client, "request", source.request):
        await controller()._tree_from_article_page(l241(), "3", None, {})
    assert source.asked == []


async def test_a_page_already_kept_is_not_asked_again(caches):
    _, pages = caches
    await pages.set(ACT + "~art3", LANDING)
    source = Source()
    with patch.object(app_module.http_client, "request", source.request):
        await controller()._tree_from_article_page(l241(), "3", None, {})
    assert source.asked == []
    assert await treextractor.tree_is_cached(l241().url)


async def test_a_page_with_no_index_stores_no_tree(caches):
    source = Source(page="<html><body>" + "x" * 600 + "</body></html>")
    with patch.object(app_module.http_client, "request", source.request):
        await controller()._tree_from_article_page(l241(), "3", None, {})
    assert not await treextractor.tree_is_cached(l241().url)


async def test_a_failure_leaves_the_check_as_it_was(caches):
    failing = AsyncMock(side_effect=NetworkError("down"))
    with patch.object(app_module.http_client, "request", failing):
        await controller()._tree_from_article_page(l241(), "3", None, {})
    assert failing.await_count == 1
    assert not await treextractor.tree_is_cached(l241().url)


async def test_the_address_of_a_cold_act_needs_one_request(caches):
    source = Source()
    with patch.object(app_module.http_client, "request", source.request), \
            patch.object(treextractor.http_client, "request", source.request):
        address = await controller().resolve_norm_address(
            {"act_type": "legge", "date": "1990-08-07", "act_number": "241", "article": "3"})
    assert address.checked == [("3", True)]
    assert [url for url, _ in source.asked] == [ACT + "~art3"]


async def test_a_named_annex_reads_the_act_page_as_before(caches):
    called = AsyncMock()
    with patch.object(NormaController, "_tree_from_article_page", called), \
            patch.object(app_module, "get_tree", AsyncMock(return_value=([], 0, {}))), \
            patch.object(app_module, "fetch_act_index", AsyncMock(return_value=None)):
        await controller().resolve_norm_address(
            {"act_type": "legge", "date": "1990-08-07", "act_number": "241", "article": "3", "annex": "1"})
    called.assert_not_awaited()


async def test_a_page_for_an_article_the_act_does_not_hold_is_not_kept(caches):
    """Normattiva answers another page (art. 1) for an article an act does not hold: the tree is
    the act's all the same, but the page must never be kept under that article's address."""
    _, pages = caches
    source = Source()
    with patch.object(app_module.http_client, "request", source.request):
        await controller()._tree_from_article_page(l241(), "9999", None, {})
    assert await treextractor.tree_is_cached(l241().url)
    assert await pages.get(ACT + "~art9999") is None


async def test_an_article_only_in_an_annex_is_not_kept_under_the_body_s_address(caches):
    _, pages = caches
    source = Source()
    with patch.object(app_module.http_client, "request", source.request):
        await controller()._tree_from_article_page(l241(), "3", "1", {})
    assert await pages.get(ACT + ":1~art3") is None


@pytest.mark.parametrize("url,measured", [
    ("https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2", True),
    ("https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1930-10-19;1398:1", True),
    ("https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1940-10-28;1443", True),
    ("https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1931-06-18;773", False),
    ("https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;2620", False),
])
async def test_only_the_measured_codes_are_read_through_their_default_annex(url, measured):
    assert app_module._measured_code(url) is measured


async def test_the_link_route_reads_the_act_page_as_before(caches):
    called = AsyncMock()
    with patch.object(NormaController, "_tree_from_article_page", called), \
            patch.object(app_module, "get_tree", AsyncMock(return_value=([{"numero": "3", "allegato": None}], 1, {}))):
        await controller().resolve_norm_address(
            {"act_type": "legge", "date": "1990-08-07", "act_number": "241", "article": "3"}, strict=True)
    called.assert_not_awaited()
