"""
VisuaLex Bridge API
===================

FastAPI application che espone tutti gli endpoint per l'integrazione con VisuaLex.

Questo modulo crea l'applicazione FastAPI principale che include:
- Feedback API (tracking interazioni, feedback esplicito)
- Auth API (sincronizzazione authority)
- Track API (endpoint semplificato per tracking rapido)

Usage:
    # Start server
    uvicorn merlt.api.visualex_bridge:app --host 0.0.0.0 --port 8000

    # O con reload per sviluppo
    uvicorn merlt.api.visualex_bridge:app --reload --port 8000
"""

# Load environment variables FIRST (before any other imports)
from dotenv import load_dotenv
load_dotenv()

import os
import structlog
from typing import Dict, Any, Optional
from datetime import datetime, timezone
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from merlt.api import feedback_router, auth_router, ingestion_router, experts_router
from merlt.api.enrichment_router import router as enrichment_router
from merlt.api.profile_router import router as profile_router
from merlt.api.graph_router import router as graph_router
from merlt.api.pipeline_router import router as pipeline_router

# Academic Dashboard routers
from merlt.api.dashboard_router import router as dashboard_router
from merlt.api.statistics_router import router as statistics_router
from merlt.api.rlcf_router import router as rlcf_router
from merlt.api.expert_metrics_router import router as expert_metrics_router

log = structlog.get_logger()

# Force reload timestamp: 2025-12-30T22:26


# =============================================================================
# LIFESPAN
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle management per l'applicazione."""
    log.info("VisuaLex Bridge API starting...")

    # Initialize Enrichment Database
    try:
        from merlt.storage.enrichment.database import init_db
        await init_db()
        log.info("✅ Enrichment database initialized successfully")
    except Exception as e:
        log.error(f"Failed to initialize enrichment database: {e}", exc_info=True)
        log.warning("Profile endpoints may return 500 errors")

    # Initialize Expert System
    try:
        from merlt.rlcf.ai_service import OpenRouterService
        from merlt.experts.synthesizer import AdaptiveSynthesizer, SynthesisConfig
        from merlt.experts.orchestrator import MultiExpertOrchestrator, OrchestratorConfig
        from merlt.api.experts_router import initialize_expert_system

        log.info("Initializing MultiExpertOrchestrator...")

        # Create AI service
        ai_service = OpenRouterService()

        # Create synthesizer
        synthesis_config = SynthesisConfig(
            convergent_threshold=0.5,
            resolvability_weight=0.3,
            include_disagreement_explanation=True,
            max_alternatives=3,
        )
        synthesizer = AdaptiveSynthesizer(
            config=synthesis_config,
            ai_service=ai_service,
        )

        # Create orchestrator
        orchestrator_config = OrchestratorConfig(
            max_experts=4,
            timeout_seconds=60,
            parallel_execution=True,
        )
        orchestrator = MultiExpertOrchestrator(
            synthesizer=synthesizer,
            tools=[],  # No tools needed for basic Q&A
            ai_service=ai_service,
            config=orchestrator_config,
        )

        # Initialize global orchestrator in experts_router
        initialize_expert_system(orchestrator)
        log.info("✅ MultiExpertOrchestrator initialized successfully")

    except Exception as e:
        log.error(f"Failed to initialize Expert System: {e}", exc_info=True)
        log.warning("Expert System endpoints will return 503 errors")

    yield
    log.info("VisuaLex Bridge API shutting down...")


# =============================================================================
# APP CONFIGURATION
# =============================================================================

app = FastAPI(
    title="MERL-T VisuaLex Bridge API",
    description="""
API di integrazione tra VisuaLex e MERL-T per RLCF feedback loop.

## Endpoints principali

### Tracking (implicit feedback)
- `POST /api/track` - Traccia interazione singola (endpoint semplificato)
- `POST /api/feedback/interaction` - Traccia interazione con response dettagliata
- `POST /api/feedback/batch` - Traccia batch di interazioni

### Feedback (explicit)
- `POST /api/feedback/explicit` - Invia feedback esplicito (thumbs, stars)
- `POST /api/feedback/session` - Finalizza sessione con feedback combinato

### Authority
- `POST /api/auth/sync` - Sincronizza credenziali utente
- `GET /api/auth/authority/{user_id}` - Recupera authority score
- `POST /api/auth/delta` - Applica delta authority per singola azione

### Enrichment (validazione granulare)
- `POST /api/enrichment/live` - Live enrichment articolo
- `POST /api/enrichment/validate-entity` - Valida singola entita'
- `POST /api/enrichment/validate-relation` - Valida singola relazione
- `POST /api/enrichment/propose-entity` - Proponi nuova entita'
- `POST /api/enrichment/propose-relation` - Proponi nuova relazione
- `POST /api/enrichment/pending` - Lista pending per validazione

### Profile (RLCF authority & user data)
- `GET /api/v1/profile/full` - Profilo completo con authority
- `GET /api/v1/profile/authority/domains` - Authority per dominio
- `GET /api/v1/profile/stats/detailed` - Statistiche contributi
- `PATCH /api/v1/profile/qualification` - Aggiorna qualifiche
- `PATCH /api/v1/profile/notifications` - Aggiorna notifiche

### Expert System (Multi-Expert Q&A)
- `POST /api/experts/query` - Submit query to MultiExpertOrchestrator
- `POST /api/experts/feedback/inline` - Quick thumbs up/down feedback
- `POST /api/experts/feedback/detailed` - 3-dimension feedback (retrieval, reasoning, synthesis)
- `POST /api/experts/feedback/source` - Per-source rating (1-5 stars)
- `POST /api/experts/feedback/refine` - Conversational refinement with follow-up

## Autenticazione

L'autenticazione viene gestita da VisuaLex. Gli endpoint accettano
`user_id` e `user_authority` nei payload.

## Rate Limiting

- 100 requests/minuto per endpoint di tracking
- 10 requests/minuto per endpoint di sync authority

## Versioning

Questa è la v1 dell'API. I path sono prefissati con `/api`.
    """,
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)


# =============================================================================
# CORS MIDDLEWARE
# =============================================================================

_bridge_cors_origins = os.environ.get(
    "CORS_ORIGINS",
    "http://localhost:5175,http://localhost:5176,http://localhost:3101,http://localhost:5100,https://visualex.it,https://api.visualex.it"
).split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _bridge_cors_origins],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =============================================================================
# ROUTERS
# =============================================================================

# Include existing routers
# NOTE: Vite proxy rewrites /api/merlt/* to /api/v1/* so all routers need /api/v1 prefix
app.include_router(feedback_router, prefix="/api/v1")
app.include_router(auth_router, prefix="/api/v1")
app.include_router(ingestion_router, prefix="/api/v1")
app.include_router(enrichment_router, prefix="/api/v1")
app.include_router(profile_router, prefix="/api/v1")
app.include_router(graph_router, prefix="/api/v1")  # graph_router has internal prefix="/graph"
app.include_router(experts_router, prefix="/api/v1")  # experts_router has internal prefix="/experts"
app.include_router(pipeline_router, prefix="/api/v1")  # pipeline_router has internal prefix="/pipeline"

# Academic Dashboard routers
app.include_router(dashboard_router, prefix="/api/v1")  # dashboard_router has internal prefix="/dashboard"
app.include_router(statistics_router, prefix="/api/v1")  # statistics_router has internal prefix="/statistics"
app.include_router(rlcf_router, prefix="/api/v1")  # rlcf_router has internal prefix="/rlcf"
app.include_router(expert_metrics_router, prefix="/api/v1")  # expert_metrics_router has internal prefix="/expert-metrics"


# =============================================================================
# SIMPLIFIED TRACK ENDPOINT
# =============================================================================

class SimpleTrackRequest(BaseModel):
    """Request semplificata per tracking rapido."""
    user_id: str = Field(..., description="UUID dell'utente")
    interaction_type: str = Field(
        ...,
        description="Tipo di interazione",
        examples=[
            "bookmark_add", "highlight_create", "cross_ref_click",
            "search_result_click", "doctrine_read", "dossier_add",
        ],
    )
    article_urn: Optional[str] = Field(None, description="URN articolo")
    metadata: Dict[str, Any] = Field(default_factory=dict)
    timestamp: Optional[str] = Field(None, description="Timestamp ISO")


class SimpleTrackResponse(BaseModel):
    """Response per tracking rapido."""
    success: bool
    message: str = "Interaction tracked"


@app.post(
    "/api/track",
    response_model=SimpleTrackResponse,
    summary="Track interazione (endpoint semplificato)",
    description="""
Endpoint semplificato per tracking rapido di interazioni.

Per tracking con response dettagliata, usa `/api/feedback/interaction`.

**Tipi di interazione supportati:**
- `bookmark_add` - Utente salva articolo
- `highlight_create` - Utente evidenzia testo
- `cross_ref_click` - Utente clicca riferimento
- `search_result_click` - Utente clicca risultato ricerca
- `first_result_click` - Utente apre primo risultato
- `skip_results` - Utente salta primi risultati
- `doctrine_read` - Utente legge dottrina (>30s)
- `quicknorm_save` - Utente salva in QuickNorm
- `dossier_add` - Utente aggiunge a dossier
- `long_read` - Utente legge a lungo (>30s)
- `quick_close` - Utente chiude subito (<5s)
- `search_after_ai` - Utente cerca dopo risposta AI
    """,
    tags=["tracking"],
)
async def simple_track(request: SimpleTrackRequest) -> SimpleTrackResponse:
    """Track interazione con endpoint semplificato."""
    log.info(
        "API: simple_track",
        user_id=request.user_id,
        type=request.interaction_type,
    )

    # TODO: In produzione, salvare in database/Redis
    # Per ora solo logging

    return SimpleTrackResponse(success=True)


# =============================================================================
# HEALTH & STATUS
# =============================================================================

@app.get(
    "/health",
    summary="Health check",
    tags=["system"],
)
async def health() -> Dict[str, Any]:
    """Health check endpoint."""
    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "service": "merl-t-visualex-bridge",
        "version": "1.0.0",
    }


@app.get(
    "/api/status",
    summary="Status dettagliato",
    tags=["system"],
)
async def status() -> Dict[str, Any]:
    """Status dettagliato del servizio."""
    return {
        "status": "running",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "endpoints": {
            "feedback": {
                "interaction": "/api/feedback/interaction",
                "batch": "/api/feedback/batch",
                "explicit": "/api/feedback/explicit",
                "session": "/api/feedback/session",
                "mappings": "/api/feedback/mappings",
            },
            "auth": {
                "sync": "/api/auth/sync",
                "authority": "/api/auth/authority/{user_id}",
                "delta": "/api/auth/delta",
                "estimate": "/api/auth/estimate",
                "qualifications": "/api/auth/qualifications",
            },
            "tracking": {
                "simple": "/api/track",
            },
            "enrichment": {
                "live": "/api/enrichment/live",
                "validate_entity": "/api/enrichment/validate-entity",
                "validate_relation": "/api/enrichment/validate-relation",
                "propose_entity": "/api/enrichment/propose-entity",
                "propose_relation": "/api/enrichment/propose-relation",
                "pending": "/api/enrichment/pending",
            },
            "profile": {
                "full": "/api/v1/profile/full",
                "domain_authority": "/api/v1/profile/authority/domains",
                "stats": "/api/v1/profile/stats/detailed",
                "update_qualification": "/api/v1/profile/qualification",
                "update_notifications": "/api/v1/profile/notifications",
            },
            "experts": {
                "query": "/api/experts/query",
                "feedback_inline": "/api/experts/feedback/inline",
                "feedback_detailed": "/api/experts/feedback/detailed",
                "feedback_source": "/api/experts/feedback/source",
                "feedback_refine": "/api/experts/feedback/refine",
            },
            "pipeline": {
                "runs": "/api/v1/pipeline/runs",
                "run_detail": "/api/v1/pipeline/run/{run_id}",
                "run_errors": "/api/v1/pipeline/run/{run_id}/errors",
                "retry": "/api/v1/pipeline/run/{run_id}/retry",
                "websocket": "/api/v1/pipeline/ws/{run_id}",
            },
            "dashboard": {
                "overview": "/api/v1/dashboard/overview",
                "health": "/api/v1/dashboard/health",
                "architecture": "/api/v1/dashboard/architecture",
                "activity": "/api/v1/dashboard/activity",
            },
            "statistics": {
                "overview": "/api/v1/statistics/overview",
                "hypothesis_tests": "/api/v1/statistics/hypothesis-tests",
                "distributions": "/api/v1/statistics/distributions",
                "correlations": "/api/v1/statistics/correlations",
                "export": "/api/v1/statistics/export",
            },
            "rlcf": {
                "training_status": "/api/v1/rlcf/training/status",
                "training_start": "/api/v1/rlcf/training/start",
                "training_stop": "/api/v1/rlcf/training/stop",
                "buffer_status": "/api/v1/rlcf/buffer/status",
                "policy_weights": "/api/v1/rlcf/policies/weights",
                "websocket": "/api/v1/rlcf/training/stream",
            },
            "expert_metrics": {
                "performance": "/api/v1/expert-metrics/performance",
                "query_stats": "/api/v1/expert-metrics/queries/stats",
                "recent_queries": "/api/v1/expert-metrics/queries/recent",
                "trace": "/api/v1/expert-metrics/trace/{trace_id}",
                "aggregation": "/api/v1/expert-metrics/aggregation",
            },
        },
        "documentation": {
            "swagger": "/docs",
            "redoc": "/redoc",
        },
    }


# =============================================================================
# STARTUP MESSAGE
# =============================================================================

@app.on_event("startup")
async def startup_message():
    """Log startup message."""
    log.info("""
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║  MERL-T VisuaLex Bridge API                              ║
║                                                           ║
║  Status: Running                                          ║
║  Version: 1.3.0                                           ║
║                                                           ║
║  Endpoints:                                               ║
║  - Health: /health                                        ║
║  - Status: /api/status                                    ║
║  - Track: /api/track                                      ║
║  - Feedback: /api/feedback/*                              ║
║  - Auth: /api/auth/*                                      ║
║  - Enrichment: /api/enrichment/*                          ║
║  - Profile: /api/v1/profile/*                             ║
║  - Experts: /api/experts/*                                ║
║  - Pipeline: /api/v1/pipeline/* (NEW!)                    ║
║                                                           ║
║  Documentation:                                           ║
║  - Swagger: /docs                                         ║
║  - ReDoc: /redoc                                          ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
    """)


# =============================================================================
# EXPORTS
# =============================================================================

__all__ = [
    "app",
    "SimpleTrackRequest",
    "SimpleTrackResponse",
]
