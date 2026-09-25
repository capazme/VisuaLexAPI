"""B1: an approved relation is written only between graph nodes that exist.

Note-derived relations carried concept names as endpoints, and on consensus
``_write_relation_to_graph`` ran ``MERGE (:Norma {URN: <concept name>})``: every
approved note relation planted phantom norms in the shared graph. The writer
now resolves each endpoint (norm URN/URL, pending entity id, Entity id,
node_id, unique Entity name); an unresolved one leaves the relation unwritten
(``written_to_graph_at`` NULL, status unchanged, reason logged and returned),
and a pending-entity endpoint is retried once that entity is written.

Postgres-backed (pending_* rows) with an in-memory fake graph:
    docker exec -w /app visualex-merlt-api python -m pytest tests/api/test_relation_graph_write.py -q
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from unittest.mock import MagicMock

import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from merlt.api.enrichment_router import (
    _write_deferred_relations_for_entity,
    _write_relation_to_graph,
    get_pending,
)
from merlt.api.models.enrichment_models import PendingQueueRequest
from merlt.storage.enrichment.database import get_database_url
from merlt.storage.enrichment.models import PendingEntity, PendingRelation
from merlt.storage.graph.relation_endpoints import NORMATTIVA_URL_PREFIX

WRITE_MARK = "MERGE (source)-["


class _FakeGraph:
    """Answers the endpoint lookups from in-memory node sets; records queries."""

    def __init__(self, normas=(), entities=(), node_ids=(), entity_names=None) -> None:
        self.normas = set(normas)
        self.entities = set(entities)
        self.node_ids = set(node_ids)
        self.entity_names: Dict[str, str] = dict(entity_names or {})
        self.queries: List[Tuple[str, Dict[str, Any]]] = []

    async def query(self, cypher: str, params: Optional[Dict[str, Any]] = None):
        params = params or {}
        self.queries.append((cypher, params))
        if WRITE_MARK in cypher:
            return [{"r": "edge"}]
        if "n.URN IN $keys" in cypher:
            hits = [k for k in params["keys"] if k in self.normas]
            return [{"key": hits[0]}] if hits else []
        if "MATCH (n:Entity {id: $key})" in cypher:
            return [{"key": params["key"]}] if params["key"] in self.entities else []
        if "n.node_id = $key" in cypher:
            return [{"key": params["key"]}] if params["key"] in self.node_ids else []
        if "toLower(n.nome)" in cypher:
            return [{"key": i} for i, n in self.entity_names.items() if n.lower() == params["name"]][:2]
        return []

    @property
    def writes(self):
        return [(q, p) for q, p in self.queries if WRITE_MARK in q]

    def merged_norma_keys(self) -> List[str]:
        keys = []
        for q, p in self.writes:
            for var in ("source", "target"):
                if f"MERGE ({var}:Norma" in q:
                    keys.append(p[f"{var}_key"])
        return keys


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine(get_database_url(), poolclass=NullPool)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    created: Dict[str, List[str]] = {"relations": [], "entities": []}
    yield factory, created
    async with factory() as session:
        await session.execute(
            text("DELETE FROM pending_relations WHERE relation_id = ANY(:ids)"), {"ids": created["relations"]}
        )
        await session.execute(
            text("DELETE FROM pending_entities WHERE entity_id = ANY(:ids)"), {"ids": created["entities"]}
        )
        await session.commit()
    await engine.dispose()


async def _relation(factory, created, source: str, target: str, *, status: str = "approved",
                    article_urn: str = "user_document", marker: Optional[str] = None) -> str:
    rid = f"PRESUPPONE:zz{uuid.uuid4().hex[:10]}"
    async with factory() as session:
        session.add(
            PendingRelation(
                relation_id=rid,
                article_urn=article_urn,
                source_type="manual",
                relation_type="PRESUPPONE",
                source_node_urn=source,
                target_entity_id=target,
                relation_description=f"evidenza {marker or ''}",
                certezza=0.8,
                fonte="community",
                validation_status=status,
                consensus_reached=status == "approved",
                consensus_type="approved" if status == "approved" else None,
                approval_score=2.5 if status == "approved" else 0.0,
                votes_count=3 if status == "approved" else 0,
                contributed_by="u-b1",
            )
        )
        await session.commit()
    created["relations"].append(rid)
    return rid


async def _entity(factory, created, name: str, *, status: str = "pending", written: bool = False) -> str:
    eid = f"concetto:{uuid.uuid4().hex[:8]}"
    async with factory() as session:
        session.add(
            PendingEntity(
                entity_id=eid,
                article_urn="user_document",
                source_type="manual",
                entity_type="concetto",
                entity_text=name,
                validation_status=status,
                consensus_reached=status in ("approved", "rejected"),
                consensus_type=status if status in ("approved", "rejected") else None,
                written_to_graph_at=datetime.now() if written else None,
                contributed_by="u-b1",
            )
        )
        await session.commit()
    created["entities"].append(eid)
    return eid


async def _load(session, rid: str) -> PendingRelation:
    return (await session.execute(select(PendingRelation).where(PendingRelation.relation_id == rid))).scalar_one()


async def test_concept_names_never_become_norma_nodes(db):
    factory, created = db
    rid = await _relation(factory, created, "Risoluzione del contratto", "Inadempimento")
    graph = _FakeGraph()

    async with factory() as session:
        outcome = await _write_relation_to_graph(await _load(session, rid), session, graph)

    assert outcome.written is False
    assert outcome.deferred is False
    assert "Risoluzione del contratto" in outcome.reason and "Inadempimento" in outcome.reason
    assert not any("MERGE" in q for q, _ in graph.queries), "an unresolved endpoint must not be MERGEd"
    async with factory() as session:
        row = await _load(session, rid)
        assert row.written_to_graph_at is None
        assert row.validation_status == "approved"


async def test_placeholder_article_never_stands_in_for_the_source(db):
    factory, created = db
    rid = await _relation(factory, created, "", "concetto:esistente")
    graph = _FakeGraph(entities={"concetto:esistente"})

    async with factory() as session:
        outcome = await _write_relation_to_graph(await _load(session, rid), session, graph)

    assert outcome.written is False
    assert "source" in outcome.reason
    assert graph.writes == []


async def test_urn_source_and_graph_entity_target_are_written(db):
    factory, created = db
    marker = uuid.uuid4().hex[:8]
    urn = f"urn:nir:stato:legge:2020-01-01;{marker}~art3"
    rid = await _relation(factory, created, urn + "!vig=", "concetto:risoluzione_del_contratto")
    graph = _FakeGraph(entities={"concetto:risoluzione_del_contratto"})

    async with factory() as session:
        outcome = await _write_relation_to_graph(await _load(session, rid), session, graph)

    assert outcome.written is True
    [(cypher, params)] = graph.writes
    # The NIR URN escape hatch: a missing norm is MERGEd as a stub, keyed
    # without the version marker; the target is MATCHed, never created.
    assert "MERGE (source:Norma {URN: $source_key})" in cypher
    assert "MATCH (target:Entity {id: $target_key})" in cypher
    assert params["source_key"] == urn
    assert params["target_key"] == "concetto:risoluzione_del_contratto"
    assert params["source_numero_articolo"] == "3"
    async with factory() as session:
        assert (await _load(session, rid)).written_to_graph_at is not None


async def test_bare_urn_matches_the_url_keyed_seed_norm(db):
    factory, created = db
    marker = uuid.uuid4().hex[:8]
    urn = f"urn:nir:stato:legge:2020-01-01;{marker}~art4"
    rid = await _relation(factory, created, "concetto:mora", urn)
    graph = _FakeGraph(normas={NORMATTIVA_URL_PREFIX + urn}, entities={"concetto:mora"})

    async with factory() as session:
        outcome = await _write_relation_to_graph(await _load(session, rid), session, graph)

    assert outcome.written is True
    [(cypher, params)] = graph.writes
    assert "MATCH (target:Norma {URN: $target_key})" in cypher
    assert params["target_key"] == NORMATTIVA_URL_PREFIX + urn
    assert graph.merged_norma_keys() == []


async def test_seed_node_id_and_unique_entity_name_resolve(db):
    factory, created = db
    rid = await _relation(factory, created, "seed-concetto-7", "Buona fede oggettiva")
    graph = _FakeGraph(node_ids={"seed-concetto-7"}, entity_names={"principio:buona_fede_oggettiva": "Buona fede oggettiva"})

    async with factory() as session:
        outcome = await _write_relation_to_graph(await _load(session, rid), session, graph)

    assert outcome.written is True
    [(cypher, params)] = graph.writes
    assert "MATCH (source {node_id: $source_key})" in cypher
    assert params["target_key"] == "principio:buona_fede_oggettiva"


async def test_ambiguous_entity_name_is_not_guessed(db):
    factory, created = db
    rid = await _relation(factory, created, "concetto:mora", "Buona fede")
    graph = _FakeGraph(
        entities={"concetto:mora"},
        entity_names={"principio:buona_fede": "Buona fede", "concetto:buona_fede": "Buona fede"},
    )

    async with factory() as session:
        outcome = await _write_relation_to_graph(await _load(session, rid), session, graph)

    assert outcome.written is False
    assert graph.writes == []


async def test_invalid_relation_type_is_refused(db):
    factory, created = db
    rid = await _relation(factory, created, "concetto:a", "concetto:b")
    async with factory() as session:
        relation = await _load(session, rid)
        relation.relation_type = "CITA]->(x) DETACH DELETE x //"
        outcome = await _write_relation_to_graph(relation, session, _FakeGraph(entities={"concetto:a", "concetto:b"}))
    assert outcome.written is False
    assert "invalid relation type" in outcome.reason


async def test_pending_entity_endpoint_is_deferred_then_written(db):
    factory, created = db
    marker = uuid.uuid4().hex[:8]
    name = f"Recesso {marker}"
    eid = await _entity(factory, created, name)
    node_id = f"concetto:recesso_{marker}"
    rid = await _relation(factory, created, "concetto:esistente", eid)
    graph = _FakeGraph(entities={"concetto:esistente"})

    async with factory() as session:
        outcome = await _write_relation_to_graph(await _load(session, rid), session, graph)
    assert outcome.written is False
    assert outcome.deferred is True
    assert graph.writes == []

    # Consensus approves the entity; the entity writer puts its node in the graph.
    async with factory() as session:
        entity = (await session.execute(select(PendingEntity).where(PendingEntity.entity_id == eid))).scalar_one()
        entity.validation_status = "approved"
        entity.consensus_reached = True
        entity.consensus_type = "approved"
        entity.written_to_graph_at = datetime.now()
        await session.commit()
        graph.entities.add(node_id)

        written = await _write_deferred_relations_for_entity(entity, node_id, session, graph)

    assert written == 1
    [(cypher, params)] = graph.writes
    assert params["target_key"] == node_id
    async with factory() as session:
        assert (await _load(session, rid)).written_to_graph_at is not None


async def test_forward_reference_to_a_same_document_entity_is_retried(db):
    """Staging resolves a same-document concept to the id its Entity will
    carry; the relation waits for that entity, whatever its pending id."""
    factory, created = db
    marker = uuid.uuid4().hex[:8]
    node_id = f"concetto:clausola_{marker}"
    rid = await _relation(factory, created, node_id, "concetto:esistente")
    graph = _FakeGraph(entities={"concetto:esistente"})

    async with factory() as session:
        outcome = await _write_relation_to_graph(await _load(session, rid), session, graph)
    assert (outcome.written, outcome.deferred) == (False, True)

    eid = await _entity(factory, created, f"Clausola {marker}", status="approved", written=True)
    graph.entities.add(node_id)
    async with factory() as session:
        entity = (await session.execute(select(PendingEntity).where(PendingEntity.entity_id == eid))).scalar_one()
        assert await _write_deferred_relations_for_entity(entity, node_id, session, graph) == 1


async def test_rejected_pending_entity_is_unresolved_not_deferred(db):
    factory, created = db
    eid = await _entity(factory, created, f"Scartata {uuid.uuid4().hex[:8]}", status="rejected")
    rid = await _relation(factory, created, "concetto:esistente", eid)

    async with factory() as session:
        outcome = await _write_relation_to_graph(
            await _load(session, rid), session, _FakeGraph(entities={"concetto:esistente"})
        )
    assert outcome.written is False
    assert outcome.deferred is False
    assert "rejected" in outcome.reason


async def test_get_pending_labels_the_endpoints(db):
    factory, created = db
    marker = uuid.uuid4().hex[:10]
    name = f"Caparra confirmatoria {marker}"
    eid = await _entity(factory, created, name)
    urn = f"{NORMATTIVA_URL_PREFIX}urn:nir:stato:regio.decreto:1942-03-16;262:2~art1385"
    article = f"urn:zz:{marker}:art1"
    with_pending = await _relation(factory, created, urn, eid, status="pending", article_urn=article)
    with_id = await _relation(
        factory, created, "concetto:risoluzione_del_contratto", "Clausola vaga", status="pending", article_urn=article
    )

    async with factory() as session:
        queue = await get_pending(
            PendingQueueRequest(user_id=f"viewer-{marker}", article_urn=marker, limit=100),
            session=session,
            api_key=MagicMock(),
        )

    relations = {r.id: r for r in queue.pending_relations}
    assert relations[with_pending].source_label == "Art. 1385"
    assert relations[with_pending].target_label == name
    assert relations[with_pending].target_urn == eid  # the identifier is unchanged
    assert relations[with_id].source_label == "Risoluzione del contratto"
    assert relations[with_id].target_label == "Clausola vaga"
