# services/visualex/tests/test_http_client_retries.py
"""ThrottledHttpClient's retry budget: the default is unchanged, a caller can lower it.

A real aiohttp server on 127.0.0.1 answers; the egress check is patched open for
that address and the waits are patched to zero. Nothing leaves the machine.
"""
import asyncio

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from visualex_api.services import http_client as hc
from visualex_api.tools.exceptions import NetworkError


@pytest.fixture(autouse=True)
def fast_and_local(monkeypatch):
    monkeypatch.setattr(hc, "is_allowed", lambda url: True)
    monkeypatch.setattr(hc, "HTTP_MIN_INTERVAL", 0.0)
    monkeypatch.setattr(hc, "HTTP_INITIAL_BACKOFF", 0.0)
    monkeypatch.setattr(hc, "HTTP_JITTER", 0.0)


@pytest.fixture
async def client():
    instance = hc.ThrottledHttpClient()
    yield instance
    await instance.close()


class Portal:
    """A server that answers the scripted statuses in order, then the last one for ever."""

    def __init__(self, statuses, delay=0.0):
        self.statuses = list(statuses)
        self.delay = delay
        self.hits = 0
        self.server = None

    async def handler(self, request):
        status = self.statuses[min(self.hits, len(self.statuses) - 1)]
        self.hits += 1
        if self.delay:
            await asyncio.sleep(self.delay)
        return web.Response(status=status, text="ok" if status == 200 else "no")

    async def __aenter__(self):
        app = web.Application()
        app.router.add_get("/", self.handler)
        self.server = TestServer(app)
        await self.server.start_server()
        return self

    async def __aexit__(self, *exc):
        await self.server.close()

    @property
    def url(self):
        return str(self.server.make_url("/"))


class TestMaxRetries:
    @pytest.mark.parametrize("status", [403, 429, 503])
    async def test_zero_retries_makes_one_attempt_and_keeps_the_status(self, client, status):
        async with Portal([status]) as portal:
            with pytest.raises(NetworkError) as raised:
                await client.request("GET", portal.url, max_retries=0)
        assert portal.hits == 1
        assert raised.value.status_code == status

    async def test_a_timeout_with_no_retries_has_no_status(self, client, monkeypatch):
        monkeypatch.setattr(hc, "HTTP_TIMEOUT", 0.05)
        async with Portal([200], delay=0.3) as portal:
            with pytest.raises(NetworkError) as raised:
                await client.request("GET", portal.url, max_retries=0)
        assert portal.hits == 1
        assert raised.value.status_code is None

    async def test_one_retry_makes_two_attempts(self, client):
        async with Portal([503]) as portal:
            with pytest.raises(NetworkError):
                await client.request("GET", portal.url, max_retries=1)
        assert portal.hits == 2


class TestDefaultBudgetUnchanged:
    async def test_a_firewall_status_is_retried_up_to_the_configured_budget(self, client):
        async with Portal([403]) as portal:
            with pytest.raises(NetworkError) as raised:
                await client.request("GET", portal.url)
        assert portal.hits == hc.HTTP_MAX_RETRIES + 1
        assert raised.value.status_code == 403

    async def test_a_transient_status_is_retried_then_the_page_is_returned(self, client):
        async with Portal([503, 200]) as portal:
            result = await client.request("GET", portal.url)
        assert portal.hits == 2
        assert (result.status, result.text) == (200, "ok")

    async def test_none_means_the_configured_budget(self, client):
        async with Portal([503]) as portal:
            with pytest.raises(NetworkError):
                await client.request("GET", portal.url, max_retries=None)
        assert portal.hits == hc.HTTP_MAX_RETRIES + 1
