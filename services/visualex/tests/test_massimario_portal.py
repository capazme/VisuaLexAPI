# services/visualex/tests/test_massimario_portal.py
"""The Massimario portal fetch: validated URLs, pacing, retries, the internal route."""
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app import NormaController
from visualex_api.services import massimario_portal as mp
from visualex_api.services.http_client import HttpResult
from visualex_api.tools.exceptions import (
    DocumentNotFoundError,
    RateLimitExceededError,
    ResourceNotFoundError,
    ValidationError,
)


def ok(data):
    return HttpResult(text=json.dumps({"valid": True, "objectData": data}), status=200, headers={})


@pytest.fixture(autouse=True)
def no_waiting(monkeypatch):
    monkeypatch.setattr(mp, "MIN_INTERVAL", 0.0)
    monkeypatch.setattr(mp, "INVALID_PAUSE", 0.0)


@pytest.fixture
def client():
    return NormaController().app.test_client()


class TestBuildUrl:
    def test_index_has_no_links_flag(self):
        assert mp.build_url("index", "96") == (
            "https://www.portaledelmassimario.ipzs.it/publicServices/96/getIndex.do"
        )

    def test_chapter_and_section_ask_for_linked_norms(self):
        assert mp.build_url("capitolo", "20828").endswith("/20828/getCapitolo.do?activateLinks=true")
        assert mp.build_url("sezione", "20830").endswith("/20830/getSezione.do?activateLinks=true")

    @pytest.mark.parametrize("kind,element_id", [
        ("parte", "1"), ("", "1"), ("index", ""), ("index", "1/../2"),
        ("index", "١٢"), ("index", "1" * 10), ("capitolo", "-1"),
    ])
    def test_rejects_bad_input(self, kind, element_id):
        with pytest.raises(ValidationError):
            mp.build_url(kind, element_id)


class TestFetchElement:
    async def test_returns_object_data_and_sends_an_honest_user_agent(self):
        request = AsyncMock(return_value=ok({"id": 20828}))
        with patch.object(mp.http_client, "request", new=request):
            data = await mp.fetch_element("capitolo", "20828")
        assert data == {"id": 20828}
        assert request.await_args.kwargs["headers"]["User-Agent"] == mp.USER_AGENT
        assert "VisuaLex" in mp.USER_AGENT

    async def test_retries_an_invalid_page_then_succeeds(self):
        bad = HttpResult(text="<html>errore</html>", status=200, headers={})
        request = AsyncMock(side_effect=[bad, ok({"id": 1})])
        with patch.object(mp.http_client, "request", new=request):
            assert await mp.fetch_element("index", "1") == {"id": 1}
        assert request.await_count == 2

    async def test_gives_up_after_the_retries(self):
        bad = HttpResult(text=json.dumps({"valid": False}), status=200, headers={})
        request = AsyncMock(return_value=bad)
        with patch.object(mp.http_client, "request", new=request):
            with pytest.raises(Exception, match="risposta non valida"):
                await mp.fetch_element("index", "1")
        assert request.await_count == mp.INVALID_RETRIES + 1

    async def test_firewall_rejection_stops_at_once(self):
        rejected = HttpResult(text="<html><head><title>Request Rejected</title>", status=200, headers={})
        request = AsyncMock(return_value=rejected)
        with patch.object(mp.http_client, "request", new=request):
            with pytest.raises(RateLimitExceededError):
                await mp.fetch_element("index", "1")
        assert request.await_count == 1

    async def test_unknown_element_is_not_found(self):
        request = AsyncMock(side_effect=DocumentNotFoundError("404"))
        with patch.object(mp.http_client, "request", new=request):
            with pytest.raises(ResourceNotFoundError):
                await mp.fetch_element("index", "999999")

    async def test_requests_are_paced(self, monkeypatch):
        monkeypatch.setattr(mp, "MIN_INTERVAL", 5.0)
        monkeypatch.setattr(mp, "_last_request_at", 0.0)
        clock = iter([100.0, 100.0, 101.0, 101.0])
        monkeypatch.setattr(mp, "time", SimpleNamespace(monotonic=lambda: next(clock)))
        slept = []

        async def fake_sleep(seconds):
            slept.append(seconds)

        monkeypatch.setattr(mp.asyncio, "sleep", fake_sleep)
        with patch.object(mp.http_client, "request", new=AsyncMock(return_value=ok({}))):
            await mp.fetch_element("index", "1")
            await mp.fetch_element("index", "2")
        assert slept == [pytest.approx(4.0)]


class TestRoute:
    async def test_returns_the_element(self, client):
        with patch.object(mp, "fetch_element", new=AsyncMock(return_value={"id": 20828})):
            response = await client.get("/fetch_massimario", query_string={"kind": "capitolo", "id": "20828"})
        assert response.status_code == 200
        assert await response.get_json() == {"kind": "capitolo", "id": "20828", "data": {"id": 20828}}

    async def test_bad_kind_is_400(self, client):
        response = await client.get("/fetch_massimario", query_string={"kind": "parte", "id": "1"})
        assert response.status_code == 400

    async def test_not_found_is_404(self, client):
        with patch.object(mp, "fetch_element", new=AsyncMock(side_effect=ResourceNotFoundError("x"))):
            response = await client.get("/fetch_massimario", query_string={"kind": "index", "id": "1"})
        assert response.status_code == 404

    async def test_firewall_is_429(self, client):
        with patch.object(mp, "fetch_element", new=AsyncMock(side_effect=RateLimitExceededError("x"))):
            response = await client.get("/fetch_massimario", query_string={"kind": "index", "id": "1"})
        assert response.status_code == 429
