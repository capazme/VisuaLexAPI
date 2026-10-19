"""AKN's two jobs: repair the existence check when the tree is unusable, and
stand in for the HTML extractor when it fails outright."""
from unittest.mock import AsyncMock, patch

import pytest

from app import NormaController
from visualex_api.services.akn_fetch import AktIndex
from visualex_api.services.normattiva_scraper import NormattivaScraper
from visualex_api.tools.cache import PersistentCache
from visualex_api.tools.cache_manager import get_cache_manager


def _controller():
    return NormaController.__new__(NormaController)


@pytest.fixture
async def cold_scraper(tmp_path, monkeypatch):
    """A NormattivaScraper with both of its caches empty.

    Two layers would otherwise hand back an earlier run's document and the
    fixture HTML would never reach the extractor: the `normattiva` persistent
    cache is a real directory under `download/cache/`, and `get_document`
    carries an aiocache MEMORY decorator that lives for the whole process.
    """
    cache = PersistentCache("normattiva")
    cache.directory = tmp_path / "normattiva"
    cache.directory.mkdir(parents=True, exist_ok=True)
    monkeypatch.setitem(get_cache_manager().persistent, "normattiva", cache)
    await NormattivaScraper.get_document.cache.clear()
    scraper = NormattivaScraper()
    yield scraper
    await NormattivaScraper.get_document.cache.clear()


class TestTreeCrossCheck:
    @pytest.mark.asyncio
    async def test_akn_answers_when_the_tree_is_unusable(self):
        """A tree failure used to mean "skip the check". With AKN available the
        answer is still authoritative."""
        ctrl = _controller()
        index = AktIndex(title="L. 241/1990", keys=["1", "2", "2-bis", "3"])
        with patch("app.get_tree", new=AsyncMock(return_value=("Empty response from server", 0, {}))), \
             patch("app.fetch_act_index", new=AsyncMock(return_value=index)):
            assert await ctrl._article_exists_in_tree("https://x", "2-bis", None) is True
            assert await ctrl._article_exists_in_tree("https://x", "99999", None) is False

    @pytest.mark.asyncio
    async def test_still_fails_open_when_both_sources_are_down(self):
        ctrl = _controller()
        with patch("app.get_tree", new=AsyncMock(return_value=("boom", 0, {}))), \
             patch("app.fetch_act_index", new=AsyncMock(return_value=None)):
            assert await ctrl._article_exists_in_tree("https://x", "1", None) is None

    @pytest.mark.asyncio
    async def test_the_tree_stays_the_primary_enumerator(self):
        """AKN must not be consulted when the tree answered."""
        ctrl = _controller()
        tree = ([{"numero": "1", "allegato": None}], 1, {})
        akn = AsyncMock(return_value=AktIndex(title="x", keys=["1", "2"]))
        with patch("app.get_tree", new=AsyncMock(return_value=tree)), \
             patch("app.fetch_act_index", new=akn):
            assert await ctrl._article_exists_in_tree("https://x", "2", None) is False
        akn.assert_not_awaited()


class TestTextFallback:
    @pytest.mark.asyncio
    async def test_akn_text_is_used_only_when_html_extraction_fails(self, cold_scraper):
        from visualex_api.tools.norma import Norma, NormaVisitata

        scraper = cold_scraper
        nv = NormaVisitata(
            norma=Norma(tipo_atto="legge", data="1990-08-07", numero_atto="241"),
            numero_articolo="3",
        )
        with patch.object(scraper, "request_document", new=AsyncMock(return_value="<html>broken</html>")), \
             patch("visualex_api.services.normattiva_scraper.fetch_act_article",
                   new=AsyncMock(return_value="### Art. 3. testo dall'AKN")):
            text, _ = await scraper.get_document(nv)
        assert "AKN" in text

    @pytest.mark.asyncio
    async def test_html_success_never_calls_akn(self, cold_scraper):
        """The guard that protects every stored highlight: when HTML works, its
        text is what ships, byte for byte."""
        from pathlib import Path

        from visualex_api.tools.norma import Norma, NormaVisitata

        html = (Path(__file__).parent / "fixtures" / "normattiva" / "akn_comma_div.html").read_text(encoding="utf-8")
        scraper = cold_scraper
        nv = NormaVisitata(
            norma=Norma(tipo_atto="legge", data="1990-08-07", numero_atto="241"),
            numero_articolo="3",
        )
        akn = AsyncMock(return_value="### dall'AKN")
        with patch.object(scraper, "request_document", new=AsyncMock(return_value=html)), \
             patch("visualex_api.services.normattiva_scraper.fetch_act_article", new=akn):
            text, _ = await scraper.get_document(nv)
        akn.assert_not_awaited()
        assert "dall'AKN" not in text


class TestFallbackFiresOnExtractorFailure:
    """The failure the fallback was built for: a selector break inside one of
    the four extractors.

    The extractors used to swallow their own exception and RETURN
    "Error in _estrai_testo_...". That string is truthy, so it flowed past the
    emptiness guard, skipped AKN, and was rendered to the reader as the text of
    the article with HTTP 200 — then cached for 24h.
    """

    @pytest.mark.asyncio
    async def test_extractor_exception_reaches_the_akn_fallback(self):
        from pathlib import Path as _Path

        from visualex_api.tools.norma import Norma, NormaVisitata
        from visualex_api.services.normattiva_scraper import NormattivaScraper

        html = (_Path(__file__).parent / "fixtures" / "normattiva" / "akn_comma_div.html").read_text(encoding="utf-8")
        scraper = NormattivaScraper()
        nv = NormaVisitata(
            norma=Norma(tipo_atto="legge", data="1990-08-07", numero_atto="241"),
            numero_articolo="3",
        )
        akn = AsyncMock(return_value="### Art. 3. testo dall'AKN")
        with patch.object(scraper, "request_document", new=AsyncMock(return_value=html)), \
             patch.object(scraper, "extract_text_recursive", side_effect=RuntimeError("selector drift")), \
             patch("visualex_api.services.normattiva_scraper.fetch_act_article", new=akn):
            text, _ = await scraper.get_document(nv)

        akn.assert_awaited()
        assert "dall'AKN" in text
        assert not text.startswith("Error in _estrai"), (
            "an extractor error string was served to the reader as article text"
        )
