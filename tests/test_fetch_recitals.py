"""`POST /fetch_recitals`: all the considerando of an EU act in one call.

The recitals sit in the same page the tree and the articles are parsed from,
which the scraper caches for 24 h — so one call per act costs nothing extra.
Only regulations and directives are accepted: Normattiva acts have no
recitals, and the treaties' preambles are not numbered.
"""
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from app import NormaController
from visualex_api.services.eurlex_scraper import EurlexScraper
from visualex_api.tools.norma import Norma

FIXTURES = Path(__file__).parent / "fixtures" / "eurlex"
GDPR_HTML = (FIXTURES / "gdpr_oj_trimmed.html").read_text(encoding="utf-8")


@pytest.fixture
def client():
    return NormaController().app.test_client()


class TestScraper:
    async def test_get_recitals_reads_the_cached_page_without_network(self):
        scraper = EurlexScraper()
        scraper.cache = AsyncMock()
        scraper.cache.get = AsyncMock(return_value=GDPR_HTML)
        scraper.request_document = AsyncMock(side_effect=AssertionError("network"))

        norma = Norma(tipo_atto="regolamento ue", data="2016", numero_atto="679")
        recitals, url = await scraper.get_recitals(norma)

        assert [r["number"] for r in recitals] == ["1", "2", "3", "173"]
        assert url == "https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita"
        scraper.request_document.assert_not_called()

    async def test_get_recitals_fetches_and_caches_on_a_cold_cache(self):
        scraper = EurlexScraper()
        scraper.cache = AsyncMock()
        scraper.cache.get = AsyncMock(return_value=None)
        scraper.cache.set = AsyncMock()
        scraper.request_document = AsyncMock(return_value=GDPR_HTML)

        norma = Norma(tipo_atto="regolamento ue", data="2016", numero_atto="679")
        recitals, _ = await scraper.get_recitals(norma)

        assert len(recitals) == 4
        scraper.cache.set.assert_awaited_once()

    async def test_get_document_still_uses_the_same_loader(self):
        """The refactor must not change what get_document returns."""
        scraper = EurlexScraper()
        scraper.cache = AsyncMock()
        scraper.cache.get = AsyncMock(return_value=GDPR_HTML)
        text, url = await scraper.get_document(act_type="regolamento ue", article="1", year="2016", num="679")
        assert text.startswith("Articolo 1")
        assert "Oggetto e finalità" in text
        assert url == "https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita"


class TestEndpoint:
    async def test_returns_the_recitals_of_an_eu_act(self, client):
        fake = AsyncMock(return_value=(
            [{"number": "1", "text": "La protezione…"}, {"number": "2", "text": "I principi…"}],
            "https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita",
        ))
        with patch("app.eurlex_scraper.get_recitals", fake):
            response = await client.post("/fetch_recitals", json={
                "act_type": "regolamento ue", "date": "2016", "act_number": "679",
            })
        assert response.status_code == 200
        body = await response.get_json()
        assert body["count"] == 2
        assert body["recitals"][0] == {"number": "1", "text": "La protezione…"}
        assert body["url"].startswith("https://eur-lex.europa.eu/")
        called_norma = fake.await_args.args[0]
        assert called_norma.numero_atto == "679"

    async def test_the_frontend_spelling_of_the_act_type_is_accepted(self, client):
        fake = AsyncMock(return_value=([], "https://eur-lex.europa.eu/eli/dir/2022/2555/oj/ita"))
        with patch("app.eurlex_scraper.get_recitals", fake):
            response = await client.post("/fetch_recitals", json={
                "act_type": "Direttiva UE", "date": "2022", "act_number": "2555",
            })
        assert response.status_code == 200

    async def test_a_normattiva_act_is_a_400(self, client):
        response = await client.post("/fetch_recitals", json={
            "act_type": "codice civile", "article": "1",
        })
        assert response.status_code == 400
        assert "EUR-Lex" in (await response.get_json())["error"]

    async def test_missing_act_type_is_a_400(self, client):
        response = await client.post("/fetch_recitals", json={"date": "2016"})
        assert response.status_code == 400
        assert "act_type" in (await response.get_json())["error"]

    async def test_missing_act_number_is_a_400_before_any_fetch(self, client):
        # Without the number the URL used to become ".../reg/2016/None/oj/ita"
        # and Playwright navigated there to find out.
        boom = AsyncMock(side_effect=AssertionError("must not fetch"))
        with patch("app.eurlex_scraper.get_recitals", boom):
            response = await client.post("/fetch_recitals", json={
                "act_type": "regolamento ue", "date": "2016",
            })
        assert response.status_code == 400
        assert "act_number" in (await response.get_json())["error"]
        boom.assert_not_called()

    async def test_a_malformed_act_number_is_a_400(self, client):
        response = await client.post("/fetch_recitals", json={
            "act_type": "regolamento ue", "date": "2016", "act_number": "679/x",
        })
        assert response.status_code == 400
        assert "act_number" in (await response.get_json())["error"]

    async def test_a_malformed_date_is_a_400_not_a_500(self, client):
        # "duemilasedici" used to raise ValueError out of Norma.__post_init__.
        response = await client.post("/fetch_recitals", json={
            "act_type": "regolamento ue", "date": "duemilasedici", "act_number": "679",
        })
        assert response.status_code == 400
        assert "date" in (await response.get_json())["error"]

    async def test_missing_date_is_a_400(self, client):
        response = await client.post("/fetch_recitals", json={
            "act_type": "regolamento ue", "act_number": "679",
        })
        assert response.status_code == 400
        assert "date" in (await response.get_json())["error"]

    async def test_a_full_date_is_accepted(self, client):
        fake = AsyncMock(return_value=([], "https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita"))
        with patch("app.eurlex_scraper.get_recitals", fake):
            response = await client.post("/fetch_recitals", json={
                "act_type": "regolamento ue", "date": "2016-04-27", "act_number": "679",
            })
        assert response.status_code == 200

    async def test_a_scraper_failure_is_a_500_with_a_message(self, client):
        boom = AsyncMock(side_effect=RuntimeError("EUR-Lex is down"))
        with patch("app.eurlex_scraper.get_recitals", boom):
            response = await client.post("/fetch_recitals", json={
                "act_type": "regolamento ue", "date": "2016", "act_number": "679",
            })
        assert response.status_code == 500
        assert "EUR-Lex is down" in (await response.get_json())["error"]
