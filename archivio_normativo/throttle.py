"""Pacing and retrying for the two providers.

`Throttle` is a token bucket with a capacity of one token per unit of work:
idle time earns at most one token, so a pause never turns into a burst
against Normattiva or Italgiure afterwards. `with_backoff` retries only the
errors a caller marks as retryable (429, 5xx, timeouts) with exponential,
jittered, capped delays and re-raises the last one when attempts run out.
"""
from __future__ import annotations

import asyncio
import random
import time
from typing import Awaitable, Callable


class RetryableError(Exception):
    """A failure worth retrying: rate limit, server error, timeout."""


class Throttle:
    def __init__(self, rate_per_second: float, *, clock=time.monotonic, sleep=asyncio.sleep):
        self.rate = float(rate_per_second)
        self._clock = clock
        self._sleep = sleep
        self._next_free: float | None = None  # earliest time the next token is available

    async def acquire(self) -> None:
        await self.pace(1)

    async def pace(self, tokens: int) -> None:
        """Wait until `tokens` units of work may proceed at the configured rate."""
        if self.rate <= 0 or tokens <= 0:
            return
        now = self._clock()
        if self._next_free is None or now > self._next_free:
            self._next_free = now  # idle bucket: one batch is free, nothing is banked
        wait = self._next_free - now
        self._next_free += tokens / self.rate
        if wait > 0:
            await self._sleep(wait)


async def with_backoff(
    fn: Callable[[], Awaitable],
    *,
    attempts: int = 5,
    base: float = 2.0,
    factor: float = 2.0,
    max_delay: float = 60.0,
    jitter: Callable[[], float] = random.random,
    sleep=asyncio.sleep,
    on_retry: Callable[[int, float, BaseException], None] | None = None,
):
    """Call `fn` until it succeeds or `attempts` are exhausted.

    Delay before retry k (1-based) is `min(max_delay, base * factor**(k-1))`
    scaled by `0.5 + jitter()`, so with `jitter() == 0.5` the delays are exact.
    """
    last: BaseException | None = None
    for attempt in range(1, attempts + 1):
        try:
            return await fn()
        except RetryableError as exc:
            last = exc
            if attempt == attempts:
                break
            delay = min(max_delay, base * factor ** (attempt - 1)) * (0.5 + jitter())
            if on_retry is not None:
                on_retry(attempt, delay, exc)
            await sleep(delay)
    assert last is not None
    raise last
