"""POST /search_decisions: the decisions whose text mentions an article or a topic (design
2026-10-05 §5). Italgiure only, the last five years; a page is cached for a day."""
from __future__ import annotations

import asyncio
import hashlib
import json
from typing import Any

import structlog

from ...tools.cache_manager import get_cache_manager
from .resolver import _SOURCE_ERRORS, ITALGIURE_TIMEOUT, SEARCH_NS, get_resolver
from .search import UnsupportedAct, article_clause, build_query, index_clause, topic_clause

log = structlog.get_logger()
MAX_PAGE = 10
ROWS = 20  # fixed: the client pages by 20
ARCHIVES = ("civile", "penale")
NORMA_FIELDS = ("tipo_atto", "numero_articolo", "numero_atto", "data")
# Prefix of the cache key: bump it whenever the shape of the answer changes, so pages cached
# before are not served again.
CACHE_VERSION = "v1"


def get_searcher():
    return get_resolver().italgiure


def get_cache():
    return get_cache_manager().get_persistent(SEARCH_NS)


async def archive_start(archivio: str) -> str | None:
    start = await get_resolver().archive_start_of(archivio)
    return start[1] if start else None


async def archive_since(archivio: str | None) -> str | None:
    """The first deposit the answer covers: the archive's start, or the earlier of the two when
    both are searched. None if a start is unknown. Never raises: an unknown start must not turn
    a page that was found into an error."""
    results = await asyncio.gather(*(archive_start(a) for a in ([archivio] if archivio else ARCHIVES)),
                                   return_exceptions=True)
    if any(not isinstance(r, str) or not r for r in results):
        return None
    return min(results)


def _errors(body: Any) -> dict[str, str]:
    if not isinstance(body, dict):
        return {"norma": "Serve un articolo o un tema"}
    errors: dict[str, str] = {}
    norma, tema = body.get("norma"), body.get("tema")
    if norma is None and tema is None:
        errors["norma"] = "Serve un articolo o un tema"
    if norma is not None and (not isinstance(norma, dict) or any(
            not isinstance(norma.get(f), (str, int, type(None))) or isinstance(norma.get(f), bool)
            for f in NORMA_FIELDS)):
        errors["norma"] = "L'articolo non è leggibile"
    if tema is not None and not isinstance(tema, str):
        errors["tema"] = "Il tema non è leggibile"
    # an explicit null is the same as the field left out
    pagina = 1 if body.get("pagina") is None else body["pagina"]
    if not isinstance(pagina, int) or isinstance(pagina, bool) or not 1 <= pagina <= MAX_PAGE:
        errors["pagina"] = f"La pagina va da 1 a {MAX_PAGE}"
    if body.get("archivio") not in (None, *ARCHIVES):
        errors["archivio"] = "Archivio non riconosciuto"
    if body.get("modo") not in (None, "indice", "testo"):
        errors["modo"] = "Modo non riconosciuto"
    return errors


async def search_decisions(body: Any) -> tuple[dict, int]:
    errors = _errors(body)
    if errors:
        return {"esito": "richiesta_non_valida", "errori": errors}, 400
    article, archivio_default, coords, hl_query = None, None, None, None
    modo = "testo"
    if body.get("norma") is not None:
        text_clause = None
        try:
            text_clause, archivio_default = article_clause(body["norma"])
        except UnsupportedAct:
            pass
        if (body.get("modo") or "indice") == "indice":
            try:
                article, archivio_default, coords = index_clause(body["norma"])
                modo, hl_query = "indice", text_clause
            except UnsupportedAct:
                pass  # the text way, said in the answer's `modo`
        if article is None:
            if text_clause is None:
                return {"esito": "non_supportata"}, 200
            article = text_clause
    topic = None
    if body.get("tema") is not None:
        try:
            topic = topic_clause(body["tema"])
        except ValueError:
            return {"esito": "richiesta_non_valida",
                    "errori": {"tema": "Il tema non contiene parole"}}, 400
    archivio = body.get("archivio") or archivio_default
    pagina = 1 if body.get("pagina") is None else body["pagina"]
    q = build_query(article, topic, archivio)
    key = hashlib.sha256(json.dumps([CACHE_VERSION, q, pagina, modo, hl_query,
                                     coords and [coords.gen, coords.art]]).encode()).hexdigest()
    cache = get_cache()
    try:
        cached = await cache.get(key)
    except Exception as exc:  # noqa: BLE001 - a broken cache costs a request, not the answer
        log.warning("Search cache not read", error_type=type(exc).__name__)
        cached = None
    if cached is not None:
        return cached, 200
    # the start(s) are read while the search runs; they never raise
    since = asyncio.ensure_future(archive_since(archivio))
    try:
        page = await asyncio.wait_for(
            get_searcher().search(q, pagina, ROWS, coords=coords, hl_query=hl_query),
            ITALGIURE_TIMEOUT)
    except _SOURCE_ERRORS as exc:
        since.cancel()
        log.warning("Decision search failed", error=str(exc), error_type=type(exc).__name__)
        return {"esito": "fonte_non_raggiungibile", "fonte": "cassazione"}, 503
    except BaseException:
        since.cancel()
        raise
    archivio_dal = await since
    answer = {
        "esito": "risultati", "totale": page.totale, "pagina": pagina, "modo": modo,
        "archivio": archivio, "archivio_dal": archivio_dal,
        "decisioni": [{"identita": h.identita.to_dict(), "attributi": h.attributi,
                       "trovata": h.trovata, "frammento": h.frammento} for h in page.decisioni],
    }
    if archivio_dal is not None:  # an answer without its start is not kept for a day
        try:
            await cache.set(key, answer)
        except Exception as exc:  # noqa: BLE001
            log.warning("Search page not cached", error_type=type(exc).__name__)
    return answer, 200
