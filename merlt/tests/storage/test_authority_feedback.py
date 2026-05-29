"""Integration test for authority feedback after consensus (loop-closure A4).

Closes RLCF Stage 2 for the graph-enrichment path: once a pending entity
reaches consensus, every voter's domain authority is recomputed — voters who
aligned with the consensus gain accuracy (→ 1.0), those who voted against lose
it (→ 0.0). `recalculate_authorities_after_consensus` is the documented hook;
this proves it produces the right authority from real votes.

    docker exec -w /app visualex-merlt-api python -m pytest tests/storage/test_authority_feedback.py -q
"""

from __future__ import annotations

import uuid

import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.pool import NullPool

from merlt.storage.enrichment.database import get_database_url
from merlt.storage.enrichment.consensus_triggers import ensure_consensus_triggers
from merlt.rlcf.domain_authority import (
    DomainAuthorityService,
    recalculate_authorities_after_consensus,
)

DOMAIN = "civile"


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine(get_database_url(), poolclass=NullPool)
    await ensure_consensus_triggers(engine)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    yield engine, factory
    await engine.dispose()


async def test_authority_updates_after_consensus(db):
    engine, factory = db
    eid = f"test-auth-{uuid.uuid4().hex[:8]}"
    approvers = [f"app-{i}-{eid}" for i in range(3)]
    rejecter = f"rej-{eid}"

    async with engine.begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO pending_entities "
                "(entity_id, article_urn, entity_type, entity_text, ambito, validation_status) "
                "VALUES (:eid, 'urn:test:a4', 'concetto', 'Auth test', :dom, 'pending')"
            ),
            {"eid": eid, "dom": DOMAIN},
        )
        # 3 approve (auth 1.0) + 1 reject (auth 1.0) → net +2 → approved consensus
        for uid in approvers:
            await conn.execute(
                text(
                    "INSERT INTO entity_votes (entity_id, user_id, vote_value, vote_type, voter_authority) "
                    "VALUES (:eid, :uid, 1, 'accuracy', 1.0)"
                ),
                {"eid": eid, "uid": uid},
            )
        await conn.execute(
            text(
                "INSERT INTO entity_votes (entity_id, user_id, vote_value, vote_type, voter_authority) "
                "VALUES (:eid, :uid, -1, 'accuracy', 1.0)"
            ),
            {"eid": eid, "uid": rejecter},
        )

    try:
        async with factory() as session:
            await recalculate_authorities_after_consensus(
                session, approvers + [rejecter], DOMAIN
            )

        service = DomainAuthorityService()
        async with factory() as session:
            for uid in approvers:
                auth = await service.get_user_authority(session, uid, DOMAIN)
                assert auth == 1.0, f"approver {uid} should be 1.0, got {auth}"
            rej_auth = await service.get_user_authority(session, rejecter, DOMAIN)
            assert rej_auth == 0.0, f"rejecter should be 0.0, got {rej_auth}"
    finally:
        async with engine.begin() as conn:
            await conn.execute(text("DELETE FROM pending_entities WHERE entity_id = :eid"), {"eid": eid})
            await conn.execute(
                text("DELETE FROM user_domain_authority WHERE user_id = ANY(:ids)"),
                {"ids": approvers + [rejecter]},
            )
