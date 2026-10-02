# services/visualex/tests/test_act_dates.py
"""Year-only URNs completed through Normattiva's resolver."""
from unittest.mock import AsyncMock, patch

import pytest

from app import NormaController
from visualex_api.services import act_dates
from visualex_api.services.http_client import HttpResult
from visualex_api.tools.exceptions import ValidationError

PAGE = """<html><head><title>Normattiva</title></head><body>
<p>Gazzetta Ufficiale 17 maggio 1983</p>
<h2>LEGGE 4 maggio 1983, n. 184</h2>
<p>Disciplina dell'adozione</p></body></html>"""


class FakeCache:
    def __init__(self):
        self.data = {}

    async def get(self, key):
        return self.data.get(key)

    async def set(self, key, value):
        self.data[key] = value


@pytest.fixture
def cache(monkeypatch):
    fake = FakeCache()
    manager = type("M", (), {"get_persistent": lambda self, ns: fake})()
    monkeypatch.setattr(act_dates, "get_cache_manager", lambda: manager)
    return fake


@pytest.fixture
def client():
    return NormaController().app.test_client()


class TestDateFromPage:
    def test_reads_the_title_not_the_gazette_date(self):
        assert act_dates.date_from_page(PAGE, "1983", "184") == "1983-05-04"

    def test_number_must_match(self):
        assert act_dates.date_from_page(PAGE, "1983", "185") is None

    def test_ordinal_day_and_capitals(self):
        page = "DECRETO LEGISLATIVO 1º Febbraio 2006, n. 109"
        assert act_dates.date_from_page(page, "2006", "109") == "2006-02-01"


class TestResolve:
    async def test_resolves_and_caches(self, cache):
        request = AsyncMock(return_value=HttpResult(text=PAGE, status=200, headers={}))
        with patch.object(act_dates.http_client, "request", new=request):
            first = await act_dates.resolve_many(["urn:nir:stato:legge:1983;184"])
            second = await act_dates.resolve_many(["urn:nir:stato:legge:1983;184"])
        assert first == {"urn:nir:stato:legge:1983;184": "urn:nir:stato:legge:1983-05-04;184"}
        assert second == first
        assert request.await_count == 1
        assert request.await_args.args[1] == (
            "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1983;184"
        )

    async def test_unknown_act_is_none_and_not_cached(self, cache):
        request = AsyncMock(return_value=HttpResult(text="<html></html>", status=200, headers={}))
        with patch.object(act_dates.http_client, "request", new=request):
            assert await act_dates.resolve_many(["urn:nir:regione.sicilia:legge:2001;17"]) == {
                "urn:nir:regione.sicilia:legge:2001;17": None
            }
        assert cache.data == {}

    @pytest.mark.parametrize("urns", [
        None, [], "urn:nir:stato:legge:1983;184", [1],
        ["urn:nir:stato:legge:1983-05-04;184"],
        ["urn:nir:stato:legge:1983;184~art1"],
        ["https://evil.example/x"],
        ["urn:nir:stato:legge:1983;184"] * 21,
    ])
    async def test_rejects_bad_input_before_any_request(self, cache, urns):
        request = AsyncMock()
        with patch.object(act_dates.http_client, "request", new=request):
            with pytest.raises(ValidationError):
                await act_dates.resolve_many(urns)
        request.assert_not_awaited()


class TestRoute:
    async def test_returns_the_map(self, client):
        with patch.object(act_dates, "resolve_many", new=AsyncMock(return_value={"u": "v"})):
            response = await client.post("/resolve_act_dates", json={"urns": ["u"]})
        assert response.status_code == 200
        assert await response.get_json() == {"resolved": {"u": "v"}}

    async def test_bad_input_is_400(self, client):
        response = await client.post("/resolve_act_dates", json={"urns": "x"})
        assert response.status_code == 400
