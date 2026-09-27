"""/health/detailed probes three live sources on the shared throttled client
and circuit breakers; the frontend banner polls it, so N open tabs multiply
that load. A server-side TTL cache shares one probe result across callers.

Uses the real Quart app (same trick as test_article_existence.py's `client`
fixture) with the three module-level scrapers' `request_document` monkeypatched
so no network call ever happens.
"""
import asyncio

import pytest
from unittest.mock import AsyncMock, patch

import app as app_module
from app import NormaController


@pytest.fixture
def client():
    return NormaController().app.test_client()


@pytest.fixture(autouse=True)
def _reset_health_cache():
    """The cache is module-level (one probe shared process-wide), so it must
    not leak between tests."""
    app_module._health_detailed_cache['response'] = None
    app_module._health_detailed_cache['status_code'] = None
    app_module._health_detailed_cache['expires_at'] = 0.0
    yield
    app_module._health_detailed_cache['response'] = None
    app_module._health_detailed_cache['status_code'] = None
    app_module._health_detailed_cache['expires_at'] = 0.0


def _patch_probes(fn):
    return (
        patch.object(app_module.normattiva_scraper, 'request_document', fn),
        patch.object(app_module.eurlex_scraper, 'request_document', fn),
        patch.object(app_module.brocardi_scraper, 'request_document', fn),
    )


@pytest.mark.asyncio
async def test_two_back_to_back_calls_share_one_probe(client, monkeypatch):
    monkeypatch.setenv('HEALTH_DETAILED_TTL', '120')
    probe = AsyncMock(return_value='<html>ok</html>')
    p1, p2, p3 = _patch_probes(probe)
    with p1, p2, p3:
        first = await client.get('/health/detailed')
        second = await client.get('/health/detailed')

    assert first.status_code == 200
    first_body = await first.get_json()
    assert first_body['cached'] is False
    assert first_body['cache_ttl_seconds'] == 120

    assert second.status_code == 200
    second_body = await second.get_json()
    assert second_body['cached'] is True
    assert second_body['status'] == first_body['status']

    # One probe = one request_document call per source (normattiva, eurlex,
    # brocardi), not one per HTTP call into /health/detailed.
    assert probe.call_count == 3


@pytest.mark.asyncio
async def test_cache_expiry_triggers_a_second_probe(client, monkeypatch):
    monkeypatch.setenv('HEALTH_DETAILED_TTL', '0.05')
    probe = AsyncMock(return_value='<html>ok</html>')
    p1, p2, p3 = _patch_probes(probe)
    with p1, p2, p3:
        first = await client.get('/health/detailed')
        assert (await first.get_json())['cached'] is False
        assert probe.call_count == 3

        await asyncio.sleep(0.1)

        second = await client.get('/health/detailed')
        assert (await second.get_json())['cached'] is False
        assert probe.call_count == 6


@pytest.mark.asyncio
async def test_a_failing_probe_is_cached_too(client, monkeypatch):
    monkeypatch.setenv('HEALTH_DETAILED_TTL', '120')
    probe = AsyncMock(side_effect=RuntimeError('source is down'))
    p1, p2, p3 = _patch_probes(probe)
    with p1, p2, p3:
        first = await client.get('/health/detailed')
        second = await client.get('/health/detailed')

    assert first.status_code == 503
    first_body = await first.get_json()
    assert first_body['status'] == 'degraded'
    assert first_body['cached'] is False

    assert second.status_code == 503
    second_body = await second.get_json()
    assert second_body['status'] == 'degraded'
    assert second_body['cached'] is True

    # A flapping source must not get hammered by every caller either.
    assert probe.call_count == 3


@pytest.mark.asyncio
async def test_concurrent_cold_calls_run_a_single_probe(client, monkeypatch):
    monkeypatch.setenv('HEALTH_DETAILED_TTL', '120')

    async def slow_probe(*args, **kwargs):
        await asyncio.sleep(0.05)
        return '<html>ok</html>'

    probe = AsyncMock(side_effect=slow_probe)
    p1, p2, p3 = _patch_probes(probe)
    with p1, p2, p3:
        results = await asyncio.gather(
            client.get('/health/detailed'),
            client.get('/health/detailed'),
            client.get('/health/detailed'),
        )

    for response in results:
        assert response.status_code == 200

    # The lock serialises the cold callers onto a single probe (3 calls: one
    # per source), not 3 probes (9 calls) for 3 concurrent requests.
    assert probe.call_count == 3
