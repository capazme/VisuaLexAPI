"""POST /fetch_decision_pdf: the court's own PDF of a Cassazione decision (design 2026-10-05
§12.2). The bytes a lookup cached, or fetched once; served only behind the login."""
from __future__ import annotations

from typing import Any

import structlog

from .model import FIRST_YEAR, MAX_NUMERO, Identity
from .resolver import _SOURCE_ERRORS, get_resolver

log = structlog.get_logger()


def _identity(body: Any, current_year: int) -> Identity | dict[str, str]:
    if not isinstance(body, dict):
        return {"body": "atteso un oggetto JSON"}
    errors: dict[str, str] = {}
    if body.get("corte") != "cassazione":
        errors["corte"] = "solo la Corte di cassazione ha il PDF originale"
    if body.get("archivio") not in ("civile", "penale"):
        errors["archivio"] = "atteso civile o penale"
    numero, anno = body.get("numero"), body.get("anno")
    if not isinstance(numero, int) or isinstance(numero, bool) or not 1 <= numero <= MAX_NUMERO:
        errors["numero"] = f"atteso un numero da 1 a {MAX_NUMERO}"
    if (not isinstance(anno, int) or isinstance(anno, bool)
            or not FIRST_YEAR["cassazione"] <= anno <= current_year):
        errors["anno"] = "anno non valido"
    return errors or Identity("cassazione", numero, anno, body["archivio"])


async def fetch_decision_pdf(body: Any, current_year: int) -> tuple[bytes | dict, int, dict[str, str]]:
    """(bytes or a JSON answer, status, headers). Only bytes that start with `%PDF-` are served."""
    identity = _identity(body, current_year)
    if isinstance(identity, dict):
        return {"esito": "richiesta_non_valida", "errori": identity}, 400, {}
    try:
        data = await get_resolver().original_pdf(identity)
    except _SOURCE_ERRORS as exc:
        log.warning("Original PDF unreachable", key=identity.key(), error=str(exc),
                    error_type=type(exc).__name__)
        return {"esito": "fonte_non_raggiungibile", "fonte": "cassazione"}, 503, {}
    if not data or not data.startswith(b"%PDF-"):
        return {"esito": "non_disponibile"}, 404, {}
    short = "civ" if identity.archivio == "civile" else "pen"
    return data, 200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": f'attachment; filename="Cass_{short}_n_{identity.numero}_{identity.anno}.pdf"',
        "X-Content-Type-Options": "nosniff",
    }
