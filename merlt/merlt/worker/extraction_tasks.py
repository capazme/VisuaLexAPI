"""RQ task: extract a user document into the staging review buffer (Slice 2c).

Enqueued by POST /api/v1/documents/{id}/extract-async at the dotted path
``merlt.worker.extraction_tasks.extract_to_staging``. Drives DocumentParserService
in `persist_target="staging"` mode (candidates land in extraction_candidates,
NOT pending_*) and reports back to the BFF /api/merlt/internal/extraction-callback.

NOTE: requires the MERL-T runtime (DB, LLM service) — verify by running the
stack + pytest, not in isolation.
"""

import asyncio
import os
from typing import Optional

import httpx
import structlog

log = structlog.get_logger()


async def _callback_extraction(
    bff_job_id: Optional[str],
    status: str,
    *,
    candidates_created: Optional[int] = None,
    error: Optional[str] = None,
) -> None:
    if not bff_job_id:
        return
    url = os.getenv("BFF_EXTRACTION_CALLBACK_URL")
    if not url:
        log.warning("BFF_EXTRACTION_CALLBACK_URL not set, skipping callback", bff_job_id=bff_job_id)
        return
    # camelCase keys: the BFF is Node/Zod (MerltExtractionJob fields).
    payload = {
        "bffJobId": bff_job_id,
        "status": status,
        "candidatesCreated": candidates_created,
        "error": error,
    }
    secret = os.getenv("MERLT_INTERNAL_SECRET", "")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(url, json=payload, headers={"X-Internal-Secret": secret})
    except Exception as e:
        log.error("BFF extraction callback failed", bff_job_id=bff_job_id, status=status, exc=str(e))


async def _run_extract(document_id: int, user_id: str, bff_job_id: Optional[str]) -> dict:
    # Lazy imports: keep the task module importable by the cold RQ worker without
    # pulling the FastAPI app graph (see ingest task notes).
    from sqlalchemy import select

    from merlt.storage.enrichment.database import get_db_session, init_db
    from merlt.storage.enrichment.models import UserDocument
    from merlt.pipeline.document_parser import DocumentParserService

    log.info("Starting document extraction", document_id=document_id, bff_job_id=bff_job_id)

    # The RQ worker has no FastAPI lifespan, so the enrichment DB engine is not
    # initialized here (unlike the api). init_db() is idempotent-enough to call
    # per task; the graph ingest task sidesteps this by using FalkorDB only.
    await init_db(echo=False)

    async with get_db_session() as session:
        doc = (
            await session.execute(select(UserDocument).where(UserDocument.id == document_id))
        ).scalar_one_or_none()
        if not doc:
            await _callback_extraction(bff_job_id, "failed", error="document_not_found")
            return {"document_id": document_id, "status": "failed", "error": "document_not_found"}

        parser = DocumentParserService()
        try:
            result = await parser.parse_document(
                document_path=doc.storage_path,
                file_type=doc.file_type,
                document_type=doc.document_type,
                legal_domain=doc.legal_domain,
                extract_entities=True,
                extract_amendments=False,
                user_id=user_id,
                session=session,
                persist_target="staging",
                document_id=document_id,
            )
            await session.commit()
            # #3: the verbatim now lives in staging — drop the uploaded file so
            # the server keeps no raw personal document on disk.
            try:
                import os

                if doc.storage_path and os.path.exists(doc.storage_path):
                    os.remove(doc.storage_path)
            except Exception as rm_exc:
                log.warning("failed to remove uploaded file", document_id=document_id, exc=str(rm_exc))
        except Exception as e:
            from rq import get_current_job

            job = get_current_job()
            retries_left = job.retries_left if job else 0
            if retries_left in (None, 0):
                await _callback_extraction(bff_job_id, "failed", error=str(e))
            log.error("Document extraction failed", document_id=document_id, exc=str(e))
            raise

    await _callback_extraction(bff_job_id, "completed", candidates_created=result.entities_count)
    log.info("Document extraction completed", document_id=document_id, candidates=result.entities_count)
    return {"document_id": document_id, "status": "completed", "candidates_created": result.entities_count}


def extract_to_staging(document_id: int, user_id: str, bff_job_id: str | None = None) -> dict:
    """RQ task (sync entrypoint). Wraps the async extraction + BFF callback."""
    return asyncio.run(_run_extract(document_id, user_id, bff_job_id))
