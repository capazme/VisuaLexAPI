"""Tests for RedisCache, PersistentCache, and CacheManager integration."""

import json
import time
import pytest
from unittest.mock import AsyncMock, patch

from visualex_api.tools.redis_cache import RedisCache, _RETRY_BACKOFF_SECONDS
from visualex_api.tools.cache_manager import _create_cache
from visualex_api.tools.cache import PersistentCache


@pytest.fixture
def redis_cache():
    """Create a RedisCache instance for testing."""
    return RedisCache("test_ns", ttl=3600)


class TestRedisCacheKeyGeneration:
    def test_make_key_deterministic(self, redis_cache):
        key1 = redis_cache._make_key("urn:nir:stato:legge:1942-03-16;262")
        key2 = redis_cache._make_key("urn:nir:stato:legge:1942-03-16;262")
        assert key1 == key2

    def test_make_key_includes_namespace(self, redis_cache):
        key = redis_cache._make_key("some_key")
        assert ":test_ns:" in key

    def test_make_key_includes_prefix(self, redis_cache):
        key = redis_cache._make_key("some_key")
        assert key.startswith("vlx:")

    def test_different_keys_produce_different_hashes(self, redis_cache):
        key1 = redis_cache._make_key("key_a")
        key2 = redis_cache._make_key("key_b")
        assert key1 != key2


class TestRedisCacheGetSet:
    @pytest.mark.asyncio
    async def test_get_returns_none_when_redis_unavailable(self, redis_cache):
        redis_cache._connect_failed = True
        redis_cache._retry_after = time.monotonic() + 9999
        result = await redis_cache.get("any_key")
        assert result is None

    @pytest.mark.asyncio
    async def test_set_noop_when_redis_unavailable(self, redis_cache):
        redis_cache._connect_failed = True
        redis_cache._retry_after = time.monotonic() + 9999
        await redis_cache.set("any_key", {"data": "test"})

    @pytest.mark.asyncio
    async def test_get_returns_cached_data(self, redis_cache):
        mock_client = AsyncMock()
        cached_payload = json.dumps({"timestamp": 1000, "data": {"text": "article content"}})
        mock_client.get = AsyncMock(return_value=cached_payload)
        redis_cache._client = mock_client

        result = await redis_cache.get("test_urn")
        assert result == {"text": "article content"}

    @pytest.mark.asyncio
    async def test_get_returns_none_on_cache_miss(self, redis_cache):
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=None)
        redis_cache._client = mock_client

        result = await redis_cache.get("nonexistent_key")
        assert result is None

    @pytest.mark.asyncio
    async def test_set_calls_setex_with_ttl(self, redis_cache):
        mock_client = AsyncMock()
        mock_client.setex = AsyncMock()
        redis_cache._client = mock_client

        await redis_cache.set("test_key", {"text": "hello"})

        mock_client.setex.assert_called_once()
        args = mock_client.setex.call_args
        assert args[0][0] == redis_cache._make_key("test_key")
        assert args[0][1] == 3600
        payload = json.loads(args[0][2])
        assert payload["data"] == {"text": "hello"}

    @pytest.mark.asyncio
    async def test_get_handles_malformed_json_gracefully(self, redis_cache):
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value="not valid json{{{")
        redis_cache._client = mock_client

        result = await redis_cache.get("bad_key")
        assert result is None

    @pytest.mark.asyncio
    async def test_delete_removes_key(self, redis_cache):
        mock_client = AsyncMock()
        mock_client.delete = AsyncMock()
        redis_cache._client = mock_client

        await redis_cache.delete("test_key")
        mock_client.delete.assert_called_once_with(redis_cache._make_key("test_key"))


class TestRedisCacheConnection:
    @pytest.mark.asyncio
    async def test_connect_failed_blocks_until_retry_window(self, redis_cache):
        redis_cache._connect_failed = True
        redis_cache._retry_after = time.monotonic() + 9999
        client = await redis_cache._get_client()
        assert client is None

    @pytest.mark.asyncio
    async def test_retry_after_backoff_elapsed(self, redis_cache):
        redis_cache._connect_failed = True
        redis_cache._retry_after = time.monotonic() - 1  # expired
        mock_client = AsyncMock()
        mock_client.ping = AsyncMock()
        with patch("visualex_api.tools.redis_cache.aioredis") as mock_aioredis:
            mock_aioredis.from_url.return_value = mock_client
            client = await redis_cache._get_client()
            assert client is mock_client
            assert redis_cache._connect_failed is False

    @pytest.mark.asyncio
    async def test_existing_client_returned(self, redis_cache):
        mock_client = AsyncMock()
        redis_cache._client = mock_client
        client = await redis_cache._get_client()
        assert client is mock_client

    @pytest.mark.asyncio
    async def test_connection_failure_sets_retry_after(self, redis_cache):
        with patch("visualex_api.tools.redis_cache.aioredis") as mock_aioredis:
            mock_aioredis.from_url.side_effect = ConnectionError("refused")
            client = await redis_cache._get_client()
            assert client is None
            assert redis_cache._connect_failed is True
            assert redis_cache._retry_after > time.monotonic()


class TestCacheManagerBackendSelection:
    def test_filesystem_backend_when_redis_disabled(self):
        with patch("visualex_api.tools.cache_manager.REDIS_ENABLED", False):
            cache = _create_cache("test_fs", ttl=3600)
            assert isinstance(cache, PersistentCache)

    def test_redis_backend_when_enabled(self):
        with patch("visualex_api.tools.cache_manager.REDIS_ENABLED", True):
            cache = _create_cache("test_redis", ttl=3600)
            assert isinstance(cache, RedisCache)


class TestPersistentCacheDelete:
    @pytest.mark.asyncio
    async def test_delete_removes_cached_entry(self, tmp_path):
        with patch("visualex_api.tools.cache.PERSISTENT_CACHE_DIR", str(tmp_path)):
            cache = PersistentCache("del_test", ttl=3600)
            cache.directory = tmp_path / "del_test"
            cache.directory.mkdir(parents=True, exist_ok=True)
            await cache.set("mykey", {"value": 42})
            result = await cache.get("mykey")
            assert result == {"value": 42}
            await cache.delete("mykey")
            result = await cache.get("mykey")
            assert result is None

    @pytest.mark.asyncio
    async def test_delete_noop_on_missing_key(self, tmp_path):
        with patch("visualex_api.tools.cache.PERSISTENT_CACHE_DIR", str(tmp_path)):
            cache = PersistentCache("del_test2", ttl=3600)
            cache.directory = tmp_path / "del_test2"
            cache.directory.mkdir(parents=True, exist_ok=True)
            await cache.delete("nonexistent")  # should not raise
