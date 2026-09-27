"""Promotion provenance on pending_* (Slice 2c / community validation).

Regressions covered:
- propose-entity / propose-relation dropped the BFF's provenance: Pydantic
  ignored the undeclared keys, propose-relation stored the column default
  'llm_extraction' for a human contribution, and the contributor's citation
  was never persisted. `fonte` (pipeline tag), `source_reference` (citation,
  new column, migration 007) and `source_document_id` (FK) now reach the row.
- get-pending built its DTOs without `created_at`, so the model default "now"
  made every validation card read "meno di un minuto fa"; relations carried no
  `article_urn`, so a note-derived relation could not link its norm.

Runs against the enrichment Postgres (in-container, or locally with
``ENRICHMENT_DATABASE_URL`` pointing at a database where ``create_tables()``
and migration 007 ran):
    docker exec -w /app visualex-merlt-api python -m pytest tests/api/test_pending_provenance.py -q
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import List
from unittest.mock import MagicMock

import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from merlt.api.enrichment_router import get_pending, propose_entity, propose_relation
from merlt.api.models.enrichment_models import (
    EntityProposalRequest,
    PendingQueueRequest,
    RelationProposalRequest,
)
from merlt.pipeline.enrichment.models import EntityType, RelationType
from merlt.storage.enrichment.database import get_database_url


class _Cleanup:
    def __init__(self) -> None:
        self.entities: List[str] = []
        self.relations: List[str] = []
        self.documents: List[int] = []
        self.users: List[str] = []


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine(get_database_url(), poolclass=NullPool)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    cleanup = _Cleanup()
    yield factory, cleanup
    async with factory() as session:
        await session.execute(
            text("DELETE FROM pending_relations WHERE relation_id = ANY(:ids)"), {"ids": cleanup.relations}
        )
        await session.execute(
            text("DELETE FROM pending_entities WHERE entity_id = ANY(:ids)"), {"ids": cleanup.entities}
        )
        await session.execute(
            text("DELETE FROM user_documents WHERE id = ANY(:ids)"), {"ids": cleanup.documents}
        )
        await session.execute(
            text("DELETE FROM user_domain_authority WHERE user_id = ANY(:ids)"), {"ids": cleanup.users}
        )
        await session.commit()
    await engine.dispose()


async def _make_document(factory, cleanup: _Cleanup, marker: str) -> int:
    async with factory() as session:
        doc_id = (
            await session.execute(
                text(
                    "INSERT INTO user_documents "
                    "(filename, original_filename, file_type, storage_path, uploaded_by) "
                    "VALUES (:f, :f, 'pdf', '/nonexistent', :u) RETURNING id"
                ),
                {"f": f"appunti-{marker}.pdf", "u": f"u-{marker}"},
            )
        ).scalar_one()
        await session.commit()
    cleanup.documents.append(doc_id)
    return doc_id


async def _row(factory, table: str, key: str, value: str) -> dict:
    async with factory() as session:
        return (
            (
                await session.execute(
                    text(
                        f"SELECT fonte, source_reference, source_document_id, contributed_by "
                        f"FROM {table} WHERE {key} = :v"
                    ),
                    {"v": value},
                )
            )
            .mappings()
            .one()
        )


async def test_propose_entity_persists_the_provenance(db):
    factory, cleanup = db
    marker = uuid.uuid4().hex[:10]
    user = f"u-prov-{marker}"
    cleanup.users.append(user)
    doc_id = await _make_document(factory, cleanup, marker)

    request = EntityProposalRequest(
        article_urn="user_document",
        nome=f"Interesse negativo {marker}",
        tipo=EntityType.CONCETTO,
        descrizione="Riformulazione dell'utente",
        fonte="community",
        source_reference="Torrente, Manuale di diritto privato, p. 123",
        source_document_id=doc_id,
        user_id=user,
        skip_duplicate_check=True,
    )
    async with factory() as session:
        response = await propose_entity(request, session=session, api_key=MagicMock())
    cleanup.entities.append(response.pending_entity.id)

    assert response.pending_entity.fonte == "community"
    assert response.pending_entity.source_reference == "Torrente, Manuale di diritto privato, p. 123"
    row = await _row(factory, "pending_entities", "entity_id", response.pending_entity.id)
    assert row["fonte"] == "community"
    assert row["source_reference"] == "Torrente, Manuale di diritto privato, p. 123"
    assert row["source_document_id"] == doc_id
    assert row["contributed_by"] == user


async def test_propose_entity_without_provenance_keeps_working(db):
    factory, cleanup = db
    marker = uuid.uuid4().hex[:10]
    user = f"u-prov-{marker}"
    cleanup.users.append(user)

    request = EntityProposalRequest(
        article_urn=f"urn:zz:{marker}:art1",
        nome=f"Buona fede oggettiva {marker}",
        tipo=EntityType.CONCETTO,
        descrizione="",
        user_id=user,
        skip_duplicate_check=True,
    )
    async with factory() as session:
        response = await propose_entity(request, session=session, api_key=MagicMock())
    cleanup.entities.append(response.pending_entity.id)

    row = await _row(factory, "pending_entities", "entity_id", response.pending_entity.id)
    assert row["fonte"] == "community"
    assert row["source_reference"] is None
    assert row["source_document_id"] is None


async def test_unknown_source_document_is_dropped_not_fatal(db):
    """A purged document (or a staging id sent by mistake) would break the FK
    and lose the whole proposal; the provenance link is dropped instead."""
    factory, cleanup = db
    marker = uuid.uuid4().hex[:10]
    user = f"u-prov-{marker}"
    cleanup.users.append(user)

    request = EntityProposalRequest(
        article_urn="user_document",
        nome=f"Affidamento incolpevole {marker}",
        tipo=EntityType.CONCETTO,
        descrizione="Riformulazione",
        source_document_id=2_000_000_000,
        user_id=user,
        skip_duplicate_check=True,
    )
    async with factory() as session:
        response = await propose_entity(request, session=session, api_key=MagicMock())
    cleanup.entities.append(response.pending_entity.id)

    row = await _row(factory, "pending_entities", "entity_id", response.pending_entity.id)
    assert row["source_document_id"] is None


async def test_propose_relation_persists_the_provenance(db):
    factory, cleanup = db
    marker = uuid.uuid4().hex[:10]
    doc_id = await _make_document(factory, cleanup, marker)

    request = RelationProposalRequest(
        source_urn=f"concetto:fonte-{marker}",
        target_entity_id=f"concetto:destinazione-{marker}",
        tipo_relazione=RelationType.CITA,
        article_urn="user_document",
        descrizione="Riformulazione dell'utente",
        fonte="community",
        source_reference="Gazzoni, Manuale, cap. 4",
        source_document_id=doc_id,
        user_id=f"u-prov-{marker}",
        skip_duplicate_check=True,
    )
    async with factory() as session:
        response = await propose_relation(request, session=session, api_key=MagicMock())
    cleanup.relations.append(response.relation_id)

    row = await _row(factory, "pending_relations", "relation_id", response.relation_id)
    assert row["fonte"] == "community"
    assert row["source_reference"] == "Gazzoni, Manuale, cap. 4"
    assert row["source_document_id"] == doc_id


async def test_propose_relation_default_fonte_is_community_not_llm(db):
    factory, cleanup = db
    marker = uuid.uuid4().hex[:10]
    request = RelationProposalRequest(
        source_urn=f"urn:zz:{marker}:art1",
        target_entity_id=f"concetto:{marker}",
        tipo_relazione=RelationType.CITA,
        article_urn=f"urn:zz:{marker}:art1",
        descrizione="Proposta manuale",
        user_id=f"u-prov-{marker}",
        skip_duplicate_check=True,
    )
    async with factory() as session:
        response = await propose_relation(request, session=session, api_key=MagicMock())
    cleanup.relations.append(response.relation_id)

    row = await _row(factory, "pending_relations", "relation_id", response.relation_id)
    assert row["fonte"] == "community"


async def test_get_pending_returns_the_real_provenance(db):
    factory, cleanup = db
    marker = uuid.uuid4().hex[:10]
    article_urn = f"urn:zz:{marker}:art1"
    created = datetime(2026, 1, 2, 3, 4, 5)
    entity_id = f"concetto:{marker}"
    manual_rel, llm_rel = f"CITA:m{marker}", f"CITA:l{marker}"
    cleanup.entities.append(entity_id)
    cleanup.relations.extend([manual_rel, llm_rel])

    async with factory() as session:
        await session.execute(
            text(
                "INSERT INTO pending_entities (entity_id, article_urn, source_type, entity_type, "
                "entity_text, fonte, source_reference, validation_status, contributed_by, created_at) "
                "VALUES (:eid, :urn, 'manual', 'concetto', :name, 'community', 'Torrente, p. 9', "
                "'pending', 'u-author', :created)"
            ),
            {"eid": entity_id, "urn": article_urn, "name": f"Interesse positivo {marker}", "created": created},
        )
        # a community relation written before the fix: column default 'llm_extraction'
        await session.execute(
            text(
                "INSERT INTO pending_relations (relation_id, article_urn, source_type, relation_type, "
                "source_node_urn, target_entity_id, fonte, source_reference, validation_status, created_at) "
                "VALUES (:rid, :urn, 'manual', 'CITA', 'concetto:a', 'concetto:b', 'llm_extraction', "
                "'Gazzoni, p. 4', 'pending', :created)"
            ),
            {"rid": manual_rel, "urn": article_urn, "created": created},
        )
        # a genuine LLM extraction keeps its label
        await session.execute(
            text(
                "INSERT INTO pending_relations (relation_id, article_urn, source_type, relation_type, "
                "source_node_urn, target_entity_id, fonte, validation_status, created_at) "
                "VALUES (:rid, :urn, 'article', 'CITA', 'concetto:c', 'concetto:d', 'llm_extraction', "
                "'pending', :created)"
            ),
            {"rid": llm_rel, "urn": article_urn, "created": created},
        )
        await session.commit()

    async with factory() as session:
        queue = await get_pending(
            PendingQueueRequest(user_id=f"viewer-{marker}", article_urn=marker, limit=100),
            session=session,
            api_key=MagicMock(),
        )

    expected_created = created.replace(tzinfo=timezone.utc)

    entity = next(e for e in queue.pending_entities if e.id == entity_id)
    assert entity.created_at == expected_created
    assert entity.created_at.tzinfo is not None
    assert entity.fonte == "community"
    assert entity.source_reference == "Torrente, p. 9"

    relations = {r.id: r for r in queue.pending_relations}
    manual, llm = relations[manual_rel], relations[llm_rel]
    assert manual.created_at == expected_created
    assert manual.fonte == "community"
    assert manual.source_reference == "Gazzoni, p. 4"
    assert manual.article_urn == article_urn
    assert llm.fonte == "llm_extraction"
    assert llm.article_urn == article_urn

    # the wire shape carries an explicit UTC offset for the browser
    assert queue.model_dump(mode="json")["pending_entities"][0]["created_at"].endswith("Z")
