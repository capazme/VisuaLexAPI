"""
API Keys Management Router
============================

CRUD endpoints for API key management (FR45).

Endpoints:
- POST /api-keys/bootstrap: Create first admin key (no auth, only if table empty)
- POST /api-keys/: Create new key (admin only)
- GET /api-keys/: List all keys (admin only)
- GET /api-keys/{key_id}: Get key details (admin only)
- PATCH /api-keys/{key_id}: Update key (admin only)
- DELETE /api-keys/{key_id}: Soft-delete key (admin only)

Usage:
    from merlt.api.api_keys_router import router as api_keys_router
    app.include_router(api_keys_router, prefix="/api/v1")
"""

import secrets
import structlog
from datetime import datetime
from typing import Optional, List
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from merlt.experts.models import ApiKey
from merlt.api.auth import hash_api_key, require_role
from merlt.rlcf.database import get_async_session_dep

log = structlog.get_logger()

router = APIRouter(prefix="/api-keys", tags=["api-keys"])


# =============================================================================
# REQUEST / RESPONSE MODELS
# =============================================================================

class CreateApiKeyRequest(BaseModel):
    """Request to create a new API key."""
    user_id: str = Field(..., min_length=1, description="Owner user ID")
    role: str = Field("user", description="Role: admin, user, guest")
    rate_limit_tier: str = Field("standard", description="Tier: unlimited, premium, standard, limited")
    description: Optional[str] = Field(None, description="Optional description")
    expires_at: Optional[datetime] = Field(None, description="Optional expiration datetime")


class CreateApiKeyResponse(BaseModel):
    """Response with the raw key (shown only once)."""
    key_id: str
    raw_key: str = Field(..., description="The raw API key — save it now, it will NOT be shown again")
    role: str
    rate_limit_tier: str
    user_id: str
    description: Optional[str]
    created_at: Optional[datetime]


class ApiKeyInfo(BaseModel):
    """API key info (without the hash)."""
    key_id: str
    role: str
    rate_limit_tier: str
    is_active: bool
    user_id: str
    description: Optional[str]
    created_at: Optional[datetime]
    last_used_at: Optional[datetime]
    expires_at: Optional[datetime]


class ApiKeyListResponse(BaseModel):
    """List of API keys."""
    keys: List[ApiKeyInfo]
    count: int


class UpdateApiKeyRequest(BaseModel):
    """Request to update an API key."""
    is_active: Optional[bool] = None
    role: Optional[str] = None
    rate_limit_tier: Optional[str] = None
    description: Optional[str] = None
    expires_at: Optional[datetime] = None


# =============================================================================
# HELPER
# =============================================================================

def _key_to_info(key: ApiKey) -> ApiKeyInfo:
    return ApiKeyInfo(
        key_id=key.key_id,
        role=key.role,
        rate_limit_tier=key.rate_limit_tier,
        is_active=key.is_active,
        user_id=key.user_id,
        description=key.description,
        created_at=key.created_at,
        last_used_at=key.last_used_at,
        expires_at=key.expires_at,
    )


# =============================================================================
# ENDPOINTS
# =============================================================================

@router.post("/bootstrap", response_model=CreateApiKeyResponse)
async def bootstrap_admin_key(
    session: AsyncSession = Depends(get_async_session_dep),
):
    """
    Create the first admin API key.

    Only works if the api_keys table is empty (chicken-and-egg bootstrap).
    Returns the raw key once — store it securely.
    """
    result = await session.execute(select(func.count()).select_from(ApiKey))
    count = result.scalar_one()

    if count > 0:
        raise HTTPException(
            status_code=409,
            detail="API keys already exist. Use POST /api-keys/ with an admin key.",
        )

    raw_key = "merlt_" + secrets.token_hex(24)
    key_id = f"key_{uuid4().hex[:12]}"
    key_hash = hash_api_key(raw_key)

    api_key = ApiKey(
        key_id=key_id,
        api_key_hash=key_hash,
        role="admin",
        rate_limit_tier="unlimited",
        is_active=True,
        user_id="bootstrap_admin",
        description="Bootstrap admin key",
    )
    session.add(api_key)
    await session.commit()

    log.info("Bootstrap admin key created", key_id=key_id)

    return CreateApiKeyResponse(
        key_id=key_id,
        raw_key=raw_key,
        role="admin",
        rate_limit_tier="unlimited",
        user_id="bootstrap_admin",
        description="Bootstrap admin key",
        created_at=api_key.created_at,
    )


@router.post("/", response_model=CreateApiKeyResponse)
async def create_api_key(
    request: CreateApiKeyRequest,
    session: AsyncSession = Depends(get_async_session_dep),
    admin_key: ApiKey = Depends(require_role("admin")),
):
    """
    Create a new API key (admin only).

    Returns the raw key once — store it securely.
    """
    # Validate role
    valid_roles = ("admin", "user", "guest")
    if request.role not in valid_roles:
        raise HTTPException(status_code=400, detail=f"Invalid role. Valid: {valid_roles}")

    valid_tiers = ("unlimited", "premium", "standard", "limited")
    if request.rate_limit_tier not in valid_tiers:
        raise HTTPException(status_code=400, detail=f"Invalid tier. Valid: {valid_tiers}")

    raw_key = "merlt_" + secrets.token_hex(24)
    key_id = f"key_{uuid4().hex[:12]}"
    key_hash = hash_api_key(raw_key)

    api_key = ApiKey(
        key_id=key_id,
        api_key_hash=key_hash,
        role=request.role,
        rate_limit_tier=request.rate_limit_tier,
        is_active=True,
        user_id=request.user_id,
        description=request.description,
        expires_at=request.expires_at,
    )
    session.add(api_key)
    await session.commit()

    log.info("API key created", key_id=key_id, role=request.role, user_id=request.user_id)

    return CreateApiKeyResponse(
        key_id=key_id,
        raw_key=raw_key,
        role=request.role,
        rate_limit_tier=request.rate_limit_tier,
        user_id=request.user_id,
        description=request.description,
        created_at=api_key.created_at,
    )


@router.get("/", response_model=ApiKeyListResponse)
async def list_api_keys(
    session: AsyncSession = Depends(get_async_session_dep),
    admin_key: ApiKey = Depends(require_role("admin")),
):
    """List all API keys (admin only). Hashes are never returned."""
    result = await session.execute(
        select(ApiKey).order_by(ApiKey.created_at.desc())
    )
    keys = result.scalars().all()

    return ApiKeyListResponse(
        keys=[_key_to_info(k) for k in keys],
        count=len(keys),
    )


@router.get("/{key_id}", response_model=ApiKeyInfo)
async def get_api_key(
    key_id: str,
    session: AsyncSession = Depends(get_async_session_dep),
    admin_key: ApiKey = Depends(require_role("admin")),
):
    """Get API key details (admin only)."""
    result = await session.execute(
        select(ApiKey).where(ApiKey.key_id == key_id)
    )
    api_key = result.scalar_one_or_none()

    if api_key is None:
        raise HTTPException(status_code=404, detail=f"Key {key_id} not found")

    return _key_to_info(api_key)


@router.patch("/{key_id}", response_model=ApiKeyInfo)
async def update_api_key(
    key_id: str,
    request: UpdateApiKeyRequest,
    session: AsyncSession = Depends(get_async_session_dep),
    admin_key: ApiKey = Depends(require_role("admin")),
):
    """Update API key properties (admin only)."""
    result = await session.execute(
        select(ApiKey).where(ApiKey.key_id == key_id)
    )
    api_key = result.scalar_one_or_none()

    if api_key is None:
        raise HTTPException(status_code=404, detail=f"Key {key_id} not found")

    if request.is_active is not None:
        api_key.is_active = request.is_active
    if request.role is not None:
        valid_roles = ("admin", "user", "guest")
        if request.role not in valid_roles:
            raise HTTPException(status_code=400, detail=f"Invalid role. Valid: {valid_roles}")
        api_key.role = request.role
    if request.rate_limit_tier is not None:
        valid_tiers = ("unlimited", "premium", "standard", "limited")
        if request.rate_limit_tier not in valid_tiers:
            raise HTTPException(status_code=400, detail=f"Invalid tier. Valid: {valid_tiers}")
        api_key.rate_limit_tier = request.rate_limit_tier
    if request.description is not None:
        api_key.description = request.description
    if request.expires_at is not None:
        api_key.expires_at = request.expires_at

    await session.commit()

    log.info("API key updated", key_id=key_id)

    return _key_to_info(api_key)


@router.delete("/{key_id}", response_model=ApiKeyInfo)
async def delete_api_key(
    key_id: str,
    session: AsyncSession = Depends(get_async_session_dep),
    admin_key: ApiKey = Depends(require_role("admin")),
):
    """Soft-delete API key by setting is_active=False (admin only)."""
    result = await session.execute(
        select(ApiKey).where(ApiKey.key_id == key_id)
    )
    api_key = result.scalar_one_or_none()

    if api_key is None:
        raise HTTPException(status_code=404, detail=f"Key {key_id} not found")

    api_key.is_active = False
    await session.commit()

    log.info("API key revoked", key_id=key_id)

    return _key_to_info(api_key)
