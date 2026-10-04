# services/merlt/merlt/worker/massimario_tasks.py
"""RQ task: vectors and bridge rows of a promoted Massimario batch, 100 paragraphs per job.

Chained: each job enqueues the next slice on `merlt_bulk` (listed last by the
worker, so readers' lazy ingestions go first). Progress lives on the batch
(`stats.vectors`). A failed slice stops the chain and records the error, and so
does a job RQ kills (its timeout) through `record_index_failure`. Promoting the
batch again (the router allows it while the vectors are incomplete) starts from
0: points are upserts and a chunk's bridge rows are replaced.

GOTCHA (CLAUDE.md #6): the worker has no FastAPI lifespan, so `init_db()` first.
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone

import structlog

from merlt.pipeline.massimario.vectors import build_qdrant_client, index_chunks

log = structlog.get_logger()

SLICE = int(os.getenv("MASSIMARIO_EMBED_SLICE", "100"))
QUEUE = "merlt_bulk"
JOB_TIMEOUT_S = 1800
# A chain whose progress has not moved for this long is dead (a worker killed outright
# records nothing): one slice's timeout, plus one bulk job it may have queued behind.
STALE_AFTER_S = 2 * JOB_TIMEOUT_S


def vector_progress(done: int, total: int, error: str | None = None) -> dict:
    """`stats.vectors`: dated, so a stopped chain can be told from a running one."""
    progress = {"done": done, "total": total, "updated_at": datetime.now(timezone.utc).isoformat()}
    if error:
        progress["error"] = error
    return progress


def vectors_stopped(progress: dict | None) -> bool:
    """Vectors that will not finish on their own: an error, or no progress for STALE_AFTER_S."""
    progress = progress or {}
    if progress.get("error"):
        return True
    if int(progress.get("done") or 0) >= int(progress.get("total") or 0):
        return False
    try:
        updated = datetime.fromisoformat(progress["updated_at"])
    except (KeyError, TypeError, ValueError):
        return True  # undated progress predates the timestamp: nothing says it still runs
    return (datetime.now(timezone.utc) - updated).total_seconds() > STALE_AFTER_S


def _bridge():
    from merlt.storage.bridge import BridgeTable, BridgeTableConfig

    return BridgeTable(BridgeTableConfig.from_enrichment_env())


def _embeddings():
    from merlt.storage.vectors.embeddings import EmbeddingService

    return EmbeddingService.get_instance()


def enqueue_index_slice(batch_id: str, start: int) -> None:
    from redis import Redis
    from rq import Callback, Queue

    queue = Queue(QUEUE, connection=Redis.from_url(os.getenv("RQ_REDIS_URL", "redis://localhost:6379/1")))
    queue.enqueue(
        "merlt.worker.massimario_tasks.index_slice", batch_id, start,
        job_id=f"mass-vec-{batch_id}-{start}", job_timeout=JOB_TIMEOUT_S,
        on_failure=Callback("merlt.worker.massimario_tasks.record_index_failure"),
    )


async def record_vectors_error(batch_id: str, start: int, error: str) -> None:
    """Write a failure on the batch's vector progress, keeping what is done."""
    from sqlalchemy import select

    from merlt.storage.enrichment.database import get_db_session, init_db
    from merlt.storage.enrichment.models import MerltIngestionBatch

    await init_db(echo=False)
    async with get_db_session() as session:
        batch = (
            await session.execute(select(MerltIngestionBatch).where(MerltIngestionBatch.id == batch_id))
        ).scalar_one_or_none()
        if batch is None:
            return
        total = int(((batch.stats or {}).get("vectors") or {}).get("total") or 0)
        batch.stats = {**(batch.stats or {}), "vectors": vector_progress(start, total, error)}
        await session.commit()


def record_index_failure(job, connection, exc_type, exc_value, traceback) -> None:
    """RQ on_failure: an exception that escaped the slice (RQ's timeout, a failed enqueue
    of the next slice) is recorded on the batch, so the chain never stops in silence."""
    batch_id, start = job.args[0], job.args[1]
    error = f"{exc_type.__name__}: {exc_value}" if str(exc_value) else exc_type.__name__
    log.error("massimario.index_slice.job_failed", batch_id=batch_id, start=start, error=error)
    asyncio.run(record_vectors_error(batch_id, start, error))


async def _run_index_slice(batch_id: str, start: int) -> dict:
    from sqlalchemy import select

    from merlt.storage.enrichment.database import get_db_session, init_db
    from merlt.storage.enrichment.models import MerltIngestionBatch
    from merlt.storage.vectors.collection import default_chunks_collection

    await init_db(echo=False)
    async with get_db_session() as session:
        batch = (
            await session.execute(select(MerltIngestionBatch).where(MerltIngestionBatch.id == batch_id))
        ).scalar_one_or_none()
        if batch is None or batch.status != "promoted":
            return {"batch_id": batch_id, "status": "skipped"}
        chunks = (batch.extras or {}).get("chunks") or []
        part = chunks[start:start + SLICE]
        done = min(start + SLICE, len(chunks))
        bridge = _bridge()
        try:
            await bridge.connect()
            await index_chunks(part, embeddings=_embeddings(), qdrant=build_qdrant_client(),
                               bridge=bridge, collection=default_chunks_collection())
        except Exception as e:  # noqa: BLE001 — recorded on the batch, the chain stops
            error = str(e) or type(e).__name__  # a timeout's message is empty
            log.error("massimario.index_slice.failed", batch_id=batch_id, start=start, error=error)
            batch.stats = {**(batch.stats or {}), "vectors": vector_progress(start, len(chunks), error)}
            await session.commit()
            return {"batch_id": batch_id, "status": "failed", "error": error}
        finally:
            await bridge.close()
        batch.stats = {**(batch.stats or {}), "vectors": vector_progress(done, len(chunks))}
        await session.commit()
    if done < len(chunks):
        enqueue_index_slice(batch_id, done)
    return {"batch_id": batch_id, "status": "ok", "done": done, "total": len(chunks)}


def index_slice(batch_id: str, start: int = 0) -> dict:
    """RQ task (sync entrypoint)."""
    return asyncio.run(_run_index_slice(batch_id, start))
