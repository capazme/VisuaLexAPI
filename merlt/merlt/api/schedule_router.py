"""
Ingestion Schedule Router
==========================

REST API per gestione schedule di ingestion automatica.

Endpoints:
- GET /ingestion/schedules — lista schedule attivi
- POST /ingestion/schedules — crea nuovo schedule
- PUT /ingestion/schedules/{schedule_id} — modifica schedule
- DELETE /ingestion/schedules/{schedule_id} — elimina schedule
- POST /ingestion/schedules/{schedule_id}/toggle — pausa/riprendi
"""

from typing import Any, Dict, List, Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from merlt.api.auth import verify_api_key, require_role
from merlt.experts.models import ApiKey
from merlt.rlcf.database import get_async_session

log = structlog.get_logger()

router = APIRouter(prefix="/ingestion", tags=["ingestion-schedules"])

# Lazy singleton for IngestionScheduler
_scheduler = None


def _get_scheduler():
    global _scheduler
    if _scheduler is None:
        from merlt.services.ingestion_scheduler import IngestionScheduler
        _scheduler = IngestionScheduler()
    return _scheduler


# =============================================================================
# MODELS
# =============================================================================


class ScheduleCreateRequest(BaseModel):
    tipo_atto: str = Field(..., min_length=1, max_length=100)
    cron_expr: str = Field(..., min_length=1, max_length=100)
    enabled: bool = True
    description: Optional[str] = None


class ScheduleUpdateRequest(BaseModel):
    tipo_atto: Optional[str] = Field(None, min_length=1, max_length=100)
    cron_expr: Optional[str] = Field(None, min_length=1, max_length=100)
    enabled: Optional[bool] = None
    description: Optional[str] = None


class ScheduleResponse(BaseModel):
    id: int
    tipo_atto: str
    cron_expr: str
    enabled: bool
    description: Optional[str] = None
    last_run_at: Optional[str] = None
    last_run_status: Optional[str] = None
    next_run_at: Optional[str] = None
    created_at: Optional[str] = None


class ScheduleListResponse(BaseModel):
    schedules: List[ScheduleResponse] = Field(default_factory=list)
    count: int = 0


# =============================================================================
# ENDPOINTS
# =============================================================================


@router.get("/schedules", response_model=ScheduleListResponse)
async def list_schedules(
    api_key: ApiKey = Depends(verify_api_key),
) -> ScheduleListResponse:
    """Lista tutti gli schedule di ingestion."""
    scheduler = _get_scheduler()
    async with get_async_session() as session:
        schedules = await scheduler.list_schedules(session)
    return ScheduleListResponse(
        schedules=[ScheduleResponse(**s) for s in schedules],
        count=len(schedules),
    )


@router.post("/schedules", response_model=ScheduleResponse)
async def create_schedule(
    request: ScheduleCreateRequest,
    api_key: ApiKey = Depends(require_role("admin")),
) -> ScheduleResponse:
    """Crea un nuovo schedule di ingestion."""
    scheduler = _get_scheduler()
    async with get_async_session() as session:
        result = await scheduler.add_schedule(
            session,
            tipo_atto=request.tipo_atto,
            cron_expr=request.cron_expr,
            enabled=request.enabled,
            description=request.description,
        )
    return ScheduleResponse(**result)


@router.put("/schedules/{schedule_id}", response_model=ScheduleResponse)
async def update_schedule(
    schedule_id: int,
    request: ScheduleUpdateRequest,
    api_key: ApiKey = Depends(require_role("admin")),
) -> ScheduleResponse:
    """Modifica uno schedule esistente."""
    scheduler = _get_scheduler()
    update_data = request.model_dump(exclude_none=True)
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    async with get_async_session() as session:
        result = await scheduler.update_schedule(session, schedule_id, **update_data)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Schedule {schedule_id} not found")
    return ScheduleResponse(**result)


@router.delete("/schedules/{schedule_id}")
async def delete_schedule(
    schedule_id: int,
    api_key: ApiKey = Depends(require_role("admin")),
) -> Dict[str, Any]:
    """Elimina uno schedule."""
    scheduler = _get_scheduler()
    async with get_async_session() as session:
        removed = await scheduler.remove_schedule(session, schedule_id)
    if not removed:
        raise HTTPException(status_code=404, detail=f"Schedule {schedule_id} not found")
    return {"message": "Schedule deleted", "schedule_id": schedule_id}


@router.post("/schedules/{schedule_id}/toggle", response_model=ScheduleResponse)
async def toggle_schedule(
    schedule_id: int,
    api_key: ApiKey = Depends(require_role("admin")),
) -> ScheduleResponse:
    """Pausa/riprendi uno schedule."""
    scheduler = _get_scheduler()
    async with get_async_session() as session:
        result = await scheduler.toggle_schedule(session, schedule_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Schedule {schedule_id} not found")
    return ScheduleResponse(**result)
