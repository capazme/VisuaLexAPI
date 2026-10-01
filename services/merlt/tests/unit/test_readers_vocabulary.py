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
    """A graph client that records the Cypher it is asked and answers with fixed rows."""

    def __init__(self, rows=None):
        self.cyphers = []
        self.params = []
        self._rows = rows or []

    async def query(self, cypher, params=None):
        self.cyphers.append(cypher)
        self.params.append(params)
        return self._rows


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
    graph = _GraphRecorder(rows=[row])
    result = await TemporalValidityService(graph_db=graph).check_validity(CC)
    assert (result.status, result.is_valid) == ("vigente", True)
    assert len(graph.cyphers) == 1  # no modification count, so no modification query


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
    with patch("merlt.api.graph_router.FalkorDBClient", return_value=client):
        await graph_router.get_article_relations(CC, relation_type=asked, api_key=None)
    assert client.query.await_args.args[1]["relation_type"] == stored


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
