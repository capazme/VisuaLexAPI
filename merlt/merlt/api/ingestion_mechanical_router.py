"""
Mechanical Ingestion Governance Router
=======================================

Admin-gated batch staging + review + promotion for deterministic (zero-LLM)
graph facts (Norma nodes, hierarchy, RINVIA cross-references) — see
docs/merlt/slices/ingestion-governance/design.md.

The graph is never touched before an admin explicitly promotes a batch:
`POST /run` only parses + computes a read-only conflict report and stages the
result in `MerltIngestionBatch` (status=pending_review). `POST
/batches/{id}/promote` is the only endpoint that writes to FalkorDB, and only
after enqueueing the promote job — it blocks with 409 on unresolved
`urn_conflicts` unless `force=true`.

Endpoints:
    POST /ingestion/mechanical/run                    - enqueue parse+stage
    GET  /ingestion/mechanical/batches                 - list (no blobs)
    GET  /ingestion/mechanical/batches/{id}             - detail (+ paginated sample)
    POST /ingestion/mechanical/batches/{id}/promote     - enqueue promote (409 on conflicts)
    POST /ingestion/mechanical/batches/{id}/reject      - reject (synchronous)
"""

import os
import asyncio
from datetime import datetime
from typing import Any, Dict, List, Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from merlt.api.auth import require_role
from merlt.experts.models import ApiKey
from merlt.storage.enrichment.database import get_db_session_dependency
from merlt.storage.enrichment.models import MerltIngestionBatch

log = structlog.get_logger()

router = APIRouter(prefix="/ingestion/mechanical", tags=["ingestion-mechanical"])

# Reuses the ingest queue name already listened to by the worker (no new
# queue -> no docker-compose change, per CLAUDE.md convention for this slice).
_QUEUE_NAME = "merlt_ingest"
_rq_connection = None


def _get_queue():
    from redis import Redis
    from rq import Queue

    global _rq_connection
    if _rq_connection is None:
        _rq_connection = Redis.from_url(os.getenv("RQ_REDIS_URL", "redis://localhost:6379/1"))
    return Queue(_QUEUE_NAME, connection=_rq_connection)


class RunIngestionRequest(BaseModel):
    source: str = Field(..., pattern="^(visualex_tree|italia_corpus)$")
    source_ref: str = Field(..., min_length=1)
    scope_label: str = Field(..., min_length=1, max_length=300)
    created_by: Optional[str] = Field(None, max_length=100)


class RunIngestionResponse(BaseModel):
    batch_id: str
    job_id: str


class BatchSummary(BaseModel):
    id: str
    source: str
    scope_label: str
    status: str
    stats: Optional[Dict[str, Any]] = None
    created_at: datetime
    created_by: Optional[str] = None
    reviewed_by: Optional[str] = None
    promoted_at: Optional[datetime] = None
    rejected_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    error: Optional[str] = None


class BatchListResponse(BaseModel):
    batches: List[BatchSummary]


class BatchDetail(BatchSummary):
    conflict_report: Optional[Dict[str, Any]] = None
    nodes_sample: List[Dict[str, Any]] = Field(default_factory=list)
    edges_sample: List[Dict[str, Any]] = Field(default_factory=list)
    nodes_total: int = 0
    edges_total: int = 0


class PromoteRequest(BaseModel):
    force: bool = False
    reason: Optional[str] = None
    reviewed_by: Optional[str] = Field(None, max_length=100)


class PromoteResponse(BaseModel):
    batch_id: str
    job_id: str
    status: str


class RejectRequest(BaseModel):
    reason: str = Field(..., min_length=1)
    reviewed_by: Optional[str] = Field(None, max_length=100)


class RejectResponse(BaseModel):
    batch_id: str
    status: str


def _to_summary(batch: MerltIngestionBatch) -> BatchSummary:
    return BatchSummary(
        id=batch.id,
        source=batch.source,
        scope_label=batch.scope_label,
        status=batch.status,
        stats=batch.stats,
        created_at=batch.created_at,
        created_by=batch.created_by,
        reviewed_by=batch.reviewed_by,
        promoted_at=batch.promoted_at,
        rejected_at=batch.rejected_at,
        expires_at=batch.expires_at,
        error=batch.error,
    )


@router.post("/run", response_model=RunIngestionResponse, status_code=202)
async def run_ingestion(
    req: RunIngestionRequest,
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(require_role("admin")),
) -> RunIngestionResponse:
    """Create a batch (status=parsing) and enqueue the parse+conflict-report job."""
    batch = MerltIngestionBatch(
        source=req.source,
        source_ref=req.source_ref,
        scope_label=req.scope_label,
        status="parsing",
        created_by=req.created_by,
    )
    session.add(batch)
    await session.commit()
    await session.refresh(batch)

    job_id = f"mech-parse-{batch.id}"
    try:
        queue = await asyncio.to_thread(_get_queue)
        await asyncio.to_thread(
            lambda: queue.enqueue(
                "merlt.worker.mechanical_ingest_tasks.parse_and_stage",
                batch.id,
                job_id=job_id,
                job_timeout=1800,
            )
        )
    except Exception as e:
        log.error(
            "Failed to enqueue mechanical ingestion parse job", batch_id=batch.id, exc_info=True
        )
        raise HTTPException(status_code=503, detail=f"Job queue non disponibile: {e}")

    log.info("mechanical_ingestion.run.queued", batch_id=batch.id, source=req.source)
    return RunIngestionResponse(batch_id=batch.id, job_id=job_id)


@router.get("/batches", response_model=BatchListResponse)
async def list_batches(
    status: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(require_role("admin")),
) -> BatchListResponse:
    """List batches (no nodes/edges blobs)."""
    limit = max(1, min(limit, 200))
    stmt = (
        select(MerltIngestionBatch)
        .order_by(MerltIngestionBatch.created_at.desc())
        .limit(limit)
        .offset(max(0, offset))
    )
    if status:
        stmt = stmt.where(MerltIngestionBatch.status == status)
    rows = (await session.execute(stmt)).scalars().all()
    return BatchListResponse(batches=[_to_summary(b) for b in rows])


@router.get("/batches/{batch_id}", response_model=BatchDetail)
async def get_batch(
    batch_id: str,
    node_limit: int = 50,
    edge_limit: int = 50,
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(require_role("admin")),
) -> BatchDetail:
    """Full batch detail: conflict report + a paginated sample of nodes/edges."""
    batch = await session.get(MerltIngestionBatch, batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="batch_not_found")

    node_limit = max(1, min(node_limit, 500))
    edge_limit = max(1, min(edge_limit, 500))
    nodes = batch.nodes or []
    edges = batch.edges or []

    return BatchDetail(
        **_to_summary(batch).model_dump(),
        conflict_report=batch.conflict_report,
        nodes_sample=nodes[:node_limit],
        edges_sample=edges[:edge_limit],
        nodes_total=len(nodes),
        edges_total=len(edges),
    )


@router.post("/batches/{batch_id}/promote", response_model=PromoteResponse)
async def promote_batch_endpoint(
    batch_id: str,
    req: PromoteRequest,
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(require_role("admin")),
) -> PromoteResponse:
    """Enqueue promotion. 409 if `urn_conflicts` is non-empty and `force` is not set.

    A `failed` batch (e.g. a worker crash mid-promote — see
    `worker/mechanical_ingest_tasks.py`) can be re-promoted: `_merge_nodes` /
    `_merge_edges` are idempotent MERGEs, so retrying is safe. The
    `pending_review`/`failed` -> `promoting` transition is a conditional
    `UPDATE ... WHERE status = <snapshot>` (not a read-then-write of the ORM
    object) so two admins racing to promote the same batch can't both pass
    the checks below and both enqueue a job.
    """
    batch = await session.get(MerltIngestionBatch, batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="batch_not_found")
    if batch.status not in ("pending_review", "failed"):
        raise HTTPException(status_code=409, detail=f"batch_not_pending_review: {batch.status}")
    if batch.expires_at and batch.expires_at < datetime.utcnow():
        raise HTTPException(status_code=409, detail="batch_expired")

    conflicts = (batch.conflict_report or {}).get("urn_conflicts") or []
    if conflicts and not req.force:
        raise HTTPException(
            status_code=409,
            detail={"error": "urn_conflicts_block_promotion", "urn_conflicts": conflicts},
        )

    new_stats = (
        {**(batch.stats or {}), "promotion_reason": req.reason} if req.reason else batch.stats
    )
    transition = await session.execute(
        update(MerltIngestionBatch)
        .where(
            MerltIngestionBatch.id == batch_id,
            MerltIngestionBatch.status == batch.status,
        )
        .values(status="promoting", reviewed_by=req.reviewed_by, stats=new_stats)
    )
    if transition.rowcount != 1:
        # Someone else already moved this batch out of the snapshotted status
        # between our read and this UPDATE (concurrent promote/reject/expiry).
        await session.rollback()
        raise HTTPException(status_code=409, detail="batch_status_changed_concurrently")
    await session.commit()

    job_id = f"mech-promote-{batch_id}"
    try:
        queue = await asyncio.to_thread(_get_queue)
        await asyncio.to_thread(
            lambda: queue.enqueue(
                "merlt.worker.mechanical_ingest_tasks.promote_task",
                batch_id,
                req.force,
                job_id=job_id,
                job_timeout=1800,
            )
        )
    except Exception as e:
        log.error(
            "Failed to enqueue mechanical ingestion promote job", batch_id=batch_id, exc_info=True
        )
        # Revert so the batch isn't stuck "promoting" with no job behind it.
        await session.execute(
            update(MerltIngestionBatch)
            .where(MerltIngestionBatch.id == batch_id)
            .values(status="pending_review")
        )
        await session.commit()
        raise HTTPException(status_code=503, detail=f"Job queue non disponibile: {e}")

    log.info("mechanical_ingestion.promote.queued", batch_id=batch_id, force=req.force)
    return PromoteResponse(batch_id=batch_id, job_id=job_id, status="promoting")


@router.post("/batches/{batch_id}/reject", response_model=RejectResponse)
async def reject_batch(
    batch_id: str,
    req: RejectRequest,
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(require_role("admin")),
) -> RejectResponse:
    """Reject a batch (synchronous — no graph write ever happened, nothing to undo)."""
    batch = await session.get(MerltIngestionBatch, batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="batch_not_found")
    if batch.status not in ("pending_review", "failed"):
        raise HTTPException(status_code=409, detail=f"batch_not_rejectable: {batch.status}")

    batch.status = "rejected"
    batch.rejected_at = datetime.utcnow()
    batch.reviewed_by = req.reviewed_by
    batch.stats = {**(batch.stats or {}), "rejection_reason": req.reason}
    await session.commit()

    log.info("mechanical_ingestion.reject", batch_id=batch_id)
    return RejectResponse(batch_id=batch_id, status="rejected")


__all__ = ["router"]
