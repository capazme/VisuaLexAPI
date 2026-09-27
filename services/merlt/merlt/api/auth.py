"""
API Key Authentication Middleware
==================================

Provides FastAPI dependencies for API key verification and role-based access.

Dependencies:
- verify_api_key: Validates X-API-Key header, checks active/expired, updates last_used_at
- require_role: Factory for role-based authorization (403 if insufficient)
- optional_api_key: Returns ApiKey or None for public endpoints

Usage:
    from merlt.api.auth import verify_api_key, require_role

    @router.post("/query")
    async def query(api_key: ApiKey = Depends(verify_api_key)):
        ...

    @router.post("/admin-action")
    async def admin_action(api_key: ApiKey = Depends(require_role("admin"))):
        ...
"""

import hashlib
import structlog
import jwt as pyjwt
from datetime import datetime
from typing import Optional, Union

from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from merlt.experts.models import ApiKey
from merlt.rlcf.database import get_async_session_dep

log = structlog.get_logger()


def hash_api_key(key: str) -> str:
    """Compute SHA-256 hex digest of an API key."""
    return hashlib.sha256(key.encode()).hexdigest()


async def verify_api_key(
    x_api_key: str = Header(..., alias="X-API-Key"),
    session: AsyncSession = Depends(get_async_session_dep),
) -> ApiKey:
    """
    Validate API key from X-API-Key header.

    Checks:
    1. Key exists in database (by hash)
    2. Key is active
    3. Key is not expired

    Updates last_used_at on success.

    Raises:
        HTTPException 401: Invalid, inactive, or expired key
    """
    key_hash = hash_api_key(x_api_key)

    result = await session.execute(
        select(ApiKey).where(ApiKey.api_key_hash == key_hash)
    )
    api_key = result.scalar_one_or_none()

    if api_key is None:
        raise HTTPException(status_code=401, detail="Invalid API key")

    if not api_key.is_active:
        raise HTTPException(status_code=401, detail="API key is inactive")

    if api_key.is_expired():
        raise HTTPException(status_code=401, detail="API key has expired")

    # Update last_used_at
    api_key.last_used_at = datetime.utcnow()
    await session.commit()

    return api_key


def require_role(roles: Union[str, list]) -> object:
    """
    Factory that returns a Depends-compatible callable requiring specific role(s).

    Usage:
        @router.post("/admin")
        async def admin_action(api_key: ApiKey = Depends(require_role("admin"))):
            ...

        @router.get("/data")
        async def get_data(api_key: ApiKey = Depends(require_role(["admin", "user"]))):
            ...
    """
    if isinstance(roles, str):
        allowed = [roles]
    else:
        allowed = list(roles)

    async def _check_role(
        api_key: ApiKey = Depends(verify_api_key),
    ) -> ApiKey:
        if api_key is None:
            raise HTTPException(status_code=401, detail="API key required")
        if api_key.role not in allowed:
            raise HTTPException(
                status_code=403,
                detail=f"Role '{api_key.role}' not authorized. Required: {allowed}",
            )
        return api_key

    return _check_role


async def get_current_user_id(
    authorization: Optional[str] = Header(None, alias="Authorization"),
) -> Optional[str]:
    """Extract user_id from JWT Bearer token. Returns None if no/invalid token."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization[7:]
    try:
        payload = pyjwt.decode(
            token,
            options={"verify_signature": False, "verify_exp": False},
            algorithms=["HS256"],
        )
        return payload.get("userId") or payload.get("user_id") or payload.get("sub")
    except Exception:
        return None


async def optional_api_key(
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    session: AsyncSession = Depends(get_async_session_dep),
) -> Optional[ApiKey]:
    """
    Optional API key validation for public endpoints.

    Returns ApiKey if a valid key is provided, None otherwise.
    Does not raise on missing/invalid key.
    """
    if x_api_key is None:
        return None

    key_hash = hash_api_key(x_api_key)

    result = await session.execute(
        select(ApiKey).where(ApiKey.api_key_hash == key_hash)
    )
    api_key = result.scalar_one_or_none()

    if api_key is None or not api_key.is_active or api_key.is_expired():
        return None

    api_key.last_used_at = datetime.utcnow()
    await session.commit()

    return api_key
