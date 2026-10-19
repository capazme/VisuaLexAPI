"""Unit tests for the Slice 2c staging branch of DocumentParserService.

Asserts that `persist_target="staging"` lands candidates in ExtractionCandidate
(NOT pending_*), keeping the raw verbatim out of the shared proposal pipeline.

Run inside the MERL-T env (deps: sqlalchemy, structlog, …):
    pip install -e ".[dev]" && pytest tests/pipeline/test_extraction_staging.py
(Not runnable from the VisuaLex repo root — those deps live in the merlt venv.)
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

from merlt.pipeline.document_parser import DocumentParserService
from merlt.storage.enrichment.models import ExtractionCandidate, PendingEntity


class _FakeSession:
    """Records objects passed to session.add()."""

    def __init__(self) -> None:
        self.added: list = []

    def add(self, obj) -> None:
        self.added.append(obj)


class _FakeExtractor:
    def __init__(self, entities):
        self._entities = entities

    async def extract(self, _content):
        return self._entities


def _fake_entity():
    return SimpleNamespace(
        nome="Risoluzione",
        descrizione="Scioglimento del vincolo contrattuale.",
        tipo=SimpleNamespace(value="concetto"),
        confidence=0.9,
    )


async def _run(persist_target: str):
    parser = DocumentParserService()
    parser.llm_service = object()  # truthy → extraction proceeds
    session = _FakeSession()
    # One extractor for every entity type, each yielding a single entity.
    with patch(
        "merlt.pipeline.enrichment.extractors.create_extractor",
        return_value=_FakeExtractor([_fake_entity()]),
    ):
        count = await parser._extract_entities_from_chunks(
            chunks=["un lungo chunk di testo " * 30],
            legal_domain="civile",
            user_id="user-123",
            session=session,
            persist_target=persist_target,
            document_id=42,
        )
    return count, session.added


async def test_staging_creates_extraction_candidates_not_pending():
    count, added = await _run("staging")
    assert count > 0
    assert added, "expected at least one candidate"
    assert all(isinstance(o, ExtractionCandidate) for o in added)
    assert all(not isinstance(o, PendingEntity) for o in added)
    first = added[0]
    assert first.document_id == 42
    assert first.contributor_id == "user-123"
    assert first.status == "draft"
    assert first.verbatim_excerpt  # the raw context is kept in staging
    assert first.entity_text == "Risoluzione"


async def test_pending_mode_still_creates_pending_entities():
    count, added = await _run("pending")
    assert count > 0
    assert all(isinstance(o, PendingEntity) for o in added)
