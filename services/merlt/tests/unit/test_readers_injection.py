"""A tool argument never becomes Cypher text, and a reader never writes.

The tools interpolate relation types, labels and numbers into Cypher, and a
tool argument is chosen by an LLM that reads retrieved text. These tests feed
each argument an injection-shaped value and read what reaches the graph: the
Cypher text and its parameters. Every reader query goes through `ro_query`, the
read-only call, so even a slip could not write.
"""
import importlib
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from merlt.core.legal_knowledge_graph import LegalKnowledgeGraph
from merlt.storage.graph.client import FalkorDBClient
from merlt.storage.temporal.validity_service import TemporalValidityService
from merlt.tools.base import bounded_int
from merlt.tools.definition import DefinitionLookupTool
from merlt.tools.hierarchy import HierarchyNavigationTool
from merlt.tools.historical_evolution import HistoricalEvolutionTool
from merlt.tools.principle_lookup import PrincipleLookupTool
from merlt.tools.search import GraphSearchTool
from merlt.tools.textual_reference import TextualReferenceTool
from merlt.tools.verification import VerificationTool

CC = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043"

RELATION_ATTACK = "X]->(n) DETACH DELETE n //"
LABEL_ATTACK = "Norma) DETACH DELETE n //"
LEVEL_ATTACK = "' OR 1=1 //"
NUMBER_ATTACK = "2]->(n) DELETE n //"


class _Graph:
    """A graph client that records the method, the Cypher and the parameters of every call."""

    def __init__(self, rows=None, answers=None):
        self.calls = []
        self._rows = rows or []
        self._answers = answers or []  # [(a piece of the Cypher, rows)], the first that fits wins

    def _answer(self, method, cypher, params):
        self.calls.append((method, cypher, params))
        for piece, rows in self._answers:
            if piece in cypher:
                return rows
        return self._rows

    async def query(self, cypher, params=None):
        return self._answer("query", cypher, params)

    async def ro_query(self, cypher, params=None):
        return self._answer("ro_query", cypher, params)

    @property
    def methods(self):
        return [method for method, _, _ in self.calls]

    @property
    def cyphers(self):
        return [cypher for _, cypher, _ in self.calls]

    @property
    def params(self):
        return [params for _, _, params in self.calls]


def _never_the_attack(graph, *attacks):
    """No attack string, and no write verb, is in any Cypher text the graph was sent."""
    for cypher in graph.cyphers:
        for attack in attacks:
            assert attack not in cypher
        assert "DELETE" not in cypher.upper()


# The numbers --------------------------------------------------------------------


@pytest.mark.parametrize("value, bounded", [
    (3, 3), (0, 1), (-7, 1), (10 ** 9, 5), ("4", 4), (" 2 ", 2), (3.0, 3),
])
def test_a_number_is_clamped_into_its_range(value, bounded):
    assert bounded_int(value, "n", 1, 5) == bounded


@pytest.mark.parametrize("value", [NUMBER_ATTACK, "2.5", 2.5, True, None, [2], "", "1e3"])
def test_anything_that_is_not_an_integer_is_an_error(value):
    with pytest.raises(ValueError, match="n must be an integer"):
        bounded_int(value, "n", 1, 5)


# graph_search ------------------------------------------------------------------


async def test_graph_search_with_only_foreign_relation_names_answers_empty_without_asking():
    graph = _Graph()
    result = await GraphSearchTool(graph_db=graph).execute(start_node=CC, relation_types=[RELATION_ATTACK])
    assert result.success and result.data["nodes"] == [] and result.data["edges"] == []
    assert graph.calls == []


async def test_graph_search_keeps_the_graphs_names_and_drops_the_rest():
    graph = _Graph()
    await GraphSearchTool(graph_db=graph).execute(
        start_node=CC, relation_types=["contiene", RELATION_ATTACK, "cita"], direction="both",
    )
    assert "-[r:CONTIENE|RINVIA*1..2]-" in graph.cyphers[0]
    _never_the_attack(graph, RELATION_ATTACK)


async def test_graph_search_target_type_is_a_label_of_the_graph_or_nothing():
    graph = _Graph()
    tool = GraphSearchTool(graph_db=graph)
    result = await tool.execute(start_node=CC, target_type=LABEL_ATTACK)
    assert result.success and result.data["nodes"] == [] and graph.calls == []
    await tool.execute(start_node=CC, target_type="norma")
    assert "(target:Norma)" in graph.cyphers[0]
    _never_the_attack(graph, LABEL_ATTACK)


async def test_graph_search_start_node_is_only_ever_a_parameter():
    graph = _Graph()
    await GraphSearchTool(graph_db=graph).execute(start_node=LEVEL_ATTACK + " DELETE n")
    assert graph.params[0] == {"start_urn": LEVEL_ATTACK + " DELETE n"}
    _never_the_attack(graph, LEVEL_ATTACK)


async def test_graph_search_hops_are_an_integer_in_range():
    graph = _Graph()
    tool = GraphSearchTool(graph_db=graph)
    result = await tool.execute(start_node=CC, max_hops=NUMBER_ATTACK)
    assert not result.success and "max_hops must be an integer" in result.error
    assert graph.calls == []
    await tool.execute(start_node=CC, max_hops=99, direction="both")
    await tool.execute(start_node=CC, max_hops=-4, direction="both")
    assert "-[r*1..3]-" in graph.cyphers[0]
    assert "-[r*1..1]-" in graph.cyphers[1]


# hierarchy_navigation ----------------------------------------------------------


_START = [("AS numero", [{"urn": CC, "tipo": "Norma", "estremi": "Art. 2043 c.c.", "rubrica": None, "numero": "2043"}])]


async def test_hierarchy_type_filter_is_a_parameter():
    graph = _Graph()
    tool = HierarchyNavigationTool(graph_db=graph)
    await tool._get_ancestors(CC, 3, False, [LABEL_ATTACK, "capo"])
    await tool._get_descendants(CC, 1, False, [LABEL_ATTACK])
    await tool._get_siblings(CC, False, [LABEL_ATTACK])
    for cypher, params in zip(graph.cyphers, graph.params):
        assert "$tipi" in cypher
        assert LABEL_ATTACK in params["tipi"]
    _never_the_attack(graph, LABEL_ATTACK)


async def test_hierarchy_start_node_is_only_ever_a_parameter():
    graph = _Graph()
    await HierarchyNavigationTool(graph_db=graph)._find_start_node(LEVEL_ATTACK)
    assert graph.params[0] == {"id": LEVEL_ATTACK}
    _never_the_attack(graph, LEVEL_ATTACK)


async def test_hierarchy_depth_is_an_integer_in_range():
    graph = _Graph(answers=_START)
    tool = HierarchyNavigationTool(graph_db=graph)
    result = await tool.execute(start_node=CC, direction="ancestors", max_depth=NUMBER_ATTACK)
    assert not result.success and "max_depth must be an integer" in result.error
    assert graph.calls == []
    await tool.execute(start_node=CC, direction="ancestors", max_depth=99)
    await tool.execute(start_node=CC, direction="descendants", max_depth=0)
    assert "-[:CONTIENE*1..10]->" in graph.cyphers[1]
    assert "-[:CONTIENE*1..1]->" in graph.cyphers[3]


# historical_evolution ----------------------------------------------------------


async def test_history_with_only_foreign_event_types_asks_nothing_about_events():
    graph = _Graph()
    tool = HistoricalEvolutionTool(graph_db=graph)
    assert await tool._get_timeline(CC, False, [RELATION_ATTACK]) == []
    assert graph.calls == []
    result = await tool.execute(article_urn=CC, event_types=[RELATION_ATTACK])
    assert result.success and result.data["timeline"] == []
    assert len(graph.calls) == 1  # only the status of the norm, which takes no event type
    _never_the_attack(graph, RELATION_ATTACK)


async def test_history_keeps_the_graphs_event_types_and_drops_the_rest():
    graph = _Graph()
    await HistoricalEvolutionTool(graph_db=graph)._get_timeline(CC, False, ["modifica", RELATION_ATTACK])
    assert "<-[r:MODIFICA]-" in graph.cyphers[0]
    _never_the_attack(graph, RELATION_ATTACK)


# textual_reference -------------------------------------------------------------


async def test_textual_reference_with_only_foreign_names_answers_empty_without_asking():
    graph = _Graph()
    result = await TextualReferenceTool(graph_db=graph).execute(article_urn=CC, reference_types=[RELATION_ATTACK])
    assert result.success and result.data["references"] == []
    assert graph.calls == []


async def test_textual_reference_keeps_the_graphs_names_and_drops_the_rest():
    graph = _Graph()
    await TextualReferenceTool(graph_db=graph).execute(article_urn=CC, reference_types=["cita", RELATION_ATTACK])
    assert "-[:RINVIA*1..2]->" in graph.cyphers[0]
    _never_the_attack(graph, RELATION_ATTACK)


async def test_textual_reference_depth_is_an_integer_in_range():
    graph = _Graph()
    tool = TextualReferenceTool(graph_db=graph)
    result = await tool.execute(article_urn=CC, max_depth=NUMBER_ATTACK)
    assert not result.success and "max_depth must be an integer" in result.error
    assert graph.calls == []
    await tool.execute(article_urn=CC, max_depth=99)
    await tool.execute(article_urn=CC, max_depth=0)
    assert "*1..5]" in graph.cyphers[0] and "*1..1]" in graph.cyphers[1]


# the ReAct loop's repair of the graph_search filter -----------------------------


def _expert_with_graph(graph):
    from merlt.experts.literal import LiteralExpert

    tool = GraphSearchTool(graph_db=graph)
    return LiteralExpert(tools=[tool]), tool


def _repaired(expert, relation_types):
    return expert._repair_graph_tool_params("graph_search", {"start_node": CC, "relation_types": relation_types}, None)


async def test_a_malformed_relation_token_is_kept_for_the_tool_to_drop_it_and_never_widens_the_query():
    # The repair used to DROP the whole filter on one token that is not an identifier, so the
    # traversal ran over every relation: the opposite of "a filter that comes out empty answers empty".
    graph = _Graph()
    expert, tool = _expert_with_graph(graph)
    repaired = _repaired(expert, ["RINVIA", RELATION_ATTACK, "contiene"])
    assert repaired["relation_types"] == ["RINVIA", RELATION_ATTACK, "contiene"]
    await tool.execute(**repaired)
    assert "-[r:RINVIA|CONTIENE*1..2]-" in graph.cyphers[0]
    _never_the_attack(graph, RELATION_ATTACK)


async def test_a_filter_of_only_malformed_tokens_still_answers_empty_without_asking():
    graph = _Graph()
    expert, tool = _expert_with_graph(graph)
    repaired = _repaired(expert, [RELATION_ATTACK, "A B", "1A"])
    assert repaired["relation_types"] == [RELATION_ATTACK, "A B", "1A"]
    result = await tool.execute(**repaired)
    assert result.success and result.data["nodes"] == [] and graph.calls == []


async def test_a_lone_string_becomes_a_one_item_list():
    graph = _Graph()
    expert, tool = _expert_with_graph(graph)
    assert _repaired(expert, "RINVIA")["relation_types"] == ["RINVIA"]
    assert _repaired(expert, RELATION_ATTACK)["relation_types"] == [RELATION_ATTACK]


def test_a_hallucinated_list_is_cut_to_the_cap_not_dropped():
    from merlt.experts import react_mixin

    graph = _Graph()
    expert, _ = _expert_with_graph(graph)
    names = [f"REL_{i}" for i in range(300)]
    assert _repaired(expert, names)["relation_types"] == names[: react_mixin._MAX_RELATION_TYPES]


@pytest.mark.parametrize("junk", [5, {"RINVIA": 1}, True])
async def test_a_filter_that_is_no_list_does_not_widen_the_query_either(junk):
    graph = _Graph()
    expert, tool = _expert_with_graph(graph)
    result = await tool.execute(**_repaired(expert, junk))
    assert result.data["nodes"] == [] and graph.calls == []


def test_a_well_formed_list_and_the_absence_of_a_filter_are_left_alone():
    graph = _Graph()
    expert, _ = _expert_with_graph(graph)
    assert _repaired(expert, ["RINVIA", "CONTIENE"])["relation_types"] == ["RINVIA", "CONTIENE"]
    assert _repaired(expert, [])["relation_types"] == []
    assert expert._repair_graph_tool_params("graph_search", {"start_node": CC}, None) == {"start_node": CC}
    assert expert._repair_graph_tool_params("graph_search", {"start_node": CC, "relation_types": None}, None) == {
        "start_node": CC, "relation_types": None,
    }


# definition_lookup -------------------------------------------------------------


async def test_definition_with_only_foreign_source_types_answers_empty_without_asking():
    graph = _Graph()
    result = await DefinitionLookupTool(graph_db=graph).execute(
        term="buona fede", source_types=[LABEL_ATTACK], include_related=True,
    )
    assert result.success and result.data["definitions"] == []
    assert graph.calls == []


async def test_definition_source_types_are_labels_of_the_graph():
    graph = _Graph()
    tool = DefinitionLookupTool(graph_db=graph)
    await tool._find_definitions_via_relation("buona fede", ["norma", LABEL_ATTACK], False, 5)
    await tool._find_definitions_in_text("buona fede", ["attogiudiziario"], 5)
    assert "(source:Norma)" in graph.cyphers[0]
    assert "(n:AttoGiudiziario)" in graph.cyphers[1]
    _never_the_attack(graph, LABEL_ATTACK)


async def test_definition_limit_is_an_integer_in_range():
    graph = _Graph()
    tool = DefinitionLookupTool(graph_db=graph)
    result = await tool.execute(term="buona fede", limit=NUMBER_ATTACK)
    assert not result.success and "limit must be an integer" in result.error
    assert graph.calls == []
    await tool.execute(term="buona fede", limit=10 ** 6)
    assert "LIMIT 50" in graph.cyphers[0]
    _never_the_attack(graph, NUMBER_ATTACK)


# principle_lookup --------------------------------------------------------------


async def test_principle_levels_are_parameters():
    graph = _Graph()
    await PrincipleLookupTool(graph_db=graph).execute(
        query="buona fede", principle_level=[LEVEL_ATTACK, "generale"], top_k=5,
    )
    with_levels = [(cypher, params) for cypher, params in zip(graph.cyphers, graph.params) if "livello" in cypher]
    assert len(with_levels) == 2  # the relation strategy and the node strategy
    for cypher, params in with_levels:
        assert "p.livello IN $livelli" in cypher
        assert params["livelli"] == [LEVEL_ATTACK, "generale"]
    _never_the_attack(graph, LEVEL_ATTACK)


async def test_principle_top_k_is_an_integer_in_range():
    graph = _Graph()
    tool = PrincipleLookupTool(graph_db=graph)
    result = await tool.execute(query="buona fede", top_k=NUMBER_ATTACK)
    assert not result.success and "top_k must be an integer" in result.error
    assert graph.calls == []
    await tool.execute(query="buona fede", top_k=10 ** 6)
    assert "LIMIT 50" in graph.cyphers[0]
    _never_the_attack(graph, NUMBER_ATTACK)


# verify_sources ----------------------------------------------------------------


async def test_verification_with_only_foreign_node_types_finds_nothing_without_asking():
    graph = _Graph()
    tool = VerificationTool(graph_db=graph, bridge=MagicMock())
    result = await tool.execute(source_ids=["art12", CC], strict_mode=False, node_types=[LABEL_ATTACK])
    assert result.success and result.data["verified"] == [] and result.data["unverified"] == ["art12", CC]
    assert graph.calls == []


async def test_verification_node_types_are_labels_of_the_graph():
    graph = _Graph()
    tool = VerificationTool(graph_db=graph, bridge=MagicMock())
    await tool._check_graph_existence(CC, ["norma", LABEL_ATTACK])
    await tool._check_graph_existence(CC, ["norma", "Dottrina"])
    assert "MATCH (n:Norma)" in graph.cyphers[0]
    assert "n:Norma OR n:Dottrina" in graph.cyphers[1]
    _never_the_attack(graph, LABEL_ATTACK)


# The read-only call ------------------------------------------------------------


async def _each_reader_query(graph):
    """Drive every reader query of the tools, the validity service and the graph context once."""
    start = [("AS numero", [{"urn": CC, "tipo": "Norma", "estremi": "Art. 2043 c.c.", "rubrica": None, "numero": "2043"}])]
    graph._answers = start
    await GraphSearchTool(graph_db=graph).execute(start_node=CC, relation_types=["contiene"])
    hierarchy = HierarchyNavigationTool(graph_db=graph)
    await hierarchy.execute(start_node=CC, direction="context")
    await HistoricalEvolutionTool(graph_db=graph).execute(article_urn=CC)
    await TextualReferenceTool(graph_db=graph).execute(article_urn=CC)
    await DefinitionLookupTool(graph_db=graph).execute(term="buona fede", include_related=True)
    await PrincipleLookupTool(graph_db=graph).execute(query="buona fede")
    await VerificationTool(graph_db=graph, bridge=MagicMock()).execute(source_ids=["art12"], strict_mode=False)
    service = TemporalValidityService(graph_db=graph)
    await service._query_norm_status(CC)
    await service._count_modifications(CC)
    await service._query_modifications(CC)
    knowledge_graph = LegalKnowledgeGraph.__new__(LegalKnowledgeGraph)
    knowledge_graph._falkordb = graph
    await knowledge_graph._get_graph_context(CC)


async def test_every_reader_query_is_read_only():
    graph = _Graph()
    await _each_reader_query(graph)
    assert len(graph.calls) >= 21  # the drive reached every query, not just the first of each tool
    assert set(graph.methods) == {"ro_query"}


class _Result:
    """What falkordb-py returns: a header of [type, alias] pairs and rows of raw values."""

    header = [[1, "n"], [1, "c"]]

    def __init__(self, rows):
        self.result_set = rows


class _Node:
    properties = {"URN": "a"}
    labels = ["Norma"]
    id = 7


class _FalkorGraph:
    def __init__(self, ro_error=None):
        self.calls = []
        self._ro_error = ro_error

    def query(self, cypher, params):
        self.calls.append(("query", cypher, params))
        return _Result([[_Node(), 3]])

    def ro_query(self, cypher, params):
        self.calls.append(("ro_query", cypher, params))
        if self._ro_error:
            raise self._ro_error
        return _Result([[_Node(), 3]])


def _client_on(graph):
    client = FalkorDBClient.__new__(FalkorDBClient)
    client._graph = graph
    client._connected = True
    return client


async def test_the_client_runs_ro_query_on_the_read_only_call_and_converts_like_query():
    graph = _FalkorGraph()
    client = _client_on(graph)
    read = await client.ro_query("MATCH (n) RETURN n, 3 AS c", {"x": 1})
    written = await client.query("MATCH (n) RETURN n, 3 AS c", {"x": 1})
    assert read == written == [{"n": {"properties": {"URN": "a"}, "labels": ["Norma"], "id": 7}, "c": 3}]
    assert [method for method, _, _ in graph.calls] == ["ro_query", "query"]


async def test_the_client_refuses_ro_query_before_it_is_connected():
    client = _client_on(_FalkorGraph())
    client._connected = False
    with pytest.raises(RuntimeError, match="Not connected"):
        await client.ro_query("RETURN 1")


async def test_ro_query_on_a_graph_that_does_not_exist_yet_is_empty_like_query():
    # GRAPH.RO_QUERY refuses an empty key where GRAPH.QUERY answers with nothing:
    # a fresh instance must read as an empty graph, not as an error.
    client = _client_on(_FalkorGraph(ro_error=Exception("Invalid graph operation on empty key")))
    assert await client.ro_query("MATCH (n) RETURN n LIMIT 1") == []


async def test_ro_query_does_not_hide_other_errors():
    client = _client_on(_FalkorGraph(ro_error=Exception("graph.RO_QUERY is to be executed only on read-only queries")))
    with pytest.raises(Exception, match="only on read-only"):
        await client.ro_query("CREATE (n)")


# The routers ----------------------------------------------------------------------


def _router_client(*answers):
    """A FalkorDBClient for a router: `ro_query` answers each call in turn (then with nothing); `query` is the writer."""
    client = MagicMock()
    client.connect = AsyncMock()
    client.close = AsyncMock()
    client.query = AsyncMock(return_value=[])
    client.ro_query = AsyncMock(side_effect=list(answers) + [[]] * 10)
    return client


async def test_the_article_relations_endpoint_reads_through_ro_query():
    graph_router = importlib.import_module("merlt.api.graph_router")
    client = _router_client()
    with patch("merlt.api.graph_router.FalkorDBClient", return_value=client):
        await graph_router.get_article_relations(CC, relation_type="cita", api_key=None)
    client.query.assert_not_awaited()
    assert client.ro_query.await_args.args[1]["relation_type"] == "RINVIA"


async def test_the_subgraph_relation_filter_is_a_parameter_in_the_graphs_names():
    graph_router = importlib.import_module("merlt.api.graph_router")
    root = [{"root": {"properties": {"URN": CC}, "labels": ["Norma"], "id": 1}, "degree": 1}]
    client = _router_client(root, [])
    with patch("merlt.api.graph_router.FalkorDBClient", return_value=client):
        await graph_router.get_subgraph(
            root_urn=CC, depth=1, relation_types=f"cita, {RELATION_ATTACK}", api_key=None,
        )
    client.query.assert_not_awaited()
    edge_cypher, edge_params = client.ro_query.await_args_list[1].args
    assert "type(r) IN $allowed_rels" in edge_cypher and "toLower(type(r))" not in edge_cypher
    assert edge_params["allowed_rels"] == ["RINVIA", RELATION_ATTACK]
    assert RELATION_ATTACK not in edge_cypher


async def test_the_search_subgraph_relation_filter_is_a_parameter_in_the_graphs_names():
    graph_router = importlib.import_module("merlt.api.graph_router")
    client = _router_client()
    await graph_router._query_search_subgraph(client, {CC}, ["cita", RELATION_ATTACK], 50)
    client.query.assert_not_awaited()
    cypher, params = client.ro_query.await_args.args
    assert "type(r) IN $allowed_rels" in cypher and RELATION_ATTACK not in cypher
    assert params == {"urns": [CC], "max_results": 50, "allowed_rels": ["RINVIA", RELATION_ATTACK]}


async def test_the_search_subgraph_without_a_relation_filter_has_no_clause():
    graph_router = importlib.import_module("merlt.api.graph_router")
    client = _router_client()
    await graph_router._query_search_subgraph(client, {CC}, None, 50)
    cypher, params = client.ro_query.await_args.args
    assert "allowed_rels" not in cypher and "allowed_rels" not in params


async def test_the_dataset_export_filter_is_a_parameter_and_the_read_is_read_only():
    # Admin-only, but the filter was written into a quoted literal: `x' DETACH DELETE n //` deleted the graph.
    pipeline_router = importlib.import_module("merlt.api.pipeline_router")
    attack = "x' DETACH DELETE n //"
    client = _router_client()
    request = pipeline_router.DatasetExportRequest(filter_tipo_atto=attack, limit=5)
    with patch("merlt.storage.graph.client.FalkorDBClient", return_value=client):
        response = await pipeline_router.export_dataset(request, api_key=None)
    client.query.assert_not_awaited()
    cypher, params = client.ro_query.await_args.args
    assert "WHERE n.tipo_atto = $tipo_atto" in cypher and "LIMIT 5" in cypher
    assert attack not in cypher and "DELETE" not in cypher.upper()
    assert params == {"tipo_atto": attack}
    assert response.records_count == 0
