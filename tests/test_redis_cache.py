"""Tests for RedisCache and CacheManager Redis integration."""

import asyncio
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from visualex_api.tools.redis_cache import RedisCache


@pytest.fixture
def redis_cache():
    """Create a RedisCache instance for testing."""
    cache = RedisCache("test_ns", ttl=3600)
    return cache


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
        result = await redis_cache.get("any_key")
        assert result is None

    @pytest.mark.asyncio
    async def test_set_noop_when_redis_unavailable(self, redis_cache):
        redis_cache._connect_failed = True
        await redis_cache.set("any_key", {"data": "test"})
        # Should not raise

    @pytest.mark.asyncio
    async def test_get_returns_cached_data(self, redis_cache):
        mock_client = AsyncMock()
        cached_payload = json.dumps({"timestamp": 1000, "data": {"text": "article content"}})
        mock_client.get = AsyncMock(return_value=cached_payload)
        mock_client.ping = AsyncMock()
        redis_cache._client = mock_client

        result = await redis_cache.get("test_urn")
        assert result == {"text": "article content"}

    @pytest.mark.asyncio
    async def test_get_returns_none_on_cache_miss(self, redis_cache):
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=None)
        mock_client.ping = AsyncMock()
        redis_cache._client = mock_client

        result = await redis_cache.get("nonexistent_key")
        assert result is None

    @pytest.mark.asyncio
    async def test_set_calls_setex_with_ttl(self, redis_cache):
        mock_client = AsyncMock()
        mock_client.setex = AsyncMock()
        mock_client.ping = AsyncMock()
        redis_cache._client = mock_client

        await redis_cache.set("test_key", {"text": "hello"})

        mock_client.setex.assert_called_once()
        args = mock_client.setex.call_args
        assert args[0][0] == redis_cache._make_key("test_key")
        assert args[0][1] == 3600  # TTL
        payload = json.loads(args[0][2])
        assert payload["data"] == {"text": "hello"}

    @pytest.mark.asyncio
    async def test_get_handles_malformed_json_gracefully(self, redis_cache):
        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value="not valid json{{{")
        mock_client.ping = AsyncMock()
        redis_cache._client = mock_client

        result = await redis_cache.get("bad_key")
        assert result is None

    @pytest.mark.asyncio
    async def test_delete_removes_key(self, redis_cache):
        mock_client = AsyncMock()
        mock_client.delete = AsyncMock()
        mock_client.ping = AsyncMock()
        redis_cache._client = mock_client

        await redis_cache.delete("test_key")
        mock_client.delete.assert_called_once_with(redis_cache._make_key("test_key"))


class TestRedisCacheConnection:
    @pytest.mark.asyncio
    async def test_connect_failed_flag_prevents_retries(self, redis_cache):
        redis_cache._connect_failed = True
        client = await redis_cache._get_client()
        assert client is None

    @pytest.mark.asyncio
    async def test_existing_client_returned(self, redis_cache):
        mock_client = AsyncMock()
        redis_cache._client = mock_client
        client = await redis_cache._get_client()
        assert client is mock_client


class TestCacheManagerBackendSelection:
    def test_filesystem_backend_when_redis_disabled(self):
        with patch("visualex_api.tools.cache_manager.REDIS_ENABLED", False):
            from visualex_api.tools.cache_manager import _create_cache
            from visualex_api.tools.cache import PersistentCache
            cache = _create_cache("test", ttl=3600)
            assert isinstance(cache, PersistentCache)

    def test_redis_backend_when_enabled(self):
        with patch("visualex_api.tools.cache_manager.REDIS_ENABLED", True):
            from visualex_api.tools.cache_manager import _create_cache
            from visualex_api.tools.redis_cache import RedisCache
            cache = _create_cache("test", ttl=3600)
            assert isinstance(cache, RedisCache)
