"""Unit tests for the relation staging branch of DocumentParserService (B1).

Mirrors test_extraction_staging for relations: `persist_target="staging"` lands
relation candidates in ExtractionCandidate(candidate_type="relation"), while
"pending" creates PendingRelation rows. Uses a fake extractor + fake session.

    docker exec -w /app visualex-merlt-api python -m pytest tests/pipeline/test_relation_staging.py -q
"""

from __future__ import annotations

from unittest.mock import patch

from merlt.pipeline.document_parser import DocumentParserService
from merlt.pipeline.enrichment.extractors.relation import ExtractedRelation
from merlt.storage.enrichment.models import ExtractionCandidate, PendingRelation


class _FakeSession:
    def __init__(self) -> None:
        self.added: list = []

    def add(self, obj) -> None:
        self.added.append(obj)


class _FakeRelExtractor:
    def __init__(self, _llm_service):
        pass

    async def extract(self, _content):
        return [
            ExtractedRelation(
                source="Risoluzione",
                target="Inadempimento",
                relation_type="PRESUPPONE",
                descrizione="d",
                confidence=0.9,
            )
        ]


async def _run(persist_target: str):
    parser = DocumentParserService()
    parser.llm_service = object()  # truthy → extraction proceeds
    session = _FakeSession()
    with patch(
        "merlt.pipeline.enrichment.extractors.relation.RelationExtractor",
        _FakeRelExtractor,
    ):
        count = await parser._extract_relations_from_chunks(
            chunks=["un lungo chunk di testo " * 30],
            legal_domain="civile",
            user_id="user-1",
            session=session,
            persist_target=persist_target,
            document_id=42,
        )
    return count, session.added


async def test_staging_creates_relation_candidates():
    count, added = await _run("staging")
    assert count == 1
    assert all(isinstance(o, ExtractionCandidate) for o in added)
    c = added[0]
    assert c.candidate_type == "relation"
    assert c.relation_type == "PRESUPPONE"
    assert c.source_node_urn == "Risoluzione"
    assert c.target_entity_id == "Inadempimento"
    assert c.verbatim_excerpt  # raw context kept in staging
    assert c.document_id == 42


async def test_pending_creates_pending_relations():
    count, added = await _run("pending")
    assert count == 1
    assert all(isinstance(o, PendingRelation) for o in added)
    assert added[0].relation_type == "PRESUPPONE"
    assert added[0].source_node_urn == "Risoluzione"
