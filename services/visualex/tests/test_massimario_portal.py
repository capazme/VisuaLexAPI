# services/visualex/tests/test_massimario_portal.py
"""The Massimario portal fetch: validated URLs, pacing, retries, the internal route."""
import importlib
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app import NormaController
from visualex_api.services import massimario_portal as mp
from visualex_api.services.http_client import HttpResult
from visualex_api.tools.exceptions import (
    DocumentNotFoundError,
    NetworkError,
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
            with pytest.raises(NetworkError, match="risposta non valida"):
                await mp.fetch_element("index", "1")
        assert request.await_count == mp.INVALID_RETRIES + 1

    async def test_firewall_rejection_stops_at_once(self):
        rejected = HttpResult(text="<html><head><title>Request Rejected</title>", status=200, headers={})
        request = AsyncMock(return_value=rejected)
        with patch.object(mp.http_client, "request", new=request):
            with pytest.raises(RateLimitExceededError):
                await mp.fetch_element("index", "1")
        assert request.await_count == 1

    @pytest.mark.parametrize("status", [403, 429])
    async def test_a_firewall_status_from_the_client_stops_at_once(self, status):
        request = AsyncMock(side_effect=NetworkError("Exceeded retry budget", status_code=status))
        with patch.object(mp.http_client, "request", new=request):
            with pytest.raises(RateLimitExceededError, match="firewall"):
                await mp.fetch_element("index", "1")
        assert request.await_count == 1

    async def test_a_server_error_is_retried_like_an_invalid_page(self):
        request = AsyncMock(side_effect=[NetworkError("boom", status_code=503), ok({"id": 1})])
        with patch.object(mp.http_client, "request", new=request):
            assert await mp.fetch_element("index", "1") == {"id": 1}
        assert request.await_count == 2

    async def test_a_timeout_is_retried_too(self):
        request = AsyncMock(side_effect=[NetworkError("timeout"), ok({"id": 1})])
        with patch.object(mp.http_client, "request", new=request):
            assert await mp.fetch_element("index", "1") == {"id": 1}
        assert request.await_count == 2

    async def test_a_network_error_is_raised_again_after_the_last_attempt(self):
        error = NetworkError("boom", status_code=503)
        request = AsyncMock(side_effect=error)
        with patch.object(mp.http_client, "request", new=request):
            with pytest.raises(NetworkError) as raised:
                await mp.fetch_element("index", "1")
        assert raised.value is error
        assert request.await_count == mp.INVALID_RETRIES + 1

    async def test_network_errors_pause_like_invalid_pages(self, monkeypatch):
        monkeypatch.setattr(mp, "INVALID_PAUSE", 2.0)
        slept = []

        async def fake_sleep(seconds):
            slept.append(seconds)

        monkeypatch.setattr(mp.asyncio, "sleep", fake_sleep)
        request = AsyncMock(side_effect=NetworkError("boom", status_code=503))
        with patch.object(mp.http_client, "request", new=request):
            with pytest.raises(NetworkError):
                await mp.fetch_element("index", "1")
        assert slept == [2.0, 4.0, 6.0]

    async def test_a_missing_page_after_a_retry_is_still_not_found(self):
        request = AsyncMock(side_effect=[NetworkError("boom", status_code=503), DocumentNotFoundError("404")])
        with patch.object(mp.http_client, "request", new=request):
            with pytest.raises(ResourceNotFoundError):
                await mp.fetch_element("index", "999999")
        assert request.await_count == 2

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


class TestPacedGet:
    async def test_the_shared_client_is_told_not_to_retry(self):
        request = AsyncMock(return_value=ok({}))
        with patch.object(mp.http_client, "request", new=request):
            await mp._paced_get("https://www.portaledelmassimario.ipzs.it/x")
        assert request.await_args.kwargs["max_retries"] == 0

    async def test_every_attempt_goes_through_the_pacing(self, monkeypatch):
        calls = []

        async def fake_paced_get(url):
            calls.append(url)
            raise NetworkError("boom", status_code=503)

        monkeypatch.setattr(mp, "_paced_get", fake_paced_get)
        with pytest.raises(NetworkError):
            await mp.fetch_element("index", "1")
        assert len(calls) == mp.INVALID_RETRIES + 1

    @pytest.mark.parametrize("raw,expected", [("0", 1.5), ("0.1", 1.5), ("1.5", 1.5), ("4", 4.0)])
    def test_the_environment_can_only_slow_the_portal_down(self, monkeypatch, raw, expected):
        monkeypatch.setenv("MASSIMARIO_MIN_INTERVAL", raw)
        try:
            importlib.reload(mp)
            assert mp.MIN_INTERVAL == expected
        finally:
            monkeypatch.delenv("MASSIMARIO_MIN_INTERVAL")
            importlib.reload(mp)

    def test_without_the_environment_the_floor_is_the_default(self, monkeypatch):
        monkeypatch.delenv("MASSIMARIO_MIN_INTERVAL", raising=False)
        importlib.reload(mp)
        assert mp.MIN_INTERVAL == 1.5


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

    async def test_a_network_error_is_500(self, client):
        with patch.object(mp, "fetch_element", new=AsyncMock(side_effect=NetworkError("boom", status_code=503))):
            response = await client.get("/fetch_massimario", query_string={"kind": "index", "id": "1"})
        assert response.status_code == 500
