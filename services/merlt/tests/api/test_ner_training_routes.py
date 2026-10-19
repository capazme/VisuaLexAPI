"""NER training routes: the RQ result outlives the admin's poll, and the last
A/B report is served from the models volume after it expired.

Pure: fake RQ queue, report directory under tmp_path.
"""

from __future__ import annotations

import importlib
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from merlt.worker import ner_training_tasks as tasks

ner_router = importlib.import_module("merlt.api.ner_router")


async def test_training_enqueue_keeps_the_result(monkeypatch):
    captured = {}

    class _Queue:
        def enqueue(self, func, *args, **kwargs):
            captured.update(kwargs, func=func, args=args)

    monkeypatch.setattr(ner_router, "_get_ner_train_queue", lambda: _Queue())
    response = await ner_router.start_ner_training(
        ner_router.NERTrainingStartRequest(n_iter=5), api_key=MagicMock()
    )

    assert response["status"] == "queued"
    assert captured["func"] == "merlt.worker.ner_training_tasks.train_ner_model"
    assert captured["args"] == (5, False)
    # RQ's default result_ttl (500s) dropped the A/B report before the card polled.
    assert captured["result_ttl"] >= 24 * 3600
    assert captured["failure_ttl"] >= 24 * 3600


async def test_latest_report_404_until_a_run_completes(tmp_path, monkeypatch):
    monkeypatch.setenv(tasks.REPORTS_DIR_ENV, str(tmp_path))
    with pytest.raises(HTTPException) as exc:
        await ner_router.ner_training_latest_report(api_key=MagicMock())
    assert exc.value.status_code == 404
    assert exc.value.detail == "no_report"


async def test_latest_report_is_served(tmp_path, monkeypatch):
    monkeypatch.setenv(tasks.REPORTS_DIR_ENV, str(tmp_path))
    report = {"test_examples": 4, "baseline": None, "baseline_available": False, "created_at": "2026-09-25T00:00:00+00:00"}
    tasks.persist_ab_report(report)

    assert await ner_router.ner_training_latest_report(api_key=MagicMock()) == report


async def test_unreadable_report_is_an_error_not_a_missing_one(tmp_path, monkeypatch):
    monkeypatch.setenv(tasks.REPORTS_DIR_ENV, str(tmp_path))
    (tmp_path / tasks.LATEST_REPORT_NAME).write_text("{not json")
    with pytest.raises(HTTPException) as exc:
        await ner_router.ner_training_latest_report(api_key=MagicMock())
    assert exc.value.status_code == 500
