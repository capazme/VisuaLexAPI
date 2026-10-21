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
    async def test_an_article_inserted_from_a_later_day_is_marked_inserted(self, controller, brocardi, endpoint):
        """Nothing is in force today: the later text is the only one, served as before
        but marked not in force, with «inserted» and its day (G-358). The norm keeps the
        request's identity: that text is the one that will come into force."""
        from tests.validity_pages import synthetic

        not_yet = synthetic(al="31-12-2026", label="Art. 3",
                            content="<span>ARTICOLO NON ANCORA ESISTENTE O VIGENTE</span>")
        scraper = scraper_serving()
        scraper.cache = FakeCache({BASE: LATER, f"{BASE}!vig=2026-10-21": not_yet})
        [result] = await ask(controller, endpoint, requested(), scraper=scraper)
        assert result["url"] == BASE
        assert result["validity"]["valid_from"] == "2027-01-01"
        assert result["upcoming"] == {"change": "inserted", "valid_from": "2027-01-01", "version_number": 2}
        assert result["not_in_force"] is True
        assert result["norma_data"]["data_versione"] is None


class TestTheLaterTextAskedFor:
    """G-357: the later text, on explicit request, always marked not in force and dated to
    the day it comes into force, so the web reads it as a text at a day (read only)."""

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    @pytest.mark.parametrize("day", [None, "2027-01-01", "2027-06-30"])
    async def test_it_is_served_marked(self, controller, brocardi, endpoint, day):
        body = {"upcoming": True, **({"version_date": day} if day else {})}
        [result] = await ask(controller, endpoint, requested(), scraper=scraper_serving(), body=body)
        assert result["article_text"].startswith("Art. 3\n((ARTICOLO ABROGATO")
        assert result["url"] == BASE
        assert result["not_in_force"] is True
        assert result["upcoming"] == {"change": "abrogated", "valid_from": "2027-01-01", "version_number": 2}
        assert result["norma_data"]["versione"] == "vigente"
        assert result["norma_data"]["data_versione"] == "2027-01-01"
        assert result["validity"]["valid_from"] == "2027-01-01"
        assert result["validity"]["request_in_window"] is True

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_an_article_with_no_later_text_says_so(self, controller, brocardi, endpoint):
        scraper = scraper_serving()
        scraper.cache = FakeCache({BASE: TODAY_PAGE})
        [result] = await ask(controller, endpoint, requested(), scraper=scraper, body={"upcoming": True})
        assert "Nessuna versione non ancora in vigore" in result["error"]
        assert "article_text" not in result

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_a_day_before_the_later_text_says_when_it_starts(self, controller, brocardi, endpoint):
        [result] = await ask(controller, endpoint, requested(), scraper=scraper_serving(),
                             body={"upcoming": True, "version_date": "2026-12-01"})
        assert "entra in vigore il 2027-01-01" in result["error"]


class TestTheRequestGuard:
    @pytest.mark.parametrize("version,day,ok", [
        (None, None, True), ("vigente", "2027-01-01", True),
        ("originale", None, False), (None, "2026-10-21", False), (None, "2020-01-01", False),
        (None, "ieri", False),
    ])
    def test_upcoming_with_what(self, version, day, ok):
        from visualex_api.services.normattiva_validity import read_upcoming_request
        from visualex_api.tools.exceptions import ValidationError
        if ok:
            read_upcoming_request(version, day, today=TODAY)
        else:
            with pytest.raises(ValidationError):
                read_upcoming_request(version, day, today=TODAY)

    async def test_a_bare_future_date_is_still_refused(self, controller):
        response = await controller.app.test_client().post(
            "/fetch_article_text", json={"act_type": "legge", "article": "3", "version_date": "2027-01-01"})
        assert response.status_code == 400


class TestTheRequestIsBuiltUndated:
    """`upcoming: true` reads the undated page whatever day it names: the norm handed to
    the handlers carries no date, or every explicit request would answer «none»."""

    async def test_a_later_day_is_accepted_and_not_kept_on_the_norm(self):
        from app import NormaController

        ctrl = NormaController.__new__(NormaController)
        tree = ([{"numero": "3", "allegato": None}], 1, {})
        with patch("app.get_tree", new=AsyncMock(return_value=tree)):
            [nv] = await ctrl.create_norma_visitata_from_data({
                "act_type": "decreto del presidente della repubblica", "date": "1986-04-26",
                "act_number": "131", "article": "3", "upcoming": True, "version_date": "2027-06-30"})
        assert nv.data_versione is None

    @pytest.mark.parametrize("body", [
        {"upcoming": True, "version": "originale"},
        {"upcoming": True, "version_date": "2026-10-21"},
    ])
    async def test_what_cannot_go_with_it_is_a_400(self, controller, body):
        response = await controller.app.test_client().post(
            "/fetch_article_text", json={"act_type": "legge", "article": "3", **body})
        assert response.status_code == 400


class TestTheLaterTextOfAnInsertedArticle:
    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_it_is_inserted(self, controller, brocardi, endpoint):
        from tests.validity_pages import synthetic

        not_yet = synthetic(al="31-12-2026", label="Art. 3",
                            content="<span>ARTICOLO NON ANCORA ESISTENTE O VIGENTE</span>")
        scraper = scraper_serving()
        scraper.cache = FakeCache({BASE: LATER, f"{BASE}!vig=2026-10-21": not_yet})
        [result] = await ask(controller, endpoint, requested(), scraper=scraper, body={"upcoming": True})
        assert result["upcoming"]["change"] == "inserted"
        assert result["not_in_force"] is True

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_today_unreadable_leaves_the_change_unknown(self, controller, brocardi, endpoint):
        from tests.validity_pages import synthetic

        amended = synthetic(dal="1-1-2027", label="Art. 3", content="<span>Testo modificato.</span>", version=2)
        scraper = scraper_serving(today_fails=True)
        scraper.cache = FakeCache({BASE: amended})
        [result] = await ask(controller, endpoint, requested(), scraper=scraper, body={"upcoming": True})
        assert result["upcoming"]["change"] is None
        assert result["not_in_force"] is True

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_an_unreadable_page_claims_nothing(self, controller, brocardi, endpoint):
        scraper = scraper_serving()
        scraper.cache = FakeCache({BASE: "<html>no window</html>"})
        [result] = await ask(controller, endpoint, requested(), scraper=scraper, body={"upcoming": True})
        assert "Non riesco a leggere la vigenza" in result["error"]
