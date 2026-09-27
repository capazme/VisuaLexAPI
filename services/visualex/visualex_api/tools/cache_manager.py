"""
Centralized Cache Manager for VisuaLexAPI.

Provides a singleton pattern for managing caches across all services.
Uses Redis when available and enabled, falling back to filesystem cache.
"""

import time
from typing import Any, Dict, Optional, Union
import structlog

from .cache import PersistentCache
from .config import PERSISTENT_CACHE_TTL, REDIS_ENABLED

log = structlog.get_logger()

CacheBackend = Any  # PersistentCache or RedisCache — same async get/set interface


_redis_fallback_warned = False


def _create_cache(namespace: str, ttl: int) -> CacheBackend:
    """Create a cache backend: Redis if enabled and available, else filesystem."""
    global _redis_fallback_warned
    if REDIS_ENABLED:
        try:
            from .redis_cache import RedisCache, REDIS_AVAILABLE
            if REDIS_AVAILABLE:
                return RedisCache(namespace, ttl=ttl)
            if not _redis_fallback_warned:
                log.warning(
                    "REDIS_ENABLED=true but redis package not installed — falling back to filesystem cache",
                )
                _redis_fallback_warned = True
        except ImportError:
            if not _redis_fallback_warned:
                log.warning(
                    "REDIS_ENABLED=true but redis_cache import failed — falling back to filesystem cache",
                )
                _redis_fallback_warned = True
    elif not _redis_fallback_warned:
        log.info(
            "REDIS_ENABLED=false — using filesystem cache. Set REDIS_ENABLED=true to share cache across instances.",
        )
        _redis_fallback_warned = True
    return PersistentCache(namespace, ttl=ttl)


class CacheManager:
    """
    Singleton cache manager with automatic backend selection.

    When REDIS_ENABLED=true and the redis package is installed, uses Redis.
    Otherwise falls back to filesystem-backed PersistentCache.
    Both backends share the same async get/set interface.
    """
    _instance: Optional["CacheManager"] = None

    def __new__(cls) -> "CacheManager":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def _init_caches(self) -> None:
        if self._initialized:
            return

        log.info("Initializing centralized cache manager", redis_enabled=REDIS_ENABLED)

        self.persistent: Dict[str, CacheBackend] = {
            "normattiva": _create_cache("normattiva", ttl=PERSISTENT_CACHE_TTL),
            "eurlex": _create_cache("eurlex", ttl=PERSISTENT_CACHE_TTL),
            "brocardi": _create_cache("brocardi", ttl=PERSISTENT_CACHE_TTL),
            "tree": _create_cache("tree", ttl=PERSISTENT_CACHE_TTL),
        }

        self.stats: Dict[str, int] = {
            "hits": 0,
            "misses": 0,
            "warmup_count": 0,
        }

        self._warmup_complete = False
        self._warmup_started = False

        self._initialized = True
        backend_type = type(next(iter(self.persistent.values()))).__name__
        log.info(
            "Cache manager initialized",
            namespaces=list(self.persistent.keys()),
            backend=backend_type,
        )

    def get_persistent(self, namespace: str) -> CacheBackend:
        self._init_caches()
        if namespace not in self.persistent:
            log.warning("Unknown cache namespace, creating new", namespace=namespace)
            self.persistent[namespace] = _create_cache(namespace, ttl=PERSISTENT_CACHE_TTL)
        return self.persistent[namespace]

    async def get(self, namespace: str, key: str) -> Optional[Any]:
        self._init_caches()
        cache = self.get_persistent(namespace)
        value = await cache.get(key)

        if value is not None:
            self.stats["hits"] += 1
            log.debug("Cache hit", namespace=namespace, key=key[:50])
        else:
            self.stats["misses"] += 1
            log.debug("Cache miss", namespace=namespace, key=key[:50])

        return value

    async def set(self, namespace: str, key: str, value: Any) -> None:
        self._init_caches()
        cache = self.get_persistent(namespace)
        await cache.set(key, value)
        log.debug("Cache set", namespace=namespace, key=key[:50])

    def get_stats(self) -> Dict[str, Any]:
        self._init_caches()
        total = self.stats["hits"] + self.stats["misses"]
        hit_rate = self.stats["hits"] / total if total > 0 else 0.0
        backend_type = type(next(iter(self.persistent.values()))).__name__

        return {
            **self.stats,
            "total_requests": total,
            "hit_rate": round(hit_rate * 100, 2),
            "warmup_complete": self._warmup_complete,
            "backend": backend_type,
        }

    def mark_warmup_started(self) -> bool:
        self._init_caches()
        if self._warmup_started:
            return False
        self._warmup_started = True
        return True

    def mark_warmup_complete(self, count: int) -> None:
        self._init_caches()
        self._warmup_complete = True
        self.stats["warmup_count"] = count
        log.info("Cache warmup marked complete", count=count)


_cache_manager: Optional[CacheManager] = None


def get_cache_manager() -> CacheManager:
    global _cache_manager
    if _cache_manager is None:
        _cache_manager = CacheManager()
        _cache_manager._init_caches()
    return _cache_manager
