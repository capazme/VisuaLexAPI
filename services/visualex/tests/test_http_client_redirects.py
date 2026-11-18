"""A redirect is checked against the allow-list before it is followed (item 15 of the security inventory).

The shared client checked only the first address: aiohttp then followed up to ten redirects on its
own. A declared source that redirected elsewhere (compromised, or an open redirect on its site)
took the scraper to a host nobody declared, an internal one included. Now every hop is checked
(`egress.is_allowed`) before it is requested, on the shared session and on a caller's own
(`http_client.new_session`).
"""
from urllib.parse import urlparse

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from visualex_api.services import http_client as hc
from visualex_api.tools.exceptions import NetworkError

ALLOWED_HOST = "127.0.0.1"


@pytest.fixture(autouse=True)
def only_one_host(monkeypatch):
    # The declared source is 127.0.0.1; «localhost», the same machine by another name, stands for any other host.
    monkeypatch.setattr(hc, "is_allowed", lambda url: urlparse(url).hostname == ALLOWED_HOST)
    monkeypatch.setattr(hc, "HTTP_MIN_INTERVAL", 0.0)
    monkeypatch.setattr(hc, "HTTP_INITIAL_BACKOFF", 0.0)
    monkeypatch.setattr(hc, "HTTP_JITTER", 0.0)


@pytest.fixture
async def site():
    hits = {"secret": 0, "away": 0}

    async def secret(_request):
        hits["secret"] += 1
        return web.Response(text="interno")

    app = web.Application()
    server = TestServer(app, host=ALLOWED_HOST)

    async def away(_request):
        hits["away"] += 1
        raise web.HTTPFound(f"http://localhost:{server.port}/secret")

    async def along(_request):
        raise web.HTTPFound("/final")

    async def by_uri(_request):
        # No Location: aiohttp then follows the URI header, so the check must read it too.
        return web.Response(status=302, headers={"URI": f"http://localhost:{server.port}/secret"})

    async def final(_request):
        return web.Response(text="fine")

    app.router.add_get("/away", away)
    app.router.add_get("/along", along)
    app.router.add_get("/by-uri", by_uri)
    app.router.add_get("/final", final)
    app.router.add_get("/secret", secret)
    await server.start_server()
    yield server, hits
    await server.close()


@pytest.fixture
async def client():
    instance = hc.ThrottledHttpClient()
    yield instance
    await instance.close()


async def test_a_redirect_to_an_undeclared_host_is_refused_before_it_is_followed(site, client):
    server, hits = site
    with pytest.raises(NetworkError) as refused:
        await client.request("GET", str(server.make_url("/away")), source="test", max_retries=0)
    assert refused.value.status_code == 403
    assert hits["secret"] == 0


async def test_a_redirect_within_the_declared_host_is_followed(site, client):
    server, _ = site
    result = await client.request("GET", str(server.make_url("/along")), source="test", max_retries=0)
    assert result.text == "fine"


async def test_a_redirect_in_the_uri_header_is_checked_too(site, client):
    server, hits = site
    with pytest.raises(NetworkError) as refused:
        await client.request("GET", str(server.make_url("/by-uri")), source="test", max_retries=0)
    assert refused.value.status_code == 403
    assert hits["secret"] == 0


async def test_a_callers_own_session_is_checked_too(site, client):
    server, hits = site
    async with hc.new_session() as session:
        with pytest.raises(NetworkError) as refused:
            await client.request("GET", str(server.make_url("/away")), source="test", max_retries=0, session=session)
    assert refused.value.status_code == 403
    assert hits["secret"] == 0


async def test_a_refused_redirect_is_not_retried(site, client):
    server, hits = site
    # With the default retries: a refusal is final, the source is asked once.
    with pytest.raises(NetworkError) as refused:
        await client.request("GET", str(server.make_url("/away")), source="test")
    assert refused.value.status_code == 403
    assert hits["away"] == 1
    assert hits["secret"] == 0
