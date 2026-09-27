"""Loop α A3 guard: a note-derived entity with no source norm is written
stand-alone, never hung off a phantom ``:Norma {URN:'user_document'}``.

``pending_entities.article_urn`` is NOT NULL, so stand-alone contributions carry
the ``user_document`` placeholder all the way to promotion. Before the guard,
``EntityGraphWriter._create_entity_relation`` ran ``MERGE (art:Norma {URN:
$article_urn})`` with that placeholder and every such concept ended up linked
to one fake hub on /grafo. Pure-python: the FalkorDB client is a recorder.
"""

from __future__ import annotations

import asyncio

from merlt.storage.enrichment.models import PendingEntity
from merlt.storage.graph.entity_writer import (
    PLACEHOLDER_ARTICLE_URNS,
    EntityGraphWriter,
    is_real_article_urn,
)


class _RecordingGraph:
    """Stands in for FalkorDBClient: records every Cypher text, answers CREATE."""

    def __init__(self) -> None:
        self.queries: list[str] = []

    async def query(self, cypher: str, params: dict | None = None):
        self.queries.append(cypher)
        if "CREATE (e:Entity" in cypher:
            return [[params["id"]]]
        return []


def _entity(article_urn: str) -> PendingEntity:
    return PendingEntity(
        entity_id="ent_test_1",
        article_urn=article_urn,
        entity_type="concetto",
        entity_text="Interesse negativo",
        ambito="generale",
        validation_status="approved",
        consensus_reached=True,
        consensus_type="approved",
        descrizione="",
        approval_score=2.0,
        votes_count=4,
        contributed_by="u1",
        contributor_authority=0.5,
    )


def test_placeholder_values_are_not_real_urns():
    for value in PLACEHOLDER_ARTICLE_URNS:
        assert not is_real_article_urn(value)
    assert not is_real_article_urn(None)
    assert not is_real_article_urn("   ")
    # Permissive on purpose: test/EU urns must keep their relation.
    assert is_real_article_urn("urn:test:art1")
    assert is_real_article_urn("https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:codice.civile:1942;262~art1453")


def test_stand_alone_entity_is_written_without_a_norma_hub():
    graph = _RecordingGraph()
    writer = EntityGraphWriter(graph)

    result = asyncio.run(writer.write_entity(_entity("user_document"), skip_deduplication=True))

    assert result.success and result.action == "created"
    assert any("CREATE (e:Entity" in q for q in graph.queries)
    assert not any("MERGE (art:Norma" in q for q in graph.queries)


def test_entity_bound_to_a_norm_keeps_its_relation():
    graph = _RecordingGraph()
    writer = EntityGraphWriter(graph)

    asyncio.run(writer.write_entity(_entity("urn:test:art1453"), skip_deduplication=True))

    assert any("MERGE (art:Norma" in q for q in graph.queries)


def test_relation_helper_refuses_the_placeholder_directly():
    """Any other caller of the relation helper is covered by the same guard."""
    graph = _RecordingGraph()
    writer = EntityGraphWriter(graph)

    asyncio.run(writer._create_entity_relation(_entity(""), "concetto:interesse_negativo"))

    assert graph.queries == []
