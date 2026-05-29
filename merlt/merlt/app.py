"""
MERL-T FastAPI Application
===========================

Entry point principale per l'API MERL-T.

Features:
- Live enrichment con validazione community
- Document upload & parsing
- Amendment submission (multivigenza)
- Multi-expert Q&A system
- RLCF feedback collection

Usage:
    # Development
    uvicorn merlt.app:app --reload --port 8000

    # Production
    uvicorn merlt.app:app --host 0.0.0.0 --port 8000 --workers 4
"""

import os
import structlog
from contextlib import asynccontextmanager
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load environment variables
env_file = Path(__file__).parent.parent / ".env"
load_dotenv(env_file)
log = structlog.get_logger()
log.info("Environment variables loaded", env_file=str(env_file))

from merlt.storage.enrichment import init_db, close_db, create_tables
from merlt.api.auth import verify_api_key, optional_api_key
from merlt.api import (
    ingestion_router,
    feedback_router,
    auth_router,
    experts_router,
    enrichment_router,
    document_router,
    amendments_router,
    candidates_router,
    graph_router,
    pipeline_router,
    training_router,
    trace_router,
    validity_router,
    citation_router,
    dashboard_router,
    profile_router,
    statistics_router,
    rlcf_router,
    expert_metrics_router,
    ws_router,
    tracking_router,
    policy_evolution_router,
    export_router,
    devils_advocate_router,
    audit_router,
    circuit_breaker_router,
    regression_router,
    schedule_router,
    quarantine_router,
    api_keys_router,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for startup/shutdown.

    Startup:
    - Initialize PostgreSQL connection pool (enrichment DB)
    - Log application startup

    Shutdown:
    - Close database connections
    """
    # Startup
    log.info("=" * 60)
    log.info("MERL-T API Starting...")
    log.info("=" * 60)

    ai_service = None
    try:
        # Initialize enrichment database
        await init_db(echo=False)  # Set echo=True for SQL logging in dev
        await create_tables()
        # create_tables() only emits Base.metadata (tables) — the RLCF consensus
        # PL/pgSQL triggers (vote → net_score → consensus_reached → promotion) live
        # in migrations and must be (re)installed idempotently on every boot, else
        # votes never reach consensus and graph promotion never fires.
        try:
            from merlt.storage.enrichment.consensus_triggers import ensure_consensus_triggers
            await ensure_consensus_triggers()
            log.info("✅ Consensus triggers ensured")
        except Exception as e:
            log.error("Failed to install consensus triggers", error=str(e), exc_info=True)
            log.warning("Community votes will NOT reach consensus until triggers are installed")
        log.info("✅ Enrichment database initialized")

        # Initialize Expert System (MultiExpertOrchestrator) WITH retrieval tools.
        # Loop β Bug 1: the experts MUST be wired with SemanticSearchTool +
        # GraphSearchTool, otherwise every analyze() silently skips retrieval and the
        # answer comes from the LLM's parametric memory with ZERO grounding (empty
        # `sources`). LegalKnowledgeGraph.connect() builds FalkorDB + Qdrant + bridge +
        # embeddings, and _init_orchestrator() assembles the retrieval-backed
        # orchestrator (synthesizer + ai_service + tools) — the single canonical
        # wiring path. (Previously app.py built the orchestrator inline with tools=[].)
        try:
            from merlt.rlcf.ai_service import OpenRouterService
            from merlt.experts.synthesizer import AdaptiveSynthesizer, SynthesisConfig
            from merlt.experts.orchestrator import MultiExpertOrchestrator, OrchestratorConfig
            from merlt.api.experts_router import initialize_expert_system
            from merlt.storage import FalkorDBClient
            from merlt.tools import GraphSearchTool

            ai_service = OpenRouterService()
            synthesizer = AdaptiveSynthesizer(
                config=SynthesisConfig(
                    convergent_threshold=0.5,
                    resolvability_weight=0.3,
                    include_disagreement_explanation=True,
                    max_alternatives=3,
                ),
                ai_service=ai_service,
            )

            # Loop β Bug 1: wire retrieval tools so the experts GROUND their answers in
            # the legal knowledge graph instead of the LLM's parametric memory (which
            # produced empty `sources`). FalkorDBClient() with no args reads
            # FALKORDB_HOST/PORT/GRAPH_NAME from env (merlt-falkordb:6379, merl_t_legal)
            # — the same env-aware path graph_router and the seed loader use.
            # IMPORTANT: do NOT route this through LegalKnowledgeGraph/MerltConfig —
            # MerltConfig hardcodes localhost:6380 and get_policy_manager() hardcodes a
            # Redis at localhost:6380, both unreachable inside the container network.
            tools = []
            graph_client = FalkorDBClient()
            await graph_client.connect()
            tools.append(GraphSearchTool(graph_db=graph_client))

            # Best-effort semantic retrieval over Qdrant. Skipped (graph grounding still
            # works) if Qdrant/embeddings are unavailable or the collection is empty.
            try:
                from qdrant_client import QdrantClient
                from merlt.storage import GraphAwareRetriever, RetrieverConfig
                from merlt.storage.vectors.embeddings import EmbeddingService
                from merlt.tools import SemanticSearchTool

                qdrant = QdrantClient(
                    host=os.getenv("QDRANT_HOST", "localhost"),
                    port=int(os.getenv("QDRANT_PORT", "6333")),
                )
                embeddings = EmbeddingService.get_instance(
                    model_name=os.getenv("EMBEDDING_MODEL", "intfloat/multilingual-e5-large")
                )
                # RetrieverConfig defaults the Qdrant collection to "merl_t_dev_chunks";
                # the live collection is "<graph>_chunks" (merl_t_legal_chunks). Point it
                # at the right one (env override wins) or semantic search 404s the
                # collection. NB: the seed was loaded with MERLT_SKIP_EMBEDDINGS=true, so
                # this collection is near-empty until embeddings are generated — graph
                # retrieval is the primary grounding source for now.
                _collection = os.getenv("QDRANT_COLLECTION") or (
                    os.getenv("FALKORDB_GRAPH_NAME", "merl_t_legal") + "_chunks"
                )
                retriever = GraphAwareRetriever(
                    vector_db=qdrant,
                    graph_db=graph_client,
                    bridge_table=None,
                    config=RetrieverConfig(collection_name=_collection),
                    policy_manager=None,
                )
                tools.append(SemanticSearchTool(retriever=retriever, embeddings=embeddings))
                log.info("Semantic retrieval tool wired")
            except Exception as e:
                log.warning("Semantic retrieval unavailable; graph grounding only", error=str(e))

            orchestrator = MultiExpertOrchestrator(
                synthesizer=synthesizer,
                tools=tools,
                ai_service=ai_service,
                config=OrchestratorConfig(
                    max_experts=4,
                    timeout_seconds=60,
                    parallel_execution=True,
                ),
            )
            initialize_expert_system(orchestrator)
            log.info("✅ Expert System initialized with retrieval", tools=len(tools))
        except Exception as e:
            log.error("Failed to initialize Expert System", error=str(e), exc_info=True)
            log.warning("Expert System endpoints will return 503 errors")

        # Seed loader (Slice 2a, MERLT-2a.1) — idempotent, non-fatal.
        # Loads the Libro IV CC graph (~27.7k nodes) from merlt/data/seeds/
        # on first boot; subsequent boots short-circuit on the >100-nodes check.
        if os.getenv("MERLT_SKIP_SEED", "").lower() != "true":
            try:
                from merlt.scripts.load_seed_libro_iv import load_seed_libro_iv_from_env
                seed_result = await load_seed_libro_iv_from_env()
                if seed_result.skipped:
                    log.info("✅ Seed loader skipped",
                             reason=seed_result.reason,
                             nodes_before=seed_result.integrity.get("nodes_before"))
                else:
                    log.info("✅ Seed loader completed",
                             nodes=seed_result.nodes_merged,
                             edges=seed_result.edges_merged,
                             embeddings=seed_result.embeddings_generated,
                             bridge_rows=seed_result.bridge_restored_rows,
                             integrity=seed_result.integrity)
            except Exception as e:
                # NON-fatal: MERL-T stays usable for Q&A without the seed.
                # The user can run `python -m merlt.scripts.load_seed_libro_iv` later.
                log.error("Seed loader failed", error=str(e), exc_info=True)
                log.warning("Graph features may be limited until seed is loaded manually")

        log.info("=" * 60)
        log.info("MERL-T API Ready")
        log.info("=" * 60)

        yield

    finally:
        # Shutdown
        log.info("=" * 60)
        log.info("MERL-T API Shutting down...")
        log.info("=" * 60)

        if ai_service is not None:
            await ai_service.close()
            log.info("✅ AI service connections closed")

        await close_db()
        log.info("✅ Database connections closed")

        log.info("=" * 60)
        log.info("MERL-T API Stopped")
        log.info("=" * 60)


# Create FastAPI app
app = FastAPI(
    title="MERL-T API",
    description="Multi-Expert Reasoning with Legal Texts",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware (configure for your frontend)
_cors_origins = os.environ.get("CORS_ORIGINS", "http://localhost:3102,http://localhost:5175").split(",")
# Frontend sends JWT (not X-API-Key). Make API key auth optional globally;
# routes using require_role() still enforce auth via null-check in _check_role.
app.dependency_overrides[verify_api_key] = optional_api_key

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _cors_origins],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(ingestion_router, prefix="/api/v1", tags=["ingestion"])
app.include_router(feedback_router, prefix="/api/v1", tags=["feedback"])
app.include_router(auth_router, prefix="/api/v1", tags=["auth"])
app.include_router(experts_router, prefix="/api/v1", tags=["experts"])
app.include_router(enrichment_router, prefix="/api/v1", tags=["enrichment"])
app.include_router(document_router, prefix="/api/v1", tags=["documents"])
app.include_router(amendments_router, prefix="/api/v1", tags=["amendments"])
app.include_router(candidates_router, prefix="/api/v1", tags=["extraction-candidates"])
app.include_router(graph_router, prefix="/api/v1", tags=["graph"])
app.include_router(pipeline_router, prefix="/api/v1", tags=["pipeline"])
app.include_router(training_router, prefix="/api/v1", tags=["training"])
app.include_router(trace_router, prefix="/api/v1", tags=["traces"])
app.include_router(validity_router, prefix="/api/v1", tags=["validity"])
app.include_router(citation_router, prefix="/api/v1", tags=["citations"])
app.include_router(dashboard_router, prefix="/api/v1", tags=["dashboard"])
app.include_router(profile_router, prefix="/api/v1", tags=["profile"])
app.include_router(statistics_router, prefix="/api/v1", tags=["statistics"])
app.include_router(rlcf_router, prefix="/api/v1", tags=["rlcf"])
app.include_router(expert_metrics_router, prefix="/api/v1", tags=["expert-metrics"])
app.include_router(ws_router, prefix="/api/v1", tags=["websocket"])
app.include_router(tracking_router, prefix="/api/v1", tags=["tracking"])
app.include_router(policy_evolution_router, prefix="/api/v1", tags=["policy-evolution"])
app.include_router(export_router, prefix="/api/v1", tags=["export"])
app.include_router(devils_advocate_router, prefix="/api/v1", tags=["devils-advocate"])
app.include_router(audit_router, prefix="/api/v1", tags=["audit"])
app.include_router(circuit_breaker_router, prefix="/api/v1", tags=["circuit-breaker"])
app.include_router(regression_router, prefix="/api/v1", tags=["regression"])
app.include_router(schedule_router, prefix="/api/v1", tags=["ingestion-schedules"])
app.include_router(quarantine_router, prefix="/api/v1", tags=["feedback-quarantine"])
app.include_router(api_keys_router, prefix="/api/v1", tags=["api-keys"])


# Health check endpoint
@app.get("/health", tags=["health"])
async def health_check():
    """Health check endpoint with infrastructure dependency checks."""
    import os
    from merlt.storage.enrichment import check_db_health

    checks: dict[str, str] = {}

    # PostgreSQL
    checks["postgresql"] = "healthy" if await check_db_health() else "unhealthy"

    # FalkorDB
    try:
        from falkordb import FalkorDB as _FalkorDB
        fdb = _FalkorDB(
            host=os.environ.get("FALKORDB_HOST", "localhost"),
            port=int(os.environ.get("FALKORDB_PORT", "6380")),
        )
        fdb.connection.ping()
        checks["falkordb"] = "healthy"
    except Exception as e:
        log.debug("health_falkordb_failed", error=str(e))
        checks["falkordb"] = "unhealthy"

    # Qdrant
    try:
        from qdrant_client import QdrantClient as _QdrantClient
        qc = _QdrantClient(
            host=os.environ.get("QDRANT_HOST", "localhost"),
            port=int(os.environ.get("QDRANT_PORT", "6333")),
            timeout=3,
        )
        qc.get_collections()
        checks["qdrant"] = "healthy"
    except Exception as e:
        log.debug("health_qdrant_failed", error=str(e))
        checks["qdrant"] = "unhealthy"

    # Redis
    try:
        import redis.asyncio as aioredis
        r = aioredis.Redis(
            host=os.environ.get("REDIS_HOST", "localhost"),
            port=int(os.environ.get("REDIS_PORT", "6379")),
            socket_connect_timeout=3,
        )
        await r.ping()
        await r.aclose()
        checks["redis"] = "healthy"
    except Exception as e:
        log.debug("health_redis_failed", error=str(e))
        checks["redis"] = "unhealthy"

    all_healthy = all(v == "healthy" for v in checks.values())

    return {
        "status": "healthy" if all_healthy else "degraded",
        "version": "1.0.0",
        "dependencies": checks,
    }


# Root endpoint
@app.get("/", tags=["root"])
async def root():
    """Root endpoint with API information."""
    return {
        "name": "MERL-T API",
        "description": "Multi-Expert Reasoning with Legal Texts",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/health",
        "endpoints": {
            "ingestion": "/api/v1/ingestion",
            "feedback": "/api/v1/feedback",
            "auth": "/api/v1/auth",
            "experts": "/api/v1/experts",
            "enrichment": "/api/v1/enrichment",
            "documents": "/api/v1/documents",
            "amendments": "/api/v1/amendments",
            "graph": "/api/v1/graph",
            "pipeline": "/api/v1/pipeline",
            "training": "/api/v1/training",
            "traces": "/api/v1/traces",
            "validity": "/api/v1/validity",
            "citations": "/api/v1/citations",
            "dashboard": "/api/v1/dashboard",
            "profile": "/api/v1/profile",
            "statistics": "/api/v1/statistics",
            "rlcf": "/api/v1/rlcf",
            "expert-metrics": "/api/v1/expert-metrics",
            "policy-evolution": "/api/v1/policy-evolution",
            "export": "/api/v1/export",
            "devils-advocate": "/api/v1/devils-advocate",
            "audit": "/api/v1/audit",
            "circuit-breaker": "/api/v1/circuit-breaker",
            "regression": "/api/v1/regression",
            "ingestion-schedules": "/api/v1/ingestion/schedules",
            "feedback-quarantine": "/api/v1/feedback",
            "api-keys": "/api/v1/api-keys",
        },
    }


# Export for uvicorn
__all__ = ["app"]
