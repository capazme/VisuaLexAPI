"""Brocardi's text never reaches a user (D-078).

The graph and Qdrant keep what Brocardi supplied; it may rank a retrieval and
link an article to a decision, but its text must not appear in any response
body, any stored trace served back, or any LLM prompt (the experts quote their
sources verbatim). Every string here is synthetic.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from merlt.experts.base import ExpertContext
from merlt.experts.precedent import PrecedentExpert
from merlt.experts.principles import PrinciplesExpert
from merlt.storage.graph.brocardi_guard import (
    TRACE_GUARD_KEY,
    is_brocardi,
    redact,
    redact_stored_sources,
    redact_stored_trace,
)
from merlt.storage.retriever.models import RetrievalResult
from merlt.tools.base import BaseTool, ToolResult
from merlt.tools.search import GraphSearchTool, SemanticSearchTool

SECRET = "TESTO SINTETICO DI UNA MASSIMA CHE NON DEVE USCIRE"
SECRET_RATIO = "RATIO SINTETICA CHE NON DEVE USCIRE"
ESTREMI = "Cass. civ. n. 1/2020"
CC = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043"
OUR_TEXT = "Qualunque fatto doloso o colposo, testo dell'articolo."
MASSIMARIO = "Principio di una rassegna del Massimario, testo nostro."


def _dump(value) -> str:
    return json.dumps(value, default=lambda o: getattr(o, "__dict__", str(o)), ensure_ascii=False)


def _brocardi_massima_node():
    return {"node": {"labels": ["AttoGiudiziario"], "properties": {
        "node_id": "massima_cass._civ._1_2020", "massima": SECRET, "estremi": ESTREMI,
        "organo_emittente": "Cass. civ.", "fonte": "Brocardi.it",
    }}}


def _brocardi_ratio_node():
    return {"node": {"labels": ["Dottrina"], "properties": {
        "node_id": "dottrina_brocardi_ratio_2043", "testo": SECRET_RATIO,
        "titolo": "Ratio art. 2043 c.c.", "fonte": "Brocardi.it",
    }}}


# --- Recognition ---------------------------------------------------------------


@pytest.mark.parametrize("item", [
    {"fonte": "Brocardi.it", "massima": SECRET},
    {"fonte": "brocardi_massime"},
    {"node_id": "massima_cass_1_2020"},
    {"node_id": "dottrina_relazione_x"},
    {"article_urn": "massima_cass_1_2020", "source_type": "massima", "text": SECRET},
    {"article_urn": CC, "source_type": "massima", "text": SECRET},  # an older ingest, no fonte
    {"article_urn": CC, "source_type": "ratio"},
    {"article_urn": "live:abc", "source_type": "dottrina"},
    {"source_tool": "cerca_brocardi"},
    {"source_url": "https://www.brocardi.it/codice-civile/art2043.html"},
    {"text": SECRET, "metadata": {"article_urn": "dottrina_brocardi_1", "source_type": "dottrina"}},
])
def test_brocardi_content_is_recognised(item):
    assert is_brocardi(item)


@pytest.mark.parametrize("item", [
    {"URN": CC, "testo": OUR_TEXT, "fonte": "Normattiva"},
    {"node_id": "massimario:1", "massima": MASSIMARIO, "fonte": "Ufficio del Massimario"},
    {"article_urn": "live:abc", "source_type": "massima", "text": "Una massima di Italgiure."},
    # a live decision saved by provisional_writer: article_urn is its source URL
    {"article_urn": "https://www.italgiure.giustizia.it/xway/application/nif/clean/hc.dll?verbo=attach&db=snciv&id=./x.pdf",
     "source_type": "massima", "text": "Una sentenza vera, salvata dal vivo."},
    {"article_urn": CC, "source_type": "rassegna", "text": MASSIMARIO},
    {"node_id": "dottrina:una_tesi", "fonte": "community", "descrizione": "Una tesi della comunità."},
    # a community entity written before entities carried a `fonte`
    {"node_id": "dottrina:una_tesi", "community_validated": True, "descrizione": "Una tesi della comunità."},
    {"source_type": "massima", "text": "Senza article_urn: non si presume Brocardi."},
])
def test_other_content_is_not(item):
    assert not is_brocardi(item)
    assert redact(item) == item


def test_a_massima_keeps_its_decision_and_loses_its_words():
    node = _brocardi_massima_node()["node"]
    out = redact(node)
    assert SECRET not in _dump(out)
    assert out["properties"]["estremi"] == ESTREMI
    assert out["properties"]["text"] == ESTREMI
    assert out["labels"] == ["AttoGiudiziario"]
    assert node["properties"]["massima"] == SECRET  # the input is never modified


def test_doctrine_keeps_only_its_identity():
    out = redact(_brocardi_ratio_node()["node"])
    assert SECRET_RATIO not in _dump(out)
    assert out["properties"]["node_id"] == "dottrina_brocardi_ratio_2043"
    assert "text" not in out["properties"]


# --- The tools: before any expert reads, prompts or traces ---------------------


class _FixedTool(BaseTool):
    name = "fixed"
    description = "Answers a fixed result."

    def __init__(self, data, **metadata):
        super().__init__()
        self._data, self._metadata = data, metadata

    @property
    def parameters(self):
        return []

    async def execute(self, **kwargs):
        return ToolResult.ok(data=self._data, tool_name=self.name, **self._metadata)


async def test_every_tool_result_is_redacted_before_it_is_returned_or_traced():
    data = {"results": [
        {"text": SECRET, "metadata": {"article_urn": "massima_x", "source_type": "massima", "text": SECRET}},
        {"text": OUR_TEXT, "metadata": {"article_urn": CC, "source_type": "norma", "text": OUR_TEXT}},
    ]}
    tool = _FixedTool(data)
    result = await tool()
    assert SECRET not in _dump(result.data)
    assert OUR_TEXT in _dump(result.data)
    assert SECRET not in _dump(tool._tool_call_traces)
    assert data["results"][0]["text"] == SECRET  # a cached result stays as it was


class _MarkdownTool(_FixedTool):
    name = "mappa_orientamento"


async def test_a_brocardi_tools_markdown_answer_is_dropped_whole():
    tool = _MarkdownTool("**Ancoraggio Brocardi**\n" + SECRET)
    result = await tool()
    assert result.data == ""
    assert SECRET not in _dump(tool._tool_call_traces)


class _Retriever:
    def __init__(self, results):
        self._results = results

    async def retrieve(self, **kwargs):
        return self._results


class _Embeddings:
    def encode_query(self, query):
        return [0.0] * 4


def _chunk(text, linked_nodes=(), **metadata):
    return RetrievalResult(
        chunk_id=uuid4(), text=text, similarity_score=0.9, graph_score=0.5, final_score=0.9,
        linked_nodes=list(linked_nodes), metadata={"text": text, **metadata},
    )


# The node a seed massima's vector is linked to (bridge table): its decision.
_DECISION_NODE = {"node_id": "massima_cass._civ._1_2020", "metadata": {"estremi": ESTREMI}}


def _semantic_tool():
    SemanticSearchTool._shared_cache.clear()
    return SemanticSearchTool(
        retriever=_Retriever([
            _chunk(SECRET, [_DECISION_NODE], article_urn="massima_cass._civ._1_2020", source_type="massima",
                   node_label="AttoGiudiziario"),
            _chunk(SECRET, article_urn=CC, source_type="massima", fonte="Brocardi.it", numero_articolo="2043"),
            _chunk(SECRET_RATIO, article_urn="dottrina_brocardi_ratio_2043", source_type="ratio"),
            _chunk(OUR_TEXT, article_urn=CC, source_type="norma", numero_articolo="2043", tipo_atto="codice civile"),
        ]),
        embeddings=_Embeddings(),
    )


async def test_semantic_search_ranks_with_brocardi_but_never_hands_out_its_text():
    tool = _semantic_tool()
    result = await tool(query="responsabilità extracontrattuale", top_k=10, expert_type="PrecedentExpert")
    dumped = _dump({"data": result.data, "metadata": result.metadata, "trace": tool._tool_call_traces})
    assert SECRET not in dumped and SECRET_RATIO not in dumped
    assert len(result.data["results"]) == 4  # still ranked, still counted
    labels = result.metadata["top_source_labels"]
    assert labels["massima_cass._civ._1_2020"] == ESTREMI
    assert result.data["results"][0]["text"] == ESTREMI
    assert OUR_TEXT in dumped


class _Graph:
    def __init__(self, rows):
        self.rows = rows

    async def query(self, cypher, params=None):
        return self.rows

    async def ro_query(self, cypher, params=None):
        return self.rows


class _LLM:
    """Records every prompt; answers a minimal structured analysis."""

    def __init__(self):
        self.prompts = []

    async def generate_response_async(self, prompt, **kwargs):
        self.prompts.append(prompt)
        return json.dumps({"interpretation": "Analisi.", "legal_basis": [], "confidence": 0.5})

    def get_last_usage(self):
        return {}


def _context():
    return ExpertContext(query_text="Il danno ingiusto si risarcisce?", entities={"norm_references": [CC]})


@pytest.mark.parametrize("expert_class", [PrecedentExpert, PrinciplesExpert])
async def test_no_prompt_and_no_response_carries_brocardi_text(expert_class):
    """A Brocardi massima and ratio in the graph and in Qdrant reach neither the
    LLM nor the expert's answer; the massima's decision does."""
    llm = _LLM()
    graph = _Graph([
        _brocardi_massima_node(), _brocardi_ratio_node(),
        {"node": {"labels": ["Norma"], "properties": {"URN": CC, "testo": OUR_TEXT}}},
    ])
    tools = [_semantic_tool(), GraphSearchTool(graph_db=graph)]
    expert = expert_class(tools=tools, ai_service=llm, config={"use_react": False})
    response = await expert.analyze(_context())

    assert llm.prompts, "the expert must have asked the LLM"
    prompts = "\n".join(llm.prompts)
    assert SECRET not in prompts and SECRET_RATIO not in prompts
    if expert_class is PrecedentExpert:
        assert ESTREMI in prompts
    dumped = _dump(response)
    assert SECRET not in dumped and SECRET_RATIO not in dumped
    assert SECRET not in _dump([t._tool_call_traces for t in tools])


async def test_without_an_llm_the_fallback_answer_carries_no_brocardi_text():
    graph = _Graph([_brocardi_massima_node(), _brocardi_ratio_node()])
    expert = PrecedentExpert(tools=[_semantic_tool(), GraphSearchTool(graph_db=graph)], config={"use_react": False})
    response = await expert.analyze(_context())
    dumped = _dump(response)
    assert SECRET not in dumped and SECRET_RATIO not in dumped


# --- The graph view ------------------------------------------------------------


def test_a_graph_node_shows_the_decision_not_the_massima():
    import importlib

    graph_router = importlib.import_module("merlt.api.graph_router")
    node = graph_router._parse_graph_node_v2(_brocardi_massima_node()["node"], include_metadata=True)
    dumped = node.model_dump_json()
    assert SECRET not in dumped
    assert node.label == ESTREMI
    ratio = graph_router._parse_graph_node_v2(_brocardi_ratio_node()["node"], include_metadata=True)
    assert SECRET_RATIO not in ratio.model_dump_json()
    ours = graph_router._parse_graph_node_v2({"labels": ["Norma"], "properties": {"URN": CC, "testo": OUR_TEXT}}, True)
    assert ours.properties["testo"] == OUR_TEXT


async def test_the_provisional_review_shows_no_brocardi_preview():
    from merlt.pipeline.review import list_pending_review

    rows = [
        {"node_id": "live:1", "source_url": "https://example.test/x", "text": SECRET, "source_tool": "cite_law",
         "fonte": None, "labels": ["LiveSource", "Dottrina"]},
        {"node_id": "live:2", "source_url": "https://www.brocardi.it/x", "text": SECRET, "source_tool": "cite_law",
         "fonte": None, "labels": ["LiveSource", "Norma"]},
        {"node_id": "live:3", "source_url": CC, "text": OUR_TEXT, "source_tool": "cite_law",
         "fonte": None, "labels": ["LiveSource", "Norma"]},
    ]
    out = await list_pending_review(_Graph(rows))
    assert SECRET not in _dump(out)
    assert out[2]["text_preview"] == OUR_TEXT


# --- What the assistant stored before the guard --------------------------------


def _legacy_trace():
    return {
        "stages": {"expert_executions": [{
            "tool_calls": [
                {"tool_name": "semantic_search", "result_summary": "{'results': [{'text': '" + SECRET},
                {"tool_name": "cerca_brocardi", "result_summary": SECRET},
                {"tool_name": "fetch_law_article", "result_summary": OUR_TEXT,
                 "result_metadata": {"top_source_labels": {
                     "c0ffee00-0000-0000-0000-000000000000": "Massima — " + SECRET[:40],
                     "dottrina_brocardi_1": SECRET_RATIO[:40],
                     CC: "art. 2043 codice civile",
                 }}},
            ],
            "retrieval_trace": {"source_labels": {"massima_x": "Massima — " + SECRET[:40]}},
        }]},
    }


def test_a_trace_stored_before_the_guard_is_read_back_without_brocardi_text():
    out = redact_stored_trace(_legacy_trace())
    dumped = _dump(out)
    assert SECRET[:40] not in dumped and SECRET_RATIO[:40] not in dumped
    calls = out["stages"]["expert_executions"][0]["tool_calls"]
    assert calls[2]["result_summary"] == OUR_TEXT
    assert calls[2]["result_metadata"]["top_source_labels"][CC] == "art. 2043 codice civile"


def test_a_guarded_trace_keeps_its_retrieval_summaries():
    trace = {TRACE_GUARD_KEY: 1, "tool_calls": [{"tool_name": "semantic_search", "result_summary": OUR_TEXT}]}
    assert redact_stored_trace(trace)["tool_calls"][0]["result_summary"] == OUR_TEXT


def test_stored_sources_keep_only_the_norms_excerpts_when_unguarded():
    sources = [
        {"article_urn": str(uuid4()), "expert": "precedent", "relevance": 0.9, "excerpt": SECRET},
        {"article_urn": "massima_x", "expert": "precedent", "relevance": 0.9, "excerpt": SECRET},
        {"article_urn": CC, "expert": "literal", "relevance": 0.9, "excerpt": OUR_TEXT},
    ]
    out = redact_stored_sources(sources, guarded=False)
    assert SECRET not in _dump(out)
    assert out[2]["excerpt"] == OUR_TEXT
    guarded = redact_stored_sources(sources[2:], guarded=True)
    assert guarded[0]["excerpt"] == OUR_TEXT


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return SimpleNamespace(all=lambda: self._rows)

    def scalar_one_or_none(self):
        return self._rows[0] if self._rows else None


class _Session:
    def __init__(self, rows):
        self._rows = rows

    async def execute(self, statement):
        return _Rows(self._rows)


def _stored_turn():
    return SimpleNamespace(
        trace_id="trace_x", user_id="u-1", query="Domanda?", synthesis_text="Sintesi.",
        synthesis_mode="convergent", confidence=0.5, selected_experts=["precedent"],
        sources=[{"article_urn": str(uuid4()), "expert": "precedent", "relevance": 0.9, "excerpt": SECRET}],
        full_trace=_legacy_trace(), consent_level="full",
        created_at=datetime(2026, 7, 1, tzinfo=timezone.utc),
    )


async def test_history_and_trace_routes_serve_no_brocardi_text():
    import importlib

    experts_router = importlib.import_module("merlt.api.experts_router")
    turn = _stored_turn()
    history = await experts_router.list_history(user_id="u-1", limit=20, session=_Session([turn]), api_key=None)
    assert SECRET not in _dump([h.model_dump() for h in history])
    trace = await experts_router.get_trace("trace_x", caller_consent=None, session=_Session([turn]), api_key=None)
    assert SECRET[:40] not in _dump(trace) and TRACE_GUARD_KEY not in trace
    assert turn.full_trace["stages"]["expert_executions"][0]["tool_calls"][1]["result_summary"] == SECRET


async def test_a_new_turn_without_a_pipeline_trace_keeps_its_excerpts():
    import importlib

    experts_router = importlib.import_module("merlt.api.experts_router")
    turn = _stored_turn()
    turn.sources = [{"article_urn": "live:abc", "expert": "precedent", "relevance": 0.9,
                     "excerpt": "Una massima di Italgiure."}]
    turn.full_trace = {TRACE_GUARD_KEY: 1}
    history = await experts_router.list_history(user_id="u-1", limit=20, session=_Session([turn]), api_key=None)
    assert history[0].sources[0].excerpt == "Una massima di Italgiure."


def test_the_dashboard_lists_no_brocardi_source():
    import inspect
    import importlib

    dashboard = importlib.import_module("merlt.api.dashboard_router")
    assert "brocardi" not in inspect.getsource(dashboard).lower()


# --- The validation queue and the per-user export ------------------------------


class _Scripted:
    """A session answering get_pending's three queries in order."""

    def __init__(self, entities, relations, names):
        self._answers = [entities, relations, names]

    async def execute(self, statement):
        rows = self._answers.pop(0)
        return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: rows), all=lambda: rows)


def _entity(entity_id, text, fonte, descrizione):
    return SimpleNamespace(
        entity_id=entity_id, entity_text=text, entity_type="concetto", descrizione=descrizione,
        article_urn=CC, ambito="civile", fonte=fonte, source_reference=None, llm_confidence=0.9,
        approval_score=0.0, rejection_score=0.0, votes_count=0, contributed_by="u-1",
        contributor_authority=0.5, created_at=None,
    )


def _relation(relation_id, source, target, fonte="llm_extraction"):
    return SimpleNamespace(
        relation_id=relation_id, source_node_urn=source, target_entity_id=target,
        relation_type="INTERPRETA", fonte=fonte, source_reference=None, source_type="article",
        article_urn=CC, llm_confidence=0.9, relation_description="", approval_score=0.0,
        rejection_score=0.0, votes_count=0, contributed_by="u-1", contributor_authority=0.5, created_at=None,
    )


async def test_the_validation_queue_hides_what_is_still_marked_as_brocardis():
    import importlib

    from merlt.api.models.enrichment_models import PendingQueueRequest

    enrichment_router = importlib.import_module("merlt.api.enrichment_router")
    session = _Scripted(
        entities=[
            _entity("e-brocardi", "Una massima estratta", "brocardi_massime", SECRET),
            _entity("e-nostra", "buona fede", "llm_extraction", "Un concetto nostro."),
        ],
        relations=[
            _relation("r-1", CC, "e-brocardi"),
            _relation("r-2", CC, "massima_cass._civ._1_2020"),
            _relation("r-3", CC, "e-nostra", fonte="brocardi"),
            _relation("r-4", CC, "e-nostra"),
        ],
        names=[("e-brocardi", "Una massima estratta", "brocardi_massime", None),
               ("e-nostra", "buona fede", "llm_extraction", None)],
    )
    response = await enrichment_router.get_pending(
        request=PendingQueueRequest(user_id="u-2"), session=session, api_key=None,
    )
    assert SECRET not in response.model_dump_json()
    assert [e.id for e in response.pending_entities] == ["e-nostra"]
    assert [r.id for r in response.pending_relations] == ["r-4"]


def test_the_per_user_export_strips_brocardi_from_old_turns():
    from merlt.privacy.user_data import _strip_brocardi_from_turn

    row = {
        "trace_id": "trace_x",
        "sources": json.dumps([
            {"article_urn": str(uuid4()), "expert": "precedent", "relevance": 0.9, "excerpt": SECRET},
            {"article_urn": CC, "expert": "literal", "relevance": 0.9, "excerpt": OUR_TEXT},
        ]),
        "full_trace": json.dumps({"stages": {}}),
        "synthesis_text": "Sintesi.",
    }
    _strip_brocardi_from_turn(row)
    assert SECRET not in _dump(row)
    assert row["sources"][1]["excerpt"] == OUR_TEXT
