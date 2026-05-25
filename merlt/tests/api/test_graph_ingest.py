"""Unit tests for POST /api/v1/graph/ingest-article (MERLT-2a.2).

The RQ worker that consumes "merlt.worker.tasks.ingest_article" jobs is built in
a later story (MERLT-2a.3); these tests assert only the enqueue contract,
mocking the RQ queue and Job.

The handler is invoked directly (not via the ASGI client) because the shared
auth dependency hits Postgres on every request, which the unit test venv has no
credentials for. The seed-loader unit tests use the same direct-call style.
"""

from __future__ import annotations

import hashlib
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

import importlib

from merlt.api.graph_router import (
    IngestArticleOptions,
    IngestArticleRequest,
    ingest_article,
)

# `merlt.api.graph_router` is shadowed by an APIRouter re-export at the package
# level, so reach the real module object via importlib for singleton-state access.
gr = importlib.import_module("merlt.api.graph_router")


def _expected_job_id(urn: str) -> str:
    return "ingest:" + hashlib.sha256(urn.encode("utf-8")).hexdigest()[:40]


@pytest.mark.asyncio
async def test_ingest_article_enqueues_new_job():
    urn = "urn:lex:it:codice.civile:1942;art2043"
    expected_job_id = _expected_job_id(urn)
    job = MagicMock()
    job.id = expected_job_id

    queue = MagicMock()
    queue.connection = MagicMock()
    queue.enqueue = MagicMock(return_value=job)

    request = IngestArticleRequest(
        urn=urn,
        options=IngestArticleOptions(bff_job_id="bff-123"),
    )

    with patch("merlt.api.graph_router._get_rq_queue", return_value=queue), patch(
        "merlt.api.graph_router.Job"
    ) as mock_job_cls:
        # No existing job -> Job.fetch raises NoSuchJobError -> pre-check returns None
        from rq.exceptions import NoSuchJobError

        mock_job_cls.fetch.side_effect = NoSuchJobError("no such job")
        response = await ingest_article(request, api_key=None)

    assert response.status == "queued"
    assert response.urn == urn
    assert response.task_id == expected_job_id

    queue.enqueue.assert_called_once()
    call = queue.enqueue.call_args
    assert call.args[0] == "merlt.worker.tasks.ingest_article"
    assert call.args[1] == urn
    assert call.kwargs["job_id"] == expected_job_id


@pytest.mark.asyncio
async def test_ingest_article_idempotent_when_already_queued():
    urn = "urn:lex:it:codice.civile:1942;art2043"
    expected_job_id = _expected_job_id(urn)

    existing_job = MagicMock()
    existing_job.get_status.return_value = "queued"

    queue = MagicMock()
    queue.connection = MagicMock()
    queue.enqueue = MagicMock()

    request = IngestArticleRequest(urn=urn)

    with patch("merlt.api.graph_router._get_rq_queue", return_value=queue), patch(
        "merlt.api.graph_router.Job"
    ) as mock_job_cls:
        mock_job_cls.fetch.return_value = existing_job
        response = await ingest_article(request, api_key=None)

    assert response.status == "already_queued"
    assert response.task_id == expected_job_id
    assert response.urn == urn
    existing_job.get_status.assert_called_once_with(refresh=True)
    queue.enqueue.assert_not_called()


@pytest.mark.asyncio
async def test_ingest_article_force_refresh_bypasses_idempotency():
    urn = "urn:lex:it:codice.civile:1942;art2043"
    expected_job_id = _expected_job_id(urn)

    job = MagicMock()
    job.id = expected_job_id

    # An active job exists, but force_refresh must bypass the pre-check.
    existing_job = MagicMock()
    existing_job.get_status.return_value = "queued"

    queue = MagicMock()
    queue.connection = MagicMock()
    queue.enqueue = MagicMock(return_value=job)

    request = IngestArticleRequest(
        urn=urn,
        options=IngestArticleOptions(force_refresh=True),
    )

    with patch("merlt.api.graph_router._get_rq_queue", return_value=queue), patch(
        "merlt.api.graph_router.Job"
    ) as mock_job_cls:
        mock_job_cls.fetch.return_value = existing_job
        response = await ingest_article(request, api_key=None)

    assert response.status == "queued"
    assert response.task_id == expected_job_id
    assert response.urn == urn
    queue.enqueue.assert_called_once()
    # Pre-check must have been skipped entirely.
    mock_job_cls.fetch.assert_not_called()


def test_get_rq_queue_reuses_connection():
    # Isolate from other tests that may have populated the module singleton.
    gr._rq_connection = None

    fake_conn = MagicMock()
    with patch("merlt.api.graph_router.Redis.from_url", return_value=fake_conn) as mock_from_url:
        gr._get_rq_queue()
        gr._get_rq_queue()

    assert mock_from_url.call_count == 1

    # Reset so we don't leak the mock connection into other tests.
    gr._rq_connection = None


def test_ingest_article_validation_error_missing_urn():
    with pytest.raises(ValidationError):
        IngestArticleRequest()
