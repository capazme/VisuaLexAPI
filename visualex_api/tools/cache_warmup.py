"""
Cache Warmup Service for VisuaLexAPI.

Pre-fetches and caches frequently used legal norms at startup to improve
response times for common requests.
"""

import asyncio
from typing import List, Tuple
import structlog

from .cache_manager import get_cache_manager
from .map import NORMATTIVA_URN_CODICI
from .urngenerator import generate_urn
from .treextractor import get_tree

log = structlog.get_logger()

# Priority norms to pre-warm at startup
# These are the most commonly accessed codes and laws
PRIORITY_NORMS: List[Tuple[str, str]] = [
    ("costituzione", "Costituzione"),
    ("codice civile", "Codice Civile"),
    ("codice penale", "Codice Penale"),
    ("codice di procedura civile", "Codice di Procedura Civile"),
    ("codice di procedura penale", "Codice di Procedura Penale"),
    ("codice dei contratti pubblici", "Codice dei Contratti Pubblici"),
    ("codice del consumo", "Codice del Consumo"),
    ("codice della strada", "Codice della Strada"),
]


async def warmup_single_norm(
    norm_key: str, 
    norm_name: str,
    delay: float = 0.5
) -> bool:
    """
    Warm cache for a single norm.
    
    Args:
        norm_key: The normalized key for the norm (e.g., 'codice civile')
        norm_name: Display name for logging
        delay: Delay between requests to avoid rate limiting
        
    Returns:
        True if successful, False otherwise
    """
    try:
        # Generate the URN for this norm
        urn = generate_urn(act_type=norm_key, urn_flag=True)
        
        if not urn:
            log.warning("Could not generate URN for warmup", norm=norm_name)
            return False
        
        # Pre-fetch the tree structure (which also caches the document)
        result, count = await get_tree(urn, link=True, details=False)
        
        if count > 0:
            log.info("Warmed cache", norm=norm_name, articles=count)
            return True
        else:
            log.warning("No articles found during warmup", norm=norm_name)
            return False
            
    except Exception as e:
        log.warning("Warmup failed for norm", norm=norm_name, error=str(e))
        return False
    finally:
        # Rate limiting delay between requests
        await asyncio.sleep(delay)


async def warmup_cache(
    norms: List[Tuple[str, str]] = None,
    delay: float = 0.5
) -> int:
    """
    Pre-fetch and cache priority norms at startup.
    
    Should be called once at application startup, preferably as a background task
    to not block server initialization.
    
    Args:
        norms: Optional list of (norm_key, norm_name) tuples. Defaults to PRIORITY_NORMS.
        delay: Delay between requests in seconds.
        
    Returns:
        Number of successfully warmed norms.
    """
    cache_manager = get_cache_manager()
    
    # Prevent duplicate warmups
    if not cache_manager.mark_warmup_started():
        log.info("Cache warmup already in progress or complete")
        return 0
    
    if norms is None:
        norms = PRIORITY_NORMS
    
    log.info("Starting cache warmup", norm_count=len(norms))
    
    success_count = 0
    
    for norm_key, norm_name in norms:
        if await warmup_single_norm(norm_key, norm_name, delay):
            success_count += 1
    
    cache_manager.mark_warmup_complete(success_count)
    
    log.info(
        "Cache warmup complete",
        successful=success_count,
        total=len(norms),
        stats=cache_manager.get_stats()
    )
    
    return success_count


async def warmup_cache_background() -> None:
    """
    Wrapper for warmup_cache that catches all exceptions.
    Use this when scheduling as a background task.
    """
    try:
        await warmup_cache()
    except Exception as e:
        log.error("Cache warmup failed unexpectedly", error=str(e), exc_info=True)
