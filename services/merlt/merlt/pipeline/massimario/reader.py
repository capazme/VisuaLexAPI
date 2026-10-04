# services/merlt/merlt/pipeline/massimario/reader.py
"""Paragraphs of the reviews that cite a norm, grouped by year (spec §7).

An exact join, no semantic search: bridge rows of relation CITA_NORMA for the
URN (whole paragraphs only), newest year first, then the points' payloads by id.
"""
from __future__ import annotations

import asyncio
from typing import Optional

import structlog

from merlt.storage.graph.schema import canonical_urn

from .urns import NORMATTIVA_PREFIX
from .volume import BRIDGE_REL_NORMA, SOURCE

log = structlog.get_logger()


def normalize_reader_urn(urn: str) -> str:
    urn = canonical_urn((urn or "").strip())
    return NORMATTIVA_PREFIX + urn if urn.startswith("urn:nir:") else urn


def _item(payload: dict, urn: str) -> dict:
    return {
        "id": payload["paragraph_key"], "anno": payload["anno"], "archivio": payload["archivio"],
        "volume": payload["volume"], "parte": payload.get("parte"), "capitolo": payload.get("capitolo"),
        "sezione": payload["sezione"], "autori": payload.get("autori", []), "url": payload["url"],
        "testo": payload["text"],
        "evidenziazioni": [
            {"start": n["start"], "end": n["end"], "citazione": n["citazione"], "comma": n.get("comma")}
            for n in payload.get("norme", []) if n["urn"] == urn
        ],
        "pronunce": payload.get("decisioni", []),
        "fonte": payload["fonte"],
    }


class RassegneReader:
    def __init__(self, bridge, qdrant, collection: str) -> None:
        self.bridge, self.qdrant, self.collection = bridge, qdrant, collection

    async def by_norma(self, urn: str, *, anno: Optional[int], archivio: Optional[str],
                       offset: int, limit: int) -> dict:
        urn = normalize_reader_urn(urn)
        filters = {"source": SOURCE, "relation_type": BRIDGE_REL_NORMA}
        counts = await self.bridge.year_counts_for_node(urn, archivio=archivio, **filters)
        if not counts:
            return {"urn": urn, "total": 0, "anni": [], "archivi": [], "anno": None, "items": [], "next_cursor": None}
        archivi = await self.bridge.archives_for_node(urn, **filters)
        years = sorted(counts, reverse=True)
        target = anno if anno in counts else years[0]
        rows = await self.bridge.page_for_node(urn, anno=target, archivio=archivio, limit=limit + 1, offset=offset, **filters)
        page = rows[:limit]
        points = await asyncio.to_thread(
            self.qdrant.retrieve, collection_name=self.collection,
            ids=[r["chunk_id"] for r in page], with_payload=True, with_vectors=False,
        )
        payloads = {str(p.id): p.payload for p in points}
        missing = [r["chunk_id"] for r in page if r["chunk_id"] not in payloads]
        if missing:  # a bridge row without its point: counted above, not listed
            log.warning("rassegne.points_missing", urn=urn, anno=target, chunk_ids=missing)
        return {
            "urn": urn,
            "total": sum(counts.values()),
            "anni": [{"anno": y, "passi": counts[y]} for y in years],
            "archivi": archivi,
            "anno": target,
            "items": [_item(payloads[r["chunk_id"]], urn) for r in page if r["chunk_id"] in payloads],
            "next_cursor": str(offset + limit) if len(rows) > limit else None,
        }
