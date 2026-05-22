"""
Temporal Validity Router
=========================

FastAPI router per verifiche di vigenza temporale delle norme.

Endpoints:
- GET /api/validity/check: Verifica vigenza singola/batch URN
- GET /api/validity/health: Health check FalkorDB

Usage:
    from merlt.api.validity_router import router as validity_router
    app.include_router(validity_router)
"""

import structlog
from typing import Optional
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Depends, Query

from merlt.api.auth import verify_api_key
from merlt.experts.models import ApiKey
from merlt.storage.graph import FalkorDBClient, FalkorDBConfig
from merlt.storage.temporal import TemporalValidityService
from merlt.storage.temporal.validity_service import validate_as_of_date
from merlt.api.models.validity_models import (
    ValidityResultResponse,
    ValiditySummaryBrief,
    ValidityCheckResponse,
)

log = structlog.get_logger()

router = APIRouter(prefix="/validity", tags=["validity"])


# ============================================================================
# DEPENDENCY INJECTION
# ============================================================================

_graph_db: Optional[FalkorDBClient] = None
_validity_service: Optional[TemporalValidityService] = None


async def get_graph_db() -> FalkorDBClient:
    """Get FalkorDBClient instance (lazy init)."""
    global _graph_db
    if _graph_db is None:
        _graph_db = FalkorDBClient(FalkorDBConfig())
        await _graph_db.connect()
    return _graph_db


async def get_validity_service() -> TemporalValidityService:
    """Get TemporalValidityService instance (lazy init)."""
    global _validity_service
    if _validity_service is None:
        graph = await get_graph_db()
        _validity_service = TemporalValidityService(graph_db=graph)
    return _validity_service


def initialize_validity_services(
    graph_db: Optional[FalkorDBClient] = None,
    validity_service: Optional[TemporalValidityService] = None
):
    """
    Initialize validity services for FastAPI app.

    Should be called in FastAPI startup event.

    Args:
        graph_db: Pre-configured FalkorDBClient
        validity_service: Pre-configured TemporalValidityService
    """
    global _graph_db, _validity_service
    if graph_db:
        _graph_db = graph_db
    if validity_service:
        _validity_service = validity_service
    log.info("Validity services initialized")


# ============================================================================
# ENDPOINTS
# ============================================================================

@router.get("/health")
async def health_check(
    graph: FalkorDBClient = Depends(get_graph_db),
    api_key: ApiKey = Depends(verify_api_key),
):
    """
    Health check per FalkorDB.

    Returns:
        {"status": "healthy"} se FalkorDB è raggiungibile
    """
    try:
        healthy = await graph.health_check()
        if not healthy:
            raise HTTPException(status_code=503, detail="FalkorDB unhealthy")
        return {"status": "healthy"}
    except HTTPException:
        raise
    except Exception as e:
        log.error("validity_health_check_failed", error=str(e))
        raise HTTPException(status_code=503, detail="FalkorDB health check failed")


@router.get("/check", response_model=ValidityCheckResponse)
async def check_validity(
    urns: str = Query(
        ...,
        description="URN da verificare (comma-separated per batch)"
    ),
    as_of_date: Optional[str] = Query(
        None,
        description="Data per verifica relativa (ISO format YYYY-MM-DD)"
    ),
    service: TemporalValidityService = Depends(get_validity_service),
    api_key: ApiKey = Depends(verify_api_key),
):
    """
    Verifica la vigenza di una o più norme.

    Accetta URN singola o lista comma-separated.

    Example:
        GET /api/validity/check?urns=urn:nir:stato:codice.penale:1930;art52
        GET /api/validity/check?urns=urn:a,urn:b&as_of_date=2024-01-01
    """
    # Validate as_of_date format
    try:
        validated_date = validate_as_of_date(as_of_date)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Parse URNs (comma-separated)
    urn_list = [u.strip() for u in urns.split(",") if u.strip()]

    if not urn_list:
        raise HTTPException(status_code=400, detail="No valid URNs provided")

    if len(urn_list) > 50:
        raise HTTPException(status_code=400, detail="Maximum 50 URNs per request")

    try:
        results = await service.check_batch_validity(urn_list, validated_date)

        valid_count = sum(1 for r in results if r.warning_level == "none")
        warning_count = sum(1 for r in results if r.warning_level == "warning")
        critical_count = sum(1 for r in results if r.warning_level == "critical")
        unknown_count = sum(1 for r in results if r.warning_level == "info")

        summary_msg = service.build_summary_message(
            valid_count, warning_count, critical_count, unknown_count
        )

        return ValidityCheckResponse(
            results=[
                ValidityResultResponse(
                    urn=r.urn,
                    status=r.status,
                    is_valid=r.is_valid,
                    warning_level=r.warning_level,
                    warning_message=r.warning_message,
                    last_modified=r.last_modified,
                    modification_count=r.modification_count,
                    abrogating_norm=r.abrogating_norm,
                    replacing_norm=r.replacing_norm,
                    recent_modifications=r.recent_modifications,
                    checked_at=r.checked_at,
                )
                for r in results
            ],
            summary=ValiditySummaryBrief(
                total=len(results),
                valid=valid_count,
                warnings=warning_count,
                critical=critical_count,
                unknown=unknown_count,
                message=summary_msg,
            ),
            as_of_date=validated_date,
            checked_at=datetime.now(timezone.utc).isoformat(),
        )

    except Exception as e:
        log.error("validity_check_failed", error=str(e), urns=urn_list)
        raise HTTPException(status_code=500, detail="Validity check failed")
