"""An undated request is served the text in force today, never a later one (G-355).

Normattiva answers a request with no date with its latest version, also one that
is not in force yet. Read on 21 October 2026, art. 3 d.P.R. 131/1986 came back
repealed from 1 January 2027 (`fixtures/normattiva/dpr131_1986_art3_*`). The
handlers read the page in force today instead and describe the later one in
`upcoming`; a request with a date, or for the original, is served as asked.
"""
from datetime import date
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from visualex_api.services.normattiva_scraper import NormattivaScraper
from visualex_api.services.normattiva_validity import extract_validity, starts_after_today, upcoming_change
from tests.test_validity_wire import (  # noqa: F401 - fixtures
    ARTICLE_ENDPOINTS, FakeCache, ask, brocardi, controller, requested, _no_history_writes,
)

FIXTURES = Path(__file__).parent / "fixtures" / "normattiva"
LATER = (FIXTURES / "dpr131_1986_art3_undated_abrogato_2027_trimmed.html").read_text(encoding="utf-8")
TODAY_PAGE = (FIXTURES / "dpr131_1986_art3_at_2026-10-21_in_force_trimmed.html").read_text(encoding="utf-8")
BASE = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.del.presidente.della.repubblica:1986-04-26;131~art3"
TODAY = date(2026, 10, 21)


@pytest.fixture(autouse=True)
def fixed_today():
    with patch("visualex_api.services.normattiva_validity._today_in_rome", return_value=TODAY):
        yield


def scraper_serving(today_fails=False):
    """The undated URN gives the later version; `!vig=2026-10-21` the text in force."""
    scraper = NormattivaScraper.__new__(NormattivaScraper)

    async def get_document(nv):
        if nv.data_versione:
            if today_fails:
                raise RuntimeError("Normattiva down")
            assert nv.data_versione == "2026-10-21" and nv.versione == "vigente"
            return "Art. 3\nContratti verbali\n1. Sono soggetti a registrazione …", f"{BASE}!vig=2026-10-21"
        return "Art. 3\n((ARTICOLO ABROGATO …))", BASE

    scraper.get_document = AsyncMock(side_effect=get_document)
    scraper.cache = FakeCache({BASE: LATER, f"{BASE}!vig=2026-10-21": TODAY_PAGE})
    return scraper


class TestUndatedRequest:
    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    @pytest.mark.parametrize("version", [None, "vigente"])
    async def test_the_text_in_force_today_is_served(self, controller, brocardi, endpoint, version):
        scraper = scraper_serving()
        [result] = await ask(controller, endpoint, requested(version=version), scraper=scraper)
        assert result["article_text"].startswith("Art. 3\nContratti verbali")
        assert result["url"] == f"{BASE}!vig=2026-10-21"
        assert result["validity"] == {
            "state": "current", "valid_from": "1986-07-01", "valid_to": "2026-12-31",
            "version_number": 1, "act_updated": "2026-08-06", "request_in_window": None,
        }
        assert result["upcoming"] == {"change": "abrogated", "valid_from": "2027-01-01", "version_number": 2}
        # The norm is still the request: no date, so its notes and highlights keep their key.
        assert result["norma_data"]["data_versione"] is None

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_a_page_already_in_force_is_read_once(self, controller, brocardi, endpoint):
        scraper = scraper_serving()
        scraper.cache = FakeCache({BASE: TODAY_PAGE})
        [result] = await ask(controller, endpoint, requested(), scraper=scraper)
        assert scraper.get_document.await_count == 1
        assert "upcoming" not in result

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_if_today_cannot_be_read_the_later_page_stands_with_its_window(self, controller, brocardi, endpoint):
        [result] = await ask(controller, endpoint, requested(), scraper=scraper_serving(today_fails=True))
        assert result["url"] == BASE
        assert result["validity"]["valid_from"] == "2027-01-01"
        assert "upcoming" not in result


class TestRequestsServedAsAsked:
    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    @pytest.mark.parametrize("version,day", [("vigente", "2027-03-01"), (None, "2026-10-21"), ("originale", None)])
    async def test_a_date_or_the_original_is_never_replaced(self, controller, brocardi, endpoint, version, day):
        scraper = NormattivaScraper.__new__(NormattivaScraper)
        scraper.get_document = AsyncMock(return_value=("testo", BASE))
        scraper.cache = FakeCache({BASE: LATER})
        [result] = await ask(controller, endpoint, requested(version=version, version_date=day), scraper=scraper)
        assert scraper.get_document.await_count == 1
        assert "upcoming" not in result


class TestTheWindow:
    def test_a_window_starting_after_today(self):
        later = extract_validity(LATER, article="3", today=TODAY)
        assert starts_after_today(later, TODAY) is True
        assert upcoming_change(later) == {"change": "abrogated", "valid_from": "2027-01-01", "version_number": 2}

    def test_a_window_already_open(self):
        assert starts_after_today(extract_validity(TODAY_PAGE, article="3", today=TODAY), TODAY) is False

    @pytest.mark.parametrize("valid_from,expected", [("2026-10-21", False), ("2026-10-22", True), (None, False)])
    def test_today_itself_is_in_force(self, valid_from, expected):
        assert starts_after_today({"valid_from": valid_from}, TODAY) is expected

    def test_a_later_text_that_is_not_a_repeal_is_an_amendment(self):
        assert upcoming_change({"state": "current", "valid_from": "2027-01-01", "version_number": 3}) == \
            {"change": "amended", "valid_from": "2027-01-01", "version_number": 3}


class StoringCache(FakeCache):
    async def set(self, key, value):
        self.entries[key] = value


class TestAfterARestart:
    """The text comes from the scraper's memory, the page from the persistent cache:
    after a restart the page can expire first. Without it the later version went out
    unrecognised, and a watched norm flipped between two texts."""

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_an_expired_page_is_read_again(self, controller, brocardi, endpoint):
        scraper = scraper_serving()
        scraper.cache = StoringCache({f"{BASE}!vig=2026-10-21": TODAY_PAGE})   # the undated page expired
        scraper.request_document = AsyncMock(return_value=LATER)
        [result] = await ask(controller, endpoint, requested(), scraper=scraper)
        scraper.request_document.assert_awaited_once()
        assert result["article_text"].startswith("Art. 3\nContratti verbali")
        assert result["upcoming"]["change"] == "abrogated"

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_a_page_that_is_there_but_unreadable_costs_no_request(self, controller, brocardi, endpoint):
        scraper = scraper_serving()
        scraper.cache = StoringCache({BASE: "<html>no window</html>"})
        scraper.request_document = AsyncMock(return_value=LATER)
        [result] = await ask(controller, endpoint, requested(), scraper=scraper)
        scraper.request_document.assert_not_awaited()
        assert "validity" not in result and "upcoming" not in result

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_a_dated_request_never_reads_again(self, controller, brocardi, endpoint):
        scraper = NormattivaScraper.__new__(NormattivaScraper)
        scraper.get_document = AsyncMock(return_value=("testo", BASE))
        scraper.cache = StoringCache({})
        scraper.request_document = AsyncMock(return_value=LATER)
        await ask(controller, endpoint, requested(version="vigente", version_date="2020-01-01"), scraper=scraper)
        scraper.request_document.assert_not_awaited()


class TestNothingInForceToday:
    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_an_article_inserted_from_a_later_day_stands_as_it_was(self, controller, brocardi, endpoint):
        from tests.validity_pages import synthetic

        not_yet = synthetic(al="31-12-2026", label="Art. 3",
                            content="<span>ARTICOLO NON ANCORA ESISTENTE O VIGENTE</span>")
        scraper = scraper_serving()
        scraper.cache = FakeCache({BASE: LATER, f"{BASE}!vig=2026-10-21": not_yet})
        [result] = await ask(controller, endpoint, requested(), scraper=scraper)
        assert result["url"] == BASE
        assert result["validity"]["valid_from"] == "2027-01-01"
        assert "upcoming" not in result
