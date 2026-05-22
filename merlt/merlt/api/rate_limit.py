"""
Rate Limiting Middleware
========================

Redis-based sliding window rate limiting per API key tier.

Tiers:
- unlimited: 999999 req/h
- premium: 1000 req/h
- standard: 100 req/h
- limited: 10 req/h

Response headers:
- X-RateLimit-Limit: Max requests in window
- X-RateLimit-Remaining: Requests remaining
- X-RateLimit-Used: Requests used
- X-RateLimit-Reset: Unix timestamp when window resets

Graceful degradation: allows requests if Redis is unavailable.

Usage:
    from merlt.api.rate_limit import check_rate_limit

    @router.post("/query")
    async def query(
        api_key: ApiKey = Depends(verify_api_key),
        _rate_limit: None = Depends(check_rate_limit),
    ):
        ...
"""

import os
import time
import structlog
from typing import Optional

from fastapi import Depends, HTTPException, Request, Response

from merlt.experts.models import ApiKey
from merlt.api.auth import verify_api_key

log = structlog.get_logger()

# Rate limit quotas per tier (requests per window)
RATE_LIMIT_QUOTAS = {
    "unlimited": 999999,
    "premium": 1000,
    "standard": 100,
    "limited": 10,
}

# Sliding window in seconds (1 hour)
RATE_LIMIT_WINDOW = 3600

# Redis connection singleton
_redis_client = None
_redis_checked = False


async def _get_redis():
    """
    Get or create Redis async client. Returns None if unavailable.
    """
    global _redis_client, _redis_checked

    if _redis_checked and _redis_client is None:
        return None

    if _redis_client is not None:
        return _redis_client

    _redis_checked = True
    try:
        import redis.asyncio as aioredis
        client = aioredis.Redis(
            host=os.environ.get("REDIS_HOST", "localhost"),
            port=int(os.environ.get("REDIS_PORT", "6379")),
            db=int(os.environ.get("REDIS_RATE_LIMIT_DB", "1")),
            decode_responses=True,
            socket_connect_timeout=2,
        )
        await client.ping()
        _redis_client = client
        log.info("Rate limit Redis connected")
        return _redis_client
    except Exception as e:
        log.warning("Rate limit Redis unavailable, allowing all requests", error=str(e))
        _redis_client = None
        return None


async def check_rate_limit(
    request: Request,
    response: Response,
    api_key: ApiKey = Depends(verify_api_key),
) -> None:
    """
    Sliding window rate limiter using Redis sorted sets.

    Adds rate limit headers to every response.
    Returns 429 Too Many Requests when limit exceeded.
    Graceful degradation: allows request if Redis is unavailable.
    """
    tier = api_key.rate_limit_tier or "standard"
    limit = RATE_LIMIT_QUOTAS.get(tier, RATE_LIMIT_QUOTAS["standard"])

    redis = await _get_redis()
    if redis is None:
        # Graceful degradation: set headers with unknown remaining
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(limit)
        response.headers["X-RateLimit-Used"] = "0"
        response.headers["X-RateLimit-Reset"] = str(int(time.time()) + RATE_LIMIT_WINDOW)
        return

    now = time.time()
    window_start = now - RATE_LIMIT_WINDOW
    redis_key = f"rate_limit:{api_key.key_id}"

    try:
        pipe = redis.pipeline()
        # Remove expired entries
        pipe.zremrangebyscore(redis_key, "-inf", window_start)
        # Count current requests in window
        pipe.zcard(redis_key)
        # Add current request
        pipe.zadd(redis_key, {f"{now}:{id(request)}": now})
        # Set TTL on the key
        pipe.expire(redis_key, RATE_LIMIT_WINDOW + 60)
        results = await pipe.execute()

        used = results[1]  # zcard before adding current request
    except Exception as e:
        log.warning("Rate limit Redis error, allowing request", error=str(e))
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(limit)
        response.headers["X-RateLimit-Used"] = "0"
        response.headers["X-RateLimit-Reset"] = str(int(time.time()) + RATE_LIMIT_WINDOW)
        return

    remaining = max(0, limit - used - 1)
    reset_at = int(now) + RATE_LIMIT_WINDOW

    # Set response headers
    response.headers["X-RateLimit-Limit"] = str(limit)
    response.headers["X-RateLimit-Remaining"] = str(remaining)
    response.headers["X-RateLimit-Used"] = str(used + 1)
    response.headers["X-RateLimit-Reset"] = str(reset_at)

    if used >= limit:
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded. Limit: {limit} requests per hour. "
                   f"Retry after {RATE_LIMIT_WINDOW} seconds.",
            headers={
                "Retry-After": str(RATE_LIMIT_WINDOW),
                "X-RateLimit-Limit": str(limit),
                "X-RateLimit-Remaining": "0",
                "X-RateLimit-Used": str(used),
                "X-RateLimit-Reset": str(reset_at),
            },
        )
