"""A cold page is parsed in a thread, not on the event loop (T133).

Parsing a code's page (2.6 MB) takes 0.2-0.4 s of CPU; on the event loop it held every other
request for as long: the longest stall during a cold read of art. 2043 c.c. was 279 ms, 21 ms now
(replayed, a 10 ms ticker). The same functions on the same pages: the text is the same.
"""
import threading
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from visualex_api.services.normattiva_scraper import NormattivaScraper
from visualex_api.tools import treextractor

pytestmark = pytest.mark.asyncio

FIXTURES = Path(__file__).parent / "fixtures"
LANDING = (FIXTURES / "akn" / "landing_legge_241_1990.html").read_text(encoding="utf-8")
ARTICLE = (FIXTURES / "normattiva" / "art2043_cc_in_force_no_notes_trimmed.html").read_text(encoding="utf-8")


async def test_an_articles_text_is_read_in_a_thread_and_is_the_same_text():
    scraper = NormattivaScraper.__new__(NormattivaScraper)
    scraper.selectors = NormattivaScraper().selectors
    threads = []
    original = NormattivaScraper.estrai_testo

    def recording(self, *args, **kwargs):
        threads.append(threading.current_thread() is threading.main_thread())
        return original(self, *args, **kwargs)

    with patch.object(NormattivaScraper, "estrai_testo", recording):
        text = await scraper.estrai_da_html(ARTICLE)
    assert threads == [False]
    assert text == original(scraper, ARTICLE)


class MemoryCache:
    def __init__(self):
        self.data = {}

    async def get(self, key):
        return self.data.get(key)

    async def set(self, key, value):
        self.data[key] = value


async def test_an_acts_tree_is_parsed_in_a_thread():
    url = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241"
    threads = []
    original = treextractor.parse_normattiva_tree

    def recording(*args, **kwargs):
        threads.append(threading.current_thread() is threading.main_thread())
        return original(*args, **kwargs)

    async def request(method, address, **kwargs):
        return SimpleNamespace(text=LANDING)

    await treextractor.get_tree.cache.clear()
    with patch.object(treextractor, "parse_normattiva_tree", recording), \
            patch.object(treextractor, "_tree_cache", MemoryCache()), \
            patch.object(treextractor.http_client, "request", request):
        articles, count, _ = await treextractor.get_tree(url, return_metadata=True)
    await treextractor.get_tree.cache.clear()
    assert threads == [False]
    assert count > 0
