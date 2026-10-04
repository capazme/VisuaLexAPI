# services/merlt/merlt/api/rassegne_router.py
"""GET /api/v1/rassegne/by-norma — the paragraphs of the Massimario's reviews citing a norm."""
from __future__ import annotations

from typing import Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query

from merlt.api.auth import verify_api_key
from merlt.experts.models import ApiKey
from merlt.pipeline.massimario.reader import RassegneReader

log = structlog.get_logger()

router = APIRouter(prefix="/rassegne", tags=["rassegne"])
_reader: Optional[RassegneReader] = None


async def get_rassegne_reader() -> RassegneReader:
    global _reader
    if _reader is None:
        from merlt.pipeline.massimario.vectors import build_qdrant_client
        from merlt.storage.bridge import BridgeTable, BridgeTableConfig
        from merlt.storage.vectors.collection import default_chunks_collection

        bridge = BridgeTable(BridgeTableConfig.from_enrichment_env())
        try:
            await bridge.connect()
        except Exception as exc:  # noqa: BLE001
            log.error("rassegne.bridge_unavailable", error=str(exc))
            raise HTTPException(status_code=503, detail="rassegne_unavailable") from exc
        _reader = RassegneReader(bridge, build_qdrant_client(), default_chunks_collection())
    return _reader


@router.get("/by-norma")
async def by_norma(
    urn: str = Query(..., min_length=1, max_length=500),
    anno: Optional[int] = Query(None, ge=1900, le=2100),
    archivio: Optional[str] = Query(None, pattern="^(civile|penale)$"),
    cursor: Optional[str] = Query(None, pattern=r"^\d{1,6}$"),
    limit: int = Query(10, ge=1, le=50),
    reader: RassegneReader = Depends(get_rassegne_reader),
    api_key: ApiKey = Depends(verify_api_key),
) -> dict:
    try:
        return await reader.by_norma(urn, anno=anno, archivio=archivio, offset=int(cursor or 0), limit=limit)
    except Exception as exc:  # noqa: BLE001 — a store down is a 503, never a 500 with internals
        log.error("rassegne.by_norma_failed", error=str(exc))
        raise HTTPException(status_code=503, detail="rassegne_unavailable") from exc
