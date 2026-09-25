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
            resp = await client.post(url, json=payload, headers={"X-Internal-Secret": secret})
        if resp.status_code >= 400:
            # 401/500 = MERLT_INTERNAL_SECRET differs between this worker and
            # the BFF (or is empty on the BFF); 404 = the BFF row is gone.
            # Best-effort by design, but silence here hid every such
            # misconfiguration behind jobs that stayed "in corso".
            log.error(
                "%s refused" % "BFF extraction callback",
                bff_job_id=bff_job_id,
                status=status,
                http_status=resp.status_code,
                body=resp.text[:300],
                hint="check MERLT_INTERNAL_SECRET on the BFF and the worker" if resp.status_code in (401, 500) else None,
            )
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

        # The uploaded file is deleted after a successful extraction (#3), so a
        # second run on the same document id (re-upload dedup, retry after the
        # TTL) has nothing to read: say so instead of a silent "0 candidati".
        if not doc.storage_path or not os.path.exists(doc.storage_path):
            await _callback_extraction(bff_job_id, "failed", error="document_file_purged")
            return {"document_id": document_id, "status": "failed", "error": "document_file_purged"}

        parser = DocumentParserService()
        try:
            result = await parser.parse_document(
                document_path=doc.storage_path,
                file_type=doc.file_type,
                document_type=doc.document_type,
                legal_domain=doc.legal_domain,
                extract_entities=True,
                extract_amendments=False,
                extract_relations=True,
                user_id=user_id,
                session=session,
                persist_target="staging",
                document_id=document_id,
            )
            await session.commit()
            # parse_document swallows extractor failures into result.errors and
            # still returns; when nothing at all was staged that is a failed
            # extraction for the user, not a completed one with zero candidates.
            parse_errors = [str(e) for e in (getattr(result, "errors", None) or [])]
            if parse_errors and (result.entities_count + result.relations_count) == 0:
                err = "; ".join(parse_errors)[:500]
                await _callback_extraction(bff_job_id, "failed", error=err)
                log.error("Document extraction produced nothing", document_id=document_id, errors=err)
                # keep the file: a retry is still possible
                return {"document_id": document_id, "status": "failed", "error": err}
            # #3: the verbatim now lives in staging — drop the uploaded file so
            # the server keeps no raw personal document on disk.
            try:
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

    candidates_created = result.entities_count + result.relations_count
    await _callback_extraction(bff_job_id, "completed", candidates_created=candidates_created)
    log.info("Document extraction completed", document_id=document_id, candidates=candidates_created)
    return {"document_id": document_id, "status": "completed", "candidates_created": candidates_created}


def extract_to_staging(document_id: int, user_id: str, bff_job_id: str | None = None) -> dict:
    """RQ task (sync entrypoint). Wraps the async extraction + BFF callback."""
    return asyncio.run(_run_extract(document_id, user_id, bff_job_id))
