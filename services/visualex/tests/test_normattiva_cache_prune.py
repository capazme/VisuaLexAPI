"""The Normattiva cache's rule (G-338, 21 October 2026): the pages not read for 30 days go, then
the least recently read ones down to 2 GB; nothing outside the "normattiva" namespace.

An article page of a code weighs 2.6 MB on disk and the filesystem cache deletes an entry only
when its key is read again, so the folder only grew (5.6 GB in development).
"""
import os
import time
from types import SimpleNamespace
from unittest.mock import patch

import pytest
import structlog
from structlog.testing import capture_logs

from visualex_api.tools import cache_manager
from visualex_api.tools.cache import PersistentCache

DAY = 24 * 3600


@pytest.fixture
def cache_dir(tmp_path):
    with patch("visualex_api.tools.cache.PERSISTENT_CACHE_DIR", str(tmp_path)):
        yield tmp_path


def _page(cache, key, size, last_used):
    """An entry of `size` bytes on disk, last read or written `last_used` seconds ago."""
    cache._write_to_disk(key, "x" * size)
    path = cache._path_for_key(key)
    used_at = time.time() - last_used
    os.utime(path, (used_at, used_at))
    return path


def test_the_pages_not_read_for_the_idle_time_go(cache_dir):
    cache = PersistentCache("normattiva")
    old = _page(cache, "old", 100, 31 * DAY)
    recent = _page(cache, "recent", 100, 29 * DAY)
    size = old.stat().st_size
    removed, freed, kept = cache.prune(max_idle=30 * DAY, max_bytes=10 ** 9)
    assert (removed, freed) == (1, size)
    assert not old.exists() and recent.exists()
    assert kept == recent.stat().st_size


def test_over_the_ceiling_the_least_recently_read_go_first(cache_dir):
    cache = PersistentCache("normattiva")
    paths = [_page(cache, f"page{i}", 1000, (10 - i) * DAY) for i in range(5)]  # page0 oldest
    sizes = [path.stat().st_size for path in paths]  # the timestamp's digits vary by a byte
    removed, freed, kept = cache.prune(max_idle=30 * DAY, max_bytes=sum(sizes[2:]))
    assert removed == 2 and freed == sum(sizes[:2]) and kept == sum(sizes[2:])
    assert [path.exists() for path in paths] == [False, False, True, True, True]


def test_a_read_keeps_a_page_written_long_ago(cache_dir):
    cache = PersistentCache("normattiva", ttl=365 * DAY)
    read = _page(cache, "read", 1000, 40 * DAY)
    unread = _page(cache, "unread", 1000, 20 * DAY)
    assert cache._read_from_disk("read") == "x" * 1000  # the read refreshes its use
    size = read.stat().st_size
    cache.prune(max_idle=30 * DAY, max_bytes=size)
    assert read.exists() and not unread.exists()


def test_a_read_does_not_extend_the_entry_lifetime(cache_dir):
    """The TTL counts from the write (the timestamp inside the entry), never from the last read."""
    cache = PersistentCache("normattiva", ttl=DAY)
    path = _page(cache, "page", 10, 0)
    assert cache._read_from_disk("page") == "x" * 10
    with patch("visualex_api.tools.cache.time.time", return_value=time.time() + DAY + 1):
        assert cache._read_from_disk("page") is None
    assert not path.exists()


def test_nothing_but_the_namespace_entries_is_touched(cache_dir):
    cache = PersistentCache("normattiva")
    _page(cache, "page", 1000, 40 * DAY)
    other = PersistentCache("decisions_found")
    other_page = _page(other, "decision", 1000, 40 * DAY)
    stray = cache.directory / "notes.txt"
    stray.write_text("not an entry")
    os.utime(stray, (time.time() - 40 * DAY,) * 2)
    removed, _, kept = cache.prune(max_idle=30 * DAY, max_bytes=0)
    assert removed == 1 and kept == 0
    assert stray.exists() and other_page.exists()


def test_an_empty_namespace_prunes_nothing(cache_dir):
    assert PersistentCache("normattiva").prune(max_idle=0, max_bytes=0) == (0, 0, 0)


class _Manager:
    def __init__(self, cache):
        self.cache = cache
        self.asked = []

    def get_persistent(self, namespace):
        self.asked.append(namespace)
        return self.cache


async def test_the_rule_is_applied_to_the_normattiva_namespace_only(cache_dir):
    cache = PersistentCache("normattiva")
    _page(cache, "idle", 10, 31 * DAY)
    _page(cache, "fresh", 10, DAY)
    manager = _Manager(cache)
    assert await cache_manager.prune_normattiva_cache(manager) == 1
    assert manager.asked == ["normattiva"]


async def test_the_owner_values():
    assert cache_manager.NORMATTIVA_CACHE_MAX_IDLE == 30 * DAY
    assert cache_manager.NORMATTIVA_CACHE_MAX_BYTES == 2 * 1024 ** 3


async def test_a_backend_without_prune_is_left_to_expire_its_keys():
    """Redis expires its keys itself."""
    manager = _Manager(SimpleNamespace(get=None, set=None))
    assert await cache_manager.prune_normattiva_cache(manager) == 0


# The expired pages go first (G-344, 21 October 2026): `get` refuses an entry older than the TTL
# and deletes it, so no reader (the scraper, normattiva_validity) can use one; the 2 GB ceiling
# stays for a longer TTL or a busy day.

def _written(cache, key, size, age):
    """An entry written `age` seconds ago, as `_write_to_disk` writes it."""
    with patch("visualex_api.tools.cache.time.time", return_value=time.time() - age):
        cache._write_to_disk(key, "x" * size)
    return cache._path_for_key(key)


async def test_the_expired_pages_go_before_the_ceiling(cache_dir):
    cache = PersistentCache("normattiva", ttl=DAY)
    expired = _written(cache, "expired", 1000, 2 * DAY)
    os.utime(expired)  # read a minute ago: a read never extends an entry's life
    fresh = _written(cache, "fresh", 1000, 3600)
    assert await cache_manager.prune_normattiva_cache(_Manager(cache)) == 1
    assert not expired.exists() and fresh.exists()
    assert cache._read_from_disk("fresh") == "x" * 1000


async def test_the_ceiling_still_holds_after_the_sweep(cache_dir, monkeypatch):
    cache = PersistentCache("normattiva", ttl=DAY)
    older = _written(cache, "older", 1000, 7200)
    os.utime(older, (time.time() - 7200,) * 2)
    newer = _written(cache, "newer", 1000, 60)
    monkeypatch.setattr(cache_manager, "NORMATTIVA_CACHE_MAX_BYTES", newer.stat().st_size)
    assert await cache_manager.prune_normattiva_cache(_Manager(cache)) == 1
    assert not older.exists() and newer.exists()


def test_the_sweep_reads_an_entry_head_not_the_whole_page(cache_dir):
    """A Normattiva page is 2.6 MB: the write time is read from the first bytes."""
    cache = PersistentCache("normattiva", ttl=DAY)
    expired = _written(cache, "expired", 3_000_000, 2 * DAY)
    fresh = _written(cache, "fresh", 3_000_000, 60)
    with patch("visualex_api.tools.cache.json.load", side_effect=AssertionError("decoded")):
        assert cache.sweep_expired() == 1
    assert not expired.exists() and fresh.exists()


async def test_the_log_counts_the_expired_pages_in_freed_mb(cache_dir, monkeypatch):
    """The first start of a long-lived cache frees its space mostly through the sweep."""
    # The app configures structlog with cache_logger_on_first_use=True, so a module logger
    # used before this test would bypass capture_logs: give the module a fresh one.
    monkeypatch.setattr(cache_manager, "log", structlog.get_logger("cache_manager"))
    cache = PersistentCache("normattiva", ttl=DAY)
    expired = _written(cache, "expired", 3 * 2 ** 20, 2 * DAY)
    os.utime(expired)
    idle = _written(cache, "idle", 2 * 2 ** 20, 3600)
    os.utime(idle, (time.time() - 31 * DAY,) * 2)
    with capture_logs() as logs:
        assert await cache_manager.prune_normattiva_cache(_Manager(cache)) == 2
    [line] = [entry for entry in logs if entry["event"] == "Normattiva cache pruned"]
    assert (line["expired"], line["removed"], line["freed_mb"]) == (1, 1, 5)


def test_the_counted_sweep_returns_the_bytes_it_freed(cache_dir):
    cache = PersistentCache("normattiva", ttl=DAY)
    expired = _written(cache, "expired", 1000, 2 * DAY)
    size = expired.stat().st_size
    _written(cache, "fresh", 1000, 60)
    assert cache.sweep_expired_counted() == (1, size)


# A write is atomic (Irnerio's review of #257): a file just opened and still empty read as
# broken, and the sweep deleted it.

def test_an_entry_being_rewritten_is_never_seen_half_written(cache_dir):
    cache = PersistentCache("normattiva", ttl=DAY)
    path = _written(cache, "page", 1000, 60)
    seen = {}

    def dump_and_look(payload, handle):
        handle.write('{"timestamp": ')  # the write has begun and is not finished
        handle.flush()
        seen["swept"] = cache.sweep_expired()
        seen["read"] = cache._read_from_disk("page")
        handle.write(f'{payload["timestamp"]}, "data": "new"}}')

    with patch("visualex_api.tools.cache.json.dump", side_effect=dump_and_look):
        cache._write_to_disk("page", "new")
    assert seen == {"swept": 0, "read": "x" * 1000}
    assert cache._read_from_disk("page") == "new"
    assert sorted(p.name for p in path.parent.iterdir()) == [path.name]


def test_a_failed_write_keeps_the_old_entry_and_leaves_no_temporary(cache_dir):
    cache = PersistentCache("normattiva", ttl=DAY)
    path = _written(cache, "page", 1000, 60)
    with patch("visualex_api.tools.cache.json.dump", side_effect=TypeError("not JSON")):
        with pytest.raises(TypeError):
            cache._write_to_disk("page", object())
    assert cache._read_from_disk("page") == "x" * 1000
    assert sorted(p.name for p in path.parent.iterdir()) == [path.name]


def test_a_temporary_left_by_a_crash_goes_once_an_hour_old(cache_dir):
    cache = PersistentCache("normattiva", ttl=DAY)
    old = cache.directory / "abc.1.tmp"
    young = cache.directory / "abc.2.tmp"
    for path in (old, young):
        path.write_text('{"timestamp": ')
    os.utime(old, (time.time() - 7200,) * 2)
    assert cache.sweep_expired() == 0  # not entries: not counted
    assert not old.exists() and young.exists()
    assert cache.prune(max_idle=DAY, max_bytes=0)[0] == 0  # prune never takes one either
    assert young.exists()
