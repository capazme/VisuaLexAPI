"""
Centralized Cache Manager for VisuaLexAPI.

Provides a singleton pattern for managing both persistent (filesystem) and
in-memory caches across all services. This ensures cache sharing and enables
statistics tracking.
"""

import asyncio
import time
from typing import Any, Dict, Optional
import structlog

from .cache import PersistentCache
from .config import PERSISTENT_CACHE_TTL

log = structlog.get_logger()


class CacheManager:
    """
    Singleton cache manager combining persistent and in-memory caching.
    
    Provides:
    - Shared cache instances across all services
    - Hit/miss statistics for monitoring
    - Namespace separation for different data sources
    - Async-safe warmup coordination
    """
    _instance: Optional["CacheManager"] = None
    _lock = asyncio.Lock()
    
    def __new__(cls) -> "CacheManager":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def _init_caches(self) -> None:
        """Initialize cache namespaces if not already done."""
        if self._initialized:
            return
            
        log.info("Initializing centralized cache manager")
        
        # Persistent caches by namespace
        self.persistent: Dict[str, PersistentCache] = {
            "normattiva": PersistentCache("normattiva", ttl=PERSISTENT_CACHE_TTL),
            "eurlex": PersistentCache("eurlex", ttl=PERSISTENT_CACHE_TTL),
            "brocardi": PersistentCache("brocardi", ttl=PERSISTENT_CACHE_TTL),
            "tree": PersistentCache("tree", ttl=PERSISTENT_CACHE_TTL),
        }
        
        # Statistics tracking
        self.stats: Dict[str, int] = {
            "hits": 0,
            "misses": 0,
            "warmup_count": 0,
        }
        
        # Warmup state
        self._warmup_complete = False
        self._warmup_started = False
        
        self._initialized = True
        log.info("Cache manager initialized", namespaces=list(self.persistent.keys()))
    
    def get_persistent(self, namespace: str) -> PersistentCache:
        """
        Get a persistent cache by namespace.
        
        Args:
            namespace: The cache namespace (e.g., 'normattiva', 'eurlex')
            
        Returns:
            The PersistentCache instance for the namespace
            
        Raises:
            KeyError: If namespace doesn't exist
        """
        self._init_caches()
        if namespace not in self.persistent:
            log.warning("Unknown cache namespace, creating new", namespace=namespace)
            self.persistent[namespace] = PersistentCache(namespace, ttl=PERSISTENT_CACHE_TTL)
        return self.persistent[namespace]
    
    async def get(self, namespace: str, key: str) -> Optional[Any]:
        """
        Get a value from the persistent cache with stats tracking.
        
        Args:
            namespace: The cache namespace
            key: The cache key
            
        Returns:
            The cached value or None if not found
        """
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
        """
        Set a value in the persistent cache.
        
        Args:
            namespace: The cache namespace
            key: The cache key
            value: The value to cache
        """
        self._init_caches()
        cache = self.get_persistent(namespace)
        await cache.set(key, value)
        log.debug("Cache set", namespace=namespace, key=key[:50])
    
    def get_stats(self) -> Dict[str, Any]:
        """
        Get cache statistics.
        
        Returns:
            Dictionary with hit/miss counts and hit rate
        """
        self._init_caches()
        total = self.stats["hits"] + self.stats["misses"]
        hit_rate = self.stats["hits"] / total if total > 0 else 0.0
        
        return {
            **self.stats,
            "total_requests": total,
            "hit_rate": round(hit_rate * 100, 2),
            "warmup_complete": self._warmup_complete,
        }
    
    def mark_warmup_started(self) -> bool:
        """
        Mark warmup as started. Returns False if already started.
        Thread-safe check to prevent duplicate warmups.
        """
        self._init_caches()
        if self._warmup_started:
            return False
        self._warmup_started = True
        return True
    
    def mark_warmup_complete(self, count: int) -> None:
        """Mark warmup as complete with the number of items warmed."""
        self._init_caches()
        self._warmup_complete = True
        self.stats["warmup_count"] = count
        log.info("Cache warmup marked complete", count=count)


# Global singleton accessor
_cache_manager: Optional[CacheManager] = None


def get_cache_manager() -> CacheManager:
    """
    Get the global CacheManager singleton instance.
    
    Returns:
        The CacheManager instance
    """
    global _cache_manager
    if _cache_manager is None:
        _cache_manager = CacheManager()
        _cache_manager._init_caches()
    return _cache_manager
