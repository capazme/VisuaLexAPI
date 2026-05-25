"""Unit tests for the RQ ingest task (MERLT-2a.3).

Non-integration: LegalKnowledgeGraph, the BFF callback, and the RQ job context
are all mocked. The live FalkorDB/Qdrant/Postgres path is covered by the manual
smoke checklist (`docs/merlt-smoke-checklist.md`).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from merlt.worker.tasks import _run_ingest, _urn_to_ingest_params

# Canonical Codice Civile art. 2043 in Normattiva URN form (RD 1942-03-16;262).
CC_2043_URN = "urn:nir:stato:regio.decreto:1942-03-16;262~art2043"


def _fake_kg(result: object | None = None, ingest_error: Exception | None = None) -> MagicMock:
    kg = MagicMock()
    kg.connect = AsyncMock()
    kg.close = AsyncMock()
    if ingest_error is not None:
        kg.ingest_norm = AsyncMock(side_effect=ingest_error)
    else:
        kg.ingest_norm = AsyncMock(return_value=result)
    return kg


async def test_ingest_success_calls_callback_completed():
    result = MagicMock()
    result.nodes_created = ["a", "b"]
    result.relations_created = ["x"]
    result.summary.return_value = {"nodes": 2, "relations": 1}

    kg = _fake_kg(result=result)

    with patch("merlt.worker.tasks.LegalKnowledgeGraph", return_value=kg), patch(
        "merlt.worker.tasks._callback_bff", new=AsyncMock()
    ) as mock_callback:
        out = await _run_ingest(CC_2043_URN, "job-1")

    kg.connect.assert_awaited_once()
    kg.close.assert_awaited_once()
    mock_callback.assert_awaited_once()
    assert mock_callback.await_args.args == ("job-1", "completed")
    assert mock_callback.await_args.kwargs["nodes_created"] == 2
    assert mock_callback.await_args.kwargs["edges_created"] == 1
    assert out["nodes_created"] == 2
    assert out["edges_created"] == 1


async def test_ingest_failure_last_retry_calls_callback_failed():
    boom = RuntimeError("falkordb exploded")
    kg = _fake_kg(ingest_error=boom)

    job = MagicMock()
    job.retries_left = 0

    with patch("merlt.worker.tasks.LegalKnowledgeGraph", return_value=kg), patch(
        "rq.get_current_job", return_value=job
    ), patch("merlt.worker.tasks._callback_bff", new=AsyncMock()) as mock_callback:
        with pytest.raises(RuntimeError):
            await _run_ingest(CC_2043_URN, "job-1")

    kg.close.assert_awaited_once()
    mock_callback.assert_awaited_once()
    assert mock_callback.await_args.args == ("job-1", "failed")
    assert mock_callback.await_args.kwargs["error"] == "falkordb exploded"


async def test_ingest_failure_non_final_retry_does_not_call_callback():
    # ingest_norm raises but RQ still has retries left -> NO failed callback yet.
    boom = RuntimeError("transient falkordb hiccup")
    kg = _fake_kg(ingest_error=boom)

    job = MagicMock()
    job.retries_left = 2

    with patch("merlt.worker.tasks.LegalKnowledgeGraph", return_value=kg), patch(
        "rq.get_current_job", return_value=job
    ), patch("merlt.worker.tasks._callback_bff", new=AsyncMock()) as mock_callback:
        with pytest.raises(RuntimeError):
            await _run_ingest(CC_2043_URN, "job-1")

    kg.close.assert_awaited_once()
    mock_callback.assert_not_awaited()


def test_urn_to_ingest_params_resolves_cc():
    # NORMATTIVA_URN_CODICI maps "codice civile" -> "regio.decreto:1942-03-16;262:2";
    # the reverse-lookup strips the trailing allegato ":2" and matches the RD URN.
    tipo_atto, articolo = _urn_to_ingest_params(CC_2043_URN)
    assert tipo_atto == "codice civile"
    assert articolo == "2043"
