"""Tests for CircuitBreaker pattern."""

import asyncio
import time
import pytest
from unittest.mock import AsyncMock

from visualex_api.tools.circuit_breaker import (
    CircuitBreaker,
    CircuitOpenError,
    CircuitState,
    get_breaker,
    get_all_statuses,
    _breakers,
)


@pytest.fixture
def breaker():
    return CircuitBreaker("test_source", failure_threshold=3, cooldown_seconds=5)


@pytest.fixture(autouse=True)
def clear_registry():
    _breakers.clear()
    yield
    _breakers.clear()


class TestCircuitBreakerStates:
    def test_initial_state_is_closed(self, breaker):
        assert breaker.state == CircuitState.CLOSED

    @pytest.mark.asyncio
    async def test_stays_closed_on_success(self, breaker):
        func = AsyncMock(return_value="ok")
        result = await breaker.call(func)
        assert result == "ok"
        assert breaker.state == CircuitState.CLOSED

    @pytest.mark.asyncio
    async def test_opens_after_threshold_failures(self, breaker):
        func = AsyncMock(side_effect=ConnectionError("refused"))
        for _ in range(3):
            with pytest.raises(ConnectionError):
                await breaker.call(func)
        assert breaker.state == CircuitState.OPEN

    @pytest.mark.asyncio
    async def test_blocks_when_open(self, breaker):
        func = AsyncMock(side_effect=ConnectionError("refused"))
        for _ in range(3):
            with pytest.raises(ConnectionError):
                await breaker.call(func)

        with pytest.raises(CircuitOpenError) as exc_info:
            await breaker.call(func)
        assert "test_source" in str(exc_info.value)
        assert func.call_count == 3

    @pytest.mark.asyncio
    async def test_half_open_after_cooldown(self, breaker):
        func = AsyncMock(side_effect=ConnectionError("refused"))
        for _ in range(3):
            with pytest.raises(ConnectionError):
                await breaker.call(func)
        assert breaker.state == CircuitState.OPEN

        breaker._last_failure_time = time.monotonic() - 10
        assert breaker.state == CircuitState.HALF_OPEN

    @pytest.mark.asyncio
    async def test_closes_on_success_in_half_open(self, breaker):
        fail_func = AsyncMock(side_effect=ConnectionError("refused"))
        for _ in range(3):
            with pytest.raises(ConnectionError):
                await breaker.call(fail_func)

        breaker._last_failure_time = time.monotonic() - 10

        success_func = AsyncMock(return_value="recovered")
        result = await breaker.call(success_func)
        assert result == "recovered"
        assert breaker.state == CircuitState.CLOSED
        assert breaker._failure_count == 0

    @pytest.mark.asyncio
    async def test_reopens_on_failure_in_half_open(self, breaker):
        fail_func = AsyncMock(side_effect=ConnectionError("refused"))
        for _ in range(3):
            with pytest.raises(ConnectionError):
                await breaker.call(fail_func)

        breaker._last_failure_time = time.monotonic() - 10
        assert breaker.state == CircuitState.HALF_OPEN

        with pytest.raises(ConnectionError):
            await breaker.call(fail_func)
        assert breaker.state == CircuitState.OPEN
        # failure_count resets to 1 for the new OPEN cycle
        assert breaker._failure_count == 1

    @pytest.mark.asyncio
    async def test_single_failure_does_not_open(self, breaker):
        func = AsyncMock(side_effect=ConnectionError("refused"))
        with pytest.raises(ConnectionError):
            await breaker.call(func)
        assert breaker.state == CircuitState.CLOSED
        assert breaker._failure_count == 1

    @pytest.mark.asyncio
    async def test_success_resets_failure_count(self, breaker):
        fail = AsyncMock(side_effect=ConnectionError("refused"))
        with pytest.raises(ConnectionError):
            await breaker.call(fail)
        with pytest.raises(ConnectionError):
            await breaker.call(fail)
        assert breaker._failure_count == 2

        success = AsyncMock(return_value="ok")
        await breaker.call(success)
        assert breaker._failure_count == 0


class TestHalfOpenProbeExclusivity:
    @pytest.mark.asyncio
    async def test_only_one_probe_allowed_in_half_open(self, breaker):
        """When in HALF_OPEN, only one coroutine should be allowed to probe."""
        fail_func = AsyncMock(side_effect=ConnectionError("refused"))
        for _ in range(3):
            with pytest.raises(ConnectionError):
                await breaker.call(fail_func)

        breaker._last_failure_time = time.monotonic() - 10

        # Create a slow func and a fast func
        probe_started = asyncio.Event()
        probe_release = asyncio.Event()

        async def slow_probe():
            probe_started.set()
            await probe_release.wait()
            return "probed"

        results = []
        errors = []

        async def first_caller():
            r = await breaker.call(slow_probe)
            results.append(r)

        async def second_caller():
            await probe_started.wait()
            try:
                await breaker.call(AsyncMock(return_value="should not run"))
            except CircuitOpenError:
                errors.append("blocked")

        task1 = asyncio.create_task(first_caller())
        task2 = asyncio.create_task(second_caller())

        await asyncio.sleep(0.01)
        probe_release.set()

        await asyncio.gather(task1, task2)

        assert results == ["probed"]
        assert errors == ["blocked"]
        assert breaker.state == CircuitState.CLOSED


class TestCircuitBreakerError:
    def test_circuit_open_error_message(self):
        err = CircuitOpenError("Normattiva")
        assert "Normattiva non disponibile al momento" in str(err)
        assert err.source == "Normattiva"


class TestCircuitBreakerStatus:
    def test_get_status(self, breaker):
        status = breaker.get_status()
        assert status["source"] == "test_source"
        assert status["state"] == "closed"
        assert status["failure_count"] == 0
        assert status["failure_threshold"] == 3

    @pytest.mark.asyncio
    async def test_reset(self, breaker):
        breaker._state = CircuitState.OPEN
        breaker._failure_count = 5
        await breaker.reset()
        assert breaker.state == CircuitState.CLOSED
        assert breaker._failure_count == 0
        assert breaker._probe_in_flight is False


class TestBreakerRegistry:
    def test_get_breaker_creates_new(self):
        b = get_breaker("normattiva")
        assert b.source == "normattiva"

    def test_get_breaker_returns_same_instance(self):
        b1 = get_breaker("normattiva")
        b2 = get_breaker("normattiva")
        assert b1 is b2

    def test_get_all_statuses(self):
        get_breaker("normattiva")
        get_breaker("eurlex")
        statuses = get_all_statuses()
        assert len(statuses) == 2
        sources = {s["source"] for s in statuses}
        assert sources == {"normattiva", "eurlex"}
