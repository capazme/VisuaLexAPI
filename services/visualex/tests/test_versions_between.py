"""Versions not in force yet that come before the latest one (review of #279).

Normattiva's undated page is the article's latest version, and a date after today answers
today's text: with two later versions, only the last can be read. The count tells it
(`versions_between`, from the version numbers), and a request for a day covered by a version
in between says it cannot be read instead of naming the last one's first day.
"""
import pytest

from visualex_api.services.normattiva_validity import upcoming_change, versions_between
from tests.test_text_in_force import BASE, TODAY_PAGE, fixed_today, scraper_serving  # noqa: F401 - fixture
from tests.test_validity_wire import (  # noqa: F401 - fixtures
    ARTICLE_ENDPOINTS, FakeCache, ask, brocardi, controller, requested, _no_history_writes,
)
from tests.validity_pages import synthetic

# Today's page is version 1; this one is version 3, from 1 January 2028: version 2 comes between.
THIRD = synthetic(dal="01-01-2028", label="Art. 3", version=3,
                  content='<span class="art-just-text-akn">Il testo dal 2028.</span>')


def _scraper():
    scraper = scraper_serving()
    scraper.cache = FakeCache({BASE: THIRD, f"{BASE}!vig=2026-10-21": TODAY_PAGE})
    return scraper


@pytest.mark.parametrize("later,today,between", [
    ({"version_number": 3}, {"version_number": 1}, 1),
    ({"version_number": 2}, {"version_number": 1}, 0),
    ({"version_number": 5}, {"version_number": 2}, 2),
    ({"version_number": 3}, None, 0),
    ({"version_number": None}, {"version_number": 1}, 0),
])
def test_versions_between(later, today, between):
    assert versions_between(later, today) == between


def test_the_count_rides_on_upcoming_only_when_there_is_one():
    later = {"state": "current", "valid_from": "2028-01-01", "version_number": 3}
    assert upcoming_change(later, today={"version_number": 1})["versions_between"] == 1
    assert "versions_between" not in upcoming_change(later, today={"version_number": 2})
    assert "versions_between" not in upcoming_change(later, inserted=True, today={"version_number": 1})


class TestTwoLaterVersions:
    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_today_is_served_and_the_count_said(self, controller, brocardi, endpoint):
        [result] = await ask(controller, endpoint, requested(), scraper=_scraper())
        assert result["article_text"].startswith("Art. 3\nContratti verbali")
        assert result["upcoming"] == {"change": "amended", "valid_from": "2028-01-01", "version_number": 3,
                                      "versions_between": 1}

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_the_latest_asked_for_carries_the_count(self, controller, brocardi, endpoint):
        [result] = await ask(controller, endpoint, requested(), scraper=_scraper(), body={"upcoming": True})
        assert result["not_in_force"] is True
        assert result["upcoming"]["versions_between"] == 1

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_a_day_of_the_version_in_between_cannot_be_read(self, controller, brocardi, endpoint):
        [result] = await ask(controller, endpoint, requested(), scraper=_scraper(),
                             body={"upcoming": True, "version_date": "2027-06-30"})
        assert "Non so dire quale versione" in result["error"] and "in vigore il 2027-06-30" in result["error"]
        assert "ce n'è un'altra, che Normattiva" in result["error"]
        assert "article_text" not in result
