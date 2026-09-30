"""The ingestion writers speak the schema's vocabulary (spec 2026-09-30, §4)."""
import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from merlt.pipeline.ingestion import IngestionPipelineV2, _canonical_urn
from merlt.pipeline.multivigenza import RELATION_TYPES
from merlt.pipeline.visualex import NormaMetadata, VisualexArticle
from merlt.scripts import load_seed_libro_iv as seed
from merlt.storage.graph.schema import Rel, canonical_rel, point_id, text_fingerprint

CC = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043"


def _meta(tipo_atto="codice civile", numero="2043"):
    return NormaMetadata(tipo_atto=tipo_atto, data="1942-03-16", numero_atto="262", numero_articolo=numero)


def test_ingestion_cuts_originale_too():
    assert _canonical_urn(CC + "@originale") == CC


def test_estremi_come_from_the_schema():
    assert _meta().to_estremi() == "Art. 2043 c.c."
    assert NormaMetadata(tipo_atto="Costituzione", data="", numero_atto="", numero_articolo="1").to_estremi() == "Art. 1 Cost."


def test_multivigenza_writes_canonical_relations():
    assert {Rel(value) for value in RELATION_TYPES.values()} == {Rel.ABROGA, Rel.SOSTITUISCE, Rel.MODIFICA, Rel.INSERISCE}


async def test_an_article_without_doctrine_is_ingested():
    client = MagicMock()
    client.query = AsyncMock(return_value=[])
    # VisuaLex texts open with their "Art. N" line: CommaParser refuses the rest.
    article_text = "Art. 1321\nTesto dell'articolo."
    article = VisualexArticle(
        metadata=_meta(numero="1321"),
        article_text=article_text,
        url=CC.replace("2043", "1321"),
        brocardi_info=None,
    )
    # Raised TypeError ("NormaMetadata is not iterable") before this task: every
    # article without doctrine failed and the job still reported completed.
    await IngestionPipelineV2(falkordb_client=client).ingest_article(article)
    writes = [c for c in client.query.await_args_list if "MERGE (art:Norma {URN: $urn})" in c.args[0]]
    cypher, params = writes[0].args
    assert "art.testo = $testo" in cypher and "art.testo_sha256 = $testo_sha256" in cypher
    assert params["testo"] == article_text  # the text goes in as it came
    assert params["testo_sha256"] == text_fingerprint(article_text)
    assert params["fonte"] == "Normattiva" and params["provenance"] == "ingestion"
    written = "\n".join(c.args[0] for c in client.query.await_args_list)
    assert ":contiene" not in written and "CONTIENE" in written


async def test_lazy_vectors_have_ids_stable_across_processes():
    from merlt.core.legal_knowledge_graph import LegalKnowledgeGraph

    kg = LegalKnowledgeGraph.__new__(LegalKnowledgeGraph)
    kg._qdrant = MagicMock()
    kg._embedding_service = MagicMock(encode_document_async=AsyncMock(return_value=[0.1, 0.2]))
    kg.config = MagicMock(qdrant_collection="chunks")
    await kg._upsert_embeddings_multi_source(
        article_text="Testo dell'articolo abbastanza lungo.",
        article_urn=CC + "!vig=",
        metadata=_meta(),
        brocardi_info={"Massime": ["x" * 60, "y" * 60]},
    )
    points = kg._qdrant.upsert.call_args.kwargs["points"]
    assert [p.id for p in points] == [point_id(CC, "norma"), point_id(CC, "massima", 0), point_id(CC, "massima", 1)]
    assert {p.payload["article_urn"] for p in points} == {CC}
    assert [p.payload["fonte"] for p in points] == ["Normattiva", "Brocardi.it", "Brocardi.it"]


class _Recorder:
    def __init__(self):
        self.calls = []

    async def query(self, cypher, params=None):
        self.calls.append((cypher, params or {}))
        return []


async def test_seed_edges_are_written_with_canonical_names():
    client = _Recorder()
    id_to_key = {1: {"key": "a", "label": "Norma", "key_field": "URN"}, 2: {"key": "b", "label": "Norma", "key_field": "URN"}}
    edges = [{"start": 1, "end": 2, "type": "interpreta", "properties": {}},
             {"start": 1, "end": 2, "type": "contiene", "properties": {}}]
    merged, skipped = await seed._merge_edges(client, edges, id_to_key)
    written = "\n".join(cypher for cypher, _ in client.calls)
    assert (merged, skipped) == (2, 0)
    assert "[r:INTERPRETA " in written and "[r:CONTIENE " in written


async def test_seed_nodes_carry_text_fingerprint_fonte_and_provenance():
    client = _Recorder()
    nodes = [{"id": 1, "labels": ["Norma"], "properties": {"URN": "a", "testo_vigente": "T", "fonte": "VisualexAPI"}}]
    await seed._merge_nodes(client, nodes, {1: {"key": "a", "label": "Norma", "key_field": "URN"}})
    props = client.calls[0][1]["props"]
    assert props["testo"] == "T" and props["testo_sha256"] == text_fingerprint("T")
    assert props["fonte"] == "Normattiva" and props["provenance"] == "seed"


def test_seed_source_types_are_canonical():
    assert seed._infer_source_type("ConcettoGiuridico") == "concetto"
    assert seed._infer_source_type("AttoGiudiziario") == "massima"
    assert seed._infer_source_type("Comma") == "comma"


def test_every_seed_relation_has_a_canonical_name():
    if not seed.SEED_GRAPH_JSON.exists():  # the seed is data, not in git: CI has no copy
        pytest.skip("seed file not present")
    meta = json.loads(seed.SEED_GRAPH_JSON.read_text(encoding="utf-8"))["meta"]
    for rel_type in meta["counts"]["rel_types"]:
        canonical_rel(rel_type)


def test_mechanical_articles_carry_testo_and_fingerprint():
    from merlt.pipeline.mechanical_ingestion import parser

    assert parser._article_props_extra("Testo.") == {
        "testo": "Testo.", "testo_sha256": text_fingerprint("Testo."), "provenance": "ingestion",
    }


# --- Beyond the plan's list: behaviours the writers above gained -------------


async def test_a_seed_edge_of_an_unknown_type_is_skipped_and_the_load_goes_on():
    client = _Recorder()
    id_to_key = {1: {"key": "a", "label": "Norma", "key_field": "URN"}, 2: {"key": "b", "label": "Norma", "key_field": "URN"}}
    edges = [{"start": 1, "end": 2, "type": "NOT_A_RELATION", "properties": {}},
             {"start": 1, "end": 2, "properties": {}},  # no type at all
             {"start": 1, "end": 2, "type": "RINVIA", "properties": {}}]
    merged, skipped = await seed._merge_edges(client, edges, id_to_key)
    written = "\n".join(cypher for cypher, _ in client.calls)
    assert (merged, skipped) == (2, 1)
    assert "NOT_A_RELATION" not in written  # a type outside the schema never reaches Cypher
    assert "[r:CORRELATO " in written and "[r:RINVIA " in written


async def test_seed_vector_ids_are_stable_across_runs():
    nodes = [
        {"id": 1, "labels": ["Norma"], "properties": {"URN": CC, "testo_vigente": "Testo uno."}},
        {"id": 2, "labels": ["AttoGiudiziario"], "properties": {"node_id": "massima_x", "massima": "Massima due."}},
    ]

    async def run():
        qdrant = MagicMock()
        embedder = MagicMock(encode_batch_async=AsyncMock(side_effect=lambda texts, is_query: [[0.1, 0.2] for _ in texts]))
        _, by_text = await seed._generate_and_upsert_embeddings(nodes, embedder, qdrant, "chunks")
        return qdrant.upsert.call_args.kwargs["points"], by_text

    first, first_by_text = await run()
    second, second_by_text = await run()
    assert [p.id for p in first] == [p.id for p in second] and first_by_text == second_by_text
    assert first[0].id == point_id(CC, "norma", text_fingerprint("Testo uno.")[:16])
    assert first[1].payload["source_type"] == "massima"


async def test_an_article_with_doctrine_is_ingested_in_the_schemas_names():
    client = MagicMock()
    client.query = AsyncMock(return_value=[])
    article = VisualexArticle(
        metadata=_meta(numero="1321"),
        article_text="Art. 1321\nTesto dell'articolo.",
        url=CC.replace("2043", "1321"),
        brocardi_info={
            "Position": "Libro IV - Delle obbligazioni, Titolo II - Dei contratti in generale, Capo I - Del contratto",
            "Ratio": "La ratio della norma.",
            "Spiegazione": "La spiegazione della norma.",
            "Massime": [{"autorita": "Cass. civ.", "numero": "1", "anno": "2021", "massima": "Testo della massima."}],
        },
    )
    await IngestionPipelineV2(falkordb_client=client).ingest_article(article)
    written = "\n".join(c.args[0] for c in client.query.await_args_list)
    for relation in ("CONTIENE", "COMMENTA", "INTERPRETA"):
        assert f"[r:{relation}]" in written
    for legacy in ("[r:contiene]", "[r:commenta]", "[r:interpreta]", "'VisualexAPI'", "'Brocardi'"):
        assert legacy not in written
    assert "libro.fonte = 'Brocardi.it'" in written and "codice.fonte = 'Normattiva'" in written
