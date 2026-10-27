"""/health/detailed probes three live sources on the shared throttled client
and circuit breakers; the frontend banner polls it, so N open tabs multiply
that load. A server-side TTL cache shares one probe result across callers.

Uses the real Quart app (same trick as test_article_existence.py's `client`
fixture) with Normattiva's `request_document` and the two probes of the Union's
acts (EUR-Lex's site and CELLAR, `eurlex_fetch`) monkeypatched so no network
call ever happens.
"""
import asyncio
from contextlib import contextmanager

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


@contextmanager
def _patch_probes(fn):
    """Every probe calls `fn`: Normattiva's page, EUR-Lex's site and CELLAR. A probe of the
    Union's acts reports a state instead of raising, as `eurlex_fetch`'s do."""
    async def eu_probe(*args, **kwargs):
        try:
            await fn(*args, **kwargs)
        except Exception:
            return 'error'
        return 'ok'

    with patch.object(app_module.normattiva_scraper, 'request_document', fn), \
            patch.object(app_module.eurlex_fetch, 'probe_eurlex', eu_probe), \
            patch.object(app_module.eurlex_fetch, 'probe_cellar', eu_probe):
        yield


@pytest.mark.asyncio
async def test_two_back_to_back_calls_share_one_probe(client, monkeypatch):
    monkeypatch.setenv('HEALTH_DETAILED_TTL', '120')
    probe = AsyncMock(return_value='<html>ok</html>')
    with _patch_probes(probe):
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

    # One probe = one call per source (Normattiva, EUR-Lex's site, CELLAR),
    # not one per HTTP call into /health/detailed. Brocardi is no longer a
    # source (D-078), so it is not probed.
    assert probe.call_count == 3
    assert 'brocardi' not in first_body['services']


@pytest.mark.asyncio
async def test_cache_expiry_triggers_a_second_probe(client, monkeypatch):
    monkeypatch.setenv('HEALTH_DETAILED_TTL', '0.05')
    probe = AsyncMock(return_value='<html>ok</html>')
    with _patch_probes(probe):
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
    with _patch_probes(probe):
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
    with _patch_probes(probe):
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


# The Union's acts are read from CELLAR first and from EUR-Lex's site second: the source is
# down only when both are, and each one's state rides along.
@pytest.mark.asyncio
@pytest.mark.parametrize("site,cellar,status", [
    ("challenge", "ok", "ok"),
    ("ok", "error", "ok"),
    ("ok", "ok", "ok"),
    ("challenge", "error", "error"),
    ("error", "error", "error"),
])
async def test_the_union_acts_are_down_only_when_both_hosts_are(client, monkeypatch, site, cellar, status):
    monkeypatch.setenv('HEALTH_DETAILED_TTL', '0')
    with patch.object(app_module.normattiva_scraper, 'request_document', AsyncMock(return_value='<html>ok</html>')), \
            patch.object(app_module.eurlex_fetch, 'probe_eurlex', AsyncMock(return_value=site)), \
            patch.object(app_module.eurlex_fetch, 'probe_cellar', AsyncMock(return_value=cellar)):
        response = await client.get('/health/detailed')
    body = await response.get_json()
    eu = body['services']['eurlex']
    assert (eu['status'], eu['eurlex'], eu['cellar']) == (status, site, cellar)
    assert response.status_code == (200 if status == 'ok' else 503)
    assert body['status'] == ('ok' if status == 'ok' else 'degraded')
