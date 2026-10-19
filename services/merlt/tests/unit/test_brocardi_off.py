"""MERL-T no longer asks Brocardi for anything (D-078).

Ingestion and live enrichment default to no Brocardi, the VisuaLex client never
calls `/fetch_brocardi_info` and drops the Brocardi fields of `/fetch_all_data`,
and no expert can reach Brocardi through the mcp-legal-it tools. The data
already in the graph is not touched here. Strings are synthetic.
"""

from __future__ import annotations

import inspect
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx

from merlt.api.models.enrichment_models import LiveEnrichmentRequest
from merlt.clients.visualex_client import VisuaLexClient
from merlt.clients.models import Norma, NormaVisitata
from merlt.core.legal_knowledge_graph import LegalKnowledgeGraph
from merlt.experts.base import BaseExpert
from merlt.experts.neural_gating.tool_neural import TOOL_VOCAB
from merlt.experts.orchestrator import MultiExpertOrchestrator
from merlt.experts.react_mixin import _CANON_STRATEGY
from merlt.pipeline.batch_ingestion import BatchIngestionPipeline
from merlt.tools import mcp_legal_adapter
from merlt.tools.mcp_legal_adapter import McpLegalToolAdapter, build_mcp_legal_tools


def _default(fn, name):
    return inspect.signature(fn).parameters[name].default


# --- Defaults ----------------------------------------------------------------


def test_every_ingestion_and_enrichment_entry_point_defaults_to_no_brocardi():
    import importlib

    enrichment_router = importlib.import_module("merlt.api.enrichment_router")
    assert _default(LegalKnowledgeGraph.ingest_norm, "include_brocardi") is False
    assert _default(LegalKnowledgeGraph.ingest_batch, "include_brocardi") is False
    assert _default(BatchIngestionPipeline.ingest_batch, "include_brocardi") is False
    assert _default(enrichment_router.live_enrich_stream, "include_brocardi") is False
    request = LiveEnrichmentRequest(tipo_atto="codice civile", articolo="1453", user_id="u-1")
    assert request.include_brocardi is False


# --- The VisuaLex client -----------------------------------------------------


def _client_with(handler) -> tuple[VisuaLexClient, list]:
    calls: list = []

    def recording(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        return handler(request)

    client = VisuaLexClient(base_url="http://visualex.test")
    client._client = httpx.AsyncClient(
        base_url="http://visualex.test", transport=httpx.MockTransport(recording)
    )
    return client, calls


async def test_the_client_never_calls_fetch_brocardi_info():
    client, calls = _client_with(lambda request: httpx.Response(200, json=[{"brocardi_info": {"Ratio": "x"}}]))
    nv = NormaVisitata(norma=Norma(tipo_atto="codice civile"), numero_articolo="1453")

    assert await client.fetch_brocardi_info(act_type="codice civile", article="1453") == []
    assert await client.get_info(nv) == (None, {}, None)
    assert calls == []


async def test_fetch_all_data_drops_the_brocardi_fields():
    item = {
        "article_text": "Testo sintetico.",
        "norma_data": {"tipo_atto": "codice civile"},
        "brocardi_info": {"Ratio": "sintetica", "Massime": ["m"]},
        "brocardi_error": None,
    }
    client, calls = _client_with(lambda request: httpx.Response(200, json=[item]))

    result = await client.fetch_all_data(act_type="codice civile", article="1453")

    assert calls == ["/fetch_all_data"]
    assert result == [{"article_text": "Testo sintetico.", "norma_data": {"tipo_atto": "codice civile"}}]


async def test_ingest_norm_asks_no_brocardi_even_when_a_caller_still_passes_true():
    """The client is the hard stop: an explicit True yields nothing either."""
    client, calls = _client_with(lambda request: httpx.Response(200, json=[]))
    kg = LegalKnowledgeGraph()
    kg._connected = True
    kg._normattiva_scraper = SimpleNamespace(
        get_document=AsyncMock(return_value=("Testo.", "https://www.normattiva.it/x"))
    )
    from merlt.clients.visualex_client import BrocardiScraper

    kg._brocardi_scraper = BrocardiScraper(client=client)
    pipeline = MagicMock()
    pipeline.ingest_article = AsyncMock(
        side_effect=lambda *, article, **_: SimpleNamespace(
            article_urn="u", nodes_created=[], relations_created=[], chunks=[], bridge_mappings=[],
        )
    )
    kg._ingestion_pipeline = pipeline

    result = await kg.ingest_norm(
        "codice civile", "1453",
        include_brocardi=True, include_embeddings=False, include_bridge=False, include_multivigenza=False,
    )

    assert calls == []
    assert result.brocardi_enriched is False
    assert pipeline.ingest_article.await_args.kwargs["article"].brocardi_info is None


# --- The experts' tools ------------------------------------------------------


def test_no_expert_is_granted_cerca_brocardi():
    assert "cerca_brocardi" not in BaseExpert.LIVE_LEGAL_TOOLS
    for expert_type, tools in MultiExpertOrchestrator.EXPERT_MCP_TOOLS.items():
        assert "cerca_brocardi" not in tools, expert_type


def test_no_curated_live_tool_is_one_that_reads_brocardi():
    # The mcp-legal-it tools that call Brocardi whatever their arguments, as the
    # guard lists them. `cite_law` reaches it only through `include_annotations`,
    # which the adapter withholds (tests below).
    from merlt.storage.graph.brocardi_guard import BROCARDI_TOOLS as brocardi_tools

    assert {"cerca_brocardi", "fetch_law_annotations", "giurisprudenza_articolo", "mappa_orientamento"} <= brocardi_tools
    assert brocardi_tools.isdisjoint(BaseExpert.LIVE_LEGAL_TOOLS)
    for tools in MultiExpertOrchestrator.EXPERT_MCP_TOOLS.values():
        assert brocardi_tools.isdisjoint(tools)


def test_guard_lists_every_vendored_tool_bound_to_brocardi():
    # `source_bindings.py` of the vendored mcp-legal-it names, tool by tool, the
    # sources it consults. A release that binds a new tool to Brocardi must be
    # added to the guard (or withheld by an argument, as `cite_law`) before the
    # submodule moves. Skipped where the submodule is not checked out: CI does
    # not check it out today, so run the suite locally when bumping it.
    import re
    from pathlib import Path

    from merlt.storage.graph.brocardi_guard import BROCARDI_TOOLS as brocardi_tools

    bindings = next(
        (p / "vendor/mcp-legal-it/src/source_bindings.py"
         for p in Path(__file__).resolve().parents
         if (p / "vendor/mcp-legal-it/src/source_bindings.py").is_file()),
        None,
    )
    if bindings is None:
        import pytest

        pytest.skip("vendor/mcp-legal-it is not checked out")
    bound = set(re.findall(r'^\s*"(\w+)":\s*\([^)]*"brocardi"', bindings.read_text(), re.M))
    assert bound, "the parser found no tool bound to Brocardi: the file's shape changed"
    # Inclusion, not equality: a name that leaves the bindings stays in the
    # guard, because stored traces still carry it as `source_tool`.
    assert bound - {"cite_law"} <= brocardi_tools


def test_cerca_brocardi_keeps_its_slot_in_the_tool_vocabulary():
    # Append-only: removing or moving it would break saved tool-gating checkpoints.
    assert TOOL_VOCAB.index("cerca_brocardi") == 2


def test_no_prompt_steers_an_expert_to_cerca_brocardi():
    import merlt.experts.react_mixin as react_mixin

    for strategy in _CANON_STRATEGY.values():
        assert "brocardi" not in strategy["tools"].lower()
    source = inspect.getsource(react_mixin.ReActMixin._build_react_prompt)
    assert "cerca_brocardi" not in source


def _remote(name, description, properties):
    return SimpleNamespace(
        name=name,
        description=description,
        inputSchema={"type": "object", "properties": properties, "required": ["reference"]},
    )


async def test_cite_law_cannot_be_asked_for_brocardi_annotations():
    remote = _remote(
        "cite_law",
        "Cita una norma.\nFonti: Normattiva, EUR-Lex, Brocardi (annotazioni).\nDopo: cerca_brocardi().",
        {
            "reference": {"type": "string"},
            "include_annotations": {"type": "boolean", "default": False},
        },
    )
    session = MagicMock()
    session.list_tools = AsyncMock(return_value=[remote])
    session.call_tool = AsyncMock(return_value=SimpleNamespace(is_error=False, content=[], data="Art. 1"))
    client_cm = MagicMock()
    client_cm.__aenter__ = AsyncMock(return_value=session)
    client_cm.__aexit__ = AsyncMock(return_value=False)

    with patch.object(mcp_legal_adapter, "Client", return_value=client_cm):
        (tool,) = await build_mcp_legal_tools("http://mcp.test/mcp")
        assert isinstance(tool, McpLegalToolAdapter)
        assert [p.name for p in tool.parameters] == ["reference"]
        assert "brocardi" not in tool.description.lower()
        assert tool.description.startswith("Cita una norma.")

        # Even if a caller slips the argument in, the remote receives False.
        await tool.execute(reference="art. 1453 codice civile", include_annotations=True)

    assert session.call_tool.await_args.kwargs["arguments"] == {
        "reference": "art. 1453 codice civile",
        "include_annotations": False,
    }


async def test_a_tool_without_the_argument_is_not_sent_it():
    remote = _remote("cite_law", "Cita una norma.", {"reference": {"type": "string"}})
    session = MagicMock()
    session.list_tools = AsyncMock(return_value=[remote])
    session.call_tool = AsyncMock(return_value=SimpleNamespace(is_error=False, content=[], data="Art. 1"))
    client_cm = MagicMock()
    client_cm.__aenter__ = AsyncMock(return_value=session)
    client_cm.__aexit__ = AsyncMock(return_value=False)

    with patch.object(mcp_legal_adapter, "Client", return_value=client_cm):
        (tool,) = await build_mcp_legal_tools("http://mcp.test/mcp")
        await tool.execute(reference="art. 1453 codice civile")

    assert session.call_tool.await_args.kwargs["arguments"] == {"reference": "art. 1453 codice civile"}
