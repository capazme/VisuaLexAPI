# services/visualex/visualex_api/services/massimario/routes.py
"""The two routes over the reviews' store (design 2026-10-30-rassegne-without-merlt §3 (a)).

- `GET /fetch_rassegne?urn=&anno=&archivio=&cursor=&limit=`, or `POST /fetch_rassegne` with the
  same fields in a JSON body and, there only, `q`: the paragraphs citing a norm, for the reader.
  The answer has the shape the panel reads (`RassegneResponse`); the URN goes through
  `normalize_norm_urn`. `q` keeps the paragraphs holding every one of its words (at most
  `store.MAX_QUERY_CHARS` characters and `store.MAX_TERMS` words of two letters or more). It is
  refused in a query string, which access logs keep, and never logged here. No store: 200 with
  `total: 0`. A store that cannot be read, or of an unknown schema: 503
  `rassegne_non_disponibili`.
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


_FIELDS = ("urn", "anno", "archivio", "cursor", "limit", "q")


def body_args(body: Any) -> tuple[Optional[dict], Optional[tuple[dict, int]]]:
    """A POST's JSON body as the fields `_query` reads: an object whose known fields are
    strings or whole numbers (anything else is refused, never coerced)."""
    if not isinstance(body, dict):
        return None, _invalid("corpo", "atteso un oggetto JSON")
    args: dict[str, str] = {}
    for field in _FIELDS:
        value = body.get(field)
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, (str, int)):
            return None, _invalid(field, "atteso un testo o un numero")
        args[field] = str(value)
    return args, None


def _words(q: Optional[str]) -> tuple[Optional[list[str]], Optional[tuple[dict, int]]]:
    if q is None or not q.strip():
        return None, None
    if len(q) > store.MAX_QUERY_CHARS:
        return None, _invalid("q", f"al massimo {store.MAX_QUERY_CHARS} caratteri")
    words = store.terms(q)
    if not words:
        return None, _invalid("q", f"attese parole di almeno {store.MIN_TERM_CHARS} lettere o cifre")
    if len(words) > store.MAX_TERMS:
        return None, _invalid("q", f"al massimo {store.MAX_TERMS} parole")
    return words, None


def _query(args: Mapping[str, str], *, allow_q: bool = False) -> tuple[Optional[dict], Optional[tuple[dict, int]]]:
    if not allow_q and args.get("q") is not None:
        return None, _invalid("q", "la ricerca per parole va inviata nel corpo di una POST")
    words, error = _words(args.get("q"))
    if error:
        return None, error
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
        "words": words,
    }, None


async def fetch_rassegne(args: Mapping[str, str], *, allow_q: bool = False) -> tuple[dict[str, Any], int]:
    """`allow_q`: the fields came in a POST's body (`body_args`), where a keyword query may be."""
    query, error = _query(args, allow_q=allow_q)
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
