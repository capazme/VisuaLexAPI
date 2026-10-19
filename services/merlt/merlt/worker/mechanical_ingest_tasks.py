"""RQ tasks: parse+stage and promote a mechanical-ingestion batch.

Enqueued by `merlt.api.ingestion_mechanical_router` on the `merlt_bulk`
queue (the router's `_QUEUE_NAME`), which the worker names last so that a
reader's lazy ingestion on `merlt_ingest` is served first (see
`infra/compose.yml`'s worker `command`). Both entrypoints are sync (RQ
requirement) wrapping the async pipeline.

GOTCHA (CLAUDE.md #6): the RQ worker has no FastAPI lifespan, so the
enrichment DB engine is never auto-initialized — every task here calls
`await init_db()` first (idempotent: no-ops if already initialized).
"""

import asyncio
from datetime import datetime

import structlog

log = structlog.get_logger()


async def _run_parse_and_stage(batch_id: str) -> dict:
    from sqlalchemy import select

    from merlt.storage.enrichment.database import get_db_session, init_db
    from merlt.storage.enrichment.models import MerltIngestionBatch
    from merlt.storage.graph.client import FalkorDBClient
    from merlt.pipeline.mechanical_ingestion.parser import get_adapter
    from merlt.pipeline.mechanical_ingestion.conflict_report import build_conflict_report

    log.info("mechanical_ingest.parse_and_stage.start", batch_id=batch_id)
    await init_db(echo=False)

    async with get_db_session() as session:
        batch = (
            await session.execute(
                select(MerltIngestionBatch).where(MerltIngestionBatch.id == batch_id)
            )
        ).scalar_one_or_none()
        if batch is None:
            log.error("mechanical_ingest.batch_not_found", batch_id=batch_id)
            return {"batch_id": batch_id, "status": "failed", "error": "batch_not_found"}

        try:
            adapter = get_adapter(batch.source)
            parsed = await adapter.parse(batch.source_ref)
            nodes = parsed.get("nodes", [])
            edges = parsed.get("edges", [])

            falkordb = FalkorDBClient()
            await falkordb.connect()
            try:
                if batch.source == "massimario":
                    # Stubs are created only if missing and decision lists are
                    # unions (pipeline/massimario/promote.py): there is nothing
                    # to conflict with. The adapter brings its own report; add
                    # what the graph already holds.
                    from merlt.pipeline.massimario.report import add_graph_counts

                    report = parsed["report"]
                    await add_graph_counts(falkordb, nodes, report)
                else:
                    report = await build_conflict_report(falkordb, nodes, edges)
            finally:
                await falkordb.close()

            batch.nodes = nodes
            batch.edges = edges
            batch.extras = parsed.get("extras")
            batch.conflict_report = report
            batch.stats = report["stats"]
            batch.status = "pending_review"
            batch.error = None
        except Exception as e:  # noqa: BLE001 — surface every parse/report failure on the batch row
            # a timeout's message is empty: the batch row names at least its kind
            error = str(e) or type(e).__name__
            log.error("mechanical_ingest.parse_and_stage.failed", batch_id=batch_id, error=error)
            batch.status = "failed"
            batch.error = error
            await session.commit()
            return {"batch_id": batch_id, "status": "failed", "error": error}

        await session.commit()

    log.info(
        "mechanical_ingest.parse_and_stage.done",
        batch_id=batch_id,
        nodes=len(nodes),
        edges=len(edges),
    )
    return {
        "batch_id": batch_id,
        "status": "pending_review",
        "nodes": len(nodes),
        "edges": len(edges),
    }


def parse_and_stage(batch_id: str) -> dict:
    """RQ task (sync entrypoint). Wraps the async parse + conflict-report pipeline."""
    return asyncio.run(_run_parse_and_stage(batch_id))


async def _run_promote(batch_id: str, force: bool) -> dict:
    from sqlalchemy import select

    from merlt.storage.enrichment.database import get_db_session, init_db
    from merlt.storage.enrichment.models import MerltIngestionBatch
    from merlt.storage.graph.client import FalkorDBClient
    from merlt.pipeline.mechanical_ingestion.promote import PromotionBlockedError, promote_batch

    log.info("mechanical_ingest.promote.start", batch_id=batch_id, force=force)
    await init_db(echo=False)

    async with get_db_session() as session:
        batch = (
            await session.execute(
                select(MerltIngestionBatch).where(MerltIngestionBatch.id == batch_id)
            )
        ).scalar_one_or_none()
        if batch is None:
            log.error("mechanical_ingest.batch_not_found", batch_id=batch_id)
            return {"batch_id": batch_id, "status": "failed", "error": "batch_not_found"}

        falkordb = FalkorDBClient()
        await falkordb.connect()
        try:
            try:
                if batch.source == "massimario":
                    from merlt.pipeline.massimario.promote import promote_massimario_graph

                    result = await promote_massimario_graph(falkordb, batch.nodes or [], batch.edges or [])
                else:
                    result = await promote_batch(
                        falkordb, batch.nodes or [], batch.edges or [], force=force
                    )
            except PromotionBlockedError as e:
                # The router already pre-checked this before enqueueing; only
                # reachable if the graph changed between that check and the
                # worker picking up the job. Not an error — send the batch
                # back to pending_review with the fresh conflict report so
                # the admin can re-decide.
                log.warning("mechanical_ingest.promote.blocked_at_run_time", batch_id=batch_id)
                batch.status = "pending_review"
                batch.conflict_report = e.conflict_report
                batch.error = str(e)
                await session.commit()
                return {"batch_id": batch_id, "status": "pending_review", "error": str(e)}
        except Exception as e:  # noqa: BLE001 — any other promote failure (FalkorDB error,
            # unexpected bug) must not leave the batch stuck "promoting" forever with no
            # job behind it. `_merge_nodes`/`_merge_edges` are idempotent MERGEs, so the
            # router allows a `failed` batch to be re-promoted (see design doc §10).
            error = str(e) or type(e).__name__  # a timeout's message is empty
            log.error("mechanical_ingest.promote.failed", batch_id=batch_id, error=error)
            batch.status = "failed"
            batch.error = error
            await session.commit()
            return {"batch_id": batch_id, "status": "failed", "error": error}
        finally:
            await falkordb.close()

        batch.status = "promoted"
        batch.promoted_at = datetime.utcnow()
        batch.error = None
        batch.stats = {
            **(batch.stats or {}),
            "promotion": {
                "nodes_merged": result["nodes_merged"],
                "edges_merged": result["edges_merged"],
                "edges_skipped": result["edges_skipped"],
                "forced": force,
            },
        }
        # decided while the session is open; the job is enqueued once the row is committed
        massimario = batch.source == "massimario"
        if massimario:
            from merlt.worker.massimario_tasks import vector_progress

            total = len((batch.extras or {}).get("chunks") or [])
            batch.stats = {**batch.stats, "vectors": vector_progress(0, total)}
        await session.commit()

    if massimario:
        from merlt.worker.massimario_tasks import enqueue_index_slice, record_vectors_error

        try:
            enqueue_index_slice(batch_id, 0)
        except Exception as e:  # noqa: BLE001 — the graph is promoted; the vectors wait for a resume
            error = f"{type(e).__name__}: {e}" if str(e) else type(e).__name__
            log.error("mechanical_ingest.promote.vectors_not_enqueued", batch_id=batch_id, error=error)
            await record_vectors_error(batch_id, 0, error)
    log.info("mechanical_ingest.promote.done", batch_id=batch_id, **result)
    return {"batch_id": batch_id, "status": "promoted", **result}


def promote_task(batch_id: str, force: bool = False) -> dict:
    """RQ task (sync entrypoint). Wraps the async promotion pipeline."""
    return asyncio.run(_run_promote(batch_id, force))


__all__ = ["parse_and_stage", "promote_task"]
