"""Concurrent identical calls share one run (single flight).

Fifty readers opening the same article on an empty cache used to send fifty requests to
Normattiva, queued behind our own limit (three at once, half a second apart): the last one waited
minutes and half of them hit the time-out (T133, docs/superpowers/specs/2026-11-28-collectors-
speed-design.md). With a single flight, the first caller's run is the run: every caller that comes
with the same key while it is in flight awaits it and gets its result, or its exception.

- **Nothing is cached here.** A key is forgotten the moment its run ends; the next caller starts a
  new run. The caches stay where they are (the scrapers' memory and persistent caches).
- **A caller that leaves does not stop the others.** The run is a task of its own, awaited through
  `asyncio.shield`: a reader who closes the tab cancels its own wait, never the fetch the other
  readers are waiting for.
- **Followers may get a copy.** `share` turns the result into what each follower receives (a
  deep copy, when the result is mutable and callers may change it); the first caller gets the
  result itself, as it did before.
- **One event loop per run.** A run is never shared across loops (the test suite opens one per
  test): a run left by a closed loop is replaced.
"""
from __future__ import annotations

import asyncio
import functools
from typing import Any, Awaitable, Callable, Hashable, Optional


class SingleFlight:
    """The runs in flight, by key."""

    def __init__(self) -> None:
        self._runs: dict[Hashable, asyncio.Task] = {}

    def __len__(self) -> int:
        return len(self._runs)

    async def run(
        self,
        key: Hashable,
        factory: Callable[[], Awaitable[Any]],
        share: Optional[Callable[[Any], Any]] = None,
    ) -> Any:
        loop = asyncio.get_running_loop()
        task = self._runs.get(key)
        if task is not None and (task.done() or task.get_loop() is not loop):
            task = None
        if task is None:
            task = loop.create_task(factory())
            self._runs[key] = task
            task.add_done_callback(functools.partial(self._finished, key))
            return await asyncio.shield(task)
        result = await asyncio.shield(task)
        return share(result) if share is not None else result

    def _finished(self, key: Hashable, task: asyncio.Task) -> None:
        if self._runs.get(key) is task:
            del self._runs[key]
        if not task.cancelled():
            # Retrieved here, so a run whose callers all left logs no "exception never retrieved".
            task.exception()


def single_flight(key: Callable[..., Hashable], share: Optional[Callable[[Any], Any]] = None):
    """Decorate a coroutine function so that concurrent calls with the same `key(*args,
    **kwargs)` share one run. Keep it beneath a caching decorator (`@cached` first, then this):
    the cache answers hits as before, and only the misses that arrive together are joined."""

    def decorate(function):
        flights = SingleFlight()

        @functools.wraps(function)
        async def wrapper(*args, **kwargs):
            return await flights.run(key(*args, **kwargs), lambda: function(*args, **kwargs), share)

        wrapper.flights = flights
        return wrapper

    return decorate


def call_key(*args, **kwargs) -> Hashable:
    """The key aiocache's `cached` builds for the same call: the arguments' reprs, keyword
    arguments sorted. Equal reprs, one run (a scraper's `self` is the same object)."""
    return str(args) + str(sorted(kwargs.items()))
