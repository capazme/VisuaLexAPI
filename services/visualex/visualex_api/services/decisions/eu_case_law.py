"""POST /search_eu_case_law: the decisions of the Union's courts that cite an article of an act
(design 2026-10-12, «Giurisprudenza» §D1).

The source is CELLAR, the Publications Office's repository, the one `curia.py` reads. A decision's
link to the legislation it cites is reified there: an `owl:Axiom` whose `owl:annotatedSource` is
the decision, whose `owl:annotatedTarget` is the act (found by its CELEX) and whose
`annotation:fragment_cited_target` is a literal such as `A06P1L1LB` (article 6, paragraph 1, …;
the article may be written `A6` or `A06`). One SPARQL query per article returns the citing
decisions with CELEX, ECLI, date and type.

The list is not complete: the article-level fragments arrive late for recent cases and are thin
before 2021 (measured on 12 October 2026), which is why the web block says so. A source that
cannot be reached, or answers something unreadable, is `fonte_non_raggiungibile`, never an empty
list.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import re
from typing import Any

import structlog

from ...tools.cache_manager import get_cache_manager
from ...tools.exceptions import DocumentNotFoundError, NetworkError
from .curia import COURTS, SPARQL_URL, case_label
from .http import decisions_http_client, http_headers

log = structlog.get_logger()

EU_CASE_LAW_NS = "eu_case_law"  # one answer per (celex, article); the TTL is set in cache_manager
EU_TIMEOUT = 25.0
_REQUEST_TIMEOUT = 20
ROW_LIMIT = 500
# Prefix of the cache key: bump it whenever the shape of the answer changes.
CACHE_VERSION = "v1"

#: `work_has_resource-type` → the answer's `tipo`. Any other type (a notice, an opinion of the
#: Court under art. 218 TFEU, …) is left out by the query itself.
TYPES = {"JUDG": "JUDG", "ORDER": "ORDER", "OPIN_AG": "OPIN_AG"}
_TYPE_URI = "http://publications.europa.eu/resource/authority/resource-type/"

# The act by its CELEX («32016R0679», a treaty's «12012E/TXT») and the article as digits: both
# enter the query, so both are checked against these patterns first. ASCII only.
_ACT_CELEX = re.compile(r"[0-9]\d{4}[A-Z]{1,2}(?:\d{4}|/[A-Z]{3})", re.ASCII)
_ARTICLE = re.compile(r"[1-9]\d{0,3}", re.ASCII)
# A decision's CELEX: 6, the case's year, the court's letter (C or T), the kind of document, the
# number. The Civil Service Tribunal's (F, closed in 2016) is not a court of the table: left out.
_DECISION_CELEX = re.compile(r"^6(\d{4})([CT])[A-Z](\d{4})$", re.ASCII)
_COURT_OF_LETTER = {letter: corte for corte, (letter, _kind) in COURTS.items()}

_XSD_STRING = "<http://www.w3.org/2001/XMLSchema#string>"


def validate(celex: Any, articolo: Any) -> dict[str, str]:
    errors: dict[str, str] = {}
    if not isinstance(celex, str) or not _ACT_CELEX.fullmatch(celex):
        errors["celex"] = "Atteso il CELEX dell'atto (es. 32016R0679)"
    if isinstance(articolo, int) and not isinstance(articolo, bool):
        articolo = str(articolo)
    if not isinstance(articolo, str) or not _ARTICLE.fullmatch(articolo):
        errors["articolo"] = "Atteso il numero dell'articolo (es. 6)"
    return errors


def sparql_query(celex: str, articolo: str) -> str:
    """The query. `celex` and `articolo` are checked here too: nothing a caller wrote enters it
    unchecked, even if a caller forgot `validate`."""
    if validate(celex, articolo):
        raise ValueError("CELEX o articolo non validi")
    types = ", ".join(f"<{_TYPE_URI}{name}>" for name in TYPES)
    return (
        "PREFIX cdm: <http://publications.europa.eu/ontology/cdm#> "
        "PREFIX owl: <http://www.w3.org/2002/07/owl#> "
        "PREFIX annotation: <http://publications.europa.eu/ontology/annotation#> "
        "SELECT DISTINCT ?celex ?ecli ?date ?type WHERE { "
        f'?act cdm:resource_legal_id_celex "{celex}"^^{_XSD_STRING} . '
        "?axiom owl:annotatedTarget ?act ; owl:annotatedSource ?dec ; "
        "annotation:fragment_cited_target ?fragment . "
        # «A6», «A06», «A06P1», «A06L…»: never «A60» for article 6
        f'FILTER(REGEX(STR(?fragment), "^A0?{articolo}($|[PL])")) '
        "?dec cdm:resource_legal_id_celex ?celex ; cdm:work_date_document ?date ; "
        "cdm:work_has_resource-type ?type . "
        f"FILTER(?type IN ({types})) "
        "OPTIONAL { ?dec cdm:case-law_ecli ?ecli } "
        f"}} ORDER BY DESC(?date) ?celex LIMIT {ROW_LIMIT}"
    )


def decisions_from_sparql(payload: Any) -> tuple[list[dict[str, Any]], bool]:
    """(the decisions, newest first, one per CELEX; whether the query hit its row limit).
    Raises ValueError on a payload that is not a SPARQL answer."""
    results = payload.get("results") if isinstance(payload, dict) else None
    rows = results.get("bindings") if isinstance(results, dict) else None
    if not isinstance(rows, list):
        raise ValueError("SPARQL: risposta non leggibile")
    found: dict[str, dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        value = lambda key: (row.get(key) or {}).get("value")  # noqa: E731
        celex, type_uri, date = value("celex"), value("type"), value("date")
        m = _DECISION_CELEX.match(celex) if isinstance(celex, str) else None
        tipo = TYPES.get(type_uri.rsplit("/", 1)[-1]) if isinstance(type_uri, str) else None
        if not m or tipo is None:
            continue
        anno, letter, numero = int(m.group(1)), m.group(2), int(m.group(3))
        # the Court of Justice wrote no letter before 1989 («26/62»)
        label = case_label(None if letter == "C" and anno < 1989 else letter, numero, anno)
        ecli = value("ecli")
        found.setdefault(celex, {
            "corte": _COURT_OF_LETTER[letter],
            "causa": label,
            "ecli": ecli if isinstance(ecli, str) and ecli else None,
            "data": date if isinstance(date, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", date) else None,
            "tipo": tipo,
            "celex": celex,
        })
    decisions = sorted(found.values(), key=lambda d: (d["data"] or "", d["celex"]), reverse=True)
    return decisions, len(rows) >= ROW_LIMIT


async def _query(sparql: str) -> Any:
    result = await decisions_http_client.request(
        "GET", SPARQL_URL, source="curia", params={"query": sparql}, timeout=_REQUEST_TIMEOUT,
        max_retries=1, headers=http_headers({"Accept": "application/sparql-results+json"}))
    if any(k.lower().startswith("x-sql-") for k in result.headers):
        # Virtuoso's «anytime» answer: cut short by its own timeout, possibly empty
        raise ValueError("SPARQL: risposta parziale")
    return json.loads(result.text)


def get_cache():
    return get_cache_manager().get_persistent(EU_CASE_LAW_NS)


_SOURCE_ERRORS = (NetworkError, DocumentNotFoundError, asyncio.TimeoutError, ValueError, OSError)


async def search_eu_case_law(celex: Any, articolo: Any) -> tuple[dict, int]:
    """(the answer, the status): `risultati` 200, `richiesta_non_valida` 400,
    `fonte_non_raggiungibile` 503. Only an answer the source gave is cached."""
    errors = validate(celex, articolo)
    if errors:
        return {"esito": "richiesta_non_valida", "errori": errors}, 400
    articolo = str(articolo)
    key = hashlib.sha256(json.dumps([CACHE_VERSION, celex, articolo]).encode()).hexdigest()
    cache = get_cache()
    try:
        cached = await cache.get(key)
    except Exception as exc:  # noqa: BLE001 - a broken cache costs a request, not the answer
        log.warning("EU case law cache not read", error_type=type(exc).__name__)
        cached = None
    if cached is not None:
        return cached, 200
    try:
        payload = await asyncio.wait_for(_query(sparql_query(celex, articolo)), EU_TIMEOUT)
        decisions, truncated = decisions_from_sparql(payload)
    except _SOURCE_ERRORS as exc:
        log.warning("EU case law search failed", error=str(exc), error_type=type(exc).__name__)
        return {"esito": "fonte_non_raggiungibile", "fonte": "curia"}, 503
    answer = {"esito": "risultati", "celex": celex, "articolo": articolo,
              "totale": len(decisions), "troncato": truncated, "decisioni": decisions}
    try:
        await cache.set(key, answer)
    except Exception as exc:  # noqa: BLE001
        log.warning("EU case law answer not cached", error_type=type(exc).__name__)
    return answer, 200
