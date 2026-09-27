"""Regression for the relation-promotion 500 (Slice 2c B1 → validation).

``RelationProposalRequest.tipo_relazione`` is a plain ``Enum``: its f-string
form is ``RelationType.CITA`` and asyncpg refuses the Enum object as a varchar
bind, so ``POST /enrichment/propose-relation`` failed every INSERT and the BFF
answered 503 on every relation candidate. The handler now resolves the wire
value once.

Runs against the enrichment Postgres (in-container, or locally with
``ENRICHMENT_DATABASE_URL`` pointing at a database where ``create_tables()``
ran):
    docker exec -w /app visualex-merlt-api python -m pytest tests/api/test_propose_relation.py -q
"""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock

import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from merlt.api.enrichment_router import propose_relation
from merlt.api.models.enrichment_models import RelationProposalRequest
from merlt.pipeline.enrichment.models import RelationType
from merlt.storage.enrichment.database import get_database_url


@pytest_asyncio.fixture
async def session_factory():
    engine = create_async_engine(get_database_url(), poolclass=NullPool)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    yield factory
    await engine.dispose()


async def test_propose_relation_persists_the_enum_value(session_factory):
    marker = f"zztest-{uuid.uuid4().hex[:8]}"
    request = RelationProposalRequest(
        source_urn=f"urn:test:{marker}:source",
        target_entity_id=f"concetto:{marker}",
        tipo_relazione=RelationType.CITA,
        article_urn=f"urn:test:{marker}:art1",
        descrizione="regression: enum value must be persisted as text",
        certezza=0.7,
        user_id="u-test",
        skip_duplicate_check=True,
    )

    async with session_factory() as session:
        response = await propose_relation(request, session=session, api_key=MagicMock())

    assert response.success is True
    assert response.relation_id is not None
    assert response.relation_id.startswith("CITA:"), response.relation_id

    async with session_factory() as session:
        row = (
            await session.execute(
                text("SELECT relation_type FROM pending_relations WHERE relation_id = :rid"),
                {"rid": response.relation_id},
            )
        ).first()
        assert row is not None
        assert row[0] == "CITA"
        await session.execute(
            text("DELETE FROM pending_relations WHERE relation_id = :rid"),
            {"rid": response.relation_id},
        )
        await session.commit()
