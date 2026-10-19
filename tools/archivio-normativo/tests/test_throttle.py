"""Pacing towards the sources, and retrying the failures worth retrying.

A fake clock and a recording sleep make the tests instant and exact.
"""
import pytest

from archivio_normativo.throttle import RetryableError, Throttle, with_backoff


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class RecordingSleep:
    def __init__(self, clock):
        self.clock = clock
        self.calls = []

    async def __call__(self, seconds):
        self.calls.append(round(seconds, 6))
        self.clock.now += seconds


class TestThrottle:
    async def test_first_call_does_not_wait(self):
        clock = FakeClock()
        sleep = RecordingSleep(clock)
        throttle = Throttle(2.0, clock=clock, sleep=sleep)
        await throttle.acquire()
        assert sleep.calls == []

    async def test_calls_are_spaced_at_the_rate(self):
        clock = FakeClock()
        sleep = RecordingSleep(clock)
        throttle = Throttle(2.0, clock=clock, sleep=sleep)  # one every 0.5 s
        await throttle.acquire()
        await throttle.acquire()
        await throttle.acquire()
        assert sleep.calls == [0.5, 0.5]

    async def test_idle_time_is_not_banked_beyond_one_token(self):
        clock = FakeClock()
        sleep = RecordingSleep(clock)
        throttle = Throttle(1.0, clock=clock, sleep=sleep)
        await throttle.acquire()
        clock.now += 100  # a long pause must not allow a burst afterwards
        await throttle.acquire()
        await throttle.acquire()
        assert sleep.calls == [1.0]

    async def test_pace_takes_n_tokens(self):
        clock = FakeClock()
        sleep = RecordingSleep(clock)
        throttle = Throttle(1.0, clock=clock, sleep=sleep)
        await throttle.pace(3)   # first batch: free
        await throttle.pace(3)   # second: wait for 3 tokens
        assert sleep.calls == [3.0]

    async def test_zero_or_negative_rate_means_no_pacing(self):
        clock = FakeClock()
        sleep = RecordingSleep(clock)
        throttle = Throttle(0, clock=clock, sleep=sleep)
        for _ in range(5):
            await throttle.acquire()
        assert sleep.calls == []


class TestBackoff:
    async def test_returns_the_result_on_first_success(self):
        calls = []

        async def fn():
            calls.append(1)
            return "ok"

        assert await with_backoff(fn, sleep=RecordingSleep(FakeClock())) == "ok"
        assert len(calls) == 1

    async def test_retries_retryable_errors_with_exponential_delays(self):
        clock = FakeClock()
        sleep = RecordingSleep(clock)
        attempts = []

        async def fn():
            attempts.append(1)
            if len(attempts) < 4:
                raise RetryableError("503")
            return "ok"

        result = await with_backoff(fn, attempts=5, base=2.0, factor=2.0,
                                    jitter=lambda: 0.5, sleep=sleep)
        assert result == "ok"
        assert sleep.calls == [2.0, 4.0, 8.0]   # base * factor**k, jitter factor 1.0

    async def test_delays_are_capped(self):
        sleep = RecordingSleep(FakeClock())
        attempts = []

        async def fn():
            attempts.append(1)
            if len(attempts) < 5:
                raise RetryableError("429")
            return "ok"

        await with_backoff(fn, attempts=5, base=10.0, factor=10.0, max_delay=15.0,
                           jitter=lambda: 0.5, sleep=sleep)
        assert sleep.calls == [10.0, 15.0, 15.0, 15.0]

    async def test_gives_up_after_attempts_and_reraises(self):
        sleep = RecordingSleep(FakeClock())

        async def fn():
            raise RetryableError("down")

        with pytest.raises(RetryableError, match="down"):
            await with_backoff(fn, attempts=3, jitter=lambda: 0.5, sleep=sleep)
        assert len(sleep.calls) == 2

    async def test_non_retryable_errors_propagate_immediately(self):
        sleep = RecordingSleep(FakeClock())

        async def fn():
            raise ValueError("bad input")

        with pytest.raises(ValueError):
            await with_backoff(fn, sleep=sleep)
        assert sleep.calls == []

    async def test_on_retry_is_told_about_each_wait(self):
        sleep = RecordingSleep(FakeClock())
        seen = []
        attempts = []

        async def fn():
            attempts.append(1)
            if len(attempts) < 2:
                raise RetryableError("503")
            return "ok"

        await with_backoff(fn, jitter=lambda: 0.5, sleep=sleep,
                           on_retry=lambda attempt, delay, err: seen.append((attempt, delay, str(err))))
        assert seen == [(1, 2.0, "503")]
