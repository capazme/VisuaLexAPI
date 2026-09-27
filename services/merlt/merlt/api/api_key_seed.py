"""Seed the admin API key from the environment at boot (idempotent).

MERL-T's admin routes (RLCF training, graph hygiene, mechanical ingestion,
NER training) sit behind ``require_role("admin")`` and need an ``X-API-Key``
row in ``api_keys``. The only way to mint the first one was a manual
``POST /api/v1/api-keys/bootstrap`` that no runbook, start.sh or compose file
ever called, so on a fresh stack every ops action answered 401 (the BFF
showed "MERL-T non raggiungibile"). With ``MERLT_ADMIN_API_KEY`` set (compose
passes the BFF's ``MERLT_API_KEY``), the key is inserted once, by hash; the
raw value is never logged.
"""

from __future__ import annotations

import os
from uuid import uuid4

import structlog
from sqlalchemy import select

from merlt.api.auth import hash_api_key
from merlt.experts.models import ApiKey
from merlt.rlcf.database import get_async_session

log = structlog.get_logger()

ENV_VAR = "MERLT_ADMIN_API_KEY"
SEED_USER_ID = "env_admin"


async def ensure_admin_api_key() -> bool:
    """Insert the admin key named by ``MERLT_ADMIN_API_KEY`` if it is missing.

    Returns True when a row was created, False when nothing had to be done
    (variable unset or key already present). Never raises past the caller's
    guard: a seeding failure must not stop the api from booting.
    """
    raw = (os.getenv(ENV_VAR) or "").strip()
    if not raw:
        log.info("Admin API key seed skipped (%s unset)", ENV_VAR)
        return False
    key_hash = hash_api_key(raw)
    async with get_async_session() as session:
        existing = (
            await session.execute(select(ApiKey).where(ApiKey.api_key_hash == key_hash))
        ).scalar_one_or_none()
        if existing is not None:
            if not existing.is_active or existing.role != "admin":
                existing.is_active = True
                existing.role = "admin"
                await session.commit()
                log.info("Admin API key re-activated", key_id=existing.key_id)
            return False
        key_id = f"key_{uuid4().hex[:12]}"
        session.add(
            ApiKey(
                key_id=key_id,
                api_key_hash=key_hash,
                role="admin",
                rate_limit_tier="unlimited",
                is_active=True,
                user_id=SEED_USER_ID,
                description=f"Seeded from {ENV_VAR} at boot",
            )
        )
        await session.commit()
    log.info("Admin API key seeded from environment", key_id=key_id)
    return True
