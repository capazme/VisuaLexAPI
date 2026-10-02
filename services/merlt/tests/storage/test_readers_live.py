"""Integration: the readers meet a graph shaped like the ones the writers leave, on a real FalkorDB.

The graph is built here, node by node, in Cypher (`_seed` lists what it holds): it has those
shapes and no others, and it is not the output of the writers. The unit tests pin the Cypher
text a reader sends; only a graph engine shows that the text is valid and finds nodes of
those shapes. Every tool turns a query error into an empty answer, so a test here asserts
the answer it should find, not only that nothing raised: a broken query string fails
somewhere. The last tests feed injection-shaped arguments to the tools and read the graph
afterwards: nothing changed.

Writes to an ISOLATED test graph (`merlt_test_readers`), wiped before and after, so the
Libro IV graph is never touched.

    docker exec -w /app <throwaway-stack>-merlt-api python -m pytest tests/storage/test_readers_live.py -m integration -q
"""

from __future__ import annotations

import importlib
import uuid
from datetime import date, timedelta
from unittest.mock import patch

import pytest
import pytest_asyncio

from merlt.core.legal_knowledge_graph import LegalKnowledgeGraph
from merlt.experts.base import ExpertContext
from merlt.experts.literal import LiteralExpert
from merlt.experts.precedent import PrecedentExpert
from merlt.experts.principles import PrinciplesExpert
from merlt.experts.systemic import SystemicExpert
from merlt.storage.graph.client import FalkorDBClient
from merlt.storage.temporal.validity_service import TemporalValidityService
from merlt.tools.definition import DefinitionLookupTool
from merlt.tools.hierarchy import HierarchyNavigationTool
from merlt.tools.historical_evolution import HistoricalEvolutionTool
from merlt.tools.principle_lookup import PrincipleLookupTool
from merlt.tools.search import GraphSearchTool, SemanticSearchTool
from merlt.tools.textual_reference import TextualReferenceTool
from merlt.tools.verification import VerificationTool

# Needs a live FalkorDB (the compose falkordb service): excluded by default through
# pyproject's `-m 'not integration'`; run with `-m integration` in-container.
pytestmark = pytest.mark.integration

TEST_GRAPH = "merlt_test_readers"
ACT = "urn:nir:stato:regio.decreto:1942-03-16;262:2"
ART1 = f"https://www.normattiva.it/uri-res/N2Ls?{ACT}~art1"
ART2 = f"https://www.normattiva.it/uri-res/N2Ls?{ACT}~art2"
ART3 = f"https://www.normattiva.it/uri-res/N2Ls?{ACT}~art3"
ART4 = f"https://www.normattiva.it/uri-res/N2Ls?{ACT}~art4"
ART5 = f"https://www.normattiva.it/uri-res/N2Ls?{ACT}~art5"
ART6 = f"https://www.normattiva.it/uri-res/N2Ls?{ACT}~art6"
TEXT1 = "Per buona fede si intende la correttezza ai sensi del codice."

RELATION_ATTACK = "X]->(n) DETACH DELETE n //"
LABEL_ATTACK = "Norma) DETACH DELETE n //"
LEVEL_ATTACK = "' OR 1=1 //"
NUMBER_ATTACK = "2]->(n) DELETE n //"
# What the old graph_search ran as Cypher: it deleted the nodes art1 points at with RINVIA.
EXPLOIT = "RINVIA]->(n) DETACH DELETE n WITH start MATCH path = (start)-[r:RINVIA"


@pytest_asyncio.fixture
async def graph():
    client = FalkorDBClient(graph_name=TEST_GRAPH)
    await client.connect()
    await client.query("MATCH (n) DETACH DELETE n", {})
    await _seed(client)
    yield client
    try:
        await client.query("MATCH (n) DETACH DELETE n", {})
    finally:
        await client.close()


async def _seed(client):
    """What this graph holds, node by node (hand-written Cypher, not the writers' output):
    partitions with a rubrica and no estremi; articles with `testo`, `testo_vigente` or both;
    the acts that modify, repeal or replace three of them, and one that INSERISCE a comma into art. 6,
    as multivigenza writes them (the act carries no date of its own that a reader takes: the date
    the amendment takes effect sits on the edge, `data_efficacia`);
    concepts, principles, massime and doctrine keyed by node_id only; the seed's definitions
    (`Norma -[DEFINISCE]-> DefinizioneLegale {node_id, nome, descrizione}`, never to a
    ConcettoGiuridico) and one community definition that carries the old `:Entity:Definizione`
    labels; and the community's entities, as the entity writer leaves them: a principle and a
    ruling written `:Entity:<Label>` (Entity first), and a seed concept the community adopted
    (`:ConcettoGiuridico:Entity`, the domain label first)."""
    await client.query(
        """
        CREATE (cod:Norma {URN: 'urn:test:cod', node_id: 'urn:test:cod', estremi: 'Codice civile', tipo_documento: 'codice'})
        CREATE (libro:Norma {URN: 'urn:test:libro4', rubrica: 'Delle obbligazioni', tipo_documento: 'libro'})
        CREATE (titolo:Norma {URN: 'urn:test:titolo2', rubrica: 'Del contratto', titolo: 'Titolo II', tipo_documento: 'titolo'})
        CREATE (a1:Norma {URN: $art1, estremi: 'Art. 1 c.c.', numero_articolo: '1', tipo_documento: 'articolo', testo: $text1, testo_vigente: $text1})
        CREATE (a2:Norma {URN: $art2, tipo_documento: 'articolo', testo_vigente: 'Solo testo_vigente.'})
        CREATE (a3:Norma {URN: $art3, tipo_documento: 'articolo', testo: 'Solo testo.'})
        CREATE (a4:Norma {URN: $art4, tipo_documento: 'articolo', testo: 'Modificato dal rinvio.'})
        CREATE (a5:Norma {URN: $art5, tipo_documento: 'articolo', testo: 'Mai toccato.'})
        CREATE (a6:Norma {URN: $art6, tipo_documento: 'articolo', testo: 'Con un comma inserito.'})
        CREATE (m4:Norma {URN: 'urn:test:act4', node_id: 'urn:test:act4', estremi: 'L. 4/2023', tipo_documento: 'legge', data_pubblicazione: '2023-01-01', fonte: 'Normattiva', provenance: 'ingestion'})
        CREATE (m4)-[:INSERISCE {disposizione: 'art. 1', data_efficacia: '2023-02-01', data_pubblicazione_gu: '2023-01-01', certezza: 1.0, fonte: 'Normattiva', fonte_relazione: 'L. 4/2023', data_decorrenza: '2023-02-01'}]->(a6)
        CREATE (m1:Norma {URN: 'urn:test:act1', node_id: 'urn:test:act1', estremi: 'L. 1/2020', tipo_documento: 'legge', data_pubblicazione: '2020-01-01', fonte: 'Normattiva', provenance: 'ingestion'})
        CREATE (m2:Norma {URN: 'urn:test:act2', node_id: 'urn:test:act2', estremi: 'L. 2/2021', tipo_documento: 'legge', data_pubblicazione: '2021-01-01', fonte: 'Normattiva', provenance: 'ingestion'})
        CREATE (m3:Norma {URN: 'urn:test:act3', node_id: 'urn:test:act3', estremi: 'L. 3/2022', tipo_documento: 'legge', data_pubblicazione: '2022-01-01', fonte: 'Normattiva', provenance: 'ingestion'})
        CREATE (cod)-[:CONTIENE]->(libro)
        CREATE (libro)-[:CONTIENE]->(titolo)
        CREATE (titolo)-[:CONTIENE]->(a1)
        CREATE (titolo)-[:CONTIENE]->(a2)
        CREATE (titolo)-[:CONTIENE]->(a3)
        CREATE (m1)-[:MODIFICA {disposizione: 'art. 1', data_efficacia: '2020-02-01', data_pubblicazione_gu: '2020-01-01', certezza: 1.0, fonte: 'Normattiva', fonte_relazione: 'L. 1/2020', data_decorrenza: '2020-02-01'}]->(a1)
        CREATE (m2)-[:ABROGA {disposizione: 'art. 1', data_efficacia: '2021-02-01', data_pubblicazione_gu: '2021-01-01', certezza: 1.0, fonte: 'Normattiva', fonte_relazione: 'L. 2/2021', data_decorrenza: '2021-02-01'}]->(a2)
        CREATE (m3)-[:SOSTITUISCE {disposizione: 'art. 1', data_efficacia: '2022-02-01', data_pubblicazione_gu: '2022-01-01', certezza: 1.0, fonte: 'Normattiva', fonte_relazione: 'L. 3/2022', data_decorrenza: '2022-02-01'}]->(a3)
        CREATE (a1)-[:RINVIA]->(a2)
        CREATE (a1)-[:MODIFICA]->(a4)
        CREATE (k:ConcettoGiuridico {node_id: 'concetto:buona_fede', nome: 'Buona fede', descrizione: 'La buona fede e correttezza.'})
        CREATE (k2:ConcettoGiuridico {node_id: 'concetto:correttezza', nome: 'Correttezza', descrizione: 'Lealta nei rapporti.'})
        CREATE (k3:ConcettoGiuridico {node_id: 'concetto:bf_oggettiva', nome: 'Buona fede oggettiva', descrizione: 'Regola di condotta.'})
        CREATE (dl:DefinizioneLegale {node_id: 'definizione:buona_fede', nome: 'buona fede', descrizione: 'Il dovere di lealta tra le parti.'})
        CREATE (a1)-[:DEFINISCE]->(dl)
        CREATE (old:Entity:Definizione {id: 'definizione:mora', nome: 'mora', descrizione: 'Il ritardo colpevole nell adempimento.'})
        CREATE (a3)-[:DEFINISCE]->(old)
        CREATE (k)-[:CORRELATO]->(k2)
        CREATE (k)-[:SPECIES]->(k3)
        CREATE (p:PrincipioGiuridico {node_id: 'principio:buona_fede', nome: 'buona fede', descrizione: 'Le parti agiscono con lealta.', livello: 'generale'})
        CREATE (a1)-[:ESPRIME_PRINCIPIO]->(p)
        CREATE (att:AttoGiudiziario {node_id: 'massima_1', massima: 'Una massima.', organo_emittente: 'Cass. civ.'})
        CREATE (att)-[:INTERPRETA]->(a1)
        CREATE (dot:Dottrina {node_id: 'dottrina:1', descrizione: 'Una nota di dottrina.'})
        CREATE (dot)-[:COMMENTA]->(a1)
        CREATE (cp:Entity:PrincipioGiuridico {id: 'principio:lealta', nome: 'lealta', descrizione: 'Chi agisce lo fa con lealta.', livello: 'generale'})
        CREATE (a1)-[:ESPRIME_PRINCIPIO]->(cp)
        CREATE (cm:Entity:AttoGiudiziario {id: 'atto_giudiziario:trib', nome: 'trib', massima: 'Una massima della community.', organo_emittente: 'Trib. Milano'})
        CREATE (cm)-[:INTERPRETA]->(a1)
        CREATE (tw:ConcettoGiuridico:Entity {node_id: 'concetto:lealta', id: 'concetto:lealta', nome: 'Lealta', descrizione: 'Un concetto del seed adottato dalla community.'})
        CREATE (a1)-[:DISCIPLINA]->(tw)
        CREATE (tw)-[:CORRELATO]->(cp)
        """,
        {"art1": ART1, "art2": ART2, "art3": ART3, "art4": ART4, "art5": ART5, "art6": ART6, "text1": TEXT1},
    )


async def _counts(client):
    nodes = (await client.query("MATCH (n) RETURN count(n) AS c", {}))[0]["c"]
    edges = (await client.query("MATCH ()-[r]->() RETURN count(r) AS c", {}))[0]["c"]
    return nodes, edges


def _context(*urns):
    return ExpertContext(query_text="Che cosa dice la norma?", entities={"norm_references": list(urns)})


# hierarchy_navigation -------------------------------------------------------------------


async def test_the_hierarchy_walks_partitions_told_apart_by_tipo_documento(graph):
    tool = HierarchyNavigationTool(graph_db=graph)
    result = await tool.execute(start_node=ART1 + "!vig=2020-01-01", direction="ancestors")  # a marked URN
    assert result.success, result.error
    assert [(n["urn"], n["tipo"], n["depth"]) for n in result.data["hierarchy"]] == [
        ("urn:test:titolo2", "titolo", 1), ("urn:test:libro4", "libro", 2), ("urn:test:cod", "codice", 3),
    ]
    # titolo and libro have a rubrica and no estremi: the path still reads
    assert result.data["path"] == "Codice civile → Delle obbligazioni → Del contratto"

    libri = await tool.execute(start_node=ART1, direction="ancestors", tipo_filter=["Libro"])  # case-insensitive
    assert [n["urn"] for n in libri.data["hierarchy"]] == ["urn:test:libro4"]
    assert (await tool._find_start_node(ART1 + "@originale"))["tipo"] == "articolo"


async def test_the_hierarchy_finds_siblings_and_descendants_and_reads_their_text(graph):
    tool = HierarchyNavigationTool(graph_db=graph)
    siblings = await tool.execute(start_node="1", direction="siblings", include_text=True)  # by article number
    assert siblings.success, siblings.error
    assert {n["urn"]: n["testo"] for n in siblings.data["hierarchy"]} == {
        ART2: "Solo testo_vigente.", ART3: "Solo testo.",
    }
    assert {n["tipo"] for n in siblings.data["hierarchy"]} == {"articolo"}
    sibling_articles = await tool.execute(start_node="1", direction="siblings", tipo_filter=["Articolo"])
    assert {n["urn"] for n in sibling_articles.data["hierarchy"]} == {ART2, ART3}
    assert (await tool.execute(start_node="1", direction="siblings", tipo_filter=["capo"])).data["hierarchy"] == []
    only_articles = await tool.execute(start_node="urn:test:titolo2", direction="descendants", tipo_filter=["articolo"])
    assert {n["urn"] for n in only_articles.data["hierarchy"]} == {ART1, ART2, ART3}
    assert {n["tipo"] for n in only_articles.data["hierarchy"]} == {"articolo"}
    context = await tool.execute(start_node=ART1, direction="context")
    assert context.success and {n["relation"] for n in context.data["hierarchy"]} == {"ancestor", "sibling"}
    around_a_titolo = await tool.execute(start_node="urn:test:titolo2", direction="context")
    assert {n["relation"] for n in around_a_titolo.data["hierarchy"]} == {"ancestor", "descendant"}
    assert {n["urn"] for n in around_a_titolo.data["hierarchy"] if n["relation"] == "descendant"} == {ART1, ART2, ART3}


async def test_the_hierarchy_cuts_a_very_large_subtree_at_the_limit(graph):
    await graph.query(
        "MATCH (t:Norma {URN: 'urn:test:titolo2'}) UNWIND range(1, 80) AS i "
        "CREATE (t)-[:CONTIENE]->(:Norma {URN: 'urn:test:bulk' + toString(i), tipo_documento: 'articolo', numero_articolo: toString(i)})",
        {},
    )
    tool = HierarchyNavigationTool(graph_db=graph)
    descendants = await tool.execute(start_node="urn:test:titolo2", direction="descendants", max_depth=1)  # 83 below it
    siblings = await tool.execute(start_node="urn:test:bulk1", direction="siblings")  # 82 others
    context = await tool.execute(start_node="urn:test:bulk1", direction="context")
    assert descendants.success and siblings.success and context.success
    sizes = (
        len(descendants.data["hierarchy"]),
        len(siblings.data["hierarchy"]),
        len([n for n in context.data["hierarchy"] if n["relation"] == "sibling"]),
    )
    assert max(sizes) < 80, sizes  # not the 83 below the titolo and the 82 beside the article
    from merlt.tools.hierarchy import MAX_NODES

    assert sizes == (MAX_NODES, MAX_NODES, MAX_NODES)


# graph_search ---------------------------------------------------------------------------


async def test_graph_search_starts_from_a_node_id_and_follows_the_graphs_names(graph):
    tool = GraphSearchTool(graph_db=graph)
    from_a_concept = await tool.execute(
        start_node="concetto:buona_fede", relation_types=["correlato", "SPECIES"], direction="outgoing",
    )
    assert from_a_concept.success, from_a_concept.error
    assert {n["urn"] for n in from_a_concept.data["nodes"]} >= {"concetto:correttezza", "concetto:bf_oggettiva"}

    from_an_article = await tool.execute(
        start_node=ART1 + "@originale", relation_types=["contiene", "cita", "deroga", "RELATED_TO"], direction="both",
        max_hops=99,
    )
    assert {e["type"] for e in from_an_article.data["edges"]} == {"CONTIENE", "RINVIA"}
    assert ART2 in {n["urn"] for n in from_an_article.data["nodes"]}

    only_norma = await tool.execute(start_node=ART1, relation_types=["rinvia"], target_type="norma")
    assert {n["urn"] for n in only_norma.data["nodes"]} == {ART1, ART2}


# definition_lookup ----------------------------------------------------------------------


async def test_definitions_are_found_by_every_strategy_on_what_the_seed_stores(graph):
    tool = DefinitionLookupTool(graph_db=graph)
    # The seed's 498 DEFINISCE edges all end on a DefinizioneLegale, never on a ConcettoGiuridico.
    via_relation = await tool._find_definitions_via_relation("buona fede", None, False, 5)
    assert [(d["source_urn"], d["source_type"], d["definition_text"]) for d in via_relation] == [
        (ART1, "Norma", "Il dovere di lealta tra le parti."),
    ]
    assert via_relation[0]["context"].startswith("Per buona fede")  # the article's text, from `testo`

    # a definition the community wrote under the labels it had before the schema (`:Entity:Definizione`)
    community = await tool._find_definitions_via_relation("mora", None, False, 5)
    assert [(d["source_urn"], d["definition_text"]) for d in community] == [(ART3, "Il ritardo colpevole nell adempimento.")]

    concepts = await tool._find_concept_definitions("buona fede", False, 5)
    assert {d["source_urn"]: (d["source_type"], d["definition_text"]) for d in concepts} == {  # keyed by node_id
        "concetto:buona_fede": ("ConcettoGiuridico", "La buona fede e correttezza."),
        "concetto:bf_oggettiva": ("ConcettoGiuridico", "Regola di condotta."),
        "definizione:buona_fede": ("DefinizioneLegale", "Il dovere di lealta tra le parti."),
    }
    related = await tool._find_related_definitions("buona fede", None, 5)
    assert {d["term"] for d in related} == {"Buona fede", "Buona fede oggettiva", "Correttezza"}  # CORRELATO and SPECIES

    in_text = await tool._find_definitions_in_text("buona fede", None, 5)
    assert [d["source_urn"] for d in in_text] == [ART1]

    everything = await tool.execute(term="buona fede", include_related=True, limit=10 ** 6)
    assert everything.success and everything.data["total"] >= 4
    # the article that DEFINISCE the term is answered with the definition the edge points at
    assert (ART1, "Il dovere di lealta tra le parti.") in {
        (d["source_urn"], d["definition_text"]) for d in everything.data["definitions"]
    }


async def test_definition_source_types_are_any_of_the_labels_asked_for(graph):
    tool = DefinitionLookupTool(graph_db=graph)
    found = await tool._find_definitions_via_relation("buona fede", ["norma", "attogiudiziario"], False, 5)
    assert [d["source_urn"] for d in found] == [ART1]
    assert await tool._find_definitions_via_relation("buona fede", ["attogiudiziario"], False, 5) == []


# textual_reference ----------------------------------------------------------------------


async def test_textual_references_follow_the_graphs_relations_and_read_the_excerpt(graph):
    tool = TextualReferenceTool(graph_db=graph)
    result = await tool.execute(article_urn=ART1 + "!vig=2020-01-01")
    assert result.success, result.error
    assert {r["to_urn"]: (r["reference_type"], r["excerpt"]) for r in result.data["references"]} == {
        ART2: ("RINVIA", "Solo testo_vigente."), ART4: ("MODIFICA", "Modificato dal rinvio."),
    }
    legacy = await tool.execute(article_urn=ART1, reference_types=["richiama", "cita"])
    assert [(r["to_urn"], r["reference_type"]) for r in legacy.data["references"]] == [(ART2, "RINVIA")]


# historical_evolution and the validity check ----------------------------------------------


async def test_history_lists_the_events_and_the_status(graph):
    tool = HistoricalEvolutionTool(graph_db=graph)
    result = await tool.execute(article_urn=ART1 + "!vig=2020-01-01")
    assert result.success, result.error
    assert [(e["event"], e["by_urn"]) for e in result.data["timeline"]] == [("modifica", "urn:test:act1")]
    assert result.data["version_count"] == 2
    only_ends = await tool._get_timeline(ART2, False, ["abroga", "sostituisce"])
    assert [(e["event"], e["by_urn"]) for e in only_ends] == [("abroga", "urn:test:act2")]
    assert [await tool._get_current_status(urn) for urn in (ART1, ART2, ART3)] == ["vigente", "abrogato", "sostituito"]


async def test_the_history_shows_future_amendments_flagged_unless_told_otherwise(graph):
    # Four amendments of one article, dated on the edge as multivigenza writes them: one in the
    # past, two that take effect years ahead (a MODIFICA and a SOSTITUISCE), one with no date at
    # all. By default every one is shown, the future ones flagged; with include_future=False the
    # future ones are left out and counted in `future_omitted`. The undated one is never future.
    art = "urn:test:future-art"
    await graph.query(
        """
        CREATE (a:Norma {URN: $art, tipo_documento: 'articolo', testo: 'Un articolo.'})
        CREATE (past:Norma {URN: 'urn:test:past', estremi: 'L. 1/2020', tipo_documento: 'legge', data_pubblicazione: '2020-01-01'})
        CREATE (future:Norma {URN: 'urn:test:future', estremi: 'L. 9/2025', tipo_documento: 'legge', data_pubblicazione: '2025-01-01'})
        CREATE (undated:Norma {URN: 'urn:test:undated', estremi: 'Atto senza data', tipo_documento: 'legge'})
        CREATE (later:Norma {URN: 'urn:test:later', estremi: 'L. 8/2025', tipo_documento: 'legge', data_pubblicazione: '2025-06-01'})
        CREATE (past)-[:MODIFICA {disposizione: 'art. 1', data_efficacia: '2020-02-01', certezza: 1.0, fonte: 'Normattiva'}]->(a)
        CREATE (future)-[:MODIFICA {disposizione: 'art. 2', data_efficacia: '2099-01-01', certezza: 1.0, fonte: 'Normattiva'}]->(a)
        CREATE (undated)-[:INSERISCE {disposizione: 'art. 3', certezza: 1.0, fonte: 'Normattiva'}]->(a)
        CREATE (later)-[:SOSTITUISCE {disposizione: 'art. 4', data_efficacia: '2098-06-01', certezza: 1.0, fonte: 'Normattiva'}]->(a)
        """,
        {"art": art},
    )
    tool = HistoricalEvolutionTool(graph_db=graph)
    default = await tool.execute(article_urn=art)
    assert default.success, default.error
    assert sorted((e["by_urn"], e["future"]) for e in default.data["timeline"]) == [
        ("urn:test:future", True), ("urn:test:later", True), ("urn:test:past", False), ("urn:test:undated", False),
    ]
    assert default.metadata["future_omitted"] == 0
    assert [e["date"] for e in default.data["timeline"] if e["by_urn"] == "urn:test:past"] == ["2020-02-01"]
    # the replacement has not taken effect: the article is in force, with one pending change
    assert default.data["current_status"] == "vigente"
    assert default.data["pending"] == [
        {"type": "sostituisce", "date": "2098-06-01", "by_urn": "urn:test:later", "by_estremi": "L. 8/2025"},
    ]
    today_only = await tool.execute(article_urn=art, include_future=False)
    assert sorted(e["by_urn"] for e in today_only.data["timeline"]) == ["urn:test:past", "urn:test:undated"]
    assert today_only.data["total_events"] == 2
    assert today_only.metadata["future_omitted"] == 2
    no_future_replacement = await tool._get_timeline(art, False, ["sostituisce"])
    assert no_future_replacement == []


@pytest.mark.parametrize("when, status, pending", [
    ("tomorrow", "vigente", ["abroga"]),
    ("yesterday", "abrogato", []),
    ("undated", "abrogato", []),  # nothing says it is in the future
])
async def test_an_abrogation_counts_from_the_day_it_takes_effect(graph, when, status, pending):
    days = {"tomorrow": 1, "yesterday": -1}
    effect = (date.today() + timedelta(days=days[when])).isoformat() if when in days else None
    art = f"urn:test:abrogated-{when}"
    await graph.query(
        "CREATE (a:Norma {URN: $art, tipo_documento: 'articolo', testo: 'Un articolo.'}) "
        "CREATE (act:Norma {URN: $act, estremi: 'L. 7/2026', tipo_documento: 'legge'}) "
        "CREATE (act)-[r:ABROGA {disposizione: 'art. 1', certezza: 1.0, fonte: 'Normattiva'}]->(a) "
        "SET r.data_efficacia = $effect",
        {"art": art, "act": art + "-act", "effect": effect},
    )
    found, coming = await HistoricalEvolutionTool(graph_db=graph)._get_status(art)
    assert (found, [p["type"] for p in coming]) == (status, pending)
    if pending:
        assert coming[0]["date"] == effect and coming[0]["by_urn"] == art + "-act"


async def test_validity_finds_modifications_by_their_edges_without_a_count_property(graph):
    service = TemporalValidityService(graph_db=graph)
    results = {urn: await service.check_validity(urn) for urn in (ART1, ART2, ART3, ART5)}
    assert {urn: r.status for urn, r in results.items()} == {
        ART1: "modificato", ART2: "abrogato", ART3: "sostituito", ART5: "vigente",
    }
    assert results[ART1].modification_count == 1
    assert [m["type"] for m in results[ART1].recent_modifications] == ["modifica"]
    marked = await service.check_validity(ART1 + "!vig=2020-01-01")
    assert (marked.urn, marked.status) == (ART1 + "!vig=2020-01-01", "modificato")


@pytest.mark.parametrize("when, as_of, status, pending", [
    ("tomorrow", None, "vigente", ["abroga"]),
    ("yesterday", None, "abrogato", []),
    ("undated", None, "abrogato", []),  # nothing says it is in the future
    ("2020-06-01", "2020-01-01", "vigente", ["abroga"]),  # in force on the day asked about
    ("2020-06-01", "2021-01-01", "abrogato", []),
])
async def test_the_validity_check_reads_an_abrogation_from_the_day_it_takes_effect(graph, when, as_of, status, pending):
    days = {"tomorrow": 1, "yesterday": -1}
    effect = (date.today() + timedelta(days=days[when])).isoformat() if when in days else (None if when == "undated" else when)
    art = f"urn:test:validity-{when}-{as_of}"
    await graph.query(
        "CREATE (a:Norma {URN: $art, tipo_documento: 'articolo', testo: 'Un articolo.'}) "
        "CREATE (act:Norma {URN: $act, estremi: 'L. 7/2026', tipo_documento: 'legge'}) "
        "CREATE (act)-[r:ABROGA {disposizione: 'art. 1', certezza: 1.0, fonte: 'Normattiva'}]->(a) "
        "SET r.data_efficacia = $effect",
        {"art": art, "act": art + "-act", "effect": effect},
    )
    result = await TemporalValidityService(graph_db=graph).check_validity(art, as_of)
    assert (result.status, [p["type"] for p in result.pending]) == (status, pending)
    assert result.is_valid is (status == "vigente")
    if pending:
        assert result.pending[0]["date"] == effect and result.pending[0]["by_urn"] == art + "-act"
        assert result.abrogating_norm is None


async def test_an_inserted_comma_is_an_amendment(graph):
    history = await HistoricalEvolutionTool(graph_db=graph).execute(article_urn=ART6)
    assert history.success, history.error
    assert [(e["event"], e["by_urn"]) for e in history.data["timeline"]] == [("inserisce", "urn:test:act4")]
    checked = await TemporalValidityService(graph_db=graph).check_validity(ART6)
    assert (checked.status, checked.modification_count) == ("modificato", 1)
    assert [(m["type"], m["by_urn"]) for m in checked.recent_modifications] == [("inserisce", "urn:test:act4")]


async def test_the_graph_context_reads_the_parent_and_the_modifiers(graph):
    knowledge_graph = LegalKnowledgeGraph.__new__(LegalKnowledgeGraph)
    knowledge_graph._falkordb = graph
    context = await knowledge_graph._get_graph_context(ART1)
    assert context == {"parent_urn": "urn:test:titolo2", "parent_title": "Titolo II", "children": [], "modifiers": ["L. 1/2020"]}


# principle_lookup and verify_sources ---------------------------------------------------------


async def test_principles_are_found_by_every_strategy_and_the_level_is_a_parameter(graph):
    tool = PrincipleLookupTool(graph_db=graph)
    result = await tool.execute(query="buona fede")
    assert result.success, result.error
    assert [(p["nome"], p["level"], p["fondamento"]) for p in result.data["principles"]] == [("buona fede", "generale", "Art. 1 c.c.")]
    assert (await tool.execute(query="buona fede", principle_level=["generale"])).data["total"] == 1
    assert (await tool.execute(query="buona fede", principle_level=["costituzionale"])).data["total"] == 0
    # each strategy on its own, so a broken one is not hidden by the other finding the same principle
    by_relation = await tool._find_principles_via_relation("buona fede", ["generale"], 5)
    by_node = await tool._find_principle_nodes("buona fede", ["generale"], 5)
    assert [p["nome"] for p in by_relation] == [p["nome"] for p in by_node] == ["buona fede"]
    assert by_relation[0]["norme_urns"] == by_node[0]["norme_urns"] == [ART1]
    assert await tool._find_principles_via_relation("buona fede", ["costituzionale"], 5) == []
    assert await tool._find_principle_nodes("buona fede", [LEVEL_ATTACK], 5) == []
    in_text = await tool._find_principles_in_text("correttezza", 5)  # a text without 'principio' or 'generale'
    assert in_text == []
    await graph.query("MATCH (n:Norma {URN: $urn}) SET n.testo = 'Il principio di correttezza.'", {"urn": ART4})
    in_text = await tool._find_principles_in_text("correttezza", 5)
    assert [p["norme_urns"] for p in in_text] == [[ART4]]
    only_the_text_answers = await tool.execute(query="correttezza")  # no principle has that name
    assert [p["norme_urns"] for p in only_the_text_answers.data["principles"]] == [[ART4]]


async def test_verification_takes_any_of_the_node_types(graph):
    tool = VerificationTool(graph_db=graph, bridge=None)
    both = await tool.execute(
        source_ids=[ART1, "buona fede", "inesistente"], strict_mode=False, node_types=["Norma", "PrincipioGiuridico"],
    )
    assert both.success, both.error
    assert both.data["verified"] == [ART1, "buona fede"] and both.data["unverified"] == ["inesistente"]
    only_norma = await tool.execute(source_ids=[ART1, "buona fede"], strict_mode=False, node_types=["norma"])
    assert only_norma.data["verified"] == [ART1] and only_norma.data["unverified"] == ["buona fede"]
    nothing = await tool.execute(source_ids=[ART1], strict_mode=False, node_types=[LABEL_ATTACK])
    assert nothing.data["verified"] == []
    by_number = await tool.execute(source_ids=["art1", "art99"], strict_mode=False)  # the article-number fallback
    assert by_number.data["verified"] == ["art1"] and by_number.data["unverified"] == ["art99"]


# the experts ------------------------------------------------------------------------------


async def test_the_experts_read_the_text_of_what_they_walk_to(graph):
    literal = LiteralExpert(tools=[GraphSearchTool(graph_db=graph)])
    sources = await literal._retrieve_sources(_context(ART1))
    texts = {s["text"] for s in sources if s["source"] == "graph_traversal"}
    assert {TEXT1, "Il dovere di lealta tra le parti."} <= texts  # the article and its definition (`descrizione`)

    principles = PrinciplesExpert(tools=[SemanticSearchTool(), GraphSearchTool(graph_db=graph)])
    found = await principles._search_principles(_context(ART1))
    # the seed's principle and the one the community wrote (`:Entity:PrincipioGiuridico`)
    assert {p["text"] for p in found if p["source"] == "principle_graph"} == {
        "Le parti agiscono con lealta.", "Chi agisce lo fa con lealta.",
    }

    precedent = PrecedentExpert(tools=[SemanticSearchTool(), GraphSearchTool(graph_db=graph)])
    cases = await precedent._search_jurisprudence(_context(ART1))
    assert {(c["text"], c["court"]) for c in cases if c["source"] == "jurisprudence_graph"} == {
        ("Una massima.", "Cass. civ."), ("Una massima della community.", "Trib. Milano"),
    }


async def test_the_systemic_walk_reads_a_massimas_text(graph, monkeypatch):
    from merlt.experts import systemic

    monkeypatch.setenv("MERLT_NEURAL_TRAVERSAL_ENABLED", "false")
    systemic._reset_neural_traversal_flag_for_tests()
    try:
        expert = SystemicExpert(tools=[GraphSearchTool(graph_db=graph)])
        expanded = await expert._expand_systemic_relations(_context(ART1), [])
    finally:
        systemic._reset_neural_traversal_flag_for_tests()
    assert {"Una massima.", TEXT1, "Modificato dal rinvio."} <= {e["text"] for e in expanded}


# a community node reads as its domain type --------------------------------------------------


async def test_a_community_node_reads_as_its_domain_type_in_every_reader(graph):
    labels = {
        row["id"]: row["labels"] for row in await graph.query(
            "MATCH (n) WHERE n.id IN ['principio:lealta', 'atto_giudiziario:trib', 'concetto:lealta'] "
            "RETURN n.id AS id, labels(n) AS labels", {},
        )
    }
    # what makes the checks below mean something: the community's nodes carry Entity first, an
    # adopted seed concept last (FalkorDB orders a node's labels by label id)
    assert labels["principio:lealta"][0] == "Entity" and labels["atto_giudiziario:trib"][0] == "Entity"
    assert labels["concetto:lealta"][-1] == "Entity"

    walked = await GraphSearchTool(graph_db=graph).execute(
        start_node=ART1, relation_types=["ESPRIME_PRINCIPIO", "INTERPRETA", "DISCIPLINA"], direction="both",
    )
    types = {(n["properties"].get("id") or n["properties"].get("node_id")): n["type"] for n in walked.data["nodes"]}
    assert types["principio:lealta"] == "PrincipioGiuridico"
    assert types["atto_giudiziario:trib"] == "AttoGiudiziario"
    assert types["concetto:lealta"] == "ConcettoGiuridico"

    verification = VerificationTool(graph_db=graph, bridge=None)
    checked = await verification.execute(source_ids=["lealta", "Lealta"], strict_mode=False)
    assert checked.data["verification_results"]["lealta"]["node_type"] == "PrincipioGiuridico"
    assert checked.data["verification_results"]["Lealta"]["node_type"] == "ConcettoGiuridico"

    assert (await HierarchyNavigationTool(graph_db=graph)._find_start_node("lealta"))["tipo"] == "PrincipioGiuridico"

    graph_router = importlib.import_module("merlt.api.graph_router")
    with patch("merlt.api.graph_router.FalkorDBClient", return_value=_Lent(graph)):
        relations = await graph_router.get_article_relations(ART1, relation_type=None, api_key=None)
        entities = await graph_router.get_article_entities(ART1, validation_status=None, api_key=None)
        detail = await graph_router.get_node_details("concetto:lealta", api_key=None)
    # (a community node has no URN and no node_id: the routers name it by its `nome`)
    assert {r["target_label"]: r["target_type"] for r in relations["relations"]}["lealta"] == "PrincipioGiuridico"
    assert {e["entity_text"]: e["entity_type"] for e in entities["entities"]}["lealta"] == "PrincipioGiuridico"
    assert [(r["target_id"], r["target_label"]) for r in detail["relations"]] == [("principio:lealta", "PrincipioGiuridico")]

    # the subgraph keeps a community node whose domain type was asked for (it read as "entity" before)
    with patch("merlt.api.graph_router.FalkorDBClient", return_value=_Lent(graph)):
        subgraph = await graph_router.get_subgraph(
            root_urn=ART1, depth=1, entity_types="PrincipioGiuridico", api_key=None,
        )
    assert {n.id: n.type for n in subgraph.nodes}["principio:lealta"] == "PrincipioGiuridico"

    # the related nodes of an article name the type of what they found
    related = await graph.get_related_nodes_for_article(ART1)
    assert {n["node_nome"]: n["node_label"] for n in related if n["node_nome"]}["lealta"] == "PrincipioGiuridico"

    # the issue context: a node (by node_id) and a relation (source and target by node_id)
    from merlt.api.enrichment_router import fetch_entity_details_from_graph

    node = await fetch_entity_details_from_graph("concetto:lealta", graph)
    assert node.node_type == "ConcettoGiuridico"
    relation = await fetch_entity_details_from_graph("rel_concetto:lealta_CORRELATO_concetto:buona_fede", graph)
    assert (relation.source_type, relation.target_type) == ("ConcettoGiuridico", "ConcettoGiuridico")


# the routers --------------------------------------------------------------------------------


class _Lent:
    """The router opens and closes its own client: lend it the test's connected one."""

    def __init__(self, client):
        self._client = client

    async def connect(self):
        pass

    async def close(self):
        pass

    async def query(self, *args):
        return await self._client.query(*args)

    async def ro_query(self, *args):
        return await self._client.ro_query(*args)


async def test_the_routers_filter_relations_by_the_graphs_names(graph):
    graph_router = importlib.import_module("merlt.api.graph_router")
    before = await _counts(graph)
    with patch("merlt.api.graph_router.FalkorDBClient", return_value=_Lent(graph)):
        relations = await graph_router.get_article_relations(ART1, relation_type="cita", api_key=None)
        subgraph = await graph_router.get_subgraph(
            root_urn=ART1, depth=1, relation_types=f"cita, {RELATION_ATTACK}", api_key=None,
        )
    assert [(r["type"], r["target_urn"]) for r in relations["relations"]] == [("RINVIA", ART2)]
    searched = await graph_router._query_search_subgraph(graph, {ART1}, ["cita", RELATION_ATTACK], 50)
    assert {row["rel_type"] for row in searched} == {"RINVIA"}
    assert len(await graph_router._query_search_subgraph(graph, {ART1}, None, 50)) > 1
    assert {e.type for e in subgraph.edges} == {"RINVIA"} and {n.id for n in subgraph.nodes} >= {ART1, ART2}
    assert await _counts(graph) == before


# the read-only call --------------------------------------------------------------------------


async def test_ro_query_reads_refuses_a_write_and_reads_a_missing_graph_as_empty(graph):
    read = await graph.ro_query("MATCH (n:Norma) RETURN count(n) AS c", {})
    assert read == await graph.query("MATCH (n:Norma) RETURN count(n) AS c", {}) and read[0]["c"] > 0
    before = await _counts(graph)
    with pytest.raises(Exception, match="RO_QUERY"):
        await graph.ro_query("MATCH (n) DETACH DELETE n", {})
    assert await _counts(graph) == before

    never_created = FalkorDBClient(graph_name=f"merlt_test_readers_missing_{uuid.uuid4().hex}")
    await never_created.connect()
    try:
        assert await never_created.ro_query("MATCH (n) RETURN n LIMIT 1", {}) == []
    finally:
        await never_created.close()


# injection ----------------------------------------------------------------------------------


async def test_injection_shaped_arguments_change_nothing_in_the_graph(graph):
    before = await _counts(graph)
    answers = {
        "search exploit": await GraphSearchTool(graph_db=graph).execute(start_node=ART1, relation_types=[EXPLOIT]),
        "search relations": await GraphSearchTool(graph_db=graph).execute(start_node=ART1, relation_types=[RELATION_ATTACK]),
        "search label": await GraphSearchTool(graph_db=graph).execute(start_node=ART1, target_type=LABEL_ATTACK),
        "search start": await GraphSearchTool(graph_db=graph).execute(start_node=RELATION_ATTACK),
        "hierarchy type": await HierarchyNavigationTool(graph_db=graph).execute(
            start_node=ART1, direction="ancestors", tipo_filter=[LABEL_ATTACK]),
        "history events": await HistoricalEvolutionTool(graph_db=graph).execute(article_urn=ART1, event_types=[RELATION_ATTACK]),
        "textual": await TextualReferenceTool(graph_db=graph).execute(
            article_urn=ART1, reference_types=[RELATION_ATTACK, "rinvia"]),
        "definition": await DefinitionLookupTool(graph_db=graph).execute(
            term=LEVEL_ATTACK, source_types=[LABEL_ATTACK, "norma"], include_related=True),
        "principles": await PrincipleLookupTool(graph_db=graph).execute(
            query=LEVEL_ATTACK, principle_level=[LEVEL_ATTACK]),
        "verification": await VerificationTool(graph_db=graph, bridge=None).execute(
            source_ids=[ART1], strict_mode=False, node_types=[LABEL_ATTACK, "norma"]),
    }
    assert all(result.success for result in answers.values()), {k: r.error for k, r in answers.items() if not r.success}
    assert answers["search exploit"].data["nodes"] == [] and answers["search relations"].data["nodes"] == []
    assert answers["textual"].data["references"][0]["to_urn"] == ART2  # the valid name still answers
    assert answers["verification"].data["verified"] == [ART1]
    numbers = {
        "search": await GraphSearchTool(graph_db=graph).execute(start_node=ART1, max_hops=NUMBER_ATTACK),
        "hierarchy": await HierarchyNavigationTool(graph_db=graph).execute(start_node=ART1, max_depth=NUMBER_ATTACK),
        "textual": await TextualReferenceTool(graph_db=graph).execute(article_urn=ART1, max_depth=NUMBER_ATTACK),
        "definition": await DefinitionLookupTool(graph_db=graph).execute(term="buona fede", limit=NUMBER_ATTACK),
        "principles": await PrincipleLookupTool(graph_db=graph).execute(query="buona fede", top_k=NUMBER_ATTACK),
    }
    assert not any(result.success for result in numbers.values())
    assert await _counts(graph) == before
