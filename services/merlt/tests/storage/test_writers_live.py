"""Integration: the writers meet nodes that already exist, on a real FalkorDB.

A property a writer sets only ON CREATE never reaches a node that was there before. The seed's
1,755 ingestion-shaped `Comma` nodes have no `fonte`, and a lazy ingestion or a multivigenza run
MERGEs onto them, so the writers stamp the fonte in a SET of their own, `coalesce`d: a node
that has one keeps it. A new community entity carries its fonte from the start.

Writes to an ISOLATED test graph (`merlt_test_writers`), wiped before and after, so the Libro IV
graph is never touched.

    docker exec -w /app <throwaway-stack>-merlt-api python -m pytest tests/storage/test_writers_live.py -m integration -q
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio

from merlt.clients import Modifica, Norma, NormaVisitata, TipoModifica
from merlt.pipeline.ingestion import IngestionPipelineV2
from merlt.pipeline.multivigenza import MultivigenzaPipeline
from merlt.pipeline.visualex import NormaMetadata, VisualexArticle
from merlt.storage.enrichment.models import PendingEntity
from merlt.storage.graph.client import FalkorDBClient
from merlt.storage.graph.entity_writer import EntityGraphWriter
from merlt.storage.graph.schema import canonical_urn

# Needs a live FalkorDB (the compose falkordb service): excluded by default through
# pyproject's `-m 'not integration'`; run with `-m integration` in-container.
pytestmark = pytest.mark.integration

TEST_GRAPH = "merlt_test_writers"
ARTICLE_TEXT = (
    "Art. 117\n\n(Competenze legislative).\n\n"
    "Lo Stato ha legislazione esclusiva nelle seguenti materie:\n"
    "a) politica estera e rapporti internazionali dello Stato;\n"
    "b) immigrazione e condizione giuridica degli stranieri.\n\n"
    "Le Regioni hanno potesta legislativa in ogni materia non riservata."
)
ACT = "urn:nir:stato:decreto.legislativo:2001-01-01;1"


@pytest_asyncio.fixture
async def graph():
    client = FalkorDBClient(graph_name=TEST_GRAPH)
    await client.connect()
    await client.query("MATCH (n) DETACH DELETE n", {})
    yield client
    try:
        await client.query("MATCH (n) DETACH DELETE n", {})
    finally:
        await client.close()


async def _fonti(graph, label):
    rows = await graph.query(f"MATCH (n:{label}) RETURN n.URN AS urn, n.fonte AS fonte, n.testo AS testo", {})
    return {row["urn"]: (row["fonte"], row["testo"]) for row in rows}


async def test_a_lazy_ingestion_gives_the_comma_and_the_lettera_a_fonte_even_when_they_exist_without_one(graph):
    meta = NormaMetadata(tipo_atto="codice civile", data="1942-03-16", numero_atto="262", numero_articolo="117")
    article_urn = canonical_urn(meta.to_urn())
    # a Comma as the seed has them: ingestion-shaped, no `fonte`
    await graph.query(
        "CREATE (:Comma {URN: $urn, node_id: $urn, numero: 1, testo: 'Testo del seed.', token_count: 3})",
        {"urn": f"{article_urn}-com1"},
    )
    article = VisualexArticle(metadata=meta, article_text=ARTICLE_TEXT, url=article_urn, brocardi_info=None)

    await IngestionPipelineV2(falkordb_client=graph).ingest_article(article)

    commi = await _fonti(graph, "Comma")
    lettere = await _fonti(graph, "Lettera")
    assert set(commi) == {f"{article_urn}-com1", f"{article_urn}-com2"}
    assert len(lettere) == 2
    assert {fonte for fonte, _ in [*commi.values(), *lettere.values()]} == {"Normattiva"}
    assert commi[f"{article_urn}-com1"][1] == "Testo del seed."  # the node that was there keeps what it had


async def test_a_multivigenza_run_gives_the_comma_lettera_and_numero_a_fonte_even_when_the_comma_exists_without_one(graph):
    target = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art1321"
    await graph.query("CREATE (:Norma {URN: $urn, node_id: $urn, tipo_documento: 'articolo'})", {"urn": target})
    comma = f"{ACT}~art12-com1"
    await graph.query("CREATE (:Comma {URN: $urn, node_id: $urn, testo: 'Testo del seed.'})", {"urn": comma})
    modifica = Modifica(
        tipo_modifica=TipoModifica.INSERISCE,
        atto_modificante_urn=ACT,
        atto_modificante_estremi="D.Lgs. 1 gennaio 2001, n. 1",
        data_efficacia="2001-02-01",
        data_pubblicazione_gu="2001-01-15",
        disposizione="art. 12, comma 1, lettera b, numero 3",
    )
    scraper = MagicMock(
        get_amendment_history=AsyncMock(return_value=[modifica]),
        get_original_version=AsyncMock(return_value=("Testo originale.", "urn")),
        get_version_at_date=AsyncMock(return_value=("Testo storico.", "urn")),
    )
    visited = NormaVisitata(
        norma=Norma(tipo_atto="codice civile", data="1942-03-16", numero_atto="262"), numero_articolo="1321", urn=target,
    )

    result = await MultivigenzaPipeline(falkordb_client=graph, scraper=scraper).ingest_with_history(
        visited, fetch_all_versions=True
    )

    assert result.errors == []
    commi = await _fonti(graph, "Comma")
    lettere = await _fonti(graph, "Lettera")
    numeri = await _fonti(graph, "Numero")
    assert set(commi) == {comma} and len(lettere) == 1 and len(numeri) == 1
    assert {fonte for fonte, _ in [*commi.values(), *lettere.values(), *numeri.values()]} == {"Normattiva"}
    assert commi[comma][1] == "Testo del seed."
    # the amendment itself reached the graph: an inserted comma is an INSERISCE edge
    edges = await graph.query("MATCH ()-[r:INSERISCE]->(t:Norma {URN: $urn}) RETURN count(r) AS n", {"urn": target})
    assert edges[0]["n"] == 1


async def test_a_new_community_entity_is_written_with_its_fonte_and_the_label_of_its_kind(graph):
    entity = PendingEntity(
        entity_id="ent_1", article_urn="user_document", entity_type="principio", entity_text="Buona fede",
        descrizione="", ambito="generale", validation_status="approved", consensus_reached=True,
        consensus_type="approved", approval_score=2.0, votes_count=3, contributed_by="u1",
    )

    await EntityGraphWriter(graph).write_entity(entity, skip_deduplication=True)

    rows = await graph.query(
        "MATCH (e:Entity:PrincipioGiuridico {id: 'principio:buona_fede'}) RETURN e.fonte AS fonte, e.provenance AS provenance",
        {},
    )
    assert rows == [{"fonte": "community", "provenance": "community_validated"}]
