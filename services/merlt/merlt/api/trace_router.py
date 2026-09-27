"""
Trace Management Router
========================

FastAPI router for managing pipeline traces.

Endpoints:
- GET /api/traces/health: Health check
- GET /api/traces: List traces with pagination and filters
- GET /api/traces/{id}: Get single trace with consent filtering
- GET /api/traces/{id}/validity: Temporal validity check for cited sources
- GET /api/traces/{id}/sources: Resolve sources via bridge_table
- DELETE /api/traces/{id}: GDPR-compliant hard delete
- POST /api/traces/archive: Archive old traces

Note: DELETE and POST /archive are admin operations. In production,
these should be protected by authentication middleware.

Usage:
    from merlt.api.trace_router import router as trace_router
    app.include_router(trace_router)
"""

import structlog
from typing import Optional, List, Literal
from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field

from merlt.api.auth import verify_api_key, require_role
from merlt.experts.models import ApiKey
from merlt.storage.trace import TraceStorageService, TraceStorageConfig
from merlt.storage.trace.trace_service import TraceFilter, TraceSummary, SourceResolution
from merlt.storage.bridge import BridgeTable, BridgeTableConfig
from merlt.storage.graph import FalkorDBClient, FalkorDBConfig
from merlt.storage.temporal import TemporalValidityService
from merlt.storage.temporal.validity_service import validate_as_of_date
from merlt.api.models.validity_models import (
    ValidityResultResponse,
    ValiditySummaryResponse,
)

log = structlog.get_logger()

router = APIRouter(prefix="/traces", tags=["traces"])

# Valid consent levels
VALID_CONSENT_LEVELS = {"anonymous", "basic", "full"}


def _validate_consent(value: Optional[str]) -> Optional[str]:
    """Validate consent level; return None if invalid (defaults to most restrictive)."""
    if value is None:
        return None
    if value not in VALID_CONSENT_LEVELS:
        return None  # Invalid → treated as None → service defaults to restrictive
    return value


# ============================================================================
# REQUEST/RESPONSE MODELS
# ============================================================================

class TraceSummaryResponse(BaseModel):
    """Summary of a trace for list responses."""
    trace_id: str
    user_id: str
    query_preview: str
    query_type: Optional[str] = None
    synthesis_mode: Optional[str] = None
    confidence: Optional[float] = None
    execution_time_ms: Optional[int] = None
    created_at: datetime
    is_archived: bool


class TraceListResponse(BaseModel):
    """Paginated list of traces."""
    traces: List[TraceSummaryResponse]
    total: int
    limit: int
    offset: int


class SourceResolutionResponse(BaseModel):
    """Resolved source information."""
    chunk_id: str
    graph_node_urn: str
    node_type: str
    chunk_text: Optional[str] = None
    confidence: Optional[float] = None


class SourcesResponse(BaseModel):
    """List of resolved sources for a trace."""
    trace_id: str
    sources: List[SourceResolutionResponse]


class ArchiveRequest(BaseModel):
    """Request to archive old traces."""
    days: int = Field(90, ge=1, description="Archive traces older than this many days")


class ArchiveResponse(BaseModel):
    """Response from archive operation."""
    archived_count: int
    message: str


class DeleteResponse(BaseModel):
    """Response from delete operation."""
    deleted: bool
    trace_id: str
    message: str




# ============================================================================
# DEPENDENCY INJECTION
# ============================================================================

_trace_service: Optional[TraceStorageService] = None
_bridge_table: Optional[BridgeTable] = None
_graph_db: Optional[FalkorDBClient] = None
_validity_service: Optional[TemporalValidityService] = None


async def get_trace_service() -> TraceStorageService:
    """
    Get TraceStorageService instance.

    Lazily initializes the service if not already connected.
    """
    global _trace_service
    if _trace_service is None:
        _trace_service = TraceStorageService(TraceStorageConfig())
        await _trace_service.connect()
    return _trace_service


async def get_bridge_table() -> BridgeTable:
    """
    Get BridgeTable instance for source resolution.

    Lazily initializes if not already connected.
    """
    global _bridge_table
    if _bridge_table is None:
        _bridge_table = BridgeTable(BridgeTableConfig())
        await _bridge_table.connect()
    return _bridge_table


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


def initialize_trace_services(
    trace_service: TraceStorageService,
    bridge_table: Optional[BridgeTable] = None,
    graph_db: Optional[FalkorDBClient] = None,
    validity_service: Optional[TemporalValidityService] = None
):
    """
    Initialize trace services for FastAPI app.

    Should be called in FastAPI startup event.

    Args:
        trace_service: Pre-configured TraceStorageService
        bridge_table: Pre-configured BridgeTable for source resolution
        graph_db: Pre-configured FalkorDBClient
        validity_service: Pre-configured TemporalValidityService
    """
    global _trace_service, _bridge_table, _graph_db, _validity_service
    _trace_service = trace_service
    _bridge_table = bridge_table
    if graph_db:
        _graph_db = graph_db
    if validity_service:
        _validity_service = validity_service
    log.info("Trace services initialized")


# ============================================================================
# ENDPOINTS
# ============================================================================

# NOTE: /health and /archive MUST be defined BEFORE /{trace_id} to avoid
# FastAPI matching "health" or "archive" as a trace_id path parameter.

@router.get("/health")
async def health_check(
    service: TraceStorageService = Depends(get_trace_service),
    api_key: ApiKey = Depends(verify_api_key),
):
    """
    Health check for trace storage service.

    Returns:
        {"status": "healthy"} if PostgreSQL connection is working
    """
    try:
        healthy = await service.health_check()

        if not healthy:
            raise HTTPException(status_code=503, detail="Trace storage unhealthy")

        return {"status": "healthy"}

    except HTTPException:
        raise
    except Exception as e:
        log.error("Health check failed", error=str(e))
        raise HTTPException(status_code=503, detail="Trace storage health check failed")


@router.post("/archive", response_model=ArchiveResponse)
async def archive_traces(
    request: ArchiveRequest,
    service: TraceStorageService = Depends(get_trace_service),
    api_key: ApiKey = Depends(require_role("admin")),
):
    """
    Archive traces older than specified days.

    Archived traces:
    - Have is_archived=true
    - Have archived_at timestamp set
    - Are excluded from default list queries (is_archived not specified)
    - Can still be accessed directly by trace_id

    Note: This is an admin operation. In production, protect with auth middleware.

    Example:
        POST /api/traces/archive
        {"days": 90}
    """
    log.info("Archiving old traces", days=request.days)

    try:
        count = await service.archive_old_traces(days=request.days)

        return ArchiveResponse(
            archived_count=count,
            message=f"Archived {count} traces older than {request.days} days"
        )

    except Exception as e:
        log.error("Failed to archive traces", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to archive traces")


@router.get("", response_model=TraceListResponse)
async def list_traces(
    user_id: Optional[str] = Query(None, description="Filter by user"),
    query_type: Optional[str] = Query(None, description="Filter by query type"),
    consent_level: Optional[str] = Query(None, description="Filter by consent level"),
    is_archived: Optional[bool] = Query(None, description="Filter by archived status"),
    date_from: Optional[datetime] = Query(None, description="Filter from date"),
    date_to: Optional[datetime] = Query(None, description="Filter to date"),
    limit: int = Query(20, ge=1, le=100, description="Results per page"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    caller_consent: Optional[str] = Query(None, description="Caller's consent level for filtering"),
    service: TraceStorageService = Depends(get_trace_service),
    api_key: ApiKey = Depends(verify_api_key),
):
    """
    List traces with pagination and filtering.

    By default, only non-archived traces are returned. Pass is_archived=true
    to see archived traces, or omit is_archived to see only active ones.

    Consent filtering:
    - caller_consent determines what data is visible
    - Invalid values are treated as most restrictive (anonymous)
    """
    log.info(
        "Listing traces",
        user_id=user_id,
        query_type=query_type,
        limit=limit,
        offset=offset
    )

    # Validate caller consent
    validated_consent = _validate_consent(caller_consent)

    # Default to non-archived when not specified
    effective_is_archived = is_archived if is_archived is not None else False

    filters = TraceFilter(
        user_id=user_id,
        query_type=query_type,
        consent_level=consent_level,
        is_archived=effective_is_archived,
        date_from=date_from,
        date_to=date_to
    )

    try:
        traces = await service.list_traces(
            filters=filters,
            limit=limit,
            offset=offset,
            consent_level=validated_consent
        )

        total = await service.count_traces(filters=filters)

        return TraceListResponse(
            traces=[
                TraceSummaryResponse(
                    trace_id=t.trace_id,
                    user_id=t.user_id,
                    query_preview=t.query_preview,
                    query_type=t.query_type,
                    synthesis_mode=t.synthesis_mode,
                    confidence=t.confidence,
                    execution_time_ms=t.execution_time_ms,
                    created_at=t.created_at,
                    is_archived=t.is_archived
                )
                for t in traces
            ],
            total=total,
            limit=limit,
            offset=offset
        )

    except Exception as e:
        log.error("Failed to list traces", error=str(e))
        raise HTTPException(status_code=500, detail="Failed to list traces")


@router.get("/{trace_id}")
async def get_trace(
    trace_id: str,
    caller_consent: Optional[str] = Query(None, description="Caller's consent level"),
    service: TraceStorageService = Depends(get_trace_service),
    api_key: ApiKey = Depends(verify_api_key),
):
    """
    Get a single trace by ID with consent filtering.

    The most restrictive of (stored consent_level, caller_consent) is applied:
    - anonymous: user_id and query are redacted
    - basic: query is redacted
    - full: no redaction

    Invalid caller_consent values default to most restrictive (anonymous).
    """
    log.info("Getting trace", trace_id=trace_id)

    validated_consent = _validate_consent(caller_consent)

    try:
        trace = await service.get_trace(trace_id, consent_level=validated_consent)

        if not trace:
            raise HTTPException(status_code=404, detail=f"Trace {trace_id} not found")

        return trace

    except HTTPException:
        raise
    except Exception as e:
        log.error("Failed to get trace", error=str(e), trace_id=trace_id)
        raise HTTPException(status_code=500, detail="Failed to get trace")


@router.get("/{trace_id}/validity", response_model=ValiditySummaryResponse)
async def get_trace_validity(
    trace_id: str,
    as_of_date: Optional[str] = Query(None, description="Data per verifica relativa (ISO YYYY-MM-DD)"),
    caller_consent: Optional[str] = Query(None, description="Caller's consent level"),
    service: TraceStorageService = Depends(get_trace_service),
    validity: TemporalValidityService = Depends(get_validity_service),
    api_key: ApiKey = Depends(verify_api_key),
):
    """
    Verifica la vigenza temporale delle fonti citate in un trace.

    Per ogni norma citata nelle sources del trace, verifica se è ancora
    in vigore consultando il grafo FalkorDB. Rileva modifiche, abrogazioni
    e sostituzioni, generando warning strutturati.

    Il check è a render-time (non stored) con cache in-memory TTL 24h.

    Args:
        trace_id: ID del trace da verificare
        as_of_date: Data opzionale per verifica relativa
        caller_consent: Livello consent del chiamante
    """
    log.info("Checking trace validity", trace_id=trace_id)

    # Validate as_of_date format
    try:
        validated_date = validate_as_of_date(as_of_date)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    validated_consent = _validate_consent(caller_consent)

    try:
        summary = await validity.check_trace_validity(
            trace_id=trace_id,
            trace_service=service,
            as_of_date=validated_date,
            consent_level=validated_consent
        )

        return ValiditySummaryResponse(
            trace_id=summary.trace_id,
            as_of_date=summary.as_of_date,
            total_sources=summary.total_sources,
            valid_count=summary.valid_count,
            warning_count=summary.warning_count,
            critical_count=summary.critical_count,
            unknown_count=summary.unknown_count,
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
                for r in summary.results
            ],
            summary_message=summary.summary_message,
        )

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        log.error("trace_validity_check_failed", error=str(e), trace_id=trace_id)
        raise HTTPException(status_code=500, detail="Validity check failed")


@router.get("/{trace_id}/sources", response_model=SourcesResponse)
async def get_trace_sources(
    trace_id: str,
    service: TraceStorageService = Depends(get_trace_service),
    bridge: BridgeTable = Depends(get_bridge_table),
    api_key: ApiKey = Depends(verify_api_key),
):
    """
    Resolve chunk_ids from trace sources to graph URNs via bridge_table.

    For each source in the trace, looks up the corresponding graph node
    in bridge_table to get the URN, node_type, and text excerpt.
    """
    log.info("Resolving trace sources", trace_id=trace_id)

    try:
        resolutions = await service.get_trace_sources(trace_id, bridge)

        return SourcesResponse(
            trace_id=trace_id,
            sources=[
                SourceResolutionResponse(
                    chunk_id=r.chunk_id,
                    graph_node_urn=r.graph_node_urn,
                    node_type=r.node_type,
                    chunk_text=r.chunk_text,
                    confidence=r.confidence
                )
                for r in resolutions
            ]
        )

    except Exception as e:
        log.error("Failed to resolve sources", error=str(e), trace_id=trace_id)
        raise HTTPException(status_code=500, detail="Failed to resolve sources")


@router.post("/{trace_id}/reproduce")
async def reproduce_trace(
    trace_id: str,
    service: TraceStorageService = Depends(get_trace_service),
    api_key: ApiKey = Depends(verify_api_key),
):
    """
    Reproduce a historical query with pinned config and diff results.

    Re-runs the orchestrator with the original query and selected experts,
    then computes a reproducibility score based on expert overlap,
    confidence delta, and source Jaccard similarity.

    Returns diff, reproducibility_score, and caveats.
    """
    log.info("Reproducing trace", trace_id=trace_id)

    try:
        from merlt.rlcf.reproducibility_service import ReproducibilityService
        from merlt.rlcf.database import get_async_session

        repro_svc = ReproducibilityService()

        async with get_async_session() as session:
            result = await repro_svc.reproduce_query(session, trace_id)

        return result.to_dict()

    except Exception as e:
        log.error("Failed to reproduce trace", error=str(e), trace_id=trace_id)
        raise HTTPException(status_code=500, detail=f"Reproduction failed: {str(e)}")


@router.delete("/{trace_id}", response_model=DeleteResponse)
async def delete_trace(
    trace_id: str,
    service: TraceStorageService = Depends(get_trace_service),
    api_key: ApiKey = Depends(require_role("admin")),
):
    """
    Hard delete a trace and all associated feedback (GDPR compliance).

    This is permanent and irreversible. Cascades to delete all feedback.

    Note: This is an admin/GDPR operation. In production, protect with
    auth middleware and implement audit logging.
    """
    log.info("Deleting trace (GDPR)", trace_id=trace_id)

    try:
        deleted = await service.delete_trace(trace_id)

        if not deleted:
            raise HTTPException(status_code=404, detail=f"Trace {trace_id} not found")

        return DeleteResponse(
            deleted=True,
            trace_id=trace_id,
            message="Trace deleted successfully"
        )

    except HTTPException:
        raise
    except Exception as e:
        log.error("Failed to delete trace", error=str(e), trace_id=trace_id)
        raise HTTPException(status_code=500, detail="Failed to delete trace")
