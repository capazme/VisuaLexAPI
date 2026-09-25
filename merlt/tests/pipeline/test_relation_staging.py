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


# ---------------------------------------------------------------------------
# B1: best-effort endpoint resolution at extraction time
# ---------------------------------------------------------------------------

from datetime import datetime, timedelta  # noqa: E402

from merlt.storage.enrichment.deduplication import (  # noqa: E402
    DeduplicationResult,
    DuplicateCandidate,
    DuplicateConfidence,
)

_URN = "urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453"


class _SessionWithSiblings(_FakeSession):
    """Holds a same-document entity candidate not flushed yet (the enrichment
    session does not autoflush) and has no database behind it."""

    def __init__(self, siblings) -> None:
        super().__init__()
        self.added.extend(siblings)

    @property
    def new(self):
        return list(self.added)

    async def execute(self, _stmt):
        raise RuntimeError("no database in this test")


class _PairsExtractor:
    pairs: list = []

    def __init__(self, _llm_service):
        pass

    async def extract(self, _content):
        return [
            ExtractedRelation(source=s, target=t, relation_type="PRESUPPONE", descrizione="d", confidence=0.9)
            for s, t in self.pairs
        ]


class _FakeDeduplicator:
    """Only 'Buona fede' has an exact match (a pending entity); 'Buona fedeltà'
    is merely similar and must not resolve."""

    calls: list = []

    def __init__(self, _session):
        pass

    async def find_duplicates(self, entity_text, entity_type, article_urn=None, scope="global", limit=10):
        self.calls.append(entity_text)
        result = DeduplicationResult(query_text=entity_text, query_type=entity_type, normalized_query="")
        if entity_text == "Buona fede":
            match = DuplicateCandidate(
                entity_id="principio:ab12cd34", entity_text="Buona fede", entity_type="principio",
                descrizione=None, article_urn="user_document", similarity_score=1.0,
                confidence=DuplicateConfidence.EXACT, match_reason="exact_normalized",
            )
            result.exact_match = match
            result.duplicates = [match]
            result.has_duplicates = True
        elif entity_text == "Buona fedeltà":
            result.duplicates = [
                DuplicateCandidate(
                    entity_id="principio:ffff0000", entity_text="Buona fede", entity_type="principio",
                    descrizione=None, article_urn="user_document", similarity_score=0.85,
                    confidence=DuplicateConfidence.LOW, match_reason="fuzzy_name",
                )
            ]
            result.has_duplicates = True
        return result


def _sibling(name: str, tipo: str = "concetto", document_id: int = 42) -> ExtractionCandidate:
    return ExtractionCandidate(
        document_id=document_id, contributor_id="user-1", candidate_type="entity",
        entity_text=name, entity_type=tipo, status="draft",
        expires_at=datetime.now() + timedelta(hours=1),
    )


async def _run_resolution(pairs, siblings):
    parser = DocumentParserService()
    parser.llm_service = object()
    session = _SessionWithSiblings(siblings)
    _PairsExtractor.pairs = pairs
    _FakeDeduplicator.calls = []
    with patch("merlt.pipeline.enrichment.extractors.relation.RelationExtractor", _PairsExtractor), patch(
        "merlt.pipeline.document_parser.EntityDeduplicator", _FakeDeduplicator
    ):
        await parser._extract_relations_from_chunks(
            chunks=["un lungo chunk di testo " * 30],
            legal_domain="civile",
            user_id="user-1",
            session=session,
            persist_target="staging",
            document_id=42,
        )
    return [o for o in session.added if isinstance(o, ExtractionCandidate) and o.candidate_type == "relation"]


async def test_same_document_entity_resolves_to_its_entity_node_id():
    [row] = await _run_resolution(
        [("La risoluzione del contratto", "Clausola vaga")],
        [_sibling("Risoluzione del contratto")],
    )
    # The id its Entity node will carry once promoted and approved.
    assert row.source_node_urn == "concetto:risoluzione_del_contratto"
    assert row.source_text == "La risoluzione del contratto"
    # Nothing matched: the raw name stays, and stays readable.
    assert row.target_entity_id == "Clausola vaga"
    assert row.target_text == "Clausola vaga"


async def test_exact_dedup_match_resolves_to_the_pending_entity_id():
    [row] = await _run_resolution([("Buona fede", "Buona fedeltà")], [])
    assert row.source_node_urn == "principio:ab12cd34"
    # A low-confidence fuzzy hit is not an identity.
    assert row.target_entity_id == "Buona fedeltà"


async def test_urn_endpoint_is_kept_without_the_version_marker():
    [row] = await _run_resolution([(_URN + "!vig=", "Buona fede")], [])
    assert row.source_node_urn == _URN
    assert row.source_text == _URN + "!vig="
    assert row.target_entity_id == "principio:ab12cd34"


async def test_sibling_of_another_document_does_not_resolve():
    [row] = await _run_resolution(
        [("Risoluzione del contratto", "Clausola vaga")],
        [_sibling("Risoluzione del contratto", document_id=7)],
    )
    assert row.source_node_urn == "Risoluzione del contratto"


async def test_each_name_is_resolved_once_per_extraction():
    await _run_resolution([("Buona fede", "Clausola vaga"), ("Buona fede", "Clausola vaga")], [])
    assert _FakeDeduplicator.calls.count("Buona fede") == 1
    assert _FakeDeduplicator.calls.count("Clausola vaga") == 1
