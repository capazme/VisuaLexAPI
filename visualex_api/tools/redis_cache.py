"""
Redis-backed cache implementation for VisuaLexAPI.

Drop-in replacement for PersistentCache (filesystem) with the same
async get/set interface. Falls back gracefully if Redis is unavailable.
"""

import json
import time
from typing import Any, Optional

import structlog

from .config import PERSISTENT_CACHE_TTL, REDIS_CACHE_PREFIX, REDIS_URL

log = structlog.get_logger()

try:
    import redis.asyncio as aioredis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False
    log.warning("redis package not installed, RedisCache unavailable")


class RedisCache:
    """
    Async Redis-backed cache with the same interface as PersistentCache.

    Cache entries are stored as JSON strings with a TTL managed by Redis.
    Key format: {prefix}:{namespace}:{sha256(key)}
    """

    def __init__(self, namespace: str, ttl: int = PERSISTENT_CACHE_TTL) -> None:
        self.namespace = namespace
        self.ttl = ttl
        self._prefix = REDIS_CACHE_PREFIX
        self._client: Optional["aioredis.Redis"] = None
        self._connect_failed = False

    def _make_key(self, key: str) -> str:
        import hashlib
        digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
        return f"{self._prefix}:{self.namespace}:{digest}"

    async def _get_client(self) -> Optional["aioredis.Redis"]:
        if not REDIS_AVAILABLE:
            return None
        if self._connect_failed:
            return None
        if self._client is not None:
            return self._client
        try:
            self._client = aioredis.from_url(
                REDIS_URL,
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=2,
            )
            await self._client.ping()
            log.info("Redis connected", namespace=self.namespace)
            return self._client
        except Exception as exc:
            log.warning("Redis connection failed, cache disabled", error=str(exc))
            self._connect_failed = True
            self._client = None
            return None

    async def get(self, key: str) -> Optional[Any]:
        client = await self._get_client()
        if client is None:
            return None
        try:
            raw = await client.get(self._make_key(key))
            if raw is None:
                return None
            payload = json.loads(raw)
            return payload.get("data")
        except Exception as exc:
            log.debug("Redis get error", error=str(exc), key=key[:50])
            return None

    async def set(self, key: str, value: Any) -> None:
        client = await self._get_client()
        if client is None:
            return
        try:
            payload = json.dumps({"timestamp": time.time(), "data": value})
            await client.setex(self._make_key(key), self.ttl, payload)
        except Exception as exc:
            log.debug("Redis set error", error=str(exc), key=key[:50])

    async def delete(self, key: str) -> None:
        client = await self._get_client()
        if client is None:
            return
        try:
            await client.delete(self._make_key(key))
        except Exception:
            pass

    async def close(self) -> None:
        if self._client is not None:
            await self._client.close()
            self._client = None
