"""Uploaded notes belong to their uploader (contrib ownership, MERL-T side).

The BFF answers 404 on a foreign document before calling MERL-T; these pin
the trust boundary on :8000 itself:

- the upload dedup is PER USER: user B uploading a byte-identical copy of user
  A's file gets a document of their own, never A's id (which also removed a
  cross-user existence oracle);
- ``extract-async`` refuses a foreign or unknown document with 404 and never
  enqueues;
- the worker reports a foreign document exactly like a missing one;
- ``GET /experts/trace/{id}`` names the asking user, so the BFF ownership
  rule can read it instead of scanning the caller's history.

The Postgres-backed tests need ``ENRICHMENT_DATABASE_URL`` (CI sets it).
"""

from __future__ import annotations

import importlib
import os
import uuid
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from starlette.datastructures import UploadFile

from merlt.storage.enrichment.database import get_database_url
from merlt.storage.enrichment.models import Base, UserDocument
from merlt.storage.enrichment.schema_additions import ensure_schema_additions

dr = importlib.import_module("merlt.api.document_router")
er = importlib.import_module("merlt.api.experts_router")

API_KEY = SimpleNamespace(user_id="svc", role="user")

needs_db = pytest.mark.skipif(
    not os.environ.get("ENRICHMENT_DATABASE_URL"), reason="needs the enrichment Postgres"
)


@pytest_asyncio.fixture
async def db_session(tmp_path, monkeypatch):
    engine = create_async_engine(get_database_url(), poolclass=NullPool)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await ensure_schema_additions(engine)
    monkeypatch.setattr(dr, "UPLOAD_DIR", tmp_path)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    created: list[int] = []
    async with factory() as session:
        yield session, created
        await session.rollback()
        if created:
            await session.execute(delete(UserDocument).where(UserDocument.id.in_(created)))
            await session.commit()
    await engine.dispose()


def _upload(content: bytes, name: str = "appunti.txt") -> UploadFile:
    return UploadFile(file=BytesIO(content), filename=name)


async def _do_upload(session, user_id: str, content: bytes):
    return await dr.upload_document(
        file=_upload(content),
        document_type="manuale",
        legal_domain="civile",
        title=None,
        author=None,
        publication_year=None,
        user_id=user_id,
        session=session,
        api_key=API_KEY,
    )


@needs_db
async def test_upload_dedup_is_per_user(db_session):
    session, created = db_session
    content = f"note {uuid.uuid4().hex}\n".encode()
    user_a, user_b = f"ua-{uuid.uuid4().hex[:6]}", f"ub-{uuid.uuid4().hex[:6]}"

    first = await _do_upload(session, user_a, content)
    created.append(first.document_id)
    again = await _do_upload(session, user_a, content)
    other = await _do_upload(session, user_b, content)
    created.append(other.document_id)

    assert again.duplicate is True and again.document_id == first.document_id
    assert other.duplicate is False and other.document_id != first.document_id
    doc_b = await session.get(UserDocument, other.document_id)
    assert doc_b.uploaded_by == user_b and doc_b.file_hash == (await session.get(UserDocument, first.document_id)).file_hash


@needs_db
async def test_extract_async_refuses_a_foreign_or_unknown_document(db_session):
    session, created = db_session
    owner = f"owner-{uuid.uuid4().hex[:6]}"
    uploaded = await _do_upload(session, owner, f"x {uuid.uuid4().hex}".encode())
    created.append(uploaded.document_id)
    queue = MagicMock()
    queue.enqueue = MagicMock(return_value=SimpleNamespace(id="job"))

    with patch.object(dr, "_get_extract_queue", return_value=queue):
        with pytest.raises(HTTPException) as foreign:
            await dr.extract_document_async(
                uploaded.document_id, dr.ExtractAsyncRequest(user_id="someone-else"),
                api_key=API_KEY, session=session,
            )
        with pytest.raises(HTTPException) as unknown:
            await dr.extract_document_async(
                10_000_000, dr.ExtractAsyncRequest(user_id=owner), api_key=API_KEY, session=session,
            )
        assert foreign.value.status_code == 404 and foreign.value.detail == "document_not_found"
        assert unknown.value.status_code == 404 and unknown.value.detail == "document_not_found"
        queue.enqueue.assert_not_called()

        out = await dr.extract_document_async(
            uploaded.document_id, dr.ExtractAsyncRequest(user_id=owner), api_key=API_KEY, session=session,
        )

    assert out.task_id.startswith("extract-")
    assert queue.enqueue.call_count == 1
    assert queue.enqueue.call_args.args[1:3] == (uploaded.document_id, owner)


class _SessionCM:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, *exc):
        return False


async def test_worker_reports_a_foreign_document_like_a_missing_one():
    from merlt.worker.extraction_tasks import _run_extract

    doc = MagicMock()
    doc.id = 7
    doc.uploaded_by = "owner"
    doc.storage_path = "/nonexistent/should-not-be-read"
    session = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=doc)
    session.execute = AsyncMock(return_value=result)
    callback = AsyncMock()

    with patch("merlt.storage.enrichment.database.init_db", new=AsyncMock()), patch(
        "merlt.storage.enrichment.database.get_db_session", return_value=_SessionCM(session)
    ), patch("merlt.worker.extraction_tasks._callback_extraction", new=callback), patch(
        "merlt.pipeline.document_parser.DocumentParserService"
    ) as parser_cls:
        out = await _run_extract(7, "intruder", "bff-job")

    assert out == {"document_id": 7, "status": "failed", "error": "document_not_found"}
    callback.assert_awaited_once_with("bff-job", "failed", error="document_not_found")
    parser_cls.assert_not_called()


# ---------------------------------------------------------------------------
# GET /experts/trace/{id} names its user
# ---------------------------------------------------------------------------

def _trace_session(qa_trace):
    session = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=qa_trace)
    session.execute = AsyncMock(return_value=result)
    return session


def _qa_trace(consent_level: str, full_trace: dict):
    return SimpleNamespace(
        trace_id="trace_1", user_id="u-owner", query="quesito", consent_level=consent_level,
        full_trace=full_trace,
    )


async def test_trace_carries_its_user_for_the_ownership_check():
    trace = _qa_trace("full", {"input": {"query": "quesito"}, "synthesis": {"answer": "..."}})

    out = await er.get_trace("trace_1", caller_consent="full", session=_trace_session(trace), api_key=API_KEY)

    assert out["user_id"] == "u-owner"


async def test_trace_user_is_redacted_for_anonymous_consent():
    trace = _qa_trace("anonymous", {"input": {"query": "quesito", "user_id": "u-owner"}, "synthesis": {}})

    out = await er.get_trace("trace_1", caller_consent="full", session=_trace_session(trace), api_key=API_KEY)

    assert out["user_id"] == "[REDACTED]"
    assert out["input"]["user_id"] == "[REDACTED]"


async def test_trace_keeps_a_user_the_pipeline_already_wrote():
    trace = _qa_trace("full", {"user_id": "u-from-pipeline", "synthesis": {}})

    out = await er.get_trace("trace_1", caller_consent="full", session=_trace_session(trace), api_key=API_KEY)

    assert out["user_id"] == "u-from-pipeline"
