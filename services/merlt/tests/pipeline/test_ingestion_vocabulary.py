"""The ingestion writers speak the schema's vocabulary (spec 2026-09-30, §4)."""
import importlib
import inspect
import json
import re
from unittest.mock import AsyncMock, MagicMock

import pytest

from merlt.clients import Modifica, Norma, NormaVisitata, TipoModifica
from merlt.pipeline.ingestion import IngestionPipelineV2, _canonical_urn
from merlt.pipeline.multivigenza import RELATION_TYPES, MultivigenzaPipeline
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
    # Each half of the MERGE must write the text, its fingerprint and the provenance:
    # a substring check on the whole query is satisfied by the ON CREATE half alone.
    assert cypher.count("ON MATCH SET") == 1
    on_create, on_match = cypher.split("ON MATCH SET")
    for line in ("art.provenance = $provenance", "art.testo = $testo", "art.testo_sha256 = $testo_sha256"):
        assert line in on_create
    for line in ("art.testo = $testo", "art.testo_sha256 = $testo_sha256", "coalesce(art.provenance, $provenance)"):
        assert line in on_match
    # a re-ingestion fills a missing provenance, it never overwrites a seed's or a confirmed one
    assert "art.provenance = $provenance" not in on_match
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


async def test_seed_edges_carry_certezza_as_a_number():
    # The seed file holds certezza as a string ("0.9", "1"); one that is not a number stays.
    client = _Recorder()
    id_to_key = {1: {"key": "a", "label": "Norma", "key_field": "URN"}, 2: {"key": "b", "label": "Norma", "key_field": "URN"}}
    edges = [{"start": 1, "end": 2, "type": "interpreta", "properties": {"certezza": "0.9"}},
             {"start": 2, "end": 1, "type": "interpreta", "properties": {"certezza": "1"}},
             {"start": 1, "end": 2, "type": "contiene", "properties": {"certezza": "alta"}}]
    await seed._merge_edges(client, edges, id_to_key)
    assert [params["props"]["certezza"] for _, params in client.calls] == [0.9, 1.0, "alta"]
    assert edges[0]["properties"]["certezza"] == "0.9"  # the seed's own data is not rewritten


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


# An article that makes the pipeline write every kind of node it knows: the codice and its four
# partitions, the article, two commi with lettere, the four shapes of doctrine, a massima.
RICH_ARTICLE_TEXT = (
    "Art. 117\n\n(Competenze legislative).\n\n"
    "Lo Stato ha legislazione esclusiva nelle seguenti materie:\n"
    "a) politica estera e rapporti internazionali dello Stato;\n"
    "b) immigrazione e condizione giuridica degli stranieri.\n\n"
    "Le Regioni hanno potesta legislativa in ogni materia non riservata."
)
RICH_BROCARDI_INFO = {
    "Position": (
        "Libro IV - Delle obbligazioni, Titolo II - Dei contratti in generale, "
        "Capo I - Del contratto, Sezione I - Disposizioni generali"
    ),
    "Ratio": "La ratio della norma.",
    "Spiegazione": "La spiegazione della norma.",
    "RelazioneCostituzione": {"titolo": "Relazione al Progetto", "testo": "Il testo della relazione.", "autore": "Ruini", "anno": 1947},
    "Relazioni": [{"titolo": "Relazione del Guardasigilli", "testo": "Il testo della relazione.", "autore": "Grandi", "anno": 1942}],
    "Massime": [{"autorita": "Cass. civ.", "numero": "1", "anno": "2021", "massima": "Testo della massima."}],
}


async def _queries_of_a_rich_ingestion() -> list[str]:
    client = MagicMock()
    client.query = AsyncMock(return_value=[])
    article = VisualexArticle(
        metadata=_meta(numero="117"),
        article_text=RICH_ARTICLE_TEXT,
        url=CC.replace("2043", "117"),
        brocardi_info=RICH_BROCARDI_INFO,
    )
    await IngestionPipelineV2(falkordb_client=client).ingest_article(article)
    return [call.args[0] for call in client.query.await_args_list]


async def test_an_article_with_doctrine_is_ingested_in_the_schemas_names():
    written = "\n".join(await _queries_of_a_rich_ingestion())
    for relation in ("CONTIENE", "COMMENTA", "INTERPRETA"):
        assert f"[r:{relation}]" in written
    for legacy in ("[r:contiene]", "[r:commenta]", "[r:interpreta]", "'VisualexAPI'", "'Brocardi'"):
        assert legacy not in written
    assert "libro.fonte = 'Brocardi.it'" in written and "codice.fonte = 'Normattiva'" in written


async def test_every_node_the_ingestion_merges_carries_provenance():
    # A node written without a provenance is the one the next backfill stamps as `seed`.
    merges = [q for q in await _queries_of_a_rich_ingestion() if re.search(r"MERGE \(\w+:[A-Z]", q)]
    variables = {re.search(r"MERGE \((\w+):", q).group(1) for q in merges}
    # the test reaches every kind of node the pipeline writes, so it cannot pass by looking at too little
    assert {"codice", "libro", "titolo", "capo", "sezione", "art", "c", "l", "d", "a"} <= variables
    assert sum("MERGE (d:Dottrina" in q for q in merges) == 4  # ratio, spiegazione and both relazioni
    for query in merges:
        assert "provenance" in query, query
        variable = re.search(r"MERGE \((\w+):", query).group(1)
        if variable != "art":  # the article's own form (a parameter, filled on create and on match) is pinned above
            assert f"{variable}.provenance = coalesce({variable}.provenance, 'ingestion')" in query


async def test_every_lazy_comma_and_lettera_carries_a_fonte_even_when_it_already_exists():
    # The seed's 1,755 ingestion-shaped Comma nodes have no `fonte`, and re-ingesting an article MERGEs
    # onto them: a property set only ON CREATE would never reach them.
    merges = [q for q in await _queries_of_a_rich_ingestion() if re.search(r"MERGE \((c|l):(Comma|Lettera)", q)]
    assert {re.search(r"MERGE \((\w+):", q).group(1) for q in merges} == {"c", "l"}
    for query in merges:
        variable = re.search(r"MERGE \((\w+):", query).group(1)
        assert re.search(rf"\n\s*SET {variable}\.fonte = coalesce\({variable}\.fonte, 'Normattiva'\)", query), query


def test_every_comma_lettera_and_numero_multivigenza_merges_carries_a_fonte_even_when_it_exists():
    multivigenza = importlib.import_module("merlt.pipeline.multivigenza")
    statements = re.findall(r'MERGE \(\w+:[A-Z][^"]*', inspect.getsource(multivigenza))
    parts = [s for s in statements if re.match(r"MERGE \((comma|let|num):(Comma|Lettera|Numero) ", s)]
    assert {re.match(r"MERGE \((\w+):", s).group(1) for s in parts} == {"comma", "let", "num"}
    for statement in parts:
        variable = re.match(r"MERGE \((\w+):", statement).group(1)
        assert re.search(rf"\n\s*SET {variable}\.fonte = coalesce\({variable}\.fonte, 'Normattiva'\)", statement), statement
        assert f"{variable}.fonte = 'Normattiva'" not in statement  # one form: the non-destructive one


def test_multivigenza_writes_no_lowercase_contiene():
    multivigenza = importlib.import_module("merlt.pipeline.multivigenza")
    assert ":contiene]" not in inspect.getsource(multivigenza)


def test_every_node_multivigenza_merges_carries_provenance():
    multivigenza = importlib.import_module("merlt.pipeline.multivigenza")
    # one Cypher string per match: the regex runs to the closing quotes of the statement
    statements = re.findall(r'MERGE \(\w+:[A-Z][^"]*', inspect.getsource(multivigenza))
    variables = {re.match(r"MERGE \((\w+):", s).group(1) for s in statements}
    assert {"atto", "art", "comma", "let", "num", "ver"} <= variables
    for statement in statements:
        variable = re.match(r"MERGE \((\w+):", statement).group(1)
        assert f"{variable}.provenance = coalesce({variable}.provenance, 'ingestion')" in statement


async def test_multivigenza_writes_the_modifying_act_in_the_schemas_names():
    client = _Recorder()
    modifica = Modifica(
        tipo_modifica=TipoModifica.MODIFICA,
        atto_modificante_urn="urn:nir:stato:decreto.legislativo:2001-01-01;1",
        atto_modificante_estremi="D.Lgs. 1 gennaio 2001, n. 1",
        data_efficacia="2001-02-01",
        data_pubblicazione_gu="2001-01-15",
        disposizione="art. 12, comma 1, lettera b, numero 3",  # the example of parse_disposizione's own docstring
    )
    scraper = MagicMock(
        get_amendment_history=AsyncMock(return_value=[modifica]),
        get_original_version=AsyncMock(return_value=("Testo originale.", "urn")),
        get_version_at_date=AsyncMock(return_value=("Testo storico.", "urn")),
    )
    norma = Norma(tipo_atto="codice civile", data="1942-03-16", numero_atto="262")
    visited = NormaVisitata(norma=norma, numero_articolo="1321", urn=CC.replace("2043", "1321"))

    result = await MultivigenzaPipeline(falkordb_client=client, scraper=scraper).ingest_with_history(
        visited, fetch_all_versions=True
    )

    assert result.errors == []  # the pipeline swallows exceptions into this list: an empty one means it ran through
    queries = [cypher for cypher, _ in client.calls]
    merges = [q for q in queries if re.search(r"MERGE \(\w+:[A-Z]", q)]
    assert {re.search(r"MERGE \((\w+):", q).group(1) for q in merges} == {"atto", "art", "comma", "let", "num", "ver"}
    assert sum("MERGE (let:Lettera" in q for q in merges) == 1  # one lettera, not one per letter of "b, numero"
    for query in merges:
        variable = re.search(r"MERGE \((\w+):", query).group(1)
        assert f"{variable}.provenance = coalesce({variable}.provenance, 'ingestion')" in query
    written = "\n".join(queries)
    assert written.count("[r:CONTIENE]") == 4  # act -> article -> comma -> lettera -> numero
    assert "[r:contiene]" not in written
    assert "[r:MODIFICA]" in written and "[r:VERSIONE_DI]" in written


def _fake_kg_for_vectors():
    kg = MagicMock()
    kg._qdrant = MagicMock()
    kg._embedding_service = MagicMock(
        encode_batch_async=AsyncMock(side_effect=lambda texts, **_: [[0.1, 0.2] for _ in texts]),
        encode_document_async=AsyncMock(return_value=[0.1, 0.2]),
    )
    kg.config = MagicMock(qdrant_collection="chunks")
    return kg


async def test_batch_vectors_are_keyed_like_the_lazy_ones():
    from merlt.core.legal_knowledge_graph import LegalKnowledgeGraph
    from merlt.pipeline.batch_ingestion import ArticleFetchResult, BatchIngestionPipeline
    from merlt.pipeline.ingestion import IngestionResult

    text = "Testo dell'articolo abbastanza lungo."
    brocardi_info = {"Spiegazione": "s" * 60, "Ratio": "r" * 60, "Massime": ["x" * 60, "y" * 60]}
    kg = _fake_kg_for_vectors()
    fetch = ArticleFetchResult(
        article_num="2043",
        norma_visitata=NormaVisitata(norma=Norma(tipo_atto="codice civile", data=None, numero_atto=None), numero_articolo="2043"),
        article_text=text,
        brocardi_info=brocardi_info,
    )
    ingestion = IngestionResult(
        article_urn=CC + "!vig=", article_url=CC, chunks=[], bridge_mappings=[], nodes_created=[], relations_created=[],
    )

    assert await BatchIngestionPipeline(kg)._generate_embeddings_batch([fetch], {"2043": ingestion}) == 5

    points = kg._qdrant.upsert.call_args.kwargs["points"]
    assert [p.id for p in points] == [
        point_id(CC, "norma"), point_id(CC, "spiegazione"), point_id(CC, "ratio"),
        point_id(CC, "massima", 0), point_id(CC, "massima", 1),
    ]
    assert {p.payload["article_urn"] for p in points} == {CC}
    assert [p.payload["fonte"] for p in points] == ["Normattiva"] + ["Brocardi.it"] * 4

    # one article, one set of points, whichever writer ran
    lazy = LegalKnowledgeGraph.__new__(LegalKnowledgeGraph)
    lazy._qdrant = MagicMock()
    lazy._embedding_service = kg._embedding_service
    lazy.config = kg.config
    await lazy._upsert_embeddings_multi_source(article_text=text, article_urn=CC, metadata=_meta(), brocardi_info=brocardi_info)
    assert [p.id for p in lazy._qdrant.upsert.call_args.kwargs["points"]] == [p.id for p in points]
