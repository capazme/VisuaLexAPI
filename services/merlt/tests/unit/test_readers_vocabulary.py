"""The experts, tools, retriever and policy read the schema's vocabulary."""
import importlib
import re
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from merlt.experts.base import ExpertContext
from merlt.experts.literal import LiteralExpert
from merlt.experts.precedent import PrecedentExpert, _case_law_from_node
from merlt.experts.principles import PrinciplesExpert
from merlt.experts.systemic import SystemicExpert
from merlt.rlcf.policy_gradient import normalize_relation_type
from merlt.storage.graph.schema import Rel
from merlt.storage.retriever.models import EXPERT_SOURCE_TYPES
from merlt.storage.retriever.retriever import GraphAwareRetriever
from merlt.tools.search import GraphSearchTool, SemanticSearchTool

CC = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043"


class _GraphRecorder:
    """A graph client that records the Cypher it is asked and answers with fixed rows.

    `query` is the writer's call and `ro_query` the read-only one: the readers use the second."""

    def __init__(self, rows=None, answers=None):
        self.cyphers = []
        self.params = []
        self.methods = []
        self._rows = rows or []
        self._answers = answers or []  # [(a piece of the Cypher, rows)]: the first that fits wins

    async def _ask(self, method, cypher, params):
        self.methods.append(method)
        self.cyphers.append(cypher)
        self.params.append(params)
        for piece, rows in self._answers:
            if piece in cypher:
                return rows
        return self._rows

    async def query(self, cypher, params=None):
        return await self._ask("query", cypher, params)

    async def ro_query(self, cypher, params=None):
        return await self._ask("ro_query", cypher, params)


def _graph_node(label, **props):
    """A record the way FalkorDBClient hands a node to the graph tool."""
    return {"node": {"properties": props, "labels": [label]}}


def _context(*urns):
    return ExpertContext(query_text="Che cosa dice la norma?", entities={"norm_references": list(urns)})


def _without_coalesced_text(cypher):
    """The Cypher with every `coalesce(x.testo, x.testo_vigente)` taken out: what is
    left must not read `testo_vigente` on its own."""
    return re.sub(r"coalesce\((\w+)\.testo,\s*\1\.testo_vigente\)", "", cypher)


# The relation lists the experts ask for -------------------------------------


@pytest.mark.parametrize("names", [
    SystemicExpert.STATIC_SYSTEMIC_RELATIONS, SystemicExpert.NEURAL_EXTRA_CANDIDATE_RELATIONS,
    LiteralExpert.GRAPH_RELATIONS, PrinciplesExpert.GRAPH_RELATIONS, PrecedentExpert.GRAPH_RELATIONS,
])
def test_every_expert_asks_for_canonical_relations(names):
    assert names and all(Rel(name) for name in names)


@pytest.fixture
def _static_systemic_floor(monkeypatch):
    """The neural-traversal flag is read once and cached: pin it off around the test."""
    from merlt.experts import systemic

    monkeypatch.setenv("MERLT_NEURAL_TRAVERSAL_ENABLED", "false")
    systemic._reset_neural_traversal_flag_for_tests()
    yield
    systemic._reset_neural_traversal_flag_for_tests()


async def test_the_systemic_expert_walks_the_floor_it_declares(_static_systemic_floor):
    graph = _GraphRecorder()
    expert = SystemicExpert(tools=[GraphSearchTool(graph_db=graph)])
    await expert._expand_systemic_relations(_context(CC), [])
    floor = "|".join(SystemicExpert.STATIC_SYSTEMIC_RELATIONS)
    assert f"-[r:{floor}*1..2]-" in graph.cyphers[0]
    assert graph.params[0] == {"start_urn": CC}


async def test_the_literal_expert_walks_its_relations_and_reads_any_writers_text():
    # An article that keeps its text in `testo_vigente` only (written before `testo` was copied) is read, not dropped.
    graph = _GraphRecorder(rows=[_graph_node("Norma", URN=CC, testo_vigente="Testo dell'articolo.")])
    expert = LiteralExpert(tools=[GraphSearchTool(graph_db=graph)])
    sources = await expert._retrieve_sources(_context(CC))
    assert "[r:CONTIENE|DEFINISCE|DISCIPLINA*1..2]" in graph.cyphers[0]
    assert [s["text"] for s in sources if s["source"] == "graph_traversal"] == ["Testo dell'articolo."]


async def test_the_principles_expert_walks_its_relations_and_reads_a_principle_from_descrizione():
    graph = _GraphRecorder(rows=[
        _graph_node("PrincipioGiuridico", node_id="principio:buona_fede", descrizione="Le parti agiscono secondo buona fede."),
    ])
    expert = PrinciplesExpert(tools=[SemanticSearchTool(), GraphSearchTool(graph_db=graph)])
    found = await expert._search_principles(_context(CC))
    assert "[r:ESPRIME_PRINCIPIO|DISCIPLINA|INTERPRETA|COMMENTA*1..2]" in graph.cyphers[0]
    assert [p["text"] for p in found if p["source"] == "principle_graph"] == ["Le parti agiscono secondo buona fede."]


async def test_the_precedent_expert_reads_the_seeds_massime_walking_toward_the_article():
    graph = _GraphRecorder(rows=[
        _graph_node("AttoGiudiziario", node_id="massima_cass_1_2020", massima="Massima.", organo_emittente="Cass. civ."),
        _graph_node("Norma", URN=CC, testo="Un articolo non e' giurisprudenza."),
    ])
    expert = PrecedentExpert(tools=[SemanticSearchTool(), GraphSearchTool(graph_db=graph)])
    found = await expert._search_jurisprudence(_context(CC))
    assert "<-[r:INTERPRETA|COMMENTA|DISCIPLINA|APPLICA_A*1..2]-" in graph.cyphers[0]
    cases = [entry for entry in found if entry["source"] == "jurisprudence_graph"]
    assert [(c["text"], c["court"]) for c in cases] == [("Massima.", "Cass. civ.")]


def test_react_reads_a_graph_nodes_text_whichever_writer_stored_it():
    result = SimpleNamespace(success=True, data={"nodes": [
        {"urn": CC, "type": "Norma", "properties": {"URN": CC, "testo_vigente": "Testo vigente."}},
        {"urn": "principio:x", "type": "PrincipioGiuridico", "properties": {"descrizione": "Un principio."}},
        {"urn": "massima:y", "type": "AttoGiudiziario", "properties": {"massima": "Una massima."}},
    ]})
    sources = LiteralExpert()._extract_sources_from_result(result)
    assert [s["text"] for s in sources] == ["Testo vigente.", "Un principio.", "Una massima."]


# The policy scores the graph's names ----------------------------------------


@pytest.mark.parametrize("name", [
    "DISCIPLINA", "INTERPRETA", "IMPONE", "CORRELATO", "DEROGA_A", "RINVIA", "CONTIENE",
    "COMMENTA", "ESPRIME_PRINCIPIO", "PREVEDE", "INSERISCE", "SOSTITUISCE",
])
def test_the_policy_scores_every_canonical_relation(name):
    # A name the policy cannot map comes back unchanged and collapses on RELATED_TO.
    assert normalize_relation_type(name) != name


# The graph tool -------------------------------------------------------------


def test_the_graph_tool_resolves_any_callers_names_and_the_start_urn():
    tool = GraphSearchTool(graph_db=None)
    query, params = tool._build_traversal_query(
        start_node=CC + "@originale", relation_types=["contiene", "cita", "deroga", "RELATED_TO"],
        max_hops=2, target_type=None, direction="both",
    )
    assert "[r:CONTIENE|RINVIA|DEROGA_A|CORRELATO*1..2]" in query
    assert params == {"start_urn": CC}


@pytest.mark.parametrize("start_node, key", [
    (CC + "!vig=2023-01-01", CC),
    (CC + "!orig=1942-03-16", CC),
    (CC, CC),
    ("massima_cassazione_civile_25837_2017", "massima_cassazione_civile_25837_2017"),
    ("principio:buona_fede", "principio:buona_fede"),
])
def test_the_graph_tool_starts_from_the_graphs_key(start_node, key):
    _, params = GraphSearchTool(graph_db=None)._build_traversal_query(start_node=start_node)
    assert params == {"start_urn": key}


# Case law and the retriever ---------------------------------------------------


def test_a_seed_massima_is_read_as_case_law():
    node = {"type": "AttoGiudiziario", "urn": "", "properties": {"massima": "Testo della massima.", "organo_emittente": "Cass. civ."}}
    entry = _case_law_from_node(node, CC)
    assert entry["text"] == "Testo della massima." and entry["court"] == "Cass. civ."
    assert _case_law_from_node({"type": "Norma", "properties": {}}, CC) is None


def test_the_older_case_law_names_are_still_read():
    node = {"type": "Massima", "urn": "m1", "properties": {"testo": "Vecchio testo.", "corte": "Cassazione"}}
    entry = _case_law_from_node(node, CC)
    assert (entry["text"], entry["court"], entry["source_urn"]) == ("Vecchio testo.", "Cassazione", CC)
    assert _case_law_from_node({"type": "Sentenza", "properties": {}}, CC)["court"] == "unknown"


def test_retriever_filters_come_from_the_schema():
    assert EXPERT_SOURCE_TYPES["literal"] == EXPERT_SOURCE_TYPES["LiteralExpert"] == ["norma", "comma"]
    assert "concetto" in EXPERT_SOURCE_TYPES["PrinciplesExpert"]
    assert EXPERT_SOURCE_TYPES["precedent"] == ["massima"]


def test_traversal_weights_read_upper_case_relations():
    retriever = GraphAwareRetriever(vector_db=MagicMock(), graph_db=MagicMock(), bridge_table=MagicMock())
    assert retriever._compute_static_relation_bonus(["CONTIENE"], "LiteralExpert") == 1.0


def test_a_missing_retriever_weights_file_is_not_a_warning(monkeypatch):
    # The file exists in no deployment: the default weights are the normal case.
    from structlog.testing import capture_logs

    from merlt.storage.retriever import models

    def _missing(*args, **kwargs):
        raise FileNotFoundError("retriever_weights.yaml")

    monkeypatch.setattr(models, "open", _missing, raising=False)
    with capture_logs() as logs:
        weights = models._load_expert_weights()
    assert weights == models._get_default_weights()
    assert [entry for entry in logs if entry["log_level"] in ("warning", "error")] == []


# The tools ---------------------------------------------------------------------


async def test_the_hierarchy_walks_contiene_backwards():
    from merlt.tools.hierarchy import HierarchyNavigationTool

    graph = _GraphRecorder()
    tool = HierarchyNavigationTool(graph_db=graph)
    await tool._get_ancestors(CC, 3, False, None)
    await tool._get_siblings(CC, False, None)
    ancestors, siblings = graph.cyphers
    assert "(n)-[:CONTIENE*1..3]->(start)" in ancestors
    assert "(parent)-[:CONTIENE]->(start)" in siblings and "(parent)-[:CONTIENE]->(sibling)" in siblings
    assert "CONTENUTO_IN" not in ancestors + siblings


async def test_the_hierarchy_reads_a_nodes_text_whichever_writer_stored_it():
    from merlt.tools.hierarchy import HierarchyNavigationTool

    graph = _GraphRecorder()
    tool = HierarchyNavigationTool(graph_db=graph)
    await tool._get_ancestors(CC, 3, True, None)
    await tool._get_descendants(CC, 1, True, None)
    await tool._get_siblings(CC, True, None)
    for cypher in graph.cyphers:
        assert "testo_vigente" in cypher and "testo_vigente" not in _without_coalesced_text(cypher)
        assert " AS testo" in cypher


async def test_the_history_follows_the_graphs_modification_relations():
    from merlt.tools.historical_evolution import HistoricalEvolutionTool

    graph = _GraphRecorder()
    await HistoricalEvolutionTool(graph_db=graph)._get_timeline(CC, False, None)
    assert "<-[r:MODIFICA|ABROGA|SOSTITUISCE]-" in graph.cyphers[0]


async def test_the_history_resolves_a_callers_legacy_names():
    from merlt.tools.historical_evolution import HistoricalEvolutionTool

    graph = _GraphRecorder()
    await HistoricalEvolutionTool(graph_db=graph)._get_timeline(CC, False, ["modifica", "abroga"])
    await HistoricalEvolutionTool(graph_db=graph)._get_timeline(CC, False, ["sostituisce", "SOSTITUISCE"])
    assert "<-[r:MODIFICA|ABROGA]-" in graph.cyphers[0]
    assert "<-[r:SOSTITUISCE]-" in graph.cyphers[1]


async def test_the_history_reports_lowercase_events_from_the_graphs_names():
    from merlt.tools.historical_evolution import HistoricalEvolutionTool

    rows = [{"event_type": "MODIFICA", "by_urn": "u", "by_estremi": "L. 1/2020", "event_date": "2020-01-01", "description": ""}]
    timeline = await HistoricalEvolutionTool(graph_db=_GraphRecorder(rows=rows))._get_timeline(CC, False, None)
    assert [event["event"] for event in timeline] == ["modifica"]


async def test_textual_references_follow_the_graphs_relations():
    from merlt.tools.textual_reference import TextualReferenceTool

    graph = _GraphRecorder()
    await TextualReferenceTool(graph_db=graph).execute(article_urn=CC)
    assert "-[:RINVIA|MODIFICA*1..2]->" in graph.cyphers[0]


async def test_textual_references_resolve_a_callers_legacy_names():
    from merlt.tools.textual_reference import TextualReferenceTool

    graph = _GraphRecorder()
    # `richiama` and `cita` are RINVIA in the graph; the repeat is dropped.
    await TextualReferenceTool(graph_db=graph).execute(article_urn=CC, reference_types=["richiama", "modifica", "cita"])
    assert "-[:RINVIA|MODIFICA*1..2]->" in graph.cyphers[0]


async def test_textual_references_read_an_excerpt_whichever_writer_stored_it():
    from merlt.tools.textual_reference import TextualReferenceTool

    graph = _GraphRecorder()
    await TextualReferenceTool(graph_db=graph).execute(article_urn=CC)
    cypher = graph.cyphers[0]
    assert "coalesce(target.testo, target.testo_vigente) as excerpt" in cypher
    assert "testo_vigente" not in _without_coalesced_text(cypher)


async def test_definitions_read_the_text_whichever_writer_stored_it():
    from merlt.tools.definition import DefinitionLookupTool

    graph = _GraphRecorder()
    tool = DefinitionLookupTool(graph_db=graph)
    await tool._find_definitions_via_relation("buona fede", None, False, 5)
    await tool._find_definitions_in_text("buona fede", None, 5)
    via_relation, in_text = graph.cyphers
    assert "coalesce(concept.definizione, concept.descrizione) AS definition_text" in via_relation
    assert "coalesce(source.testo, source.testo_vigente) AS context" in via_relation
    assert "coalesce(n.testo, n.testo_vigente) AS definition_text" in in_text
    for cypher in graph.cyphers:
        assert "testo_vigente" not in _without_coalesced_text(cypher)


# The seed's 498 DEFINISCE edges all end on a DefinizioneLegale {node_id, nome, descrizione}: none on a
# ConcettoGiuridico, which is what the definition lookup used to ask for.
SEED_DEFINITION_ROW = {
    "term": "caparra confirmatoria", "source_urn": CC, "source_type": "Norma", "source_estremi": "Art. 1385 c.c.",
    "definition_text": "La somma data a garanzia dell'adempimento.", "context": "Se al momento della conclusione...",
}


async def test_a_definition_is_found_whichever_label_the_defined_concept_has():
    from merlt.tools.definition import DefinitionLookupTool

    graph = _GraphRecorder(rows=[SEED_DEFINITION_ROW])
    found = await DefinitionLookupTool(graph_db=graph)._find_definitions_via_relation("caparra", None, False, 5)
    cypher = " ".join(graph.cyphers[0].split())
    for label in ("DefinizioneLegale", "ConcettoGiuridico", "Entity"):
        assert f"-[r:DEFINISCE]->(concept:{label})" in cypher
    assert cypher.count("UNION") == 2  # one branch per label
    # an `OR` of labels in the WHERE is an all-node scan (80 ms on 425,000 nodes, 1 ms for a label scan)
    assert " OR concept:" not in cypher
    assert [(d["source_urn"], d["definition_text"]) for d in found] == [(CC, SEED_DEFINITION_ROW["definition_text"])]


async def test_a_seed_legal_definition_is_looked_up_as_a_concept_with_a_definition():
    from merlt.tools.definition import DefinitionLookupTool

    row = {
        "term": "caparra confirmatoria", "source_urn": "definizione:caparra_confirmatoria",
        "source_type": "DefinizioneLegale", "source_estremi": "caparra confirmatoria",
        "definition_text": "La somma data a garanzia dell'adempimento.",
    }
    graph = _GraphRecorder(rows=[row])
    found = await DefinitionLookupTool(graph_db=graph)._find_concept_definitions("caparra", False, 5)
    cypher = " ".join(graph.cyphers[0].split())
    assert "MATCH (c:ConcettoGiuridico)" in cypher and "MATCH (c:DefinizioneLegale)" in cypher
    assert cypher.count("UNION") == 1 and " OR c:" not in cypher
    assert [(d["source_urn"], d["source_type"]) for d in found] == [("definizione:caparra_confirmatoria", "DefinizioneLegale")]


async def test_related_concepts_follow_correlato_and_the_communitys_is_a_relation():
    from merlt.tools.definition import DefinitionLookupTool

    graph = _GraphRecorder()
    await DefinitionLookupTool(graph_db=graph)._find_related_definitions("buona fede", None, 5)
    cypher = graph.cyphers[0]
    assert "-[:CORRELATO|SPECIES]-" in cypher
    assert "SPECIALIZZA" not in cypher and "GENERALIZZA" not in cypher


# The temporal validity service, the knowledge graph and the router ----------------


async def test_the_validity_service_reads_the_graphs_modification_relations():
    from merlt.storage.temporal.validity_service import TemporalValidityService

    graph = _GraphRecorder()
    service = TemporalValidityService(graph_db=graph)
    await service._query_norm_status(CC)
    await service._query_modifications(CC)
    status, modifications = graph.cyphers
    assert "<-[r_abr:ABROGA]-" in status and "<-[r_sost:SOSTITUISCE]-" in status
    assert "<-[r:MODIFICA|ABROGA|SOSTITUISCE]-" in modifications


def test_the_validity_service_reports_lowercase_modification_types():
    from merlt.storage.temporal.validity_service import TemporalValidityService

    node = {"is_abrogated": False, "mod_count": 1, "last_modified": "2020-01-01"}
    modifications = [{"event_type": "MODIFICA", "by_urn": "u", "by_estremi": "L. 1/2020", "event_date": "2020-01-01"}]
    result = TemporalValidityService(graph_db=None)._build_validity_result(CC, node, modifications, None)
    assert [mod["type"] for mod in result.recent_modifications] == ["modifica"]


async def test_a_norm_no_amendment_run_has_touched_is_checked():
    # `n_modifiche` is set by the multivigenza run only: the graph answers null for every other article.
    from merlt.storage.temporal.validity_service import TemporalValidityService

    row = {
        "is_abrogated": None, "is_current": None, "mod_count": None, "last_modified": None, "effective_since": None,
        "abr_urn": None, "abr_estremi": None, "abr_date": None, "sost_urn": None, "sost_estremi": None, "sost_date": None,
    }
    graph = _GraphRecorder(rows=[row], answers=[("count(r)", [{"n": 0}])])
    result = await TemporalValidityService(graph_db=graph).check_validity(CC)
    assert (result.status, result.is_valid) == ("vigente", True)
    assert len(graph.cyphers) == 2  # the status and the count: no modification, so no modification query


async def test_an_abrogation_is_reported_without_a_modification_count():
    from merlt.storage.temporal.validity_service import TemporalValidityService

    row = {
        "is_abrogated": None, "is_current": None, "mod_count": None, "last_modified": None, "effective_since": None,
        "abr_urn": "act2", "abr_estremi": "L. 2/2021", "abr_date": "2021-02-01",
        "sost_urn": None, "sost_estremi": None, "sost_date": None,
    }
    result = await TemporalValidityService(graph_db=_GraphRecorder(rows=[row])).check_validity(CC)
    assert (result.status, result.abrogating_norm["urn"]) == ("abrogato", "act2")


def _knowledge_graph_on(graph):
    from merlt.core.legal_knowledge_graph import LegalKnowledgeGraph

    knowledge_graph = LegalKnowledgeGraph.__new__(LegalKnowledgeGraph)
    knowledge_graph._falkordb = graph
    return knowledge_graph


async def test_the_graph_context_reads_the_graphs_relations():
    # FalkorDBClient.query() answers with a list of dicts keyed by the RETURN aliases.
    row = {"parent_urn": "urn:libro", "parent_title": "Libro IV", "children": ["1", "2"], "modifiers": ["L. 1/2020"]}
    graph = _GraphRecorder(rows=[row])
    context = await _knowledge_graph_on(graph)._get_graph_context(CC)
    cypher = graph.cyphers[0]
    assert cypher.count("[:CONTIENE]") == 2
    assert "[:MODIFICA|ABROGA|SOSTITUISCE|INSERISCE]" in cypher
    assert context == row


async def test_the_graph_context_of_an_unknown_article_is_empty():
    assert await _knowledge_graph_on(_GraphRecorder())._get_graph_context(CC) == {}


@pytest.mark.parametrize("asked, stored", [("CITA", "RINVIA"), ("cita", "RINVIA"), ("DISCIPLINA", "DISCIPLINA"), ("contiene", "CONTIENE")])
async def test_the_article_relations_filter_asks_the_graph_for_its_own_name(asked, stored):
    graph_router = importlib.import_module("merlt.api.graph_router")

    client = MagicMock()
    client.connect = AsyncMock()
    client.close = AsyncMock()
    client.query = AsyncMock(return_value=[])
    client.ro_query = AsyncMock(return_value=[])
    with patch("merlt.api.graph_router.FalkorDBClient", return_value=client):
        await graph_router.get_article_relations(CC, relation_type=asked, api_key=None)
    assert client.ro_query.await_args.args[1]["relation_type"] == stored


# The engine ------------------------------------------------------------------


async def test_no_tool_is_wired_on_a_relation_no_writer_produces(monkeypatch):
    engine_bootstrap = importlib.import_module("merlt.api.engine_bootstrap")

    class _Falkor:
        async def connect(self):
            pass

    class _Bridge:
        def __init__(self, config):
            pass

        async def connect(self):
            pass

    class _Flags:
        def get_bool(self, key, default=False):
            return False  # no semantic search, no MCP sidecar

    monkeypatch.setattr("merlt.storage.graph.client.FalkorDBClient", _Falkor)
    monkeypatch.setattr("merlt.storage.bridge.BridgeTable", _Bridge)
    monkeypatch.setattr(engine_bootstrap, "get_runtime_config", lambda: _Flags())
    names = {tool.name for tool in await engine_bootstrap._build_tools()}
    assert {"graph_search", "hierarchy_navigation", "historical_evolution", "textual_reference", "definition_lookup"} <= names
    assert not names & {"constitutional_basis", "citation_chain"}


def test_the_experts_prompt_names_no_tool_that_is_not_wired():
    from merlt.experts import react_mixin

    prompt_tools = " ".join(strategy["tools"] for strategy in react_mixin._CANON_STRATEGY.values())
    assert "constitutional_basis" not in prompt_tools and "citation_chain" not in prompt_tools


# The issue-context parser ----------------------------------------------------------


@pytest.mark.parametrize("rel_type", ["RINVIA", "DERIVA_DA", "CITA"])
async def test_the_issue_context_parser_knows_the_graphs_relations_and_the_communitys(rel_type):
    from merlt.api.enrichment_router import fetch_entity_details_from_graph

    entity_id = f"rel_concetto:buona_fede_{rel_type}_principio:correttezza"
    details = await fetch_entity_details_from_graph(entity_id, _GraphRecorder())
    assert details.is_relation
    assert details.relation_type == rel_type
    assert (details.source_label, details.target_label) == ("concetto:buona_fede", "principio:correttezza")


# The nodes as the seed stores them ------------------------------------------------


def _squashed(cypher):
    return " ".join(cypher.split())


def _without_coalesced_pair(cypher, first, second):
    """The Cypher with every `coalesce(x.<first>, x.<second>)` taken out."""
    return re.sub(rf"coalesce\((\w+)\.{first},\s*\1\.{second}\)", "", cypher)


async def test_concept_definitions_read_a_concept_as_the_seed_stores_it():
    # A seed concept has no `definizione` and no `URN`: its text is `descrizione`, its key `node_id`.
    # Each of the four strategies is answered with rows of its own, so an entry can only come from
    # the strategy that asked for it: one fake row for every query would let any of them pass.
    from merlt.tools.definition import DefinitionLookupTool

    graph = _GraphRecorder(answers=[
        ("MATCH (c:ConcettoGiuridico)", [{
            "term": "Buona fede", "source_urn": "concetto:buona_fede", "source_type": "ConcettoGiuridico",
            "source_estremi": "Buona fede", "definition_text": "La buona fede e correttezza.",
        }]),
        ("CORRELATO|SPECIES", [{
            "term": "Correttezza", "source_urn": "concetto:correttezza", "source_estremi": "Correttezza",
            "definition_text": "Lealta nei rapporti.", "context": "correlato a Buona fede",
        }]),
        ("[r:DEFINISCE]", [{
            "term": "buona fede", "source_urn": "massima_cass_1", "source_type": "AttoGiudiziario",
            "source_estremi": "Cass. civ. 1/2020", "definition_text": "Il dovere di lealta.", "context": "La massima.",
        }]),
        ("'si intende'", [{
            "source_urn": CC, "source_type": "Norma", "source_estremi": "Art. 1321 c.c.",
            "definition_text": "Per contratto si intende l'accordo.",
        }]),
    ])
    tool = DefinitionLookupTool(graph_db=graph)
    direct = await tool._find_concept_definitions("buona fede", False, 5)
    related = await tool._find_related_definitions("buona fede", None, 5)
    via_relation = await tool._find_definitions_via_relation("buona fede", None, False, 5)
    in_text = await tool._find_definitions_in_text("buona fede", None, 5)
    assert [(d["source_urn"], d["source_type"], d["definition_text"]) for d in direct] == [
        ("concetto:buona_fede", "ConcettoGiuridico", "La buona fede e correttezza."),
    ]
    assert [(d["source_urn"], d["definition_text"]) for d in related] == [("concetto:correttezza", "Lealta nei rapporti.")]
    # a source keyed by node_id only (a massima, doctrine) is a source too
    assert [(d["source_urn"], d["source_type"], d["definition_text"], d["context"]) for d in via_relation] == [
        ("massima_cass_1", "AttoGiudiziario", "Il dovere di lealta.", "La massima."),
    ]
    assert [(d["source_urn"], d["definition_text"]) for d in in_text] == [(CC, "Per contratto si intende l'accordo.")]
    direct_cypher, related_cypher, relation_cypher, text_cypher = graph.cyphers
    assert "coalesce(c.definizione, c.descrizione) IS NOT NULL" in direct_cypher
    assert "coalesce(c.URN, c.node_id) AS source_urn" in direct_cypher
    assert "coalesce(c2.definizione, c2.descrizione) IS NOT NULL" in related_cypher
    assert "coalesce(c2.URN, c2.node_id) AS source_urn" in related_cypher
    # a source keyed by node_id only (a massima, doctrine) is a source too
    assert "coalesce(source.URN, source.node_id) AS source_urn" in relation_cypher
    assert "coalesce(n.URN, n.node_id) AS source_urn" in text_cypher
    for cypher in (direct_cypher, related_cypher, relation_cypher):
        assert ".definizione" not in _without_coalesced_pair(cypher, "definizione", "descrizione")


async def test_the_systemic_expansion_reads_a_nodes_text_whichever_writer_stored_it(_static_systemic_floor):
    graph = _GraphRecorder(rows=[
        _graph_node("ConcettoGiuridico", node_id="concetto:buona_fede", descrizione="Un concetto."),
        _graph_node("AttoGiudiziario", node_id="massima_1", massima="Una massima."),
        _graph_node("Norma", URN=CC, testo_vigente="Un articolo."),
    ])
    expert = SystemicExpert(tools=[GraphSearchTool(graph_db=graph)])
    expanded = await expert._expand_systemic_relations(_context(CC), [])
    assert [e["text"] for e in expanded] == ["Un concetto.", "Una massima.", "Un articolo."]


def test_graph_search_finds_a_node_keyed_by_node_id_only():
    # 15,377 seed nodes have no URN: the tool hands their node_id to the LLM, which hands it back.
    query, params = GraphSearchTool(graph_db=None)._build_traversal_query(start_node="concetto:buona_fede")
    assert "WHERE start.URN = $start_urn OR start.source_url = $start_urn OR start.node_id = $start_urn" in _squashed(query)
    assert params == {"start_urn": "concetto:buona_fede"}


@pytest.mark.parametrize("marker", ["!vig=2023-01-01", "@originale"])
async def test_the_readers_start_from_the_graphs_key_not_from_a_marked_urn(marker):
    from merlt.storage.temporal.validity_service import TemporalValidityService
    from merlt.tools.hierarchy import HierarchyNavigationTool
    from merlt.tools.historical_evolution import HistoricalEvolutionTool
    from merlt.tools.textual_reference import TextualReferenceTool

    marked = CC + marker
    graph = _GraphRecorder()
    await HierarchyNavigationTool(graph_db=graph)._find_start_node(marked)
    history = HistoricalEvolutionTool(graph_db=graph)
    await history._get_timeline(marked, False, None)
    await history._get_current_status(marked)
    await TextualReferenceTool(graph_db=graph).execute(article_urn=marked)
    service = TemporalValidityService(graph_db=graph)
    await service._query_norm_status(marked)
    await service._query_modifications(marked)
    assert graph.params == [{"id": CC}, {"urn": CC}, {"urn": CC}, {"urn": CC}, {"urn": CC}, {"urn": CC}]


async def test_a_validity_answer_keeps_the_urn_that_was_asked():
    from merlt.storage.temporal.validity_service import TemporalValidityService

    marked = CC + "!vig=2023-01-01"
    graph = _GraphRecorder(answers=[("count(r)", [{"n": 0}])], rows=[{"mod_count": 0}])
    result = await TemporalValidityService(graph_db=graph).check_validity(marked)
    assert result.urn == marked  # the caller matches the answer to its own spelling
    assert {params["urn"] for params in graph.params} == {CC}  # the graph is asked with its key


async def test_principle_text_search_reads_testo_before_testo_vigente():
    from merlt.tools.principle_lookup import PrincipleLookupTool

    graph = _GraphRecorder()
    await PrincipleLookupTool(graph_db=graph)._find_principles_in_text("buona fede", 5)
    cypher = graph.cyphers[0]
    assert "coalesce(n.testo, n.testo_vigente)" in cypher
    assert "testo_vigente" not in _without_coalesced_pair(cypher, "testo", "testo_vigente")


async def test_the_hierarchy_tells_partitions_apart_by_tipo_documento():
    from merlt.storage.graph.schema import node_type_cypher
    from merlt.tools.hierarchy import HierarchyNavigationTool

    graph = _GraphRecorder()
    tool = HierarchyNavigationTool(graph_db=graph)
    await tool._find_start_node("1453")
    await tool._get_ancestors(CC, 3, False, ["Capo", "articolo"])
    await tool._get_descendants(CC, 1, False, None)
    await tool._get_siblings(CC, False, ["sezione"])
    start, ancestors, descendants, siblings = (_squashed(cypher) for cypher in graph.cyphers)
    # a partition's type is its tipo_documento; a node without one reads as its type (the first
    # label that is not Entity), never as `labels(n)[0]`
    of_n, of_sibling = node_type_cypher("n"), node_type_cypher("sibling")
    assert f"coalesce(n.tipo_documento, {of_n}) AS tipo" in start
    assert f"coalesce(n.tipo_documento, {of_n}) AS tipo" in ancestors
    assert f"coalesce(n.tipo_documento, {of_n}) AS tipo" in descendants
    assert f"coalesce(sibling.tipo_documento, {of_sibling}) AS tipo" in siblings
    assert f"AND coalesce(n.tipo_documento, {of_n}) IN $tipi" in ancestors
    assert f"AND coalesce(sibling.tipo_documento, {of_sibling}) IN $tipi" in siblings
    assert graph.params[1]["tipi"] == ["Capo", "capo", "articolo"]  # as given and in lower case
    assert "labels(n)[0] AS tipo" not in ancestors.replace(f"coalesce(n.tipo_documento, {of_n}) AS tipo", "")


async def test_the_hierarchy_bounds_the_descendants_and_the_siblings_it_returns():
    # The descendants of a code's root are about 2,800 rows once the graph is migrated, and the
    # whole subtree went through the ReAct loop: ancestors are bounded by the depth, these were not.
    import re

    from merlt.tools.hierarchy import HierarchyNavigationTool

    graph = _GraphRecorder()
    tool = HierarchyNavigationTool(graph_db=graph)
    await tool._get_descendants(CC, 5, False, None)
    await tool._get_siblings(CC, False, None)
    descendants, siblings = (_squashed(cypher) for cypher in graph.cyphers)
    for cypher in (descendants, siblings):
        assert re.search(r"ORDER BY [\w ,.]+ LIMIT \d+$", cypher), cypher  # the nearest nodes first, then the cut


async def test_the_hierarchy_limit_is_a_clamped_integer_like_the_others():
    from merlt.tools.hierarchy import MAX_NODES, HierarchyNavigationTool

    graph = _GraphRecorder()
    tool = HierarchyNavigationTool(graph_db=graph)
    await tool._get_descendants(CC, 1, False, None)
    await tool._get_siblings(CC, False, None)
    await tool._get_descendants(CC, 1, False, None, limit=10 ** 9)  # out of range: clamped, not refused
    await tool._get_siblings(CC, False, None, limit=0)
    cyphers = [_squashed(cypher) for cypher in graph.cyphers]
    assert [cypher.rsplit("LIMIT ", 1)[1] for cypher in cyphers] == [str(MAX_NODES), str(MAX_NODES), str(MAX_NODES), "1"]
    for attack in ("2]->(n) DELETE n //", "2.5", None):
        with pytest.raises(ValueError, match="limit must be an integer"):
            await tool._get_descendants(CC, 1, False, None, limit=attack)
        with pytest.raises(ValueError, match="limit must be an integer"):
            await tool._get_siblings(CC, False, None, limit=attack)
    assert len(graph.cyphers) == 4  # the refused ones never reached the graph


async def test_the_context_navigation_asks_for_bounded_siblings_and_children():
    from merlt.tools.hierarchy import HierarchyNavigationTool

    graph = _GraphRecorder()
    await HierarchyNavigationTool(graph_db=graph)._get_context(CC, 3, False, None)
    siblings, children = (_squashed(cypher) for cypher in graph.cyphers[-2:])
    assert "LIMIT" in siblings and "LIMIT" in children


def test_the_hierarchy_examples_are_real_types():
    from merlt.tools.hierarchy import HierarchyNavigationTool

    description = next(p for p in HierarchyNavigationTool(graph_db=None).parameters if p.name == "tipo_filter").description
    for tipo in ("libro", "titolo", "capo", "sezione", "articolo"):
        assert tipo in description
    assert "Articolo" not in description


def test_a_path_through_partitions_without_estremi_is_still_a_path():
    # An ingested titolo or capo has a rubrica but no estremi: the path must not raise.
    from merlt.tools.hierarchy import HierarchyNavigationTool

    nodes = [
        {"urn": "capo1", "estremi": None, "rubrica": "Dei contratti in generale", "depth": 1},
        {"urn": "titolo1", "estremi": None, "rubrica": None, "depth": 2},
        {"urn": "cod", "estremi": "Codice civile", "rubrica": None, "depth": 3},
    ]
    tool = HierarchyNavigationTool(graph_db=None)
    assert tool._build_path_string(nodes, "ancestors") == "Codice civile → titolo1 → Dei contratti in generale"
    assert tool._build_path_string(nodes, "siblings") == "Dei contratti in generale | titolo1 | Codice civile"
    assert tool._build_path_string(nodes, "descendants") == "Dei contratti in generale, titolo1, Codice civile"
    context = [dict(node, relation="ancestor") for node in nodes]
    assert "Dei contratti in generale" in tool._build_path_string(context, "context")


async def test_modifications_are_found_by_counting_the_incoming_modifica_edges():
    # `n_modifiche` is on 34 of 1,539 seed articles, and there are 54 MODIFICA edges.
    from merlt.storage.temporal.validity_service import TemporalValidityService

    status = {
        "is_abrogated": None, "is_current": None, "mod_count": None, "last_modified": None, "effective_since": None,
        "abr_urn": None, "abr_estremi": None, "abr_date": None, "sost_urn": None, "sost_estremi": None, "sost_date": None,
    }
    edges = [{"event_type": "MODIFICA", "by_urn": "act1", "by_estremi": "L. 1/2020", "event_date": "2020-02-01"}]
    graph = _GraphRecorder(answers=[
        ("count(r)", [{"n": 2}]),
        ("type(r) AS event_type", edges),
        ("AS is_abrogated", [status]),
    ])
    result = await TemporalValidityService(graph_db=graph).check_validity(CC)
    assert (result.status, result.modification_count) == ("modificato", 2)
    assert [mod["type"] for mod in result.recent_modifications] == ["modifica"]
    count_cypher = next(c for c in graph.cyphers if "count(r)" in c)
    assert "<-[r:MODIFICA]-" in count_cypher


async def test_an_article_nothing_modifies_is_checked_without_a_modification_query():
    from merlt.storage.temporal.validity_service import TemporalValidityService

    status = {
        "is_abrogated": None, "is_current": None, "mod_count": None, "last_modified": None, "effective_since": None,
        "abr_urn": None, "abr_estremi": None, "abr_date": None, "sost_urn": None, "sost_estremi": None, "sost_date": None,
    }
    graph = _GraphRecorder(answers=[("count(r)", [{"n": 0}]), ("AS is_abrogated", [status])])
    result = await TemporalValidityService(graph_db=graph).check_validity(CC)
    assert (result.status, result.modification_count) == ("vigente", 0)
    assert not any("type(r) AS event_type" in cypher for cypher in graph.cyphers)


# One canonical URN for the experts' seeds and prompts -----------------------------------------------


@pytest.mark.parametrize("marker", ["!vig=2023-01-01", "@originale"])
async def test_the_systemic_expert_seeds_the_traversal_with_the_canonical_urn(_static_systemic_floor, marker):
    tool = GraphSearchTool(graph_db=_GraphRecorder())
    await SystemicExpert(tools=[tool])._expand_systemic_relations(_context(CC + marker), [])
    assert [call["parameters"]["start_node"] for call in tool.collect_and_reset_traces()] == [CC]


@pytest.mark.parametrize("marker", ["!vig=2023-01-01", "@originale"])
def test_the_react_prompt_gives_the_llm_the_canonical_graph_key(marker):
    expert = LiteralExpert()
    context = ExpertContext(
        query_text="Che cosa dice la norma?",
        entities={"legal_references": [{"display": "art. 2043 c.c.", "urn": CC + marker}]},
    )
    assert f"[chiave-grafo: {CC}]" in expert._format_query_references(context)
    prompt = expert._build_react_prompt(context, [], [{"urn": CC + marker, "text": "Testo."}], [])
    assert f"\n  {CC}\n" in prompt and marker not in prompt


# A community node is `:Entity:<Label>`: it reads as the label, whichever label comes first ----------


def _labelled_node(*labels, **props):
    """A record the way FalkorDBClient hands a node over, with its labels in the order given."""
    return {"node": {"properties": props, "labels": list(labels)}}


@pytest.mark.parametrize("labels", [["Entity", "PrincipioGiuridico"], ["PrincipioGiuridico", "Entity"]])
def test_a_community_node_reads_as_its_label_whichever_comes_first(labels):
    # FalkorDB orders a node's labels by label id, so `labels[0]` of a node written
    # `:Entity:PrincipioGiuridico` is "Entity" on a graph where Entity came first.
    node = {"properties": {"id": "principio:buona_fede"}, "labels": labels}
    assert GraphSearchTool(graph_db=None)._node_to_dict(node)["type"] == "PrincipioGiuridico"


def test_a_node_with_no_label_but_entity_is_an_entity_and_one_with_none_is_unknown():
    tool = GraphSearchTool(graph_db=None)
    assert tool._node_to_dict({"properties": {}, "labels": ["Entity"]})["type"] == "Entity"
    assert tool._node_to_dict({"properties": {}, "labels": []})["type"] == "Unknown"


async def test_the_principles_expert_keeps_a_principle_the_community_wrote():
    graph = _GraphRecorder(rows=[
        _labelled_node("Entity", "PrincipioGiuridico", id="principio:buona_fede", descrizione="Le parti agiscono secondo buona fede."),
    ])
    expert = PrinciplesExpert(tools=[SemanticSearchTool(), GraphSearchTool(graph_db=graph)])
    found = await expert._search_principles(_context(CC))
    assert [p["text"] for p in found if p["source"] == "principle_graph"] == ["Le parti agiscono secondo buona fede."]


async def test_the_precedent_expert_keeps_a_ruling_the_community_wrote():
    graph = _GraphRecorder(rows=[
        _labelled_node("Entity", "AttoGiudiziario", id="atto_giudiziario:x", massima="Una massima.", organo_emittente="Cass. civ."),
    ])
    expert = PrecedentExpert(tools=[SemanticSearchTool(), GraphSearchTool(graph_db=graph)])
    found = await expert._search_jurisprudence(_context(CC))
    cases = [entry for entry in found if entry["source"] == "jurisprudence_graph"]
    assert [(c["text"], c["court"]) for c in cases] == [("Una massima.", "Cass. civ.")]


# The policy and the static weights speak the schema ---------------------------------


@pytest.mark.parametrize("rel", list(Rel), ids=lambda rel: rel.value)
def test_every_relation_of_the_schema_reaches_the_policy_in_its_own_vocabulary(rel):
    from structlog.testing import capture_logs

    from merlt.rlcf.policy_gradient import TRAVERSAL_RELATION_TYPES, TraversalPolicy

    for spelling in (rel.value, rel.value.lower()):
        policy_name = normalize_relation_type(spelling)
        assert policy_name in TRAVERSAL_RELATION_TYPES
        # The policy warns about a name it does not know and falls back: it must not need to.
        with capture_logs() as logs:
            index = TraversalPolicy.get_relation_index(
                SimpleNamespace(relation_types=list(TRAVERSAL_RELATION_TYPES)), policy_name,
            )
        assert logs == [] and TRAVERSAL_RELATION_TYPES[index] == policy_name


@pytest.mark.parametrize("name, policy_name", [
    ("ABROGA_TOTALMENTE", "ABROGA"), ("ABROGA_PARZIALMENTE", "ABROGA"), ("INTEGRA", "MODIFICA"),
    ("SOSPENDE", "MODIFICA"), ("PROROGA", "MODIFICA"), ("ATTUA", "APPLIES_TO"), ("RECEPISCE", "APPLIES_TO"),
    ("APPLICA", "APPLIES_TO"), ("APPLICA_NORMA_A_CASO", "APPLIES_TO"), ("DEROGA_PRINCIPIO", "DEROGA"),
    ("SPIEGA", "INTERPRETED_BY"),
    ("VERSIONE_DI", "RELATED_TO"), ("SPECIES", "RELATED_TO"), ("TITOLARE_DI", "RELATED_TO"),  # no nearer name
])
def test_the_policy_maps_the_rest_of_the_schema_to_its_nearest_name(name, policy_name):
    assert normalize_relation_type(name) == policy_name


def test_a_name_that_is_not_the_schemas_still_passes_through_unchanged():
    assert normalize_relation_type("RELAZIONE_NUOVA") == "RELAZIONE_NUOVA"


def test_the_feedback_endpoint_knows_every_relation_of_the_schema():
    from merlt.rlcf.policy_gradient import KNOWN_RELATION_VOCABULARY

    assert all(rel.value in KNOWN_RELATION_VOCABULARY for rel in Rel)


async def test_the_neural_path_score_asks_the_policy_in_its_own_vocabulary():
    from merlt.storage.retriever.models import GraphPath

    class _Policy:
        def __init__(self):
            self.asked = []

        async def compute_batch_weights(self, query_embedding, relation_types, expert_type, trace=None):
            self.asked.append(list(relation_types))
            return {name: (0.5 if name == "RELATED_TO" else 0.8, 0.0) for name in relation_types}

    policy = _Policy()
    retriever = GraphAwareRetriever(
        vector_db=MagicMock(), graph_db=MagicMock(), bridge_table=MagicMock(), policy_manager=policy,
    )
    path = GraphPath(source_node="a", target_node="b", edges=["CONTIENE", "RINVIA", "DEROGA_A", "RINVIA"], length=4)
    score = await retriever._score_path(path, expert_type="LiteralExpert", query_embedding=[0.1] * 4)
    assert policy.asked == [["RELATED_TO", "RIFERIMENTO", "DEROGA"]]  # each once, in the policy's names
    assert score == pytest.approx((1 / 5) * 0.5 * 0.8 * 0.8 * 0.8)


def test_the_static_weight_tables_are_keyed_by_the_schemas_relations():
    from merlt.storage.retriever.models import _get_default_weights

    relations = {rel.value.lower() for rel in Rel}
    tables = _get_default_weights()
    assert tables
    for expert, weights in tables.items():
        assert "default" in weights, expert
        assert set(weights) - {"default"} <= relations, expert


@pytest.mark.parametrize("expert, relation, weight", [
    ("LiteralExpert", "CONTIENE", 1.0), ("LiteralExpert", "RINVIA", 0.75),
    ("SystemicExpert", "ATTUA", 0.95), ("SystemicExpert", "DEROGA_A", 0.90), ("SystemicExpert", "MODIFICA", 0.90),
    ("PrinciplesExpert", "BILANCIA_CON", 0.95), ("PrinciplesExpert", "DEROGA_A", 0.95),
    ("PrinciplesExpert", "ATTUA", 0.95),
    ("PrecedentExpert", "INTERPRETA", 1.0), ("PrecedentExpert", "APPLICA_A", 1.0), ("PrecedentExpert", "RINVIA", 0.85),
])
def test_the_static_weights_are_found_by_the_graphs_relation_names(expert, relation, weight):
    retriever = GraphAwareRetriever(vector_db=MagicMock(), graph_db=MagicMock(), bridge_table=MagicMock())
    with patch("merlt.storage.retriever.retriever.EXPERT_TRAVERSAL_WEIGHTS", _default_weights()):
        assert retriever._compute_static_relation_bonus([relation], expert) == weight


def _default_weights():
    from merlt.storage.retriever.models import _get_default_weights

    return _get_default_weights()


# What the tools tell the LLM ---------------------------------------------------------


def _quoted_names(text):
    return re.findall(r"'([A-Za-z_]+)'", text)


@pytest.mark.parametrize("tool_name, parameter", [
    ("search", "relation_types"), ("historical_evolution", "event_types"), ("textual_reference", "reference_types"),
])
def test_the_relations_a_tool_suggests_are_the_graphs_names(tool_name, parameter):
    from merlt.tools.historical_evolution import HistoricalEvolutionTool
    from merlt.tools.textual_reference import TextualReferenceTool

    tool = {
        "search": GraphSearchTool(graph_db=None),
        "historical_evolution": HistoricalEvolutionTool(graph_db=None),
        "textual_reference": TextualReferenceTool(graph_db=None),
    }[tool_name]
    description = next(p for p in tool.parameters if p.name == parameter).description
    names = _quoted_names(description)
    assert names, description
    assert all(name in {rel.value for rel in Rel} for name in names), names


def test_the_source_types_the_semantic_tool_describes_come_from_the_schema():
    import ast

    from merlt.storage.graph.schema import EXPERT_SOURCE_TYPES as by_expert

    description = next(p for p in SemanticSearchTool().parameters if p.name == "source_types").description
    described = {
        name.lower(): ast.literal_eval(types) for name, types in re.findall(r"(\w+?)Expert=(\[[^\]]*\])", description)
    }
    assert described == by_expert


def test_the_source_types_description_follows_the_schemas_table(monkeypatch):
    monkeypatch.setattr("merlt.tools.search.EXPERT_SOURCE_TYPES", {"literal": ["norma"], "precedent": ["massima", "dottrina"]})
    description = next(p for p in SemanticSearchTool().parameters if p.name == "source_types").description
    assert "LiteralExpert=['norma']" in description and "PrecedentExpert=['massima', 'dottrina']" in description
    assert "Systemic" not in description
