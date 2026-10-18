"""Activity events expire (``merlt.privacy.retention``), and the tracking route
keeps nothing when it cannot store an event.

The purge test needs ``ENRICHMENT_DATABASE_URL`` (a disposable database; CI sets it).
"""

from __future__ import annotations

import importlib
import os
import uuid
from contextlib import asynccontextmanager

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from merlt.privacy import retention
from merlt.storage.enrichment.database import get_database_url
from merlt.storage.enrichment.models import Base

needs_db = pytest.mark.skipif(
    not os.environ.get("ENRICHMENT_DATABASE_URL"), reason="needs the enrichment Postgres"
)


@pytest.mark.parametrize(
    "raw, days",
    [("", 365), ("30", 30), ("0", 1), ("-5", 1), ("un anno", 365)],
)
def test_the_period_is_read_from_the_environment(monkeypatch, raw, days):
    monkeypatch.setenv("MERLT_TRACKING_RETENTION_DAYS", raw)
    assert retention.tracking_retention_days() == days


@pytest.mark.parametrize("raw, hours", [("", 24.0), ("6", 6.0), ("0", 24.0), ("x", 24.0)])
def test_the_interval_is_read_from_the_environment(monkeypatch, raw, hours):
    monkeypatch.setenv("MERLT_RETENTION_INTERVAL_HOURS", raw)
    assert retention.retention_interval_hours() == hours


@needs_db
async def test_the_purge_deletes_only_the_expired_events():
    engine = create_async_engine(get_database_url(), poolclass=NullPool)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    marker = f"zztest-retention-{uuid.uuid4()}"
    try:
        async with maker() as s:
            for days_ago in (400, 366, 364, 1):
                await s.execute(
                    text(
                        "INSERT INTO tracking_events (event_type, user_id, payload, created_at) "
                        "VALUES ('article:viewed', :u, '{}', NOW() - make_interval(days => :d))"
                    ),
                    {"u": marker, "d": days_ago},
                )
            await s.commit()
        async with maker() as s:
            deleted = await retention.purge_expired_tracking_events(s, 365)
            await s.commit()
        assert deleted >= 2
        async with maker() as s:
            left = (await s.execute(
                text("SELECT count(*) FROM tracking_events WHERE user_id = :u"), {"u": marker}
            )).scalar_one()
        assert left == 2
    finally:
        async with maker() as s:
            await s.execute(text("DELETE FROM tracking_events WHERE user_id = :u"), {"u": marker})
            await s.commit()
        await engine.dispose()


def test_the_tracking_route_answers_503_and_keeps_nothing_when_the_store_is_down(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from merlt.api.auth import optional_api_key, verify_api_key
    from merlt.rlcf.database import get_async_session_dep

    tr = importlib.import_module("merlt.api.tracking_router")

    @asynccontextmanager
    async def down():
        raise ConnectionError("the database is down")
        yield  # pragma: no cover

    monkeypatch.setattr(tr, "get_db_session", down)
    app = FastAPI()
    app.include_router(tr.router, prefix="/api/v1")

    async def no_session():
        yield None

    app.dependency_overrides[get_async_session_dep] = no_session
    app.dependency_overrides[verify_api_key] = optional_api_key
    response = TestClient(app).post(
        "/api/v1/tracking/events",
        json={"events": [{"type": "annotation:created", "data": {"user_id": "u", "note_text": "n"}, "timestamp": 1}]},
    )
    assert response.status_code == 503
    assert not hasattr(tr, "_event_buffer")
