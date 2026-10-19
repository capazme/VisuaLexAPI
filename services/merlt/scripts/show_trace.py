#!/usr/bin/env python3
"""
Full pipeline trace with real infrastructure.

Connects to FalkorDB, Qdrant, PostgreSQL, and OpenRouter to run a real
multi-expert legal analysis pipeline and output a complete JSON trace.

Usage:
    .venv/bin/python scripts/show_trace.py "Cos'è la legittima difesa?"
    .venv/bin/python scripts/show_trace.py --config scripts/my_experiment.yaml "query"

Infrastructure required (docker-compose.dev.yml):
    - FalkorDB  → localhost:6382  (graph: merl_t_dev, ~27k nodes)
    - Qdrant    → localhost:6343  (collection: merl_t_dev_chunks, ~5.9k vectors)
    - PostgreSQL→ localhost:5436  (bridge_table, ~27k mappings)
    - OpenRouter API key in env
"""

import argparse
import asyncio
import json
import logging
import os
import sys
import time
from pathlib import Path
from uuid import uuid4

import yaml

# Send structlog output to stderr so stdout is clean JSON
import structlog
structlog.configure(
    wrapper_class=structlog.make_filtering_bound_logger(logging.WARNING),
    logger_factory=structlog.PrintLoggerFactory(file=sys.stderr),
)
# Also redirect stdlib logging to stderr (some libs use logging directly)
logging.basicConfig(stream=sys.stderr, level=logging.WARNING)

# --- Storage backends ---
from merlt.storage.graph.client import FalkorDBClient
from merlt.storage.graph.config import FalkorDBConfig
from merlt.storage.vectors.embeddings import EmbeddingService
from merlt.storage.retriever.retriever import GraphAwareRetriever
from merlt.storage.retriever.models import RetrieverConfig
from merlt.storage.bridge.bridge_table import BridgeTable, BridgeTableConfig
from qdrant_client import QdrantClient

# --- Tools ---
from merlt.tools.search import SemanticSearchTool, GraphSearchTool

# --- AI Service ---
from merlt.rlcf.ai_service import OpenRouterService

# --- Orchestrator & Synthesizer ---
from merlt.experts.orchestrator import MultiExpertOrchestrator, OrchestratorConfig
from merlt.experts.synthesizer import AdaptiveSynthesizer, SynthesisConfig

# --- Neural Gating ---
from merlt.experts.neural_gating import ExpertGatingMLP, HybridExpertRouter, GatingConfig
from merlt.experts.router import ExpertRouter

# --- Trace Storage ---
from merlt.storage.trace import TraceStorageService, TraceStorageConfig
from merlt.experts.models import QATrace


DEFAULT_CONFIG = Path(__file__).parent / "pipeline_config.yaml"


def load_config(config_path: Path) -> dict:
    """Load pipeline configuration from YAML."""
    with open(config_path) as f:
        return yaml.safe_load(f)


def _load_env_from_dotenv():
    """Load OPENROUTER_API_KEY from visualex-api/.env if not already set."""
    if os.getenv("OPENROUTER_API_KEY"):
        return
    dotenv_path = os.path.join(
        os.path.dirname(__file__), "..", "..", "visualex-api", ".env"
    )
    dotenv_path = os.path.normpath(dotenv_path)
    if os.path.exists(dotenv_path):
        with open(dotenv_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key, value = key.strip(), value.strip()
                if key == "OPENROUTER_API_KEY" and value:
                    os.environ["OPENROUTER_API_KEY"] = value
                    return


async def setup_infrastructure(cfg: dict):
    """Wire up all real backends and return the orchestrator + ai_service."""

    infra = cfg.get("infrastructure", {})
    routing_cfg = cfg.get("routing", {})
    neural_cfg = cfg.get("neural_gating", {})
    experts_cfg = cfg.get("experts", {})
    synth_cfg = cfg.get("synthesis", {})

    # 1. FalkorDB
    fdb = infra.get("falkordb", {})
    falkordb = FalkorDBClient(
        FalkorDBConfig(
            host=fdb.get("host", "localhost"),
            port=fdb.get("port", 6380),
            graph_name=fdb.get("graph_name", "merl_t_dev"),
        )
    )
    await falkordb.connect()

    # 2. Qdrant
    qcfg = infra.get("qdrant", {})
    qdrant = QdrantClient(
        host=qcfg.get("host", "localhost"),
        port=qcfg.get("port", 6333),
    )

    # 3. Bridge Table (PostgreSQL)
    bridge = BridgeTable(BridgeTableConfig())
    await bridge.connect()

    # 4. EmbeddingService (E5-large, singleton)
    embeddings = EmbeddingService.get_instance()

    # 5. GraphAwareRetriever (hybrid vector + graph)
    ret_cfg = infra.get("retriever", {})
    from merlt.rlcf.policy_manager import get_policy_manager
    retriever = GraphAwareRetriever(
        vector_db=qdrant,
        graph_db=falkordb,
        bridge_table=bridge,
        config=RetrieverConfig(
            alpha=ret_cfg.get("alpha", 0.7),
            collection_name=ret_cfg.get("collection_name", "merl_t_dev_chunks"),
        ),
        policy_manager=get_policy_manager(),
    )

    # 6. Tools
    semantic_tool = SemanticSearchTool(retriever=retriever, embeddings=embeddings)
    graph_tool = GraphSearchTool(graph_db=falkordb)

    # 7. AI Service (OpenRouter)
    ai = OpenRouterService()

    # 8. Synthesizer
    synth = AdaptiveSynthesizer(config=SynthesisConfig(), ai_service=ai)

    # 9. Routing setup
    strategy = routing_cfg.get("strategy", "hybrid")
    hybrid_router = None

    if strategy == "hybrid" and neural_cfg.get("enabled", True):
        # Neural Gating MLP
        priors = neural_cfg.get("expert_priors", {})
        gating_config = GatingConfig(
            input_dim=neural_cfg.get("input_dim", 1024),
            hidden_dim1=neural_cfg.get("hidden_dim1", 512),
            hidden_dim2=neural_cfg.get("hidden_dim2", 256),
            dropout=neural_cfg.get("dropout", 0.1),
            expert_priors=priors if priors else None,
        )
        gating_mlp = ExpertGatingMLP(gating_config)

        # Load checkpoint if specified
        ckpt = neural_cfg.get("checkpoint_path")
        ckpt_path = Path(ckpt) if ckpt else None

        # LLM fallback router (no regex)
        llm_model = routing_cfg.get("llm_classification", {}).get("model", "google/gemini-2.0-flash-001")
        llm_router = ExpertRouter(ai_service=ai, classification_model=llm_model, disable_regex=True)

        hybrid_router = HybridExpertRouter(
            neural_gating=gating_mlp,
            embedding_service=embeddings,
            llm_router=llm_router,
            confidence_threshold=neural_cfg.get("confidence_threshold", 0.3),
            checkpoint_path=ckpt_path,
        )

    # 10. Orchestrator
    orchestrator = MultiExpertOrchestrator(
        synthesizer=synth,
        tools=[semantic_tool, graph_tool],
        ai_service=ai,
        config=OrchestratorConfig(
            selection_threshold=routing_cfg.get("selection_threshold", 0.2),
            max_experts=routing_cfg.get("max_experts", 4),
            parallel_execution=experts_cfg.get("parallel_execution", True),
            timeout_seconds=experts_cfg.get("timeout_seconds", 60.0),
            enable_circuit_breaker=experts_cfg.get("enable_circuit_breaker", True),
        ),
        hybrid_router=hybrid_router,
    )

    return orchestrator, ai, cfg


async def main():
    parser = argparse.ArgumentParser(description="MERL-T pipeline trace")
    parser.add_argument("query", nargs="?", default=None, help="Legal query")
    parser.add_argument("--config", "-c", default=str(DEFAULT_CONFIG), help="YAML config path")
    parser.add_argument("--save-db", action="store_true", help="Save trace to PostgreSQL via TraceStorageService")
    parser.add_argument("--consent", default="basic", choices=["anonymous", "basic", "full"],
                        help="Consent level for storage (default: basic)")
    args = parser.parse_args()

    # Load config
    config_path = Path(args.config)
    if not config_path.exists():
        print(f"Config not found: {config_path}", file=sys.stderr)
        sys.exit(1)
    cfg = load_config(config_path)

    query = args.query or cfg.get(
        "default_query",
        "Quali sono le conseguenze dell'inadempimento contrattuale "
        "secondo l'art. 1453 del codice civile?"
    )

    # Ensure API key is available
    _load_env_from_dotenv()
    if not os.getenv("OPENROUTER_API_KEY"):
        print(
            "ERROR: OPENROUTER_API_KEY not set. "
            "Export it or place it in visualex-api/.env",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"Config: {config_path.name}", file=sys.stderr)
    print(f"Strategy: {cfg.get('routing', {}).get('strategy', 'hybrid')}", file=sys.stderr)
    print(f"Setting up infrastructure...", file=sys.stderr)
    t0 = time.perf_counter()
    orchestrator, ai, cfg = await setup_infrastructure(cfg)
    setup_ms = (time.perf_counter() - t0) * 1000
    print(f"Infrastructure ready ({setup_ms:.0f}ms)", file=sys.stderr)

    print(f"Running pipeline for: {query[:80]}...", file=sys.stderr)
    t1 = time.perf_counter()

    try:
        result = await orchestrator.process(
            query=query,
            include_trace=True,
        )
    finally:
        await ai.close()

    pipeline_ms = (time.perf_counter() - t1) * 1000
    print(f"Pipeline complete ({pipeline_ms:.0f}ms)", file=sys.stderr)

    # Build output
    trace = result.metadata.get("pipeline_trace", {})
    metrics = result.metadata.get("pipeline_metrics", {})

    # Generate trace_id
    trace_id = f"trace_{uuid4().hex[:12]}"

    # Save to database if requested
    if args.save_db:
        print(f"Saving trace to PostgreSQL...", file=sys.stderr)
        try:
            trace_service = TraceStorageService(TraceStorageConfig())
            await trace_service.connect()
            await trace_service.ensure_tables_exist()

            # Extract routing metadata
            routing_method = None
            query_type = None
            if trace:
                routing_info = trace.get("routing", {})
                routing_method = routing_info.get("method")
                query_type = routing_info.get("query_type")

            # Build QATrace
            qa_trace = QATrace(
                trace_id=trace_id,
                user_id="cli_user",
                query=query,
                selected_experts=list(result.expert_contributions.keys()) if result.expert_contributions else [],
                synthesis_mode=result.mode.value,
                synthesis_text=result.synthesis,
                sources=None,  # CLI doesn't populate sources in same format
                execution_time_ms=int(pipeline_ms),
                full_trace=trace,
                consent_level=args.consent,
                query_type=query_type,
                confidence=result.confidence,
                routing_method=routing_method,
            )

            saved_id = await trace_service.save_trace(qa_trace)
            await trace_service.close()

            print(f"Trace saved: {saved_id}", file=sys.stderr)
        except Exception as e:
            print(f"Failed to save trace: {e}", file=sys.stderr)

    output = {
        "query": query,
        "trace_id": trace_id,
        "config_file": config_path.name,
        "synthesis_mode": result.mode.value,
        "confidence": round(result.confidence, 3),
        "synthesis_preview": result.synthesis[:500] if result.synthesis else "",
        "pipeline_trace": trace,
        "pipeline_metrics": metrics,
        "timing": {
            "setup_ms": round(setup_ms, 1),
            "pipeline_ms": round(pipeline_ms, 1),
            "total_ms": round(setup_ms + pipeline_ms, 1),
        },
        "saved_to_db": args.save_db,
    }

    print(json.dumps(output, indent=2, ensure_ascii=False, default=str))


if __name__ == "__main__":
    asyncio.run(main())
