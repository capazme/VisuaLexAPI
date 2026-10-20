"""
Centralized Cache Manager for VisuaLexAPI.

Provides a singleton pattern for managing caches across all services.
Uses Redis when available and enabled, falling back to filesystem cache.
"""

import asyncio
from typing import Any, Dict, Optional
import structlog

from .cache import PersistentCache
from .config import PERSISTENT_CACHE_TTL, REDIS_ENABLED

log = structlog.get_logger()

CacheBackend = Any  # PersistentCache or RedisCache — same async get/set interface

# The Union's courts' decisions that cite an article: three days. CELLAR answers in under a second
# (0.06 to 0.8 s measured on 13 October 2026), so the cache spares the endpoint rather than the
# reader. The citation fragments are indexed late (weeks), so a fresher list would not be a more
# complete one.
EU_CASE_LAW_TTL = 3 * 24 * 3600

# The Normattiva pages: an article page of a code weighs 2.6 MB on disk, and the filesystem cache
# deletes an entry only when its key is read again, so the folder only grew (5.6 GB in
# development, 20 October 2026). The owner's rules (21 October 2026): the expired pages go, as
# for the decisions (G-344; `get` would refuse them anyway), then the pages not read for 30 days
# and the least recently read ones down to 2 GB, a ceiling for a longer PERSISTENT_CACHE_TTL or a
# busy day (G-338).
NORMATTIVA_CACHE_MAX_IDLE = 30 * 24 * 3600
NORMATTIVA_CACHE_MAX_BYTES = 2 * 1024 ** 3


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
            # Court decisions (design 2026-10-01 §3): a deposited decision does not change;
            # "not found" is kept for an hour because indexing lags; a decision found without
            # its text (withheld by the source while it removes personal data, or missing at
            # the source), or read from the archive's text field rather than the court's PDF, is kept
            # for a day. The PDFs' bytes are kept a month (decisions_pdf).
            "decisions_found": _create_cache("decisions_found", ttl=30 * 24 * 3600),
            "decisions_pdf": _create_cache("decisions_pdf", ttl=30 * 24 * 3600),
            "decisions_absent": _create_cache("decisions_absent", ttl=3600),
            "decisions_pending": _create_cache("decisions_pending", ttl=24 * 3600),
            # One page of /search_decisions, per query: a day.
            "decisions_search": _create_cache("decisions_search", ttl=24 * 3600),
            # The Union's courts' decisions that cite an article (decisions/eu_case_law.py).
            "eu_case_law": _create_cache("eu_case_law", ttl=EU_CASE_LAW_TTL),
            # A found act date never changes: keep it a year (act_dates.py).
            "act_dates": _create_cache("act_dates", ttl=365 * 24 * 3600),
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


async def prune_normattiva_cache(manager: Optional["CacheManager"] = None) -> int:
    """Apply the Normattiva cache's rules: the expired pages, then NORMATTIVA_CACHE_MAX_IDLE and
    NORMATTIVA_CACHE_MAX_BYTES. Return how many pages went. Only the "normattiva" namespace:
    the other caches keep their own lifetimes. A backend without `prune` (Redis) expires its
    keys itself. The app runs this at start and with the decision caches' sweep."""
    cache = (manager or get_cache_manager()).get_persistent("normattiva")
    prune = getattr(cache, "prune", None)
    if prune is None:
        return 0
    expired = await asyncio.to_thread(cache.sweep_expired)
    removed, freed, kept = await asyncio.to_thread(
        prune, NORMATTIVA_CACHE_MAX_IDLE, NORMATTIVA_CACHE_MAX_BYTES)
    log.info("Normattiva cache pruned", expired=expired, removed=removed,
             freed_mb=round(freed / 2 ** 20), kept_mb=round(kept / 2 ** 20))
    return expired + removed


_cache_manager: Optional[CacheManager] = None


def get_cache_manager() -> CacheManager:
    global _cache_manager
    if _cache_manager is None:
        _cache_manager = CacheManager()
        _cache_manager._init_caches()
    return _cache_manager
