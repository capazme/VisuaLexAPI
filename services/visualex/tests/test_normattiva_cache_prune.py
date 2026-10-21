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
