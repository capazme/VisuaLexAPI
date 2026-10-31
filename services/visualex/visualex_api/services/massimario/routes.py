# services/visualex/visualex_api/services/massimario/routes.py
"""The two routes over the reviews' store (design 2026-10-30-rassegne-without-merlt §3 (a)).

- `GET /fetch_rassegne?urn=&anno=&archivio=&cursor=&limit=`: the paragraphs citing a norm, for
  the reader. The answer has the shape the panel reads (`RassegneResponse`); the URN goes
  through `normalize_norm_urn`. No store: 200 with `total: 0`. A store that cannot be read, or
  of an unknown schema: 503 `rassegne_non_disponibili`.
- `GET /massimario/volume/<id>/records`: a volume's records and parse report, for MERL-T's
  ingestion. Internal: not in the ingress, the Vite proxy or `legalFetch`.

Both read a local file only: no request leaves, no MERL-T hop.
"""
from __future__ import annotations

import asyncio
import re
from typing import Any, Mapping, Optional

import structlog

from ...tools.sources import normalize_norm_urn
from . import store

log = structlog.get_logger()

DEFAULT_LIMIT = 10
MAX_LIMIT = 50
_CURSOR = re.compile(r"[0-9]{1,6}", re.ASCII)
_YEAR = re.compile(r"[0-9]{4}", re.ASCII)
_LIMIT = re.compile(r"[0-9]{1,2}", re.ASCII)
_VOLUME = re.compile(r"[0-9]{1,9}", re.ASCII)
_UNAVAILABLE = ({"detail": "rassegne_non_disponibili"}, 503)


def _invalid(field: str, message: str) -> tuple[dict, int]:
    return {"detail": "richiesta_non_valida", "errori": {field: message}}, 400


def _query(args: Mapping[str, str]) -> tuple[Optional[dict], Optional[tuple[dict, int]]]:
    urn = (args.get("urn") or "").strip()
    if not 1 <= len(urn) <= 500:
        return None, _invalid("urn", "atteso l'URN della norma, al massimo 500 caratteri")
    anno = args.get("anno") or None
    if anno is not None and not (_YEAR.fullmatch(anno) and 1900 <= int(anno) <= 2100):
        return None, _invalid("anno", "atteso un anno tra il 1900 e il 2100")
    archivio = args.get("archivio") or None
    if archivio is not None and archivio not in ("civile", "penale"):
        return None, _invalid("archivio", "atteso civile o penale")
    cursor = args.get("cursor") or None
    if cursor is not None and not _CURSOR.fullmatch(cursor):
        return None, _invalid("cursor", "atteso un numero")
    limit = args.get("limit") or None
    if limit is not None and not (_LIMIT.fullmatch(limit) and 1 <= int(limit) <= MAX_LIMIT):
        return None, _invalid("limit", f"atteso un numero tra 1 e {MAX_LIMIT}")
    return {
        "urn": normalize_norm_urn(urn),
        "anno": int(anno) if anno else None,
        "archivio": archivio,
        "offset": int(cursor) if cursor else 0,
        "limit": int(limit) if limit else DEFAULT_LIMIT,
    }, None


async def fetch_rassegne(args: Mapping[str, str]) -> tuple[dict[str, Any], int]:
    query, error = _query(args)
    if error:
        return error
    urn = query.pop("urn")
    try:
        answer = await asyncio.to_thread(store.by_norma, store.default_path(), urn, **query)
    except store.StoreUnavailable as exc:
        log.error("rassegne.store_unavailable", error=str(exc))
        return _UNAVAILABLE
    return answer, 200


async def volume_records(volume_id: str) -> tuple[dict[str, Any], int]:
    if not _VOLUME.fullmatch(volume_id or ""):
        return _invalid("volume", "atteso un numero")
    try:
        answer = await asyncio.to_thread(store.volume_records, store.default_path(), int(volume_id))
    except store.StoreUnavailable as exc:
        log.error("rassegne.store_unavailable", error=str(exc))
        return _UNAVAILABLE
    if answer is None:
        return {"detail": "volume_non_presente"}, 404
    return answer, 200
