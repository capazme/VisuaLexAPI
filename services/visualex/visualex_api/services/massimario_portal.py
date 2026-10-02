# services/visualex/visualex_api/services/massimario_portal.py
"""One element of the Portale del Massimario (the Corte di cassazione's annual reviews).

Internal source for MERL-T's MassimarioAdapter: the route that serves it is not
routed by the ingress. The portal sits behind a web application firewall, so
this module is deliberately slow: one request at a time, at least MIN_INTERVAL
seconds apart (the shared client's pacing is global and much shorter), an honest
User-Agent, a pause before retrying a page that is not valid JSON, and a stop at
the first firewall rejection.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
from typing import Any

import structlog

from ..tools.exceptions import (
    DocumentNotFoundError,
    NetworkError,
    RateLimitExceededError,
    ResourceNotFoundError,
    ValidationError,
)
from .http_client import http_client

log = structlog.get_logger()

PORTAL_BASE = "https://www.portaledelmassimario.ipzs.it"
USER_AGENT = "VisuaLex (+https://github.com/capazme/VisuaLexAPI)"
MIN_INTERVAL = float(os.getenv("MASSIMARIO_MIN_INTERVAL", "1.5"))
INVALID_RETRIES = 3
INVALID_PAUSE = float(os.getenv("MASSIMARIO_INVALID_PAUSE", "10"))

_PATHS = {
    "index": "/publicServices/{id}/getIndex.do",
    "capitolo": "/publicServices/{id}/getCapitolo.do?activateLinks=true",
    "sezione": "/publicServices/{id}/getSezione.do?activateLinks=true",
}
# ASCII digits only: `\d` alone accepts other scripts' digits, which do not belong in a URL.
_ID = re.compile(r"[0-9]{1,9}", re.ASCII)

_lock = asyncio.Lock()
_last_request_at = 0.0


def build_url(kind: str, element_id: str) -> str:
    """The portal URL for one element; raises ValidationError on anything else."""
    if kind not in _PATHS:
        raise ValidationError(f"kind non valido: atteso uno tra {', '.join(sorted(_PATHS))}")
    if not _ID.fullmatch(element_id or ""):
        raise ValidationError("id non valido: atteso un numero")
    return PORTAL_BASE + _PATHS[kind].format(id=element_id)


async def _paced_get(url: str) -> str:
    global _last_request_at
    async with _lock:
        wait = _last_request_at + MIN_INTERVAL - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        try:
            result = await http_client.request(
                "GET", url, source="massimario", headers={"User-Agent": USER_AGENT}
            )
        finally:
            _last_request_at = time.monotonic()
    return result.text


async def fetch_element(kind: str, element_id: str) -> dict[str, Any]:
    """Return the portal's `objectData` for one element, as served."""
    url = build_url(kind, element_id)
    for attempt in range(INVALID_RETRIES + 1):
        try:
            text = await _paced_get(url)
        except DocumentNotFoundError as exc:
            raise ResourceNotFoundError(f"elemento {kind} {element_id} non trovato sul portale") from exc
        if "Request Rejected" in text[:500]:
            raise RateLimitExceededError("il firewall del portale ha rifiutato la richiesta")
        try:
            payload = json.loads(text)
        except ValueError:
            payload = None
        if isinstance(payload, dict) and payload.get("valid") is True:
            return payload.get("objectData") or {}
        log.warning("massimario.invalid_payload", url=url, attempt=attempt + 1, head=text[:120])
        if attempt < INVALID_RETRIES:
            await asyncio.sleep(INVALID_PAUSE * (attempt + 1))
    raise NetworkError(
        f"risposta non valida dal portale dopo {INVALID_RETRIES + 1} tentativi: {kind} {element_id}"
    )
