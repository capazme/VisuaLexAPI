"""FIX 2: the case-law package must not share its throttle with article
reading.

Before this module existed, every case-law adapter imported the same
`ThrottledHttpClient` instance Normattiva/EUR-Lex/Brocardi use — one global
semaphore (`HTTP_MAX_CONCURRENCY=3`) and one global 0.5s-min-interval lock
serialising every outbound request across every source. A single
`/fetch_case_law` call fans out to four adapters and issues about seven
requests, so it alone could occupy the whole semaphore; any article-reading
request submitted at the same time queued behind it.

These tests prove the two `ThrottledHttpClient` instances are independent at
the object level: work saturating one's semaphore must not delay a request
issued on the other. Both `_get_session` methods are stubbed so the tests run
offline and deterministically — the point under test is queuing behaviour on
the client's own semaphore/lock, not real network I/O.
"""
from __future__ import annotations

import asyncio

import pytest

from visualex_api.services.case_law.http_client import case_law_http_client
from visualex_api.services.http_client import http_client as shared_http_client
from visualex_api.tools.config import HTTP_MAX_CONCURRENCY


class _StubResponse:
    def __init__(self, text: str, wait: asyncio.Event | None = None) -> None:
        self._text = text
        self._wait = wait
        self.status = 200
        self.headers: dict = {}

    async def text(self, encoding=None, errors="strict") -> str:
        if self._wait is not None:
            await self._wait.wait()
        return self._text

    def raise_for_status(self) -> None:
        return None


class _StubRequestCM:
    def __init__(self, response: _StubResponse) -> None:
        self._response = response

    async def __aenter__(self) -> _StubResponse:
        return self._response

    async def __aexit__(self, *exc_info) -> bool:
        return False


class _StubSession:
    """`request()` is intentionally sync (matches aiohttp's own signature: it
    returns a context manager, the awaiting happens on `__aenter__`/on
    `response.text()`)."""

    def __init__(self, response_factory) -> None:
        self._response_factory = response_factory

    def request(self, method, url, **kwargs) -> _StubRequestCM:
        return _StubRequestCM(self._response_factory())


@pytest.fixture(autouse=True)
def _allow_every_host(monkeypatch):
    """Isolation is the only thing under test here; the egress allowlist is
    covered separately (`tests/test_egress_allowlist.py`)."""
    monkeypatch.setattr("visualex_api.services.http_client.is_allowed", lambda url: True)


@pytest.fixture(autouse=True)
def _reset_throttle_state():
    """Both clients are process-wide singletons reused across the whole
    suite; a test that saturates one must not leave `_last_request_at` or a
    held semaphore behind for the next test."""
    for client in (shared_http_client, case_law_http_client):
        client._last_request_at = 0.0
    yield
    for client in (shared_http_client, case_law_http_client):
        client._last_request_at = 0.0


def test_the_two_clients_do_not_share_state():
    """Not a network test: the class keeps no mutable state at class level
    (semaphore, session, lock and `_last_request_at` are all set in
    `__init__`), so the two module-level instances must already be distinct
    objects with distinct internals — the actual reason a second instance is
    a safe fix with zero changes to `ThrottledHttpClient` itself."""
    assert shared_http_client is not case_law_http_client
    assert shared_http_client._semaphore is not case_law_http_client._semaphore
    assert shared_http_client._request_lock is not case_law_http_client._request_lock


async def test_saturating_the_shared_client_does_not_delay_the_case_law_client(monkeypatch):
    """The regression this fix closes: opening the case-law panel (heavy use
    of one client) must not slow down reading an article (the other
    client)."""
    hold = asyncio.Event()

    async def slow_get_session():
        return _StubSession(lambda: _StubResponse("slow", wait=hold))

    async def fast_get_session():
        return _StubSession(lambda: _StubResponse("fast"))

    monkeypatch.setattr(shared_http_client, "_get_session", slow_get_session)
    monkeypatch.setattr(case_law_http_client, "_get_session", fast_get_session)

    # Saturate the shared client's semaphore (capacity HTTP_MAX_CONCURRENCY)
    # with requests that will not return until `hold` is set.
    saturating = [
        asyncio.create_task(
            shared_http_client.request("GET", "https://www.normattiva.it/x", source="test")
        )
        for _ in range(HTTP_MAX_CONCURRENCY)
    ]
    # Let each saturating request acquire the semaphore and reach the
    # blocking `text()` call before issuing the request under test.
    await asyncio.sleep(0.05)

    try:
        result = await asyncio.wait_for(
            case_law_http_client.request(
                "GET", "https://publications.europa.eu/x", source="cellar"
            ),
            timeout=2.0,
        )
    except asyncio.TimeoutError:
        pytest.fail(
            "the case-law client waited on the shared client's semaphore — "
            "the two clients are not independent"
        )
    finally:
        hold.set()
        await asyncio.gather(*saturating)

    assert result.text == "fast"


async def test_saturating_the_case_law_client_does_not_delay_the_shared_client(monkeypatch):
    """The reverse direction: a case-law fan-out in progress must not delay
    an article-reading request either."""
    hold = asyncio.Event()

    async def slow_get_session():
        return _StubSession(lambda: _StubResponse("slow", wait=hold))

    async def fast_get_session():
        return _StubSession(lambda: _StubResponse("fast"))

    monkeypatch.setattr(case_law_http_client, "_get_session", slow_get_session)
    monkeypatch.setattr(shared_http_client, "_get_session", fast_get_session)

    saturating = [
        asyncio.create_task(
            case_law_http_client.request(
                "GET", "https://publications.europa.eu/x", source="cellar"
            )
        )
        for _ in range(HTTP_MAX_CONCURRENCY)
    ]
    await asyncio.sleep(0.05)

    try:
        result = await asyncio.wait_for(
            shared_http_client.request("GET", "https://www.normattiva.it/x", source="test"),
            timeout=2.0,
        )
    except asyncio.TimeoutError:
        pytest.fail(
            "the shared client waited on the case-law client's semaphore — "
            "the two clients are not independent"
        )
    finally:
        hold.set()
        await asyncio.gather(*saturating)

    assert result.text == "fast"
