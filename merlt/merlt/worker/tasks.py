"""RQ ingest task: lazy ingestion of a single article into the knowledge graph.

Enqueued by POST /api/v1/graph/ingest-article at the dotted path
``merlt.worker.tasks.ingest_article``. Synchronous RQ entrypoint that drives the
async ingestion pipeline and reports the outcome back to the BFF.
"""

import asyncio
import importlib.util
import os
import sys
from pathlib import Path
from typing import Optional

import httpx
import structlog

from merlt.core.legal_knowledge_graph import LegalKnowledgeGraph
from merlt.worker.config import merlt_config_from_env

log = structlog.get_logger()

_MERLT_PKG_DIR = Path(__file__).resolve().parent.parent


def _load_module_by_path(name: str, relative_path: str):
    """Load a single module file without executing its package __init__.

    merlt.citation.__init__ eagerly imports the FastAPI routers, which causes a
    circular import (citation -> api -> citation.formatter) when this task module
    is loaded cold by the RQ worker. Loading the leaf module by file path sidesteps
    the package __init__ entirely, so the import works regardless of import order.
    """
    spec = importlib.util.spec_from_file_location(name, _MERLT_PKG_DIR / relative_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module  # MUST precede exec_module
    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(name, None)  # don't leave a poisoned partial module
        raise
    return module


parse_urn = _load_module_by_path("merlt._worker_urn_parser", "citation/urn_parser.py").parse_urn
NORMATTIVA_URN_CODICI = _load_module_by_path("merlt._worker_map", "utils/map.py").NORMATTIVA_URN_CODICI


def _resolve_codice_name(parsed) -> Optional[str]:
    """Reverse-lookup a human codice name from the URN components.

    NORMATTIVA_URN_CODICI maps codice name -> URN identifier (e.g.
    "regio.decreto:1942-03-16;262:2"). We rebuild that identifier from the parsed
    URN and match it, tolerating the trailing ":<allegato>" suffix in the map.
    """
    if not (parsed.act_type and parsed.date and parsed.act_number):
        return None
    candidate = f"{parsed.act_type}:{parsed.date};{parsed.act_number}"
    for name, urn_id in NORMATTIVA_URN_CODICI.items():
        stripped = urn_id
        head, _, tail = urn_id.rpartition(":")
        if head and tail.isdigit():
            stripped = head
        if stripped == candidate:
            return name
    return None


def _urn_to_ingest_params(urn: str) -> tuple[str, str]:
    """Map a Normattiva URN to (tipo_atto, articolo) for kg.ingest_norm."""
    parsed = parse_urn(urn)
    articolo = parsed.article
    if not articolo:
        raise ValueError(f"URN privo di articolo, impossibile ingerire: {urn}")

    codice = _resolve_codice_name(parsed)
    if codice:
        tipo_atto = codice
    else:
        tipo_atto = (parsed.act_type or "").lower().replace(".", " ").strip()
    if not tipo_atto:
        raise ValueError(f"URN privo di tipo atto, impossibile ingerire: {urn}")

    return tipo_atto, articolo


async def _callback_bff(
    bff_job_id: Optional[str],
    status: str,
    *,
    nodes_created: Optional[int] = None,
    edges_created: Optional[int] = None,
    error: Optional[str] = None,
) -> None:
    if not bff_job_id:
        return  # nothing to call back to
    url = os.getenv("BFF_CALLBACK_URL")
    if not url:
        log.warning("BFF_CALLBACK_URL not set, skipping callback", bff_job_id=bff_job_id)
        return
    # camelCase keys: the BFF is Node/Zod (MerltIngestionJob fields).
    payload = {
        "bffJobId": bff_job_id,
        "status": status,
        "nodesCreated": nodes_created,
        "edgesCreated": edges_created,
        "error": error,
    }
    secret = os.getenv("MERLT_INTERNAL_SECRET", "")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(url, json=payload, headers={"X-Internal-Secret": secret})
    except Exception as e:
        log.error("BFF callback failed", bff_job_id=bff_job_id, status=status, exc=str(e))


async def _run_ingest(urn: str, bff_job_id: Optional[str]) -> dict:
    tipo_atto, articolo = _urn_to_ingest_params(urn)
    log.info("Starting article ingestion", urn=urn, tipo_atto=tipo_atto, articolo=articolo, bff_job_id=bff_job_id)

    kg = LegalKnowledgeGraph(merlt_config_from_env())
    try:
        await kg.connect()
        try:
            result = await kg.ingest_norm(tipo_atto, articolo)
        except Exception as e:
            # Only notify the BFF as failed on the final attempt; otherwise let RQ retry.
            from rq import get_current_job

            job = get_current_job()
            retries_left = job.retries_left if job else 0
            if retries_left in (None, 0):
                await _callback_bff(bff_job_id, "failed", error=str(e))
            log.error("Article ingestion failed", urn=urn, retries_left=retries_left, exc=str(e))
            raise

        nodes_created = len(result.nodes_created)
        edges_created = len(result.relations_created)
        await _callback_bff(
            bff_job_id, "completed", nodes_created=nodes_created, edges_created=edges_created
        )
        log.info(
            "Article ingestion completed",
            urn=urn,
            nodes_created=nodes_created,
            edges_created=edges_created,
        )
        return {
            "urn": urn,
            "tipo_atto": tipo_atto,
            "articolo": articolo,
            "nodes_created": nodes_created,
            "edges_created": edges_created,
            "summary": result.summary(),
        }
    finally:
        try:
            await kg.close()
        except Exception as close_exc:
            log.warning("kg.close() failed during cleanup", exc=str(close_exc))


def ingest_article(urn: str, bff_job_id: str | None = None) -> dict:
    """RQ task (sync entrypoint). Wraps the async ingestion + BFF callback."""
    return asyncio.run(_run_ingest(urn, bff_job_id))
