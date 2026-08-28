"""Giurisprudenza from the MEF's Documentazione economica e finanziaria.

Not the tax court. One search returns Corte di cassazione, Corte costituzionale
and the Commissioni tributarie together, and it reaches back to at least 1979 —
seventy years more than Italgiure's rolling five. The issuing body is read off
each row, never assumed.

Its link to a norm is the weakest of the four: a literal phrase match. Asking
for "articolo 2043" finds decisions; asking for "art. 36-bis" finds none,
because hyphenated ordinals break the index. Callers get `LinkKind.MATCHED` and
should not read an empty answer as "no case law".

The hidden form fields below are load-bearing. Sending only the visible ones
returns "errore sconosciuto"; a sibling client (mcp-legal-it) posts a different,
smaller field set and does not send these — this one was verified against the
live form.
"""
from __future__ import annotations

import re

import structlog

from ..http_client import http_client
from .base import Decisione, LinkKind, SourceResult, http_headers

log = structlog.get_logger()

_EP = "https://def.finanze.it/DocTribFrontend/executeAdvancedGiurisprudenzaSearch.do"

# `\s+`/`\s*` around the assignment tolerate the whitespace variance real pages
# show (single space is typical, but nothing here guarantees it).
_XML_VAR = re.compile(r"var\s+xmlResult\s*=\s*'(.*?)'\s*;", re.S)
_ESTREMI = re.compile(r"<estremi[^>]*>(.*?)</estremi>", re.S)
# "Sentenza del 18/07/2026 n. 23488 - Corte di Cassazione - Sezione/Collegio 3"
#
# `organo` is `.+?` (any character, including a hyphen), not `[^-]+?`. CeRDEF
# mixes four courts in one feed, and some of their names carry an internal
# hyphen as part of the name itself (e.g. a regional tax commission rendered
# "Comm. Trib. Reg. - Abruzzo"). A char class that excludes '-' truncates the
# organo at that internal hyphen and then fails to match at all, because
# nothing after it looks like "Sezione/Collegio" — the row is silently
# dropped. Anchoring on the literal "Sezione/Collegio" tail (present or not)
# instead of on the first bare hyphen lets the lazy quantifier walk past any
# hyphen that belongs to the organo's own name.
_ROW = re.compile(
    r"^(?P<tipo>\w+)\s+del\s+(?P<data>\d{2}/\d{2}/(?P<anno>\d{4}))\s+"
    r"n\.\s*(?P<numero>[\w-]+)\s*-\s*(?P<organo>.+?)"
    r"(?:\s*-\s*Sezione/Collegio\s*(?P<sez>.+))?$"
)


def _extract_xml(page: str) -> str:
    m = _XML_VAR.search(page)
    if not m:
        return ""
    return m.group(1).replace("\\/", "/").replace('\\"', '"').replace("\\'", "'")


class CerdefAdapter:
    organo = "CeRDEF"
    coverage = "Cassazione, Corte cost. e Commissioni tributarie, dal 1979"

    async def _search(self, parole: str, criterio: str, limite: int) -> SourceResult:
        form = {
            "js_enabled": "0", "tipoComplessitaRicerca": "avanzata",
            "ricercaAreaRiservata": "false", "tipoRicerca": "RA", "device": "D",
            "ambitoRicerca": "G", "parole": parole,
            "tipoCriterioRicerca": criterio, "tipo_ord": "DATA", "numero": "",
            "giornoDataEmissioneDa": "", "meseDataEmissioneDa": "",
            "annoDataEmissioneDa": "", "dataEmissioneDa": "",
            "giornoDataEmissioneA": "", "meseDataEmissioneA": "",
            "annoDataEmissioneA": "", "dataEmissioneA": "",
        }
        try:
            # Session cookie first: the endpoint rejects a cold session. The
            # shared ClientSession keeps a cookie jar, so this is the whole
            # handshake.
            await http_client.request("GET", _EP, source="cerdef",
                                      headers=http_headers())
            result = await http_client.request(
                "POST", _EP, source="cerdef", data=form,
                headers=http_headers({"Referer": _EP}),
            )
        except Exception as exc:  # noqa: BLE001 — reported, never swallowed
            log.warning("CeRDEF search failed", parole=parole[:60], error=str(exc))
            return SourceResult(organo=self.organo, ok=False, error=str(exc),
                                coverage=self.coverage)

        xml = _extract_xml(result.text)
        decisioni: list[Decisione] = []
        for estremi in _ESTREMI.findall(xml)[:limite]:
            testo = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", estremi)).strip()
            m = _ROW.match(testo)
            if not m:
                continue
            decisioni.append(Decisione(
                organo=m.group("organo").strip(),
                numero=m.group("numero"),
                anno=int(m.group("anno")),
                sezione=(m.group("sez") or "").strip(),
                data=m.group("data"),
                link_kind=LinkKind.MATCHED,
                url=_EP,
                estratto=testo,
            ))
        return SourceResult(organo=self.organo, decisioni=decisioni, ok=True,
                            coverage=self.coverage)

    async def cerca_per_norma(self, riferimento: str, limite: int = 10) -> SourceResult:
        # Exact phrase: the index matches literally, so "tutte le parole" would
        # return decisions containing the words anywhere, which is noise.
        return await self._search(riferimento, criterio="2", limite=limite)

    async def cerca_libera(self, testo: str, limite: int = 10) -> SourceResult:
        return await self._search(testo, criterio="0", limite=limite)

    async def leggi(self, numero: str, anno: int) -> Decisione | None:
        """Never fabricates a result: only returns a `Decisione` built from a
        row CeRDEF actually returned and that matches both `numero` and
        `anno`. No match — including an empty answer or a search that finds
        only decisions with the same number in a different year — is `None`,
        not a synthesised row for the number requested."""
        result = await self._search(f"n. {numero}", criterio="2", limite=20)
        for d in result.decisioni:
            if d.numero == numero and d.anno == anno:
                return d
        return None
