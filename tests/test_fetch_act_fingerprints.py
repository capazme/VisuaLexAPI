"""`POST /fetch_act_fingerprints`: which articles of an act changed, cheaply.

The archive that consumes this compares the hashes with the ones it stored
last time and refetches only the articles whose hash moved — minutes instead
of hours for a full refetch. When the AKN export is unavailable the endpoint
says so with `available: false` and empty maps; the caller falls back to a
full fetch rather than concluding nothing changed.
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app import NormaController
from visualex_api.services.akn_fetch import AktIndex


@pytest.fixture
def client():
    return NormaController().app.test_client()


def _index():
    return AktIndex(
        title="Legge 7 agosto 1990, n. 241",
        keys=["1", "2", "2-bis"],
        fingerprints={
            "1": {"fingerprint": "a" * 64, "date": None},
            "2": {"fingerprint": "b" * 64, "date": None},
            "2-bis": {"fingerprint": "c" * 64, "date": None},
        },
        parts_detail=[],
    )


ACT_URL = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241"


class TestHappyPath:
    async def test_serves_the_index_fingerprints(self, client):
        fake = AsyncMock(return_value=_index())
        with patch("app.fetch_act_index", fake):
            response = await client.post("/fetch_act_fingerprints", json={"urn": ACT_URL})
        assert response.status_code == 200
        body = await response.get_json()
        assert body["available"] is True
        assert body["count"] == 3
        assert body["fingerprints"]["2-bis"]["fingerprint"] == "c" * 64
        assert body["parts"] == []

    async def test_the_article_suffix_is_stripped_from_the_urn(self, client):
        fake = AsyncMock(return_value=_index())
        with patch("app.fetch_act_index", fake):
            await client.post("/fetch_act_fingerprints", json={"urn": ACT_URL + "~art2"})
        norma = fake.await_args.args[0]
        assert norma.url == ACT_URL

    async def test_parts_are_served_with_their_fingerprints(self, client):
        index = _index()
        index.parts_detail = [{
            "name": "Disposizioni sulla legge in generale", "keys": ["1"],
            "rubriche": {}, "abrogati": [],
            "fingerprints": {"1": {"fingerprint": "d" * 64, "date": "1942-04-21"}},
        }]
        with patch("app.fetch_act_index", AsyncMock(return_value=index)):
            response = await client.post("/fetch_act_fingerprints", json={"urn": ACT_URL})
        body = await response.get_json()
        assert body["parts"] == [{
            "name": "Disposizioni sulla legge in generale",
            "fingerprints": {"1": {"fingerprint": "d" * 64, "date": "1942-04-21"}},
        }]


class TestDegradedAndInvalid:
    async def test_no_index_is_a_200_that_says_so(self, client):
        with patch("app.fetch_act_index", AsyncMock(return_value=None)):
            response = await client.post("/fetch_act_fingerprints", json={"urn": ACT_URL})
        assert response.status_code == 200
        body = await response.get_json()
        assert body == {"available": False, "fingerprints": {}, "parts": [], "count": 0}

    async def test_missing_urn_is_a_400(self, client):
        response = await client.post("/fetch_act_fingerprints", json={})
        assert response.status_code == 400

    async def test_eurlex_urls_are_a_400(self, client):
        response = await client.post("/fetch_act_fingerprints", json={
            "urn": "https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita",
        })
        assert response.status_code == 400
        assert "Normattiva" in (await response.get_json())["error"]

    async def test_an_unexpected_failure_is_a_500_not_an_empty_200(self, client):
        """Empty-and-200 means "nothing changed" to the caller; a crash must not
        be mistaken for that."""
        with patch("app.fetch_act_index", AsyncMock(side_effect=RuntimeError("boom"))):
            response = await client.post("/fetch_act_fingerprints", json={"urn": ACT_URL})
        assert response.status_code == 500
