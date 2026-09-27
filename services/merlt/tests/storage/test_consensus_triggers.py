"""Integration test for the RLCF enrichment consensus triggers (loop-closure A2).

Asserts that after `ensure_consensus_triggers()`, authority-weighted votes
inserted into `entity_votes` make the PL/pgSQL trigger recompute `net_score`
and flip `consensus_reached` / `consensus_type` on the parent
`pending_entities` row. Guards against the regression where `create_tables()`
creates the tables but never installs the triggers (so votes never reach
consensus and graph promotion never fires).

Runs inside the merlt-api container (reaches merlt-postgres):
    docker exec -w /app visualex-merlt-api python -m pytest tests/storage/test_consensus_triggers.py -q

A loop-local NullPool engine is created per test so pytest-asyncio's per-test
event loop never inherits a pool bound to a closed loop.
"""

from __future__ import annotations

import uuid

import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from merlt.storage.enrichment.database import get_database_url
from merlt.storage.enrichment.consensus_triggers import ensure_consensus_triggers


@pytest_asyncio.fixture
async def engine():
    eng = create_async_engine(get_database_url(), poolclass=NullPool)
    await ensure_consensus_triggers(eng)
    yield eng
    await eng.dispose()


async def _insert_entity(eng, eid: str) -> None:
    async with eng.begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO pending_entities "
                "(entity_id, article_urn, entity_type, entity_text, ambito, validation_status) "
                "VALUES (:eid, :urn, 'concetto', 'Test entity', 'generale', 'pending')"
            ),
            {"eid": eid, "urn": "urn:test:art1"},
        )


async def _cast_vote(eng, eid: str, user_id: str, value: int, authority: float) -> None:
    async with eng.begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO entity_votes "
                "(entity_id, user_id, vote_value, vote_type, voter_authority) "
                "VALUES (:eid, :uid, :val, 'accuracy', :auth)"
            ),
            {"eid": eid, "uid": user_id, "val": value, "auth": authority},
        )


async def _read(eng, eid: str):
    async with eng.begin() as conn:
        return (
            await conn.execute(
                text(
                    "SELECT consensus_reached, consensus_type, net_score, votes_count "
                    "FROM pending_entities WHERE entity_id = :eid"
                ),
                {"eid": eid},
            )
        ).first()


async def _cleanup(eng, eid: str) -> None:
    async with eng.begin() as conn:
        await conn.execute(
            text("DELETE FROM pending_entities WHERE entity_id = :eid"), {"eid": eid}
        )


async def test_votes_reach_approval_consensus(engine):
    eid = f"test-ent-{uuid.uuid4().hex[:8]}"
    await _insert_entity(engine, eid)
    try:
        for i in range(3):  # 3 × authority 1.0 = net +3 >= +2
            await _cast_vote(engine, eid, f"voter-{i}-{eid}", 1, 1.0)
        row = await _read(engine, eid)
        assert row is not None
        assert row.consensus_reached is True
        assert row.consensus_type == "approved"
        assert row.net_score >= 2.0
        assert row.votes_count == 3
    finally:
        await _cleanup(engine, eid)


async def test_votes_reach_rejection_consensus(engine):
    eid = f"test-ent-{uuid.uuid4().hex[:8]}"
    await _insert_entity(engine, eid)
    try:
        for i in range(3):  # 3 × -authority 1.0 = net -3 <= -2
            await _cast_vote(engine, eid, f"rvoter-{i}-{eid}", -1, 1.0)
        row = await _read(engine, eid)
        assert row.consensus_reached is True
        assert row.consensus_type == "rejected"
        assert row.net_score <= -2.0
    finally:
        await _cleanup(engine, eid)


async def test_below_threshold_stays_pending(engine):
    eid = f"test-ent-{uuid.uuid4().hex[:8]}"
    await _insert_entity(engine, eid)
    try:
        await _cast_vote(engine, eid, f"single-{eid}", 1, 1.0)  # net +1 < +2
        row = await _read(engine, eid)
        assert row.consensus_reached is False
        assert row.consensus_type is None
    finally:
        await _cleanup(engine, eid)
