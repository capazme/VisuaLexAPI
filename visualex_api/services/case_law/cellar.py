"""CJEU case law from the EU Publications Office's CELLAR endpoint.

The only source in this package whose link to a norm is a fact rather than an
inference: `cdm:work_cites_work` is a citation graph the publisher declares, so
everything here is `LinkKind.CITED`. Public SPARQL, no authentication, no
coverage cut-off. Measured; see the spec.
"""
from __future__ import annotations

import json
import re
import urllib.parse
from datetime import date

import structlog

from ..http_client import http_client
from .base import Decisione, LinkKind, SourceResult, http_headers

log = structlog.get_logger()

_ENDPOINT = "https://publications.europa.eu/webapi/rdf/sparql"
_EURLEX_DOC = "https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:"

# A regulation/directive reference names a year and a number, in either
# order, and CELLAR keys on CELEX rather than on either digit group alone.
# The two groups below are captured in whatever order they appear on the
# page; _year_and_number() then decides which one is the year by
# plausibility, not by which alternative the regex tried first — a four-digit
# *number* (pre-2015 regulations went well into four digits, e.g. Reg. (CE)
# 1234/2007) is common enough that digit count alone cannot disambiguate.
#
#   "Regolamento UE 2016/679"    -> 32016R0679  (modern order, year/num)
#   "Regolamento UE n. 679/2016" -> 32016R0679  (legacy order, num/year)
#   "Regolamento UE 679/2016"    -> 32016R0679  (legacy order, no "n.")
#   "Regolamento UE 1234/2007"   -> 32007R1234  (legacy order, 4-digit number)
#   "Direttiva UE 2019/790"      -> 32019L0790  ("UE" before the digits)
#   "Direttiva 2019/790/UE"      -> 32019L0790  ("UE" after the digits)
_REG = re.compile(r"regolamento\s+ue\s+(?:n\.\s*)?(\d{1,4})/(\d{1,4})", re.I)
_DIR = re.compile(r"direttiva\s+(?:ue\s+(?:n\.\s*)?)?(\d{1,4})/(\d{1,4})(?:/ue)?", re.I)

_MIN_PLAUSIBLE_YEAR = 1950


def _year_and_number(a: str, b: str) -> tuple[str, str] | None:
    """Pick which of two digit groups is the year, by plausibility rather
    than position. Returns None when both groups are plausible years or
    neither is — a false mapping would return another act's case law under
    the norm the lawyer asked about, and returning nothing is the safer
    failure."""
    max_year = date.today().year + 1
    a_is_year = _MIN_PLAUSIBLE_YEAR <= int(a) <= max_year
    b_is_year = _MIN_PLAUSIBLE_YEAR <= int(b) <= max_year
    if a_is_year and not b_is_year:
        return a, b
    if b_is_year and not a_is_year:
        return b, a
    return None


def _celex_from_riferimento(riferimento: str) -> str | None:
    m = _REG.search(riferimento)
    if m:
        pair = _year_and_number(m.group(1), m.group(2))
        if pair is None:
            return None
        anno, num = pair
        return f"3{anno}R{int(num):04d}"
    m = _DIR.search(riferimento)
    if m:
        pair = _year_and_number(m.group(1), m.group(2))
        if pair is None:
            return None
        anno, num = pair
        return f"3{anno}L{int(num):04d}"
    return None


_QUERY = """PREFIX cdm:<http://publications.europa.eu/ontology/cdm#>
SELECT DISTINCT ?celex ?ecli WHERE {
  ?norma cdm:resource_legal_id_celex '%s'^^<http://www.w3.org/2001/XMLSchema#string> .
  ?sent cdm:work_cites_work ?norma .
  ?sent cdm:resource_legal_id_celex ?celex .
  OPTIONAL { ?sent cdm:case-law_ecli ?ecli }
  FILTER(STRSTARTS(STR(?celex),'6'))
} LIMIT %d"""

# leggi() must never hand back a Decisione it did not verify: link_kind=CITED
# is read elsewhere as "the publisher says so", so an unverified CELEX would
# be a fabricated citation, not a cautious guess. This ASK query is the
# verification — a nonexistent CELEX resolves to `false` and leggi() returns
# None, which is what lets Task 8's 404 path fire instead of inventing a case.
_EXISTS_QUERY = """PREFIX cdm:<http://publications.europa.eu/ontology/cdm#>
ASK WHERE {
  ?work cdm:resource_legal_id_celex '%s'^^<http://www.w3.org/2001/XMLSchema#string> .
}"""


class CellarAdapter:
    organo = "CGUE"
    coverage = ""

    async def cerca_per_norma(self, riferimento: str, limite: int = 10) -> SourceResult:
        celex = _celex_from_riferimento(riferimento)
        if celex is None:
            # Not an EU act. A normal question with an empty answer.
            return SourceResult(organo=self.organo, decisioni=[], ok=True)

        query = _QUERY % (celex, limite)
        url = f"{_ENDPOINT}?{urllib.parse.urlencode({'query': query})}"
        try:
            result = await http_client.request(
                "GET", url, source="cellar",
                headers=http_headers({"Accept": "application/sparql-results+json"}),
            )
            data = json.loads(result.text)
        except Exception as exc:  # noqa: BLE001 — reported, never swallowed
            log.warning("CELLAR query failed", riferimento=riferimento, error=str(exc))
            return SourceResult(organo=self.organo, ok=False, error=str(exc))

        seen: set[str] = set()
        decisioni: list[Decisione] = []
        for b in data.get("results", {}).get("bindings", []):
            celex_val = b.get("celex", {}).get("value", "")
            if not celex_val or celex_val in seen:
                continue
            seen.add(celex_val)
            decisioni.append(Decisione(
                organo=self.organo,
                numero=celex_val,
                anno=int(celex_val[1:5]) if celex_val[1:5].isdigit() else 0,
                link_kind=LinkKind.CITED,
                url=_EURLEX_DOC + celex_val,
                ecli=b.get("ecli", {}).get("value", ""),
            ))
        return SourceResult(organo=self.organo, decisioni=decisioni, ok=True)

    async def leggi(self, numero: str, anno: int) -> Decisione | None:
        query = _EXISTS_QUERY % numero
        url = f"{_ENDPOINT}?{urllib.parse.urlencode({'query': query})}"
        try:
            result = await http_client.request(
                "GET", url, source="cellar",
                headers=http_headers({"Accept": "application/sparql-results+json"}),
            )
            data = json.loads(result.text)
        except Exception as exc:  # noqa: BLE001 — reported, never swallowed
            log.warning("CELLAR existence check failed", numero=numero, error=str(exc))
            return None

        if not data.get("boolean", False):
            # CELLAR has no resource under this CELEX. Reporting "not found"
            # beats fabricating a citation for a number nobody confirmed.
            return None

        return Decisione(
            organo=self.organo, numero=numero, anno=anno,
            link_kind=LinkKind.CITED, url=_EURLEX_DOC + numero,
        )

    async def cerca_libera(self, testo: str, limite: int = 10) -> SourceResult:
        # CELLAR is a metadata graph, not a full-text index. Free search belongs
        # to the sources that have one; answering with an empty list here is
        # honest, and the registry labels it.
        return SourceResult(organo=self.organo, decisioni=[], ok=True,
                            coverage="ricerca libera non supportata da CELLAR")
