"""`text_source`: where an article's text comes from, said on the wire (scan A.7).

The display text is the HTML extractor's (`article_text` is the offset space every
highlight and note is anchored to, root CLAUDE.md rule 23). When that extraction fails
outright, the AKN export stands in so the reader is not left without a text, but it is
a different string (accents transliterated, a markdown heading): anchors made on it do
not land on the HTML text when it comes back. So:

- the answer says which one it is: `text_source` is "html" or "akn", on every article;
- an AKN text is never kept in the scraper's 24-hour memory as if it were the HTML
  text: the next request tries the HTML page again;
- the HTML text stays cached, and comes through byte for byte.
"""
from unittest.mock import AsyncMock, patch

import pytest

from visualex_api.services.normattiva_scraper import (
    AknArticleText,
    NormattivaScraper,
    text_source_of,
)
from visualex_api.tools.norma import Norma, NormaVisitata
from tests.test_akn_integration import cold_scraper  # noqa: F401 - fixture
from tests.test_validity_wire import (  # noqa: F401 - fixtures
    ARTICLE_ENDPOINTS,
    TEXT,
    URN,
    FakeCache,
    ask,
    brocardi,
    controller,
    _no_history_writes,
    requested,
)

AKN = "### Art. 3.\n\n1. Ogni provvedimento e' motivato."
HTML = "akn_comma_div.html"


def _nv():
    return NormaVisitata(norma=Norma(tipo_atto="legge", data="1990-08-07", numero_atto="241"),
                         numero_articolo="3")


def _serving(text):
    scraper = NormattivaScraper.__new__(NormattivaScraper)
    scraper.get_document = AsyncMock(return_value=(text, URN))
    scraper.cache = FakeCache({})
    return scraper


class TestTheScraperMarksItsText:
    def test_a_plain_string_is_html_and_the_akn_wrapper_is_akn(self):
        assert text_source_of(TEXT) == "html"
        assert text_source_of(AknArticleText(AKN)) == "akn"
        assert AknArticleText(AKN) == AKN  # the characters are the export's, untouched

    async def test_the_fallback_is_marked_akn(self, cold_scraper):  # noqa: F811
        with patch.object(cold_scraper, "request_document", new=AsyncMock(return_value="<html>broken</html>")), \
             patch("visualex_api.services.normattiva_scraper.fetch_act_article", new=AsyncMock(return_value=AKN)):
            text, _ = await cold_scraper.get_document(_nv())
        assert text == AKN
        assert text_source_of(text) == "akn"

    async def test_the_html_text_is_marked_html(self, cold_scraper):  # noqa: F811
        from pathlib import Path

        page = (Path(__file__).parent / "fixtures" / "normattiva" / HTML).read_text(encoding="utf-8")
        with patch.object(cold_scraper, "request_document", new=AsyncMock(return_value=page)):
            text, _ = await cold_scraper.get_document(_nv())
        assert text_source_of(text) == "html"


class TestTheFallbackIsNeverCached:
    async def test_the_next_request_reads_again_instead_of_the_cached_akn_text(self, cold_scraper):  # noqa: F811
        akn = AsyncMock(side_effect=[AKN, AKN + " (dopo)"])
        with patch.object(cold_scraper, "request_document", new=AsyncMock(return_value="<html>broken</html>")), \
             patch("visualex_api.services.normattiva_scraper.fetch_act_article", new=akn):
            first, _ = await cold_scraper.get_document(_nv())
            second, _ = await cold_scraper.get_document(_nv())
        assert first == AKN
        assert second == AKN + " (dopo)"
        assert akn.await_count == 2

    async def test_the_html_text_is_still_cached(self, cold_scraper):  # noqa: F811
        from pathlib import Path

        page = (Path(__file__).parent / "fixtures" / "normattiva" / HTML).read_text(encoding="utf-8")
        request = AsyncMock(return_value=page)
        extract = AsyncMock(wraps=cold_scraper.estrai_da_html)
        with patch.object(cold_scraper, "request_document", new=request), \
             patch.object(cold_scraper, "estrai_da_html", new=extract):
            first, _ = await cold_scraper.get_document(_nv())
            second, _ = await cold_scraper.get_document(_nv())
        assert first == second
        assert extract.await_count == 1  # the second came from the 24-hour memory


class TestTheWireSaysIt:
    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_an_html_text_says_html(self, controller, brocardi, endpoint):  # noqa: F811
        [result] = await ask(controller, endpoint, requested(), scraper=_serving(TEXT))
        assert result["article_text"] == TEXT
        assert result["text_source"] == "html"

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_an_akn_text_says_akn(self, controller, brocardi, endpoint):  # noqa: F811
        [result] = await ask(controller, endpoint, requested(), scraper=_serving(AknArticleText(AKN)))
        assert result["article_text"] == AKN
        assert result["text_source"] == "akn"
        # The export holds its notes in the text: none are read from the page.
        assert result["note_nel_testo"] is True

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_the_akn_mark_does_not_hang_on_the_heading(self, controller, brocardi, endpoint):  # noqa: F811
        """An HTML text that happened to open with «###» is still the HTML text."""
        [result] = await ask(controller, endpoint, requested(), scraper=_serving("### " + TEXT))
        assert result["text_source"] == "html"
