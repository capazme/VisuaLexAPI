"""The key seeded at boot is the one key that opens MERL-T (scan A.2).

A key minted earlier (the old bootstrap route, the previous value after a rotation) stays in
the table, deactivated: kept for the record, never deleted. Without a configured key no key stays
active, and the seed leaves KEY_READY false, which /health reports, so a stack that refuses
everything does not look healthy.
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


async def _database(monkeypatch):
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
    return engine, maker


async def _insert(maker, key_id, raw, *, expires=False):
    async with maker() as s:
        await s.execute(
            text("INSERT INTO api_keys (key_id, api_key_hash, role, rate_limit_tier, is_active, user_id, expires_at) "
                 "VALUES (:k, :h, 'admin', 'unlimited', true, 'someone', "
                 + ("NOW() - interval '1 day'" if expires else "NULL") + ")"),
            {"k": key_id, "h": hash_api_key(raw)},
        )
        await s.commit()


async def _active(maker, key_id) -> bool:
    async with maker() as s:
        return (await s.execute(text("SELECT is_active FROM api_keys WHERE key_id = :k"), {"k": key_id})).scalar_one()


@needs_db
async def test_without_a_configured_key_no_key_opens_and_health_knows(monkeypatch):
    engine, maker = await _database(monkeypatch)
    old = f"key_left_{uuid.uuid4().hex[:8]}"
    try:
        await _insert(maker, old, f"left-{old}")
        monkeypatch.delenv(seed.ENV_VAR, raising=False)
        seed.KEY_READY = True
        assert await seed.ensure_admin_api_key() is False
        assert seed.KEY_READY is False
        # A key left from before (the old bootstrap route, an earlier value) opens nothing.
        assert await _active(maker, old) is False
    finally:
        async with maker() as s:
            await s.execute(text("DELETE FROM api_keys WHERE key_id = :k"), {"k": old})
            await s.commit()
        await engine.dispose()


@needs_db
async def test_a_configured_key_that_had_expired_is_made_usable(monkeypatch):
    engine, maker = await _database(monkeypatch)
    key_id = f"key_expired_{uuid.uuid4().hex[:8]}"
    raw = f"expired-{key_id}"
    try:
        await _insert(maker, key_id, raw, expires=True)
        monkeypatch.setenv(seed.ENV_VAR, raw)
        assert await seed.ensure_admin_api_key() is False
        assert seed.KEY_READY is True
        async with maker() as s:
            expires = (await s.execute(text("SELECT expires_at FROM api_keys WHERE key_id = :k"), {"k": key_id})).scalar_one()
        assert expires is None and await _active(maker, key_id) is True
    finally:
        async with maker() as s:
            await s.execute(text("DELETE FROM api_keys WHERE key_id = :k"), {"k": key_id})
            await s.commit()
        await engine.dispose()


@needs_db
async def test_the_configured_key_is_the_only_active_one(monkeypatch):
    engine, maker = await _database(monkeypatch)
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
