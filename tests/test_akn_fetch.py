"""Network + cache layer for the AKN export. No test hits the network."""
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
import structlog

from visualex_api.services import akn_fetch
from visualex_api.services.http_client import HttpResult
from visualex_api.tools.cache import PersistentCache
from visualex_api.tools.cache_manager import get_cache_manager

FIXTURES = Path(__file__).parent / "fixtures" / "akn"
LANDING = (FIXTURES / "landing_legge_241_1990.html").read_text(encoding="utf-8")
XML = (FIXTURES / "legge_241_1990.xml").read_text(encoding="utf-8")


class FakeNorma:
    """The whole contract fetch_act_index needs: an article-free act URL."""

    def __init__(self, url="https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241"):
        self._url = url

    @property
    def url(self):
        return self._url

    def __str__(self):
        return "legge 1990-08-07, n. 241"


def _responder(calls):
    async def fake_request(method, url, *, source="generic", **kwargs):
        calls.append(url)
        body = XML if "caricaAKN" in url else LANDING
        return HttpResult(text=body, status=200, headers={})
    return fake_request


@pytest.fixture
def structlog_to_stdlib(monkeypatch):
    """Route this module's structlog output into stdlib logging, for `caplog`.

    structlog is configured onto stdlib in the root `app.py`, which these tests
    never import; the default configuration writes to stdout, where `caplog`
    cannot see it. Configuring it here — and rebinding the module logger, since
    the app configures with `cache_logger_on_first_use=True` — makes the
    assertion about the log line true independently of import order.
    """
    previous = structlog.get_config()
    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            structlog.stdlib.render_to_log_kwargs,
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=False,
    )
    monkeypatch.setattr(akn_fetch, "log", structlog.get_logger("akn_fetch"))
    try:
        yield
    finally:
        structlog.configure(**previous)


@pytest.fixture(autouse=True)
def isolate_cache(tmp_path, monkeypatch):
    # PERSISTENT_CACHE_DIR is a module constant computed from BASE_PATH at import
    # time, not an env lookup, so setting the variable is not enough on its own:
    # the "akn" namespace is repointed at tmp_path directly. Without this a
    # stored index from an earlier run would serve "cold fetch costs two
    # requests" from disk and the assertion would read zero round-trips.
    monkeypatch.setenv("PERSISTENT_CACHE_DIR", str(tmp_path))
    cache = PersistentCache("akn")
    cache.directory = tmp_path / "akn"
    cache.directory.mkdir(parents=True, exist_ok=True)
    monkeypatch.setitem(get_cache_manager().persistent, "akn", cache)
    akn_fetch.clear_akn_cache()
    yield
    akn_fetch.clear_akn_cache()


class TestParamExtraction:
    def test_extracts_both_params_from_the_landing_page(self):
        params = akn_fetch._extract_params(LANDING)
        assert params == ("090G0294", "19900818")

    def test_returns_none_when_either_is_missing(self):
        assert akn_fetch._extract_params("<html>nothing</html>") is None


class TestHappyPath:
    @pytest.mark.asyncio
    async def test_cold_fetch_costs_two_requests(self):
        calls = []
        with patch("visualex_api.services.akn_fetch.http_client.request",
                   new=AsyncMock(side_effect=_responder(calls))):
            index = await akn_fetch.fetch_act_index(FakeNorma())
        assert index is not None
        assert len(calls) == 2
        assert "caricaAKN" in calls[1]
        assert len(index.keys) == 51
        assert "2-bis" in index.keys

    @pytest.mark.asyncio
    async def test_warm_fetch_costs_nothing(self):
        calls = []
        with patch("visualex_api.services.akn_fetch.http_client.request",
                   new=AsyncMock(side_effect=_responder(calls))):
            await akn_fetch.fetch_act_index(FakeNorma())
            await akn_fetch.fetch_act_index(FakeNorma())
        assert len(calls) == 2, "the second call should have been served from cache"


class TestTheIndexOnlyContract:
    @pytest.mark.asyncio
    async def test_no_article_text_is_retained(self):
        """The cache holds keys, not texts — that is what bounds its size."""
        calls = []
        with patch("visualex_api.services.akn_fetch.http_client.request",
                   new=AsyncMock(side_effect=_responder(calls))):
            index = await akn_fetch.fetch_act_index(FakeNorma())
        blob = repr(index)
        assert "L'attivita' amministrativa" not in blob
        assert len(blob) < 20000


class TestSingleFlight:
    @pytest.mark.asyncio
    async def test_concurrent_cold_requests_download_once(self):
        import asyncio

        calls = []
        with patch("visualex_api.services.akn_fetch.http_client.request",
                   new=AsyncMock(side_effect=_responder(calls))):
            await asyncio.gather(*[akn_fetch.fetch_act_index(FakeNorma()) for _ in range(5)])
        assert len(calls) == 2, (
            f"5 concurrent cold requests issued {len(calls)} round-trips; "
            "the codice civile is 10.6 MB, so this must be 2"
        )


class TestFailsClosed:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("body", [
        "<html>error page</html>",          # not XML
        "<?xml version='1.0'?><empty/>",    # XML with no articles
    ])
    async def test_bad_payload_returns_none(self, body):
        async def bad(method, url, *, source="generic", **kwargs):
            return HttpResult(text=(LANDING if "caricaAKN" not in url else body),
                              status=200, headers={})
        with patch("visualex_api.services.akn_fetch.http_client.request",
                   new=AsyncMock(side_effect=bad)):
            assert await akn_fetch.fetch_act_index(FakeNorma()) is None

    @pytest.mark.asyncio
    async def test_transport_error_returns_none(self):
        with patch("visualex_api.services.akn_fetch.http_client.request",
                   new=AsyncMock(side_effect=RuntimeError("down"))):
            assert await akn_fetch.fetch_act_index(FakeNorma()) is None

    @pytest.mark.asyncio
    async def test_failures_are_logged_not_swallowed(self, caplog, structlog_to_stdlib):
        with patch("visualex_api.services.akn_fetch.http_client.request",
                   new=AsyncMock(side_effect=RuntimeError("down"))):
            await akn_fetch.fetch_act_index(FakeNorma())
        assert caplog.records, "a load-path failure was swallowed silently"


class TestKillSwitch:
    @pytest.mark.asyncio
    async def test_akn_disabled_short_circuits(self, monkeypatch):
        monkeypatch.setenv("AKN_ENABLED", "false")
        calls = []
        with patch("visualex_api.services.akn_fetch.http_client.request",
                   new=AsyncMock(side_effect=_responder(calls))):
            assert await akn_fetch.fetch_act_index(FakeNorma()) is None
        assert not calls

    def test_the_switch_is_read_at_call_time(self, monkeypatch):
        monkeypatch.setenv("AKN_ENABLED", "false")
        assert akn_fetch.akn_disabled() is True
        monkeypatch.setenv("AKN_ENABLED", "true")
        assert akn_fetch.akn_disabled() is False


class TestSingleFlightCancellation:
    """A follower hanging up must not break the leader, and a cancelled leader
    must not strand its followers. Both are routine on a shared server, and the
    AKN branch fires exactly when Normattiva is flaky."""

    @pytest.mark.asyncio
    async def test_a_cancelled_follower_does_not_break_the_leader(self):
        import asyncio

        calls = []
        slow = asyncio.Event()

        async def slow_responder(method, url, *, source="generic", **kwargs):
            calls.append(url)
            if "caricaAKN" in url:
                await slow.wait()
                return HttpResult(text=XML, status=200, headers={})
            return HttpResult(text=LANDING, status=200, headers={})

        with patch("visualex_api.services.akn_fetch.http_client.request",
                   new=AsyncMock(side_effect=slow_responder)):
            leader = asyncio.create_task(akn_fetch.fetch_act_index(FakeNorma()))
            await asyncio.sleep(0.05)
            follower = asyncio.create_task(akn_fetch.fetch_act_index(FakeNorma()))
            await asyncio.sleep(0.05)
            follower.cancel()
            with pytest.raises(asyncio.CancelledError):
                await follower
            slow.set()
            index = await leader

        assert index is not None, "a cancelled follower broke the leader's fetch"
        assert len(index.keys) == 51

    @pytest.mark.asyncio
    async def test_a_cancelled_leader_releases_its_followers(self):
        import asyncio

        slow = asyncio.Event()

        async def slow_responder(method, url, *, source="generic", **kwargs):
            if "caricaAKN" in url:
                await slow.wait()
                return HttpResult(text=XML, status=200, headers={})
            return HttpResult(text=LANDING, status=200, headers={})

        with patch("visualex_api.services.akn_fetch.http_client.request",
                   new=AsyncMock(side_effect=slow_responder)):
            leader = asyncio.create_task(akn_fetch.fetch_act_index(FakeNorma()))
            await asyncio.sleep(0.05)
            follower = asyncio.create_task(akn_fetch.fetch_act_index(FakeNorma()))
            await asyncio.sleep(0.05)
            leader.cancel()
            with pytest.raises(asyncio.CancelledError):
                await leader
            # The follower must resolve rather than hang forever.
            result = await asyncio.wait_for(follower, timeout=2.0)

        assert result is None
