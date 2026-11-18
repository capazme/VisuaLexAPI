"""Seed the API key from the environment at boot (idempotent).

Every MERL-T route but /health and / needs an ``X-API-Key`` row in ``api_keys``
(merlt.app, scan A.2), and its only caller is the VisuaLex server. With
``MERLT_ADMIN_API_KEY`` set (compose passes the server's ``MERLT_API_KEY``), the
key is inserted once, by hash, and every other active key is deactivated (kept,
not deleted): the configured key is the only one that opens MERL-T, so a key
minted by the old bootstrap route, or the previous value after a rotation, stops
working. The raw value is never logged; the deactivated keys only as a count.

``KEY_READY`` says whether the seed left a usable key, for /health: without one
every route answers 401 while the stores are healthy.
"""

from __future__ import annotations

import os
from uuid import uuid4

import structlog
from sqlalchemy import select, update

from merlt.api.auth import hash_api_key
from merlt.experts.models import ApiKey
from merlt.rlcf.database import get_async_session

log = structlog.get_logger()

ENV_VAR = "MERLT_ADMIN_API_KEY"
SEED_USER_ID = "env_admin"

# Whether the last seed left the configured key usable (read by /health).
KEY_READY = False


async def ensure_admin_api_key() -> bool:
    """Make the key named by ``MERLT_ADMIN_API_KEY`` the one active key.

    Inserts it when missing, re-activates it as an unlimited admin key when it is
    not, and deactivates every other active key. Returns True when a row was
    created. The caller guards it: a seeding failure must not stop the api from
    booting, and leaves ``KEY_READY`` false, which /health reports.
    """
    global KEY_READY
    KEY_READY = False
    raw = (os.getenv(ENV_VAR) or "").strip()
    if not raw:
        log.error("No API key configured (%s unset): every MERL-T route answers 401", ENV_VAR)
        return False
    key_hash = hash_api_key(raw)
    created = False
    async with get_async_session() as session:
        existing = (
            await session.execute(select(ApiKey).where(ApiKey.api_key_hash == key_hash))
        ).scalar_one_or_none()
        if existing is None:
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
            created = True
        elif not existing.is_active or existing.role != "admin" or existing.rate_limit_tier != "unlimited":
            existing.is_active = True
            existing.role = "admin"
            existing.rate_limit_tier = "unlimited"
            log.info("Admin API key re-activated", key_id=existing.key_id)
        others = await session.execute(
            update(ApiKey)
            .where(ApiKey.api_key_hash != key_hash, ApiKey.is_active.is_(True))
            .values(is_active=False)
        )
        await session.commit()
    if others.rowcount:
        log.warning("Other API keys deactivated: only the configured key opens MERL-T", count=others.rowcount)
    if created:
        log.info("Admin API key seeded from environment")
    KEY_READY = True
    return created
