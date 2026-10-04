# services/merlt/merlt/worker/massimario_tasks.py
"""RQ task: vectors and bridge rows of a promoted Massimario batch, 100 paragraphs per job.

Chained: each job enqueues the next slice on `merlt_bulk` (listed last by the
worker, so readers' lazy ingestions go first). Progress lives on the batch
(`stats.vectors`). A failed slice stops the chain and records the error; a new
promotion of the batch starts again from 0, and every write is an upsert.

GOTCHA (CLAUDE.md #6): the worker has no FastAPI lifespan, so `init_db()` first.
"""
from __future__ import annotations

import asyncio
import os

import structlog

from merlt.pipeline.massimario.vectors import build_qdrant_client, index_chunks

log = structlog.get_logger()

SLICE = int(os.getenv("MASSIMARIO_EMBED_SLICE", "100"))
QUEUE = "merlt_bulk"


def _bridge():
    from merlt.storage.bridge import BridgeTable, BridgeTableConfig

    return BridgeTable(BridgeTableConfig.from_enrichment_env())


def _embeddings():
    from merlt.storage.vectors.embeddings import EmbeddingService

    return EmbeddingService.get_instance()


def enqueue_index_slice(batch_id: str, start: int) -> None:
    from redis import Redis
    from rq import Queue

    queue = Queue(QUEUE, connection=Redis.from_url(os.getenv("RQ_REDIS_URL", "redis://localhost:6379/1")))
    queue.enqueue(
        "merlt.worker.massimario_tasks.index_slice", batch_id, start,
        job_id=f"mass-vec-{batch_id}-{start}", job_timeout=1800,
    )


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
            log.error("massimario.index_slice.failed", batch_id=batch_id, start=start, error=str(e))
            batch.stats = {**(batch.stats or {}), "vectors": {"done": start, "total": len(chunks), "error": str(e)}}
            await session.commit()
            return {"batch_id": batch_id, "status": "failed", "error": str(e)}
        finally:
            await bridge.close()
        batch.stats = {**(batch.stats or {}), "vectors": {"done": done, "total": len(chunks)}}
        await session.commit()
    if done < len(chunks):
        enqueue_index_slice(batch_id, done)
    return {"batch_id": batch_id, "status": "ok", "done": done, "total": len(chunks)}


def index_slice(batch_id: str, start: int = 0) -> dict:
    """RQ task (sync entrypoint)."""
    return asyncio.run(_run_index_slice(batch_id, start))
