"""Expert-System bootstrap — build the MultiExpertOrchestrator from the current
RuntimeConfig flags.

Extracted from the app lifespan so the SAME construction runs both at boot AND on
an admin "engine reinitialize" (the restart button): the construction-time levers
(ReAct, semantic search, advanced neural routing) are read from RuntimeConfig, so
toggling them in the admin panel and reinitializing rebuilds the engine WITHOUT a
container restart. Runtime-tunable levers (gating threshold, max_tokens,
max_experts, disagreement gate) already take effect per-query with no rebuild.

Every heavy/optional piece is best-effort + fail-open: a missing dependency
degrades to fewer capabilities and is logged — it never blocks Q&A.
"""

import os
from typing import Any, Dict, List

import structlog

from merlt.config.runtime_config import get_runtime_config

log = structlog.get_logger()


async def _build_tools() -> list:
    """GraphSearchTool (always, FalkorDB core dep) + SemanticSearchTool (flagged).

    Async because both FalkorDB and the Bridge Table connect over the network:
    the SemanticSearchTool needs a fully-wired GraphAwareRetriever (Qdrant vector
    search + FalkorDB graph enrichment + chunk→node bridge). Wiring it with only
    `embeddings=` — the previous bug — made every semantic_search call fail at
    runtime with "GraphAwareRetriever non configurato", so experts answered from
    LLM priors with NO grounding on the indexed corpus. The FalkorDB client is
    built once and shared by GraphSearchTool AND the retriever.
    """
    tools: list = []

    # One connected FalkorDB client, shared by the graph tool + the retriever.
    falkordb = None
    try:
        from merlt.storage.graph.client import FalkorDBClient
        falkordb = FalkorDBClient()
        await falkordb.connect()
    except Exception as e:
        log.warning("FalkorDB connect failed — graph grounding degraded", error=str(e))
        falkordb = None

    # Bridge Table (chunk↔node mapping): built once, hoisted out of the
    # semantic_search_enabled flag so VerificationTool can use it regardless of
    # that flag. BridgeTableConfig defaults to localhost:5433/rlcf_dev, which is
    # unreachable inside the container network (the bridge silently failed to
    # connect → zero graph enrichment). Point it at the enrichment DB
    # (merlt-postgres:5432/merlt) where the chunk→node bridge_table lives.
    bridge = None
    try:
        from merlt.storage.bridge import BridgeTable, BridgeTableConfig
        bridge = BridgeTable(BridgeTableConfig(
            host=os.getenv("ENRICHMENT_DB_HOST", "localhost"),
            port=int(os.getenv("ENRICHMENT_DB_PORT", "5432")),
            database=os.getenv("ENRICHMENT_DB_NAME", "merlt"),
            user=os.getenv("ENRICHMENT_DB_USER", "merlt"),
            password=os.getenv("ENRICHMENT_DB_PASSWORD", "merlt"),
        ))
        await bridge.connect()
        log.info("✅ BridgeTable connected (chunk↔node mapping)")
    except Exception as e:
        log.warning("BridgeTable unavailable — chunk verification / semantic enrichment degraded", error=str(e))
        bridge = None

    if falkordb is not None:
        try:
            from merlt.tools import GraphSearchTool
            tools.append(GraphSearchTool(graph_db=falkordb))
            log.info("✅ GraphSearchTool wired (FalkorDB graph grounding)")
        except Exception as e:
            log.warning("GraphSearchTool unavailable — experts run without graph traversal", error=str(e))

        # Wire the remaining graph-grounded tools. Each is independently
        # fail-open: a missing/broken tool is logged and skipped, it never
        # aborts the rest of _build_tools.
        _graph_tools_before = len(tools)
        try:
            from merlt.tools import HierarchyNavigationTool
            tools.append(HierarchyNavigationTool(graph_db=falkordb))
            log.info("✅ HierarchyNavigationTool wired")
        except Exception as e:
            log.warning("HierarchyNavigationTool unavailable", error=str(e))

        try:
            from merlt.tools import HistoricalEvolutionTool
            tools.append(HistoricalEvolutionTool(graph_db=falkordb))
            log.info("✅ HistoricalEvolutionTool wired")
        except Exception as e:
            log.warning("HistoricalEvolutionTool unavailable", error=str(e))

        try:
            from merlt.tools import PrincipleLookupTool
            tools.append(PrincipleLookupTool(graph_db=falkordb))
            log.info("✅ PrincipleLookupTool wired")
        except Exception as e:
            log.warning("PrincipleLookupTool unavailable", error=str(e))

        try:
            from merlt.tools import ConstitutionalBasisTool
            tools.append(ConstitutionalBasisTool(graph_db=falkordb))
            log.info("✅ ConstitutionalBasisTool wired")
        except Exception as e:
            log.warning("ConstitutionalBasisTool unavailable", error=str(e))

        try:
            from merlt.tools import CitationChainTool
            tools.append(CitationChainTool(graph_db=falkordb))
            log.info("✅ CitationChainTool wired")
        except Exception as e:
            log.warning("CitationChainTool unavailable", error=str(e))

        try:
            from merlt.tools import TextualReferenceTool
            tools.append(TextualReferenceTool(graph_db=falkordb))
            log.info("✅ TextualReferenceTool wired")
        except Exception as e:
            log.warning("TextualReferenceTool unavailable", error=str(e))

        try:
            from merlt.tools import DefinitionLookupTool
            tools.append(DefinitionLookupTool(graph_db=falkordb))
            log.info("✅ DefinitionLookupTool wired")
        except Exception as e:
            log.warning("DefinitionLookupTool unavailable", error=str(e))

        try:
            from merlt.tools import ExternalSourceTool
            tools.append(ExternalSourceTool(graph_db=falkordb))
            log.info("✅ ExternalSourceTool wired")
        except Exception as e:
            log.warning("ExternalSourceTool unavailable", error=str(e))

        # ArticleFetchTool (native, Italian params tipo_atto/numero_articolo) is
        # DELIBERATELY NOT wired: it duplicates the MCP `fetch_law_article`
        # (English params act_type/article) which is the curated tool that also
        # feeds graph co-evolution (Slice A live-source sedimentation). Exposing
        # BOTH made the ReAct LLM cross-apply the two schemas — the root cause of
        # the fetch_law_article "Missing/Unknown parameter" failures. Keeping only
        # the MCP tool removes that ambiguity. (Not in the neural TOOL_VOCAB, so no
        # gating change needed.)

        # VerificationTool uses the shared BridgeTable when available; it
        # degrades fail-open (graph-only strict_mode) when the bridge failed.
        try:
            from merlt.tools import VerificationTool
            if bridge is not None:
                tools.append(VerificationTool(graph_db=falkordb, bridge=bridge))
            else:
                tools.append(VerificationTool(graph_db=falkordb))
            log.info("✅ VerificationTool wired", with_bridge=bridge is not None)
        except Exception as e:
            log.warning("VerificationTool unavailable", error=str(e))

        log.info("✅ graph tools wired", count=len(tools) - _graph_tools_before)

    if get_runtime_config().get_bool("semantic_search_enabled", False):
        if bridge is None:
            log.warning("SemanticSearchTool unavailable — BridgeTable not connected")
        else:
            try:
                from qdrant_client import QdrantClient
                from merlt.tools import SemanticSearchTool
                from merlt.storage.vectors.embeddings import EmbeddingService
                from merlt.storage.retriever import GraphAwareRetriever, RetrieverConfig
                from merlt.rlcf.policy_manager import get_policy_manager

                qdrant = QdrantClient(
                    host=os.getenv("QDRANT_HOST", "localhost"),
                    port=int(os.getenv("QDRANT_PORT", "6333")),
                )
                # RetrieverConfig defaults to 'merl_t_dev_chunks' — the populated
                # collection is 'merl_t_legal_chunks' (backfill_embeddings default),
                # so name it explicitly or vector search hits an empty collection.
                collection = (
                    os.getenv("QDRANT_COLLECTION")
                    or os.getenv("MERLT_SEED_COLLECTION")
                    or "merl_t_legal_chunks"
                )
                retriever = GraphAwareRetriever(
                    vector_db=qdrant,
                    graph_db=falkordb,
                    bridge_table=bridge,
                    config=RetrieverConfig(collection_name=collection),
                    policy_manager=get_policy_manager(),
                )
                tools.append(SemanticSearchTool(
                    retriever=retriever,
                    embeddings=EmbeddingService.get_instance(),
                ))
                log.info("✅ SemanticSearchTool wired (retriever + Qdrant grounding)", collection=collection)
            except Exception as e:
                log.warning("SemanticSearchTool unavailable — semantic search off", error=str(e), exc_info=True)

    # Loop β A.1: live legal grounding via the mcp-legal-it sidecar (FastMCP over
    # HTTP at MCP_LEGAL_IT_URL). build_mcp_legal_tools lists the remote tools and
    # wraps each; keep ONLY the curated LIVE_LEGAL_TOOLS (norm text + jurisprudence
    # + doctrine) so the ~180 calculator tools never enter the registry (the
    # per-expert filter in orchestrator._init_experts keeps non-mcp tools for all
    # experts, so an un-curated calculator would otherwise reach every expert).
    # Failure-isolated: build_mcp_legal_tools returns [] if the sidecar is down.
    if get_runtime_config().get_bool("mcp_legal_tools_enabled", True):
        try:
            from merlt.tools.mcp_legal_adapter import build_mcp_legal_tools
            from merlt.experts.base import BaseExpert
            curated = set(BaseExpert.LIVE_LEGAL_TOOLS)
            mcp_tools = [t for t in await build_mcp_legal_tools() if t.name in curated]
            tools.extend(mcp_tools)
            log.info(
                "✅ mcp-legal-it live tools wired",
                count=len(mcp_tools),
                names=[t.name for t in mcp_tools],
            )
        except Exception as e:
            log.warning("mcp-legal-it tools unavailable — live legal grounding off", error=str(e))
    return tools


def _build_neural(rc) -> Dict[str, Any]:
    """The advanced-routing stack: PolicyManager (traversal head) + embedding_service
    + HybridExpertRouter (gating head). Flag-gated + fail-open."""
    out: Dict[str, Any] = {"policy_manager": None, "embedding_service": None, "hybrid_router": None, "tool_selector": None}
    if not rc.get_bool("advanced_routing_enabled", False):
        return out

    try:
        from merlt.rlcf.policy_manager import get_policy_manager
        out["policy_manager"] = get_policy_manager()
        log.info(
            "PolicyManager wired",
            traversal_checkpoint=out["policy_manager"].is_traversal_policy_available(),
            gating_checkpoint=out["policy_manager"].is_gating_policy_available(),
        )
    except Exception as e:
        log.warning("PolicyManager unavailable — traversal head off", error=str(e))
    try:
        from merlt.storage.vectors.embeddings import EmbeddingService
        out["embedding_service"] = EmbeddingService.get_instance()
    except Exception as e:
        log.warning("EmbeddingService unavailable — neural routing cannot fire", error=str(e))

    if out["policy_manager"] is not None and out["embedding_service"] is not None:
        try:
            gating_policy = out["policy_manager"].get_gating_policy()
            if gating_policy is not None:
                from merlt.experts.neural_gating.hybrid_router import HybridExpertRouter
                hybrid_router = HybridExpertRouter(
                    neural_gating=gating_policy,
                    embedding_service=out["embedding_service"],
                )
                # Gating threshold is admin-tunable at runtime: seed from RuntimeConfig
                # + register an apply-hook so a PUT pushes onto the LIVE router (route()
                # reads self.confidence_threshold per query — no restart).
                hybrid_router.confidence_threshold = rc.get_float(
                    "gating_confidence_threshold", hybrid_router.confidence_threshold
                )
                rc.register_apply(
                    "gating_confidence_threshold",
                    lambda v, _r=hybrid_router: setattr(_r, "confidence_threshold", v),
                )
                out["hybrid_router"] = hybrid_router
                log.info(
                    "✅ HybridExpertRouter wired (neural expert selection)",
                    confidence_threshold=hybrid_router.confidence_threshold,
                )
            else:
                log.info("No gating checkpoint — expert selection stays regex")
        except Exception as e:
            log.warning("HybridExpertRouter unavailable — expert selection stays regex", error=str(e))

    # Loop β E.3: activate the tool-gating selector at inference. It was NEVER
    # wired (tool_selector stayed None) → the ToolSelector never ran → no
    # `tool_use` actions were recorded, so the ToolGatingMLP had ZERO training
    # data AND no per-query tool selection ran. Wiring it closes the whole loop:
    # ToolSelector records tool_use actions (log_prob + called + A/B arm) that
    # ToolPolicyTrainer.update_from_feedback trains on, using the answer-level
    # reward. Bootstrap with a warm-start MLP when no checkpoint exists (else it
    # can never gather its first data). Default ab_ratio=0.0 = pure SHADOW: the
    # selector records data with all tools still firing (zero answer-quality
    # risk); an admin raises it (live, register_apply) to let the policy actually
    # prune tools once it has trained. Failure-isolated.
    if out["policy_manager"] is not None and rc.get_bool("tool_gating_enabled", True):
        try:
            from merlt.experts.neural_gating.tool_selector import ToolSelector
            from merlt.experts.neural_gating.tool_neural import ToolGatingMLP, ToolGatingConfig
            from merlt.experts.orchestrator import MultiExpertOrchestrator

            tool_policy = out["policy_manager"]._load_tool_policy()
            if tool_policy is None:
                tool_policy = ToolGatingMLP(ToolGatingConfig(input_dim=1024))
                tool_policy.requires_grad_(False)
                tool_policy.eval()
                _has_ckpt = False
            else:
                _has_ckpt = True

            selector = ToolSelector(
                policy=tool_policy,
                expert_tool_map=MultiExpertOrchestrator.EXPERT_MCP_TOOLS,
                enabled=True,
                ab_ratio=rc.get_float("tool_gating_ab_ratio", 0.0),
            )
            out["tool_selector"] = selector
            rc.register_apply(
                "tool_gating_ab_ratio",
                lambda v, _s=selector: setattr(_s, "ab_ratio", max(0.0, min(1.0, float(v)))),
            )
            log.info(
                "✅ ToolSelector wired (tool-gating records at inference)",
                ab_ratio=selector.ab_ratio,
                has_checkpoint=_has_ckpt,
                experts=list(selector.expert_tool_map.keys()),
            )
        except Exception as e:
            log.warning("ToolSelector unavailable — tool selection stays static per-canon", error=str(e))
    return out


async def build_orchestrator(ai_service):
    """Construct a fresh MultiExpertOrchestrator from the current RuntimeConfig.

    Async because tool wiring connects FalkorDB + the Bridge Table. Returns the
    orchestrator; the caller swaps it in via initialize_expert_system.
    """
    from merlt.experts.synthesizer import AdaptiveSynthesizer, SynthesisConfig
    from merlt.experts.orchestrator import MultiExpertOrchestrator, OrchestratorConfig

    rc = get_runtime_config()
    synthesizer = AdaptiveSynthesizer(
        config=SynthesisConfig(
            convergent_threshold=0.5,
            resolvability_weight=0.3,
            include_disagreement_explanation=True,
            max_alternatives=3,
        ),
        ai_service=ai_service,
    )
    tools = await _build_tools()
    neural = _build_neural(rc)

    orchestrator = MultiExpertOrchestrator(
        synthesizer=synthesizer,
        tools=tools,
        ai_service=ai_service,
        config=OrchestratorConfig(
            max_experts=rc.get_int("max_experts", 4),
            timeout_seconds=60,
            parallel_execution=True,
        ),
        policy_manager=neural["policy_manager"],
        embedding_service=neural["embedding_service"],
        hybrid_router=neural["hybrid_router"],
        tool_selector=neural["tool_selector"],
    )
    log.info("✅ Expert System built", **engine_state(orchestrator))
    return orchestrator


def engine_state(orchestrator) -> Dict[str, Any]:
    """A snapshot of the live engine state (for the reinit response + startup log)."""
    rc = get_runtime_config()
    tools: List[str] = [getattr(t, "name", "?") for t in getattr(orchestrator, "tools", [])]
    pm = getattr(orchestrator, "policy_manager", None)
    return {
        "tools": tools,
        "routing_strategy": getattr(orchestrator, "_routing_strategy", "?"),
        "react_enabled": bool(getattr(orchestrator, "_expert_use_react", False)),
        "gating_head": getattr(orchestrator, "hybrid_router", None) is not None,
        "traversal_head": bool(pm.is_traversal_policy_available()) if pm is not None else False,
        "gating_confidence_threshold": rc.get_float("gating_confidence_threshold", 0.7),
        "max_experts": rc.get_int("max_experts", 4),
    }
