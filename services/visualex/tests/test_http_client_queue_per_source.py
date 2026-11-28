"""One queue per source host (owner, G-647; T133).

The shared client had one queue for every source: three requests at once, half a second apart,
whatever the host. A CELLAR request for an EU article waited behind every Normattiva page in the
queue. Each host now has the queue the one queue was: Normattiva keeps its three at once and its
half second, and no other source waits behind it.
"""
import asyncio
import time

import pytest

from visualex_api.services import http_client as http_module
from visualex_api.services.http_client import ThrottledHttpClient

pytestmark = pytest.mark.asyncio

NORMATTIVA = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241~art{}"
CELLAR = "https://publications.europa.eu/resource/celex/32016R0679"


class Response:
    status = 200
    headers = {}

    async def text(self, encoding=None):
        return "<html>page</html>"

    def raise_for_status(self):
        return None


class Session:
    """Counts the requests in flight per host; each waits until the gate of its host opens."""

    def __init__(self):
        self.active, self.peak, self.started = {}, {}, []
        self.gates = {"www.normattiva.it": asyncio.Event(), "publications.europa.eu": asyncio.Event()}

    def request(self, method, url, **kwargs):
        session = self

        class Context:
            async def __aenter__(self):
                host = http_module._host_of(url)
                session.started.append((host, time.monotonic()))
                session.active[host] = session.active.get(host, 0) + 1
                session.peak[host] = max(session.peak.get(host, 0), session.active[host])
                await session.gates[host].wait()
                session.active[host] -= 1
                return Response()

            async def __aexit__(self, *exc):
                return None

        return Context()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(http_module, "HTTP_MIN_INTERVAL", 0.0)
    instance = ThrottledHttpClient()
    session = Session()

    async def get_session():
        return session

    instance._get_session = get_session
    return instance, session


async def test_a_cellar_request_does_not_wait_behind_normattivas_queue(client):
    instance, session = client
    pages = [asyncio.create_task(instance.request("GET", NORMATTIVA.format(n), source="normattiva"))
             for n in range(10)]
    await asyncio.sleep(0.01)
    assert session.active["www.normattiva.it"] == 3  # Normattiva's three slots are taken
    session.gates["publications.europa.eu"].set()
    answer = await asyncio.wait_for(instance.request("GET", CELLAR, source="cellar"), 1)
    assert answer.status == 200
    session.gates["www.normattiva.it"].set()
    await asyncio.gather(*pages)


async def test_normattiva_still_gets_three_requests_at_once(client):
    instance, session = client
    pages = [asyncio.create_task(instance.request("GET", NORMATTIVA.format(n), source="normattiva"))
             for n in range(12)]
    await asyncio.sleep(0.01)
    session.gates["www.normattiva.it"].set()
    await asyncio.gather(*pages)
    assert session.peak["www.normattiva.it"] == http_module.HTTP_MAX_CONCURRENCY == 3


async def test_two_names_for_one_host_share_its_queue(client):
    instance, session = client
    calls = [asyncio.create_task(instance.request("GET", NORMATTIVA.format(n), source=name))
             for n, name in enumerate(["normattiva", "tree", "act_dates", "normattiva", "tree"])]
    await asyncio.sleep(0.01)
    assert session.active["www.normattiva.it"] == 3
    session.gates["www.normattiva.it"].set()
    await asyncio.gather(*calls)


async def test_the_half_second_holds_per_host(monkeypatch):
    monkeypatch.setattr(http_module, "HTTP_MIN_INTERVAL", 0.05)
    instance = ThrottledHttpClient()
    session = Session()
    for gate in session.gates.values():
        gate.set()

    async def get_session():
        return session

    instance._get_session = get_session
    await asyncio.gather(*(instance.request("GET", NORMATTIVA.format(n), source="normattiva") for n in range(3)),
                         instance.request("GET", CELLAR, source="cellar"))
    normattiva = sorted(t for host, t in session.started if host == "www.normattiva.it")
    assert all(b - a >= 0.045 for a, b in zip(normattiva, normattiva[1:]))
    cellar = [t for host, t in session.started if host == "publications.europa.eu"]
    assert cellar[0] - normattiva[0] < 0.045  # CELLAR's first request did not wait for Normattiva's spacing
