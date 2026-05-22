"""
MERL-T API Module
=================

FastAPI routers per integrazioni esterne.

Routers:
- ingestion_api: Ingestion da fonti esterne (VisuaLex)
- feedback_api: Ricezione feedback RLCF
- auth_api: Sincronizzazione authority utente
- experts_router: Query multi-expert system
- enrichment_router: Live enrichment con validazione community
- document_router: Upload e parsing documenti utente
- amendments_router: Submission e gestione amendments (multivigenza)
- graph_router: API per visualizzazione Knowledge Graph
- pipeline_router: Monitoring pipeline ingestion/enrichment
- citation_router: Citation export in multiple formats

Esempio:
    >>> from fastapi import FastAPI
    >>> from merlt.api import (
    ...     ingestion_router,
    ...     feedback_router,
    ...     auth_router,
    ...     enrichment_router,
    ...     document_router,
    ...     amendments_router,
    ...     graph_router,
    ...     pipeline_router,
    ...     citation_router,
    ... )
    >>>
    >>> app = FastAPI(title="MERL-T API")
    >>> app.include_router(ingestion_router, prefix="/api/v1")
    >>> app.include_router(feedback_router, prefix="/api/v1")
    >>> app.include_router(auth_router, prefix="/api/v1")
    >>> app.include_router(enrichment_router, prefix="/api/v1")
    >>> app.include_router(document_router, prefix="/api/v1")
    >>> app.include_router(amendments_router, prefix="/api/v1")
    >>> app.include_router(graph_router, prefix="/api/v1")
    >>> app.include_router(pipeline_router, prefix="/api/v1")
"""

from merlt.api.ingestion_api import router as ingestion_router
from merlt.api.feedback_api import router as feedback_router
from merlt.api.auth_api import router as auth_router
from merlt.api.experts_router import router as experts_router
from merlt.api.enrichment_router import router as enrichment_router
from merlt.api.document_router import router as document_router, amendments_router
from merlt.api.graph_router import router as graph_router
from merlt.api.pipeline_router import router as pipeline_router
from merlt.api.training_router import router as training_router
from merlt.api.validity_router import router as validity_router
from merlt.api.citation_router import router as citation_router
from merlt.api.trace_router import router as trace_router
from merlt.api.dashboard_router import router as dashboard_router
from merlt.api.profile_router import router as profile_router
from merlt.api.statistics_router import router as statistics_router
from merlt.api.rlcf_router import router as rlcf_router
from merlt.api.expert_metrics_router import router as expert_metrics_router
from merlt.api.ws_router import router as ws_router
from merlt.api.tracking_router import router as tracking_router
from merlt.api.policy_evolution_router import router as policy_evolution_router
from merlt.api.export_router import router as export_router
from merlt.api.devils_advocate_router import router as devils_advocate_router
from merlt.api.audit_router import router as audit_router
from merlt.api.circuit_breaker_router import router as circuit_breaker_router
from merlt.api.regression_router import router as regression_router
from merlt.api.schedule_router import router as schedule_router
from merlt.api.quarantine_router import router as quarantine_router
from merlt.api.api_keys_router import router as api_keys_router

__all__ = [
    "ingestion_router",
    "feedback_router",
    "auth_router",
    "experts_router",
    "enrichment_router",
    "document_router",
    "amendments_router",
    "graph_router",
    "pipeline_router",
    "training_router",
    "validity_router",
    "citation_router",
    "trace_router",
    "dashboard_router",
    "profile_router",
    "statistics_router",
    "rlcf_router",
    "expert_metrics_router",
    "ws_router",
    "tracking_router",
    "policy_evolution_router",
    "export_router",
    "devils_advocate_router",
    "audit_router",
    "circuit_breaker_router",
    "regression_router",
    "schedule_router",
    "quarantine_router",
    "api_keys_router",
]
