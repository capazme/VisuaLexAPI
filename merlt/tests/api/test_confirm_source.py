"""Loop β D.1 — POST /api/v1/enrichment/confirm-source ("ricorda nel grafo").

The BFF (backend/src/services/merlt/expertsClient.ts) has always proxied this
path, but MERL-T never declared it: every confirm answered 404 and the source
chip went to its error state. These tests pin the route's contract:

- a non-``live:`` id is refused, an unknown node is a 404;
- a Normattiva article goes to the lazy-ingest queue (``ingest-`` + sha256 job
  id, ``!vig=`` stripped) and creates no proposal;
- any other source becomes a ``pending_entity`` attributed to the user, whose
  description is a capped excerpt (never the full verbatim), and the
  LiveSource node gets ``pending_entity_id`` + ``confirmed_by`` + a trust bump
  while its provenance stays ``live_unconfirmed``;
- a second confirm reuses the proposal instead of creating a twin.

FalkorDB and the RQ queue are fakes. The pending branch writes through the real
propose-entity code path, so those tests need the enrichment Postgres (locally
with ``ENRICHMENT_DATABASE_URL`` pointing at a database where
``create_tables()`` and migration 007 ran, or in-container):
    docker exec -w /app visualex-merlt-api python -m pytest tests/api/test_confirm_source.py -q
"""

from __future__ import annotations

import hashlib
import importlib
import uuid
from typing import Any, Dict, List, Optional
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from fastapi import HTTPException
from rq.exceptions import NoSuchJobError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from merlt.api.enrichment_router import (
    CONFIRM_SOURCE_EXCERPT_CHARS,
    CONFIRMED_SOURCE_TRUST,
    NO_NORM_ARTICLE_URN,
    confirm_source,
)
from merlt.api.models.enrichment_models import ConfirmSourceRequest
from merlt.pipeline.provisional_writer import PROVISIONAL_TRUST
from merlt.storage.enrichment.database import get_database_url
from merlt.storage.graph.entity_writer import is_real_article_urn

# The package re-exports each APIRouter under the module's own name, so reach
# the module objects through importlib to patch their globals.
er = importlib.import_module("merlt.api.enrichment_router")
gr = importlib.import_module("merlt.api.graph_router")

NORMATTIVA_ART = (
    "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262~art2043"
)


class _FakeLiveGraph:
    """Stands in for FalkorDBClient: one LiveSource node, every Cypher recorded.

    The stamp emulation follows the Cypher it answers (set-like confirmed_by,
    non-downgrading trust, first-writer-wins pending_entity_id); the Cypher text
    itself is asserted separately.
    """

    def __init__(self, node: Optional[Dict[str, Any]]) -> None:
        self.node = node
        self.queries: List[tuple] = []
        self.closed = False

    async def query(self, cypher: str, params: Optional[dict] = None):
        params = params or {}
        self.queries.append((cypher, params))
        node = self.node
        if node is None or node["node_id"] != params.get("node_id"):
            return []
        if "labels(n) AS labels" in cypher:
            return [dict(node)]
        if "SET n.confirmed_by" in cypher:
            confirmed = list(node.get("confirmed_by") or [])
            if params["user_id"] not in confirmed:
                confirmed.append(params["user_id"])
            node["confirmed_by"] = confirmed
            node["trust"] = max(node.get("trust") or 0.0, params["trust"])
            if not node.get("pending_entity_id"):
                node["pending_entity_id"] = params["pending_entity_id"]
            return [{"pending_entity_id": node.get("pending_entity_id")}]
        return []

    async def close(self) -> None:
        self.closed = True

    def stamp_queries(self) -> List[str]:
        return [c for c, _ in self.queries if "SET n.confirmed_by" in c]


def _live_node(**overrides: Any) -> Dict[str, Any]:
    node = {
        "node_id": f"live:{uuid.uuid4().hex[:24]}",
        "labels": ["LiveSource", "AttoGiudiziario"],
        "source_url": "",
        "text": "",
        "provenance": "live_unconfirmed",
        "trust": PROVISIONAL_TRUST,
        "pending_entity_id": None,
    }
    node.update(overrides)
    return node


@pytest.fixture
def graph_factory(monkeypatch):
    def _install(node: Optional[Dict[str, Any]]) -> _FakeLiveGraph:
        graph = _FakeLiveGraph(node)
        monkeypatch.setattr(er, "_open_live_graph", AsyncMock(return_value=graph))
        return graph

    return _install


@pytest_asyncio.fixture
async def session_factory():
    engine = create_async_engine(get_database_url(), poolclass=NullPool)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    created_users: List[str] = []
    created_entities: List[str] = []
    yield factory, created_users, created_entities
    async with factory() as session:
        await session.execute(
            text("DELETE FROM pending_entities WHERE entity_id = ANY(:ids)"), {"ids": created_entities}
        )
        await session.execute(
            text("DELETE FROM user_domain_authority WHERE user_id = ANY(:ids)"), {"ids": created_users}
        )
        await session.commit()
    await engine.dispose()


# --------------------------------------------------------------------------
# Pure checks (no database)
# --------------------------------------------------------------------------


def test_confirmed_trust_sits_between_provisional_and_validated():
    assert PROVISIONAL_TRUST < CONFIRMED_SOURCE_TRUST < 1.0


def test_norm_article_detection():
    assert er._is_norm_article_url(NORMATTIVA_ART)
    assert er._is_norm_article_url("urn:nir:stato:legge:1990-08-07;241~art3")
    # an act without an article cannot be ingested
    assert not er._is_norm_article_url(
        "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241"
    )
    assert not er._is_norm_article_url("https://eur-lex.europa.eu/eli/reg/2016/679/oj")
    assert not er._is_norm_article_url("https://www.brocardi.it/codice-civile/art2043.html")
    assert not er._is_norm_article_url("")


def test_excerpt_is_capped_and_never_the_full_body():
    body = "parola " * 400
    excerpt = er._source_excerpt(body)
    assert len(excerpt) <= CONFIRM_SOURCE_EXCERPT_CHARS + 1
    assert excerpt.endswith("…")
    assert excerpt.rstrip("…") != " ".join(body.split())


def test_placeholder_article_urn_stays_off_the_graph():
    assert not is_real_article_urn(NO_NORM_ARTICLE_URN)


async def test_rejects_an_id_that_is_not_a_live_node(graph_factory):
    graph = graph_factory(None)
    with pytest.raises(HTTPException) as exc:
        await confirm_source(
            ConfirmSourceRequest(node_id="concetto:abc", user_id="u1", entity_text="Qualcosa"),
            session=MagicMock(),
            api_key=MagicMock(),
        )
    assert exc.value.status_code == 422
    assert graph.queries == []


async def test_unknown_node_is_a_404(graph_factory):
    graph = graph_factory(None)
    with pytest.raises(HTTPException) as exc:
        await confirm_source(
            ConfirmSourceRequest(node_id="live:doesnotexist", user_id="u1", entity_text="Qualcosa"),
            session=MagicMock(),
            api_key=MagicMock(),
        )
    assert exc.value.status_code == 404
    assert "live:doesnotexist" in exc.value.detail
    assert graph.closed


# --------------------------------------------------------------------------
# Normattiva article → lazy ingest
# --------------------------------------------------------------------------


async def test_norm_article_goes_to_lazy_ingest(graph_factory, monkeypatch):
    node = _live_node(labels=["LiveSource", "Norma"], source_url=NORMATTIVA_ART + "!vig=")
    graph = graph_factory(node)

    expected_job_id = "ingest-" + hashlib.sha256(NORMATTIVA_ART.encode("utf-8")).hexdigest()[:40]
    job = MagicMock()
    job.id = expected_job_id
    queue = MagicMock()
    queue.connection = MagicMock()
    queue.enqueue = MagicMock(return_value=job)
    job_cls = MagicMock()
    job_cls.fetch.side_effect = NoSuchJobError("no such job")
    monkeypatch.setattr(gr, "_get_rq_queue", lambda: queue)
    monkeypatch.setattr(gr, "Job", job_cls)

    session = MagicMock()
    response = await confirm_source(
        ConfirmSourceRequest(node_id=node["node_id"], user_id="u-lazy", entity_text="Art. 2043 c.c."),
        session=session,
        api_key=MagicMock(),
    )

    assert response.promoted_as == "lazy_ingest"
    assert response.article_urn == NORMATTIVA_ART  # `!vig=` stripped
    assert response.ingest_job_id == expected_job_id
    assert response.entity_id is None
    call = queue.enqueue.call_args
    assert call.args[:2] == ("merlt.worker.tasks.ingest_article", NORMATTIVA_ART)
    assert call.kwargs["job_id"] == expected_job_id
    # no proposal: the article enters the graph through the ingestion
    session.execute.assert_not_called()
    session.add.assert_not_called()
    # the confirmation is still recorded on the node, without a pending id
    assert node["confirmed_by"] == ["u-lazy"]
    assert node["pending_entity_id"] is None
    assert graph.closed


async def test_lazy_ingest_queue_down_is_a_503(graph_factory, monkeypatch):
    node = _live_node(labels=["LiveSource", "Norma"], source_url=NORMATTIVA_ART)
    graph_factory(node)

    def _down():
        raise ConnectionError("redis down")

    monkeypatch.setattr(gr, "_get_rq_queue", _down)

    with pytest.raises(HTTPException) as exc:
        await confirm_source(
            ConfirmSourceRequest(node_id=node["node_id"], user_id="u1", entity_text="Art. 2043 c.c."),
            session=MagicMock(),
            api_key=MagicMock(),
        )
    assert exc.value.status_code == 503


# --------------------------------------------------------------------------
# Interpretative source → pending entity (real propose-entity path)
# --------------------------------------------------------------------------


def _ruling_node(marker: str) -> Dict[str, Any]:
    body = (
        f"# Cassazione civile sez. III {marker}\n\n"
        + "La responsabilita' extracontrattuale richiede il nesso di causalita' tra condotta ed evento. " * 20
    )
    return _live_node(
        labels=["LiveSource", "AttoGiudiziario"],
        source_url=f"https://www.italgiure.giustizia.it/sncass/{marker}",
        text=body,
    )


async def test_interpretative_source_becomes_a_pending_entity(graph_factory, session_factory):
    factory, users, entities = session_factory
    marker = uuid.uuid4().hex[:10]
    user = f"u-confirm-{marker}"
    users.append(user)
    node = _ruling_node(marker)
    graph = graph_factory(node)

    async with factory() as session:
        response = await confirm_source(
            ConfirmSourceRequest(
                node_id=node["node_id"],
                user_id=user,
                entity_text=f"Cass. civ. sez. III n. {marker}",
            ),
            session=session,
            api_key=MagicMock(),
        )

    assert response.success is True
    assert response.promoted_as == "pending_entity"
    assert response.article_urn == node["source_url"]
    assert response.ingest_job_id is None
    entity_id = response.entity_id
    assert entity_id and entity_id.startswith("atto_giudiziario:")
    entities.append(entity_id)

    async with factory() as session:
        row = (
            await session.execute(
                text(
                    "SELECT contributed_by, fonte, source_reference, article_urn, entity_type, "
                    "descrizione, validation_status FROM pending_entities WHERE entity_id = :eid"
                ),
                {"eid": entity_id},
            )
        ).mappings().one()

    assert row["contributed_by"] == user
    assert row["fonte"] == "community"
    assert row["source_reference"] == node["source_url"]
    assert row["article_urn"] == NO_NORM_ARTICLE_URN
    assert row["entity_type"] == "atto_giudiziario"
    assert row["validation_status"] == "pending"
    # copyright gate: a capped quotation plus the source URL, never the verbatim
    flat_body = " ".join(node["text"].split())
    assert flat_body not in row["descrizione"]
    quoted = row["descrizione"].split("\n\n")[0]
    assert len(quoted) <= CONFIRM_SOURCE_EXCERPT_CHARS + 3  # «…» plus the ellipsis
    assert row["descrizione"].endswith(f"Fonte: {node['source_url']}")

    # the node now carries the key entity_writer._link_provisional_source matches on
    assert node["pending_entity_id"] == entity_id
    assert node["confirmed_by"] == [user]
    assert node["trust"] == CONFIRMED_SOURCE_TRUST
    assert node["provenance"] == "live_unconfirmed"

    stamp = graph.stamp_queries()[0]
    assert "WHEN coalesce(n.trust, 0.0) >= $trust THEN n.trust" in stamp  # never lowers trust
    assert "coalesce(n.pending_entity_id, $pending_entity_id)" in stamp  # first writer wins
    assert "provenance" not in stamp  # stays live_unconfirmed until consensus
    assert graph.closed


async def test_second_confirm_reuses_the_proposal(graph_factory, session_factory):
    factory, users, entities = session_factory
    marker = uuid.uuid4().hex[:10]
    first, second = f"u-first-{marker}", f"u-second-{marker}"
    users.extend([first, second])
    node = _ruling_node(marker)
    graph_factory(node)
    name = f"Cass. civ. sez. III n. {marker}"

    async with factory() as session:
        r1 = await confirm_source(
            ConfirmSourceRequest(node_id=node["node_id"], user_id=first, entity_text=name),
            session=session,
            api_key=MagicMock(),
        )
    entities.append(r1.entity_id)
    async with factory() as session:
        r2 = await confirm_source(
            ConfirmSourceRequest(node_id=node["node_id"], user_id=second, entity_text=name),
            session=session,
            api_key=MagicMock(),
        )

    assert r2.promoted_as == "pending_entity"
    assert r2.entity_id == r1.entity_id
    assert node["confirmed_by"] == [first, second]
    async with factory() as session:
        count = (
            await session.execute(
                text("SELECT count(*) FROM pending_entities WHERE entity_text = :n"), {"n": name}
            )
        ).scalar_one()
    assert count == 1


async def test_exact_duplicate_links_the_existing_proposal(graph_factory, session_factory):
    """Two provisional nodes for the same ruling (no shared URL key): the second
    confirm links to the first proposal rather than asking for a twin."""
    factory, users, entities = session_factory
    marker = uuid.uuid4().hex[:10]
    user = f"u-dup-{marker}"
    users.append(user)
    name = f"Cass. civ. sez. III n. {marker}"

    node_a = _ruling_node(marker)
    graph_factory(node_a)
    async with factory() as session:
        r1 = await confirm_source(
            ConfirmSourceRequest(node_id=node_a["node_id"], user_id=user, entity_text=name),
            session=session,
            api_key=MagicMock(),
        )
    entities.append(r1.entity_id)

    node_b = _ruling_node(marker)
    graph_factory(node_b)
    async with factory() as session:
        r2 = await confirm_source(
            ConfirmSourceRequest(node_id=node_b["node_id"], user_id=user, entity_text=name),
            session=session,
            api_key=MagicMock(),
        )

    assert r2.entity_id == r1.entity_id
    assert node_b["pending_entity_id"] == r1.entity_id
    async with factory() as session:
        count = (
            await session.execute(
                text("SELECT count(*) FROM pending_entities WHERE entity_text = :n"), {"n": name}
            )
        ).scalar_one()
    assert count == 1


async def test_junk_name_is_refused_and_nothing_is_stamped(graph_factory, session_factory):
    factory, users, _ = session_factory
    user = f"u-junk-{uuid.uuid4().hex[:8]}"
    users.append(user)
    node = _ruling_node(uuid.uuid4().hex[:10])
    graph = graph_factory(node)

    async with factory() as session:
        with pytest.raises(HTTPException) as exc:
            await confirm_source(
                ConfirmSourceRequest(node_id=node["node_id"], user_id=user, entity_text="https://x.example/abc"),
                session=session,
                api_key=MagicMock(),
            )
    assert exc.value.status_code == 422
    assert graph.stamp_queries() == []
    assert node["pending_entity_id"] is None


def test_entity_type_override_and_fallbacks():
    assert er._confirm_entity_type("principio", ["LiveSource", "Dottrina"]).value == "principio"
    assert er._confirm_entity_type(None, ["LiveSource", "AttoGiudiziario"]).value == "atto_giudiziario"
    assert er._confirm_entity_type(None, ["LiveSource", "Dottrina"]).value == "dottrina"
    # an unknown override does not fail the one-click confirmation
    assert er._confirm_entity_type("sentenza", ["LiveSource", "AttoGiudiziario"]).value == "atto_giudiziario"
    assert er._confirm_entity_type(None, ["LiveSource"]).value == "dottrina"
