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


@pytest.mark.parametrize("raw, days", [("", 730), ("365", 365), ("0", 1), ("due anni", 730)])
def test_the_assistant_period_is_read_from_the_environment(monkeypatch, raw, days):
    monkeypatch.setenv("MERLT_ASSISTANT_RETENTION_DAYS", raw)
    assert retention.assistant_retention_days() == days


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


@needs_db
async def test_events_keep_no_note_text():
    engine = create_async_engine(get_database_url(), poolclass=NullPool)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    marker = f"zztest-notes-{uuid.uuid4()}"
    try:
        async with maker() as s:
            for payload in (
                '{"note_text": "fatti del cliente", "article_urn": "u"}',
                '{"note_text": null, "article_urn": "u"}',
                '{"article_urn": "u"}',
            ):
                await s.execute(
                    text("INSERT INTO tracking_events (event_type, user_id, payload) VALUES ('annotation:created', :u, CAST(:p AS json))"),
                    {"u": marker, "p": payload},
                )
            await s.commit()
        async with maker() as s:
            changed = await retention.strip_note_text(s)
            await s.commit()
        assert changed >= 2
        async with maker() as s:
            rows = (await s.execute(
                text("SELECT payload::text FROM tracking_events WHERE user_id = :u"), {"u": marker}
            )).scalars().all()
        assert len(rows) == 3
        assert all("note_text" not in r and "article_urn" in r for r in rows)
    finally:
        async with maker() as s:
            await s.execute(text("DELETE FROM tracking_events WHERE user_id = :u"), {"u": marker})
            await s.commit()
        await engine.dispose()


@needs_db
async def test_the_purge_deletes_only_the_expired_questions_and_judgements():
    import merlt.experts.models  # noqa: F401  (registers the RLCF tables)
    from merlt.rlcf.database import Base as RlcfBase
    from merlt.rlcf.database import get_async_database_url

    engine = create_async_engine(get_async_database_url(), poolclass=NullPool)
    async with engine.begin() as conn:
        await conn.run_sync(RlcfBase.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    tag = uuid.uuid4().hex[:8]
    old, new = f"trace_old_{tag}", f"trace_new_{tag}"
    try:
        async with maker() as s:
            for trace_id, days_ago in ((old, 800), (new, 10)):
                await s.execute(
                    text("INSERT INTO qa_traces (trace_id, user_id, query, created_at) "
                         "VALUES (:t, 'u', 'domanda', NOW() - make_interval(days => :d))"),
                    {"t": trace_id, "d": days_ago},
                )
            # A judgement on the old question, a recent one on the new, an old one on the new.
            for trace_id, days_ago in ((old, 799), (new, 5), (new, 731)):
                await s.execute(
                    text("INSERT INTO qa_feedback (trace_id, user_id, inline_rating, created_at) "
                         "VALUES (:t, 'u', 4, NOW() - make_interval(days => :d))"),
                    {"t": trace_id, "d": days_ago},
                )
            await s.execute(
                text("INSERT INTO devils_advocate_log (trace_id, feedback_text) VALUES (:t, 'x')"), {"t": old}
            )
            await s.commit()
        async with maker() as s:
            deleted = await retention.purge_expired_assistant_data(s, 730)
            await s.commit()
        assert deleted >= 4
        async with maker() as s:
            traces = (await s.execute(
                text("SELECT trace_id FROM qa_traces WHERE trace_id IN (:o, :n)"), {"o": old, "n": new}
            )).scalars().all()
            feedback = (await s.execute(
                text("SELECT trace_id FROM qa_feedback WHERE trace_id IN (:o, :n)"), {"o": old, "n": new}
            )).scalars().all()
            log_rows = (await s.execute(
                text("SELECT count(*) FROM devils_advocate_log WHERE trace_id = :o"), {"o": old}
            )).scalar_one()
        assert traces == [new]
        assert feedback == [new]
        assert log_rows == 0
    finally:
        async with maker() as s:
            await s.execute(text("DELETE FROM qa_feedback WHERE trace_id IN (:o, :n)"), {"o": old, "n": new})
            await s.execute(text("DELETE FROM qa_traces WHERE trace_id IN (:o, :n)"), {"o": old, "n": new})
            await s.commit()
        await engine.dispose()


def test_the_buffer_drops_the_expired_experiences(monkeypatch):
    import merlt.rlcf.training_scheduler as ts

    monkeypatch.setenv("MERLT_RLCF_BUFFER_PATH", "")
    ts.reset_scheduler()
    try:
        scheduler = ts.get_scheduler()
        scheduler.add_experience({"t": 1}, {"user_id": "a"}, 1.0)
        scheduler.add_experience({"t": 2}, {"user_id": "b"}, 1.0)
        experiences = [e for e in scheduler.buffer.tree.data if e is not None] \
            if hasattr(scheduler.buffer, "tree") else scheduler.buffer.get_all()
        experiences[0].timestamp = "2020-01-01T00:00:00"
        assert retention.drop_expired_experiences(730) == 1
        left = [e for e in scheduler.buffer.tree.data if e is not None] \
            if hasattr(scheduler.buffer, "tree") else scheduler.buffer.get_all()
        assert [e.feedback_data["user_id"] for e in left] == ["b"]
    finally:
        ts.reset_scheduler()


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
