"""RQ ingest task: lazy ingestion of a single article into the knowledge graph.

Enqueued by POST /api/v1/graph/ingest-article at the dotted path
``merlt.worker.tasks.ingest_article``. Synchronous RQ entrypoint that drives the
async ingestion pipeline and reports the outcome back to the BFF.
"""

import asyncio
import importlib.util
import os
import re
import sys
from dataclasses import dataclass
from datetime import date as calendar_date
from pathlib import Path
from typing import Optional

import httpx
import structlog

from merlt.core.legal_knowledge_graph import LegalKnowledgeGraph
from merlt.pipeline.visualex import NormaMetadata
from merlt.storage.graph.schema import canonical_urn
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


NORMATTIVA_URN_CODICI = _load_module_by_path("merlt._worker_map", "utils/map.py").NORMATTIVA_URN_CODICI

_N2LS = "https://www.normattiva.it/uri-res/N2Ls?"

# An article of a state act, as VisuaLex writes it after the URL wrapper:
# `urn:nir:stato:<type>[:<date>][;<number>][:<annex>]~art<article>`. Anything
# else (a comma, a partition, a regional act, an act without its article) is
# not something this task can ingest.
_ARTICLE_URN_RE = re.compile(
    r"urn:nir:stato:(?P<type>[a-z]+(?:\.[a-z]+)*)"
    r"(?::(?P<date>\d{4}(?:-\d{2}-\d{2})?))?"
    r"(?:;(?P<number>\d+[a-z]*))?"
    r"(?::(?P<annex>\d+))?"
    r"~art(?P<article>\d+[a-z]*(?:\.\d+)?)"
)

_ANNEX_TAIL_RE = re.compile(r":\d+$")


class UrnNotIngestible(ValueError):
    """The URN can never be ingested as it is: retrying cannot help."""


@dataclass(frozen=True)
class IngestParams:
    """What `kg.ingest_norm` needs for one article, and the node it must land on."""

    tipo_atto: str
    articolo: str
    graph_key: str
    data: Optional[str] = None
    numero_atto: Optional[str] = None
    allegato: Optional[str] = None


def _code_name(act: str, annex: Optional[str]) -> Optional[str]:
    """The VisuaLex name of the code whose act is `act` ("regio.decreto:1942-03-16;262").

    With an annex the match is exact: annex 1 of r.d. 262/1942 is the preleggi,
    annex 2 the civil code. Without one, a code is found by its decree alone, so
    that a code URN missing its annex is recognised (and then refused by the
    identity check, not fetched as the bare decree).
    """
    if annex:
        wanted = f"{act}:{annex}"
        return next((name for name, urn in NORMATTIVA_URN_CODICI.items() if urn == wanted), None)
    exact = next((name for name, urn in NORMATTIVA_URN_CODICI.items() if urn == act), None)
    if exact:
        return exact
    return next(
        (name for name, urn in NORMATTIVA_URN_CODICI.items() if _ANNEX_TAIL_RE.sub("", urn) == act),
        None,
    )


def _urn_to_ingest_params(urn: str) -> IngestParams:
    """Map an article URN to the arguments of `kg.ingest_norm`.

    A code (and the Constitution) travels by its name, as VisuaLex knows its
    decree. Any other act travels by type, date and number, which VisuaLex
    needs to build the Normattiva address: without them it asks for
    `legge:None;None`. The URN the ingestion would write is rebuilt here, before
    any request, and must be the URN asked for: otherwise the article would land
    on a node the reader never looks at, next to the stub it was meant to fill.

    Raises:
        UrnNotIngestible: with the reason, for a URN no retry can ingest.
    """
    key = canonical_urn((urn or "").strip())
    body = key.removeprefix(_N2LS)
    match = _ARTICLE_URN_RE.fullmatch(body)
    if not match:
        raise UrnNotIngestible(f"non è l'URN di un articolo di un atto dello Stato: {urn}")
    key = _N2LS + body

    act_type, date, number, annex, articolo = match.group("type", "date", "number", "annex", "article")
    act = act_type + (f":{date}" if date else "") + (f";{number}" if number else "")

    codice = _code_name(act, annex)
    if codice:
        params = IngestParams(tipo_atto=codice, articolo=articolo, graph_key=key)
    else:
        if not date or len(date) != 10:
            raise UrnNotIngestible(f"manca la data completa dell'atto (AAAA-MM-GG): {urn}")
        try:
            calendar_date.fromisoformat(date)
        except ValueError:
            raise UrnNotIngestible(f"data non valida ({date}): {urn}") from None
        if not number:
            raise UrnNotIngestible(f"manca il numero dell'atto: {urn}")
        params = IngestParams(
            tipo_atto=act_type.replace(".", " "),
            articolo=articolo,
            graph_key=key,
            data=date,
            numero_atto=number,
            allegato=annex,
        )

    # The same builder the ingestion pipeline keys the article node with.
    written = canonical_urn(
        NormaMetadata(
            tipo_atto=params.tipo_atto,
            data=params.data,
            numero_atto=params.numero_atto,
            numero_articolo=params.articolo,
            allegato=params.allegato,
        ).to_urn()
        or ""
    )
    if written != key:
        raise UrnNotIngestible(f"l'articolo sarebbe salvato come {written or 'nessun URN'}, non come {key}")
    return params


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
            resp = await client.post(url, json=payload, headers={"X-Internal-Secret": secret})
        if resp.status_code >= 400:
            # 401/500 = MERLT_INTERNAL_SECRET differs between this worker and
            # the BFF (or is empty on the BFF); 404 = the BFF row is gone.
            # Best-effort by design, but silence here hid every such
            # misconfiguration behind jobs that stayed "in corso".
            log.error(
                "%s refused" % "BFF callback",
                bff_job_id=bff_job_id,
                status=status,
                http_status=resp.status_code,
                body=resp.text[:300],
                hint="check MERLT_INTERNAL_SECRET on the BFF and the worker" if resp.status_code in (401, 500) else None,
            )
    except Exception as e:
        log.error("BFF callback failed", bff_job_id=bff_job_id, status=status, exc=str(e))


async def _run_ingest(urn: str, bff_job_id: Optional[str]) -> dict:
    # Tell the BFF the worker actually picked the job up (deadlock fix): a job
    # that stays `pending` with no transition is indistinguishable from a lost
    # enqueue, and the BFF idempotency check would block re-ingestion of the
    # URN forever. `running` stamps startedAt on the MerltIngestionJob row and
    # lets the stale-TTL sweeper reason on real worker liveness. Best-effort
    # (_callback_bff swallows errors) — a lost `running` never fails the task.
    await _callback_bff(bff_job_id, "running")

    # URN parsing must happen INSIDE error-callback scope: a malformed URN
    # raised here used to escape without notifying the BFF, leaving the
    # MerltIngestionJob row stuck in `pending` forever (idempotency check
    # would then block all future enqueues for the same URN). The failure is
    # final, so the task returns instead of raising: RQ would retry it and
    # call back `running` again on each attempt.
    try:
        params = _urn_to_ingest_params(urn)
    except Exception as e:  # UrnNotIngestible, or a builder that broke on it
        log.error("URN cannot be ingested", urn=urn, reason=str(e))
        await _callback_bff(bff_job_id, "failed", error=f"urn_parse_error: {e}")
        return {"urn": urn, "status": "failed", "error": str(e)}
    log.info(
        "Starting article ingestion",
        urn=urn,
        tipo_atto=params.tipo_atto,
        articolo=params.articolo,
        data=params.data,
        numero_atto=params.numero_atto,
        allegato=params.allegato,
        bff_job_id=bff_job_id,
    )

    kg = LegalKnowledgeGraph(merlt_config_from_env())
    try:
        await kg.connect()
        try:
            result = await kg.ingest_norm(
                params.tipo_atto,
                params.articolo,
                data=params.data,
                numero_atto=params.numero_atto,
                allegato=params.allegato,
            )
            # ingest_norm reports a failed fetch or pipeline in the result
            # instead of raising; it is a failed job, never a completed one.
            if result.fatal_error:
                raise RuntimeError(result.fatal_error)
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
            "tipo_atto": params.tipo_atto,
            "articolo": params.articolo,
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
