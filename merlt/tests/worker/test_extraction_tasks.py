"""Unit tests for the RQ document-extraction task (Slice 2c gap-closure).

Non-integration: the enrichment DB session, DocumentParserService, and the BFF
callback are all mocked. Covers the `candidates_created` count regression: the
callback/return payload must sum entities AND relations, not just entities
(`ParseResult.relations_count` was previously dropped).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from merlt.pipeline.document_parser import ParseResult
from merlt.worker.extraction_tasks import _run_extract


class _FakeSessionCM:
    def __init__(self, session: AsyncMock) -> None:
        self._session = session

    async def __aenter__(self) -> AsyncMock:
        return self._session

    async def __aexit__(self, *exc: object) -> bool:
        return False


def _fake_session(doc: object) -> AsyncMock:
    session = AsyncMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none = MagicMock(return_value=doc)
    session.execute = AsyncMock(return_value=execute_result)
    session.commit = AsyncMock()
    return session


def _fake_doc() -> MagicMock:
    doc = MagicMock()
    doc.id = 1
    doc.storage_path = "/tmp/merlt-test-extraction-tasks-does-not-exist.pdf"
    doc.file_type = "pdf"
    doc.document_type = "manuale"
    doc.legal_domain = "civile"
    return doc


async def test_extract_completed_sums_entities_and_relations():
    doc = _fake_doc()
    session = _fake_session(doc)

    parser_instance = MagicMock()
    parser_instance.parse_document = AsyncMock(
        return_value=ParseResult(entities_count=3, relations_count=2)
    )

    with patch(
        "merlt.storage.enrichment.database.init_db", new=AsyncMock()
    ), patch(
        "merlt.storage.enrichment.database.get_db_session",
        return_value=_FakeSessionCM(session),
    ), patch(
        "merlt.pipeline.document_parser.DocumentParserService",
        return_value=parser_instance,
    ), patch(
        "merlt.worker.extraction_tasks._callback_extraction", new=AsyncMock()
    ) as mock_callback:
        out = await _run_extract(document_id=1, user_id="user-1", bff_job_id="job-1")

    assert out["status"] == "completed"
    assert out["candidates_created"] == 5  # 3 entities + 2 relations, not just 3
    mock_callback.assert_awaited_once_with("job-1", "completed", candidates_created=5)


async def test_extract_completed_with_zero_relations_matches_entities_only():
    doc = _fake_doc()
    session = _fake_session(doc)

    parser_instance = MagicMock()
    parser_instance.parse_document = AsyncMock(
        return_value=ParseResult(entities_count=4, relations_count=0)
    )

    with patch(
        "merlt.storage.enrichment.database.init_db", new=AsyncMock()
    ), patch(
        "merlt.storage.enrichment.database.get_db_session",
        return_value=_FakeSessionCM(session),
    ), patch(
        "merlt.pipeline.document_parser.DocumentParserService",
        return_value=parser_instance,
    ), patch(
        "merlt.worker.extraction_tasks._callback_extraction", new=AsyncMock()
    ) as mock_callback:
        out = await _run_extract(document_id=1, user_id="user-1", bff_job_id="job-1")

    assert out["candidates_created"] == 4
    mock_callback.assert_awaited_once_with("job-1", "completed", candidates_created=4)


async def test_extract_document_not_found_calls_failed_callback():
    session = _fake_session(None)

    with patch(
        "merlt.storage.enrichment.database.init_db", new=AsyncMock()
    ), patch(
        "merlt.storage.enrichment.database.get_db_session",
        return_value=_FakeSessionCM(session),
    ), patch(
        "merlt.worker.extraction_tasks._callback_extraction", new=AsyncMock()
    ) as mock_callback:
        out = await _run_extract(document_id=999, user_id="user-1", bff_job_id="job-1")

    assert out["status"] == "failed"
    assert out["error"] == "document_not_found"
    mock_callback.assert_awaited_once_with("job-1", "failed", error="document_not_found")
