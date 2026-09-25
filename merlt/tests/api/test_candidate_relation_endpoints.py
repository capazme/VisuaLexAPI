"""B1: a staged relation candidate carries its endpoint names and whether each
endpoint resolved, through the real extraction_candidates table (columns
source_text / target_text, migration 008 / schema_additions) and the
GET /documents/{id}/candidates read model.

    docker exec -w /app visualex-merlt-api python -m pytest tests/api/test_candidate_relation_endpoints.py -q
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from unittest.mock import MagicMock

import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from merlt.api.document_router import get_candidate, list_document_candidates
from merlt.storage.enrichment.database import get_database_url
from merlt.storage.enrichment.models import ExtractionCandidate

LONG_URL_TARGET = (
    "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:"
    "2003-06-30;196~art2quinquiesdecies"
)


@pytest_asyncio.fixture
async def doc():
    engine = create_async_engine(get_database_url(), poolclass=NullPool)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    marker = uuid.uuid4().hex[:10]
    async with factory() as session:
        doc_id = (
            await session.execute(
                text(
                    "INSERT INTO user_documents (filename, original_filename, file_type, storage_path, uploaded_by) "
                    "VALUES (:f, :f, 'txt', '/nonexistent', :u) RETURNING id"
                ),
                {"f": f"appunti-{marker}.txt", "u": f"u-{marker}"},
            )
        ).scalar_one()
        await session.commit()
    yield factory, doc_id, f"u-{marker}"
    async with factory() as session:  # candidates cascade with the document
        await session.execute(text("DELETE FROM user_documents WHERE id = :id"), {"id": doc_id})
        await session.commit()
    await engine.dispose()


async def test_candidate_read_model_round_trip(doc):
    factory, doc_id, user = doc
    assert len(LONG_URL_TARGET) > 100  # overflowed the old varchar(100)
    async with factory() as session:
        row = ExtractionCandidate(
            document_id=doc_id,
            contributor_id=user,
            candidate_type="relation",
            relation_type="PRESUPPONE",
            source_node_urn="concetto:risoluzione_del_contratto",
            source_text="La risoluzione del contratto",
            target_entity_id=LONG_URL_TARGET,
            target_text=LONG_URL_TARGET,
            article_urn="user_document",
            status="draft",
            expires_at=datetime.now() + timedelta(hours=1),
        )
        unresolved = ExtractionCandidate(
            document_id=doc_id,
            contributor_id=user,
            candidate_type="relation",
            relation_type="IMPLICA",
            source_node_urn="Buona fede",
            source_text="Buona fede",
            target_entity_id="Clausola vaga",
            target_text="Clausola vaga",
            article_urn="user_document",
            status="draft",
            expires_at=datetime.now() + timedelta(hours=1),
        )
        session.add_all([row, unresolved])
        await session.commit()
        row_id, unresolved_id = row.id, unresolved.id

    async with factory() as session:
        listed = await list_document_candidates(doc_id, user, session=session, api_key=MagicMock())
    by_id = {c.id: c for c in listed.candidates}

    resolved = by_id[row_id]
    assert resolved.source_node_urn == "concetto:risoluzione_del_contratto"
    assert resolved.source_text == "La risoluzione del contratto"
    assert resolved.source_resolved is True
    assert resolved.target_entity_id == LONG_URL_TARGET
    assert resolved.target_resolved is True

    raw = by_id[unresolved_id]
    assert (raw.source_resolved, raw.target_resolved) == (False, False)
    assert raw.source_node_urn == "Buona fede"

    async with factory() as session:
        single = await get_candidate(unresolved_id, session=session, api_key=MagicMock())
    assert single.target_text == "Clausola vaga"
    assert single.target_resolved is False
