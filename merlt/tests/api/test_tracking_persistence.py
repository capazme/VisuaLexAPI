"""Tests for RLCF tracking-event persistence (loop-closure A1).

Slice 1 events used to live only in an in-memory ring buffer (lost on restart).
These tests pin the new durable path: events map to `tracking_events` rows and
survive a fresh session.

    docker exec -w /app visualex-merlt-api python -m pytest tests/api/test_tracking_persistence.py -q
"""

from __future__ import annotations

import uuid

import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.pool import NullPool

from merlt.api.tracking_router import (
    TrackingEvent,
    build_tracking_records,
    persist_tracking_events,
)
from merlt.storage.enrichment.models import TrackingEventRecord, Base
from merlt.storage.enrichment.database import get_database_url


class _FakeSession:
    def __init__(self):
        self.added: list = []

    def add(self, obj):
        self.added.append(obj)


def test_build_records_extracts_user_id_and_fields():
    events = [
        TrackingEvent(type="article:viewed", data={"user_id": 42, "urn": "x"}, timestamp=1700000000000),
        TrackingEvent(type="forum:like", data={}, timestamp=1700000000001),
    ]
    records = build_tracking_records(events)
    assert len(records) == 2
    assert all(isinstance(r, TrackingEventRecord) for r in records)
    assert records[0].event_type == "article:viewed"
    assert records[0].user_id == "42"  # coerced to string (opaque id, never an FK)
    assert records[0].payload == {"user_id": 42, "urn": "x"}
    assert records[0].client_ts == 1700000000000
    assert records[1].user_id is None


async def test_persist_adds_records_to_session():
    session = _FakeSession()
    events = [TrackingEvent(type="citation:clicked", data={"user_id": "u1"}, timestamp=1)]
    count = await persist_tracking_events(session, events)
    assert count == 1
    assert len(session.added) == 1
    assert isinstance(session.added[0], TrackingEventRecord)


@pytest_asyncio.fixture
async def session_factory():
    engine = create_async_engine(get_database_url(), poolclass=NullPool)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    yield factory
    await engine.dispose()


async def test_events_persist_to_db(session_factory):
    marker = f"zztest:{uuid.uuid4().hex[:8]}"
    events = [TrackingEvent(type=marker, data={"user_id": "u-int"}, timestamp=123)]
    async with session_factory() as session:
        await persist_tracking_events(session, events)
        await session.commit()

    async with session_factory() as session:
        rows = (
            await session.execute(
                text("SELECT event_type, user_id, client_ts FROM tracking_events WHERE event_type = :t"),
                {"t": marker},
            )
        ).all()
    assert len(rows) == 1
    assert rows[0].user_id == "u-int"
    assert rows[0].client_ts == 123

    async with session_factory() as session:
        await session.execute(text("DELETE FROM tracking_events WHERE event_type = :t"), {"t": marker})
        await session.commit()
