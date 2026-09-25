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


async def test_relation_consensus_recalculates_authority(db, monkeypatch):
    """A4 for relations: validate_relation used to skip the recalc that
    validate_entity runs, so a relation-only voter's authority waited for some
    later entity consensus. The vote that tips a relation into consensus now
    recomputes every voter plus the contributor."""
    import importlib
    from unittest.mock import AsyncMock, MagicMock

    from merlt.api.models.enrichment_models import RelationValidationRequest

    er = importlib.import_module("merlt.api.enrichment_router")
    # FalkorDB is not part of this test: the graph write is a no-op here.
    monkeypatch.setattr(er, "_write_relation_to_graph", AsyncMock())

    engine, factory = db
    rid = f"CITA:a4-{uuid.uuid4().hex[:8]}"
    early = [f"early-{i}-{rid}" for i in range(2)]
    closer = f"closer-{rid}"
    contributor = f"author-{rid}"
    everyone = early + [closer, contributor]

    async with engine.begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO pending_relations "
                "(relation_id, article_urn, source_type, relation_type, source_node_urn, "
                "target_entity_id, validation_status, contributed_by) "
                "VALUES (:rid, 'urn:test:a4r', 'manual', 'CITA', 'concetto:a', 'concetto:b', "
                "'pending', :author)"
            ),
            {"rid": rid, "author": contributor},
        )
        # 2 approvals at authority 0.9: net +1.8, below the +2.0 threshold. The
        # closing vote (default authority 0.5) tips it (the trigger recomputes
        # consensus on every insert).
        for uid in early:
            await conn.execute(
                text(
                    "INSERT INTO relation_votes (relation_id, user_id, vote_value, vote_type, "
                    "voter_authority, legal_domain) VALUES (:rid, :uid, 1, 'accuracy', 0.9, 'generale')"
                ),
                {"rid": rid, "uid": uid},
            )

    try:
        async with factory() as session:
            response = await er.validate_relation(
                RelationValidationRequest(relation_id=rid, user_id=closer, vote="approve"),
                session=session,
                api_key=MagicMock(),
            )
        assert response.threshold_reached is True

        async with factory() as session:
            rows = (
                await session.execute(
                    text(
                        "SELECT user_id, domain_authority, total_feedbacks FROM user_domain_authority "
                        "WHERE user_id = ANY(:ids) AND legal_domain = 'generale'"
                    ),
                    {"ids": everyone},
                )
            ).mappings().all()
        by_user = {r["user_id"]: r for r in rows}
        assert set(by_user) == set(everyone)
        for uid in early + [closer]:
            assert by_user[uid]["total_feedbacks"] == 1, uid
            assert by_user[uid]["domain_authority"] == 1.0, uid
    finally:
        async with engine.begin() as conn:
            await conn.execute(text("DELETE FROM pending_relations WHERE relation_id = :rid"), {"rid": rid})
            await conn.execute(
                text("DELETE FROM user_domain_authority WHERE user_id = ANY(:ids)"), {"ids": everyone}
            )
