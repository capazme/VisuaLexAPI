"""The key seeded at boot is the one key that opens MERL-T (scan A.2).

A key minted earlier (the old bootstrap route, the previous value after a rotation) stays in
the table, deactivated: kept for the record, never deleted. Without a configured key the seed
leaves KEY_READY false, which /health reports, so a stack that refuses everything does not look
healthy.
"""

import os
import uuid
from contextlib import asynccontextmanager

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

import merlt.api.api_key_seed as seed
from merlt.api.auth import hash_api_key

needs_db = pytest.mark.skipif(
    not os.environ.get("RLCF_ASYNC_DATABASE_URL"),
    reason="needs the RLCF Postgres",
)


async def test_without_a_configured_key_nothing_opens_and_health_knows(monkeypatch):
    monkeypatch.delenv(seed.ENV_VAR, raising=False)
    seed.KEY_READY = True
    assert await seed.ensure_admin_api_key() is False
    assert seed.KEY_READY is False


@needs_db
async def test_the_configured_key_is_the_only_active_one(monkeypatch):
    import merlt.experts.models  # noqa: F401  (registers the api_keys table)
    from merlt.rlcf.database import Base as RlcfBase
    from merlt.rlcf.database import get_async_database_url

    engine = create_async_engine(get_async_database_url(), poolclass=NullPool)
    async with engine.begin() as conn:
        await conn.run_sync(RlcfBase.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    @asynccontextmanager
    async def session():
        async with maker() as s:
            yield s

    monkeypatch.setattr(seed, "get_async_session", session)
    tag = uuid.uuid4().hex[:8]
    configured = f"configured-{tag}"
    minted, rotated = f"key_minted_{tag}", f"key_rotated_{tag}"
    try:
        async with maker() as s:
            for key_id, raw, role in ((minted, f"minted-{tag}", "admin"), (rotated, f"old-{tag}", "admin")):
                await s.execute(
                    text("INSERT INTO api_keys (key_id, api_key_hash, role, rate_limit_tier, is_active, user_id) "
                         "VALUES (:k, :h, :r, 'unlimited', true, 'someone')"),
                    {"k": key_id, "h": hash_api_key(raw), "r": role},
                )
            await s.commit()

        monkeypatch.setenv(seed.ENV_VAR, configured)
        assert await seed.ensure_admin_api_key() is True
        assert seed.KEY_READY is True

        async with maker() as s:
            rows = {
                key_id: (active, role, tier)
                for key_id, active, role, tier, key_hash in (
                    await s.execute(text(
                        "SELECT key_id, is_active, role, rate_limit_tier, api_key_hash FROM api_keys "
                        "WHERE key_id IN (:a, :b) OR api_key_hash = :h"),
                        {"a": minted, "b": rotated, "h": hash_api_key(configured)})
                ).all()
            }
        # The earlier keys stay, switched off; the configured one is the active admin key.
        assert rows[minted][0] is False and rows[rotated][0] is False
        seeded = [v for k, v in rows.items() if k not in (minted, rotated)]
        assert seeded == [(True, "admin", "unlimited")]

        # A second boot creates nothing and leaves it so.
        assert await seed.ensure_admin_api_key() is False
        async with maker() as s:
            active = (await s.execute(text(
                "SELECT count(*) FROM api_keys WHERE is_active AND (key_id IN (:a, :b) OR api_key_hash = :h)"),
                {"a": minted, "b": rotated, "h": hash_api_key(configured)})).scalar_one()
        assert active == 1
    finally:
        async with maker() as s:
            await s.execute(text("DELETE FROM api_keys WHERE key_id IN (:a, :b) OR api_key_hash = :h"),
                            {"a": minted, "b": rotated, "h": hash_api_key(configured)})
            await s.commit()
        await engine.dispose()
