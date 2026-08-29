"""Giurisprudenza from the MEF's Documentazione economica e finanziaria.

Not the tax court. One search returns Corte di cassazione, Corte costituzionale
and the Commissioni tributarie together, and it reaches back to at least 1979 —
seventy years more than Italgiure's rolling five. The issuing body is read off
each row, never assumed.

Its link to a norm is the weakest of the four: a literal phrase match. Asking
for "articolo 2043" finds decisions; asking for "art. 36-bis" finds none,
because hyphenated ordinals break the index. Callers get `LinkKind.MATCHED` and
should not read an empty answer as "no case law".

The index also only holds the spelled-out form. Every reference this API
builds is abbreviated ("art. 2043 c.c."), and searching that verbatim as an
exact phrase (measured live) always returns zero — "art. 2043 c.c." / "art.
2043" / "2043 c.c." all give 0, "articolo 2043" gives non-zero. `cerca_per_norma`
therefore reformulates: it pulls the article number out of the reference and
searches "articolo N", dropping everything else, including the act. Asking
for the act too ("articolo 2043 codice civile") would just recreate the
literal-phrase problem this class already has — CeRDEF's index does not
reliably hold that longer phrase either.

Dropping the act is the same shape of ambiguity `italgiure.py`'s
`build_norma_query` refuses to run (a bare "art. N" can't tell art. 2043 c.c.
from art. 2043 c.p.c.), accepted here for three reasons specific to this
source: the corpus is tax-focused, so the collision surface is narrower than
a general-purpose court archive; every row was already `LinkKind.MATCHED`, an
inference rather than a source-declared citation, so this adds imprecision to
a field that was never exact; and each row carries the issuing court parsed
off the row itself, which is the signal a lawyer actually uses to judge
whether a hit is on point. `coverage` says so explicitly, so the imprecision
travels with the answer instead of only living in this comment. A reference
that names no article number at all is refused outright — no article number
means nothing to search for that couldn't also just be noise — and returns an
empty, `ok=True` result rather than a phrase search on the raw string,
mirroring the refusal in `italgiure.build_norma_query`.

The hidden form fields below are load-bearing. Sending only the visible ones
returns "errore sconosciuto"; a sibling client (mcp-legal-it) posts a different,
smaller field set and does not send these — this one was verified against the
live form.
"""
from __future__ import annotations

import re

import structlog

from .base import Decisione, LinkKind, SourceResult, http_headers
from .http_client import case_law_http_client as http_client

log = structlog.get_logger()

_EP = "https://def.finanze.it/DocTribFrontend/executeAdvancedGiurisprudenzaSearch.do"

# `\s+`/`\s*` around the assignment tolerate the whitespace variance real pages
# show (single space is typical, but nothing here guarantees it).
_XML_VAR = re.compile(r"var\s+xmlResult\s*=\s*'(.*?)'\s*;", re.S)
_ESTREMI = re.compile(r"<estremi[^>]*>(.*?)</estremi>", re.S)
# "Sentenza del 18/07/2026 n. 23488 - Corte di Cassazione - Sezione/Collegio 3"
# "Ordinanza interlocutoria del 01/01/2020 n. 100 - Corte di Cassazione - ..."
#
# Two groups are deliberately not `\w+`/`[^-]+?`, because a char class that
# is too narrow does not just mis-parse a row — it makes `_ROW` fail to match
# at all, and the row is silently dropped (`if not m` below), shrinking the
# result set with no signal:
#
# - `tipo` is `.+?` (lazy, any character), not `\w+`. `\w+` only ever matches
#   a single token, so a real, multi-word provvedimento type such as
#   "Ordinanza interlocutoria" fails to match. It is anchored on the literal
#   `\s+del\s+` that always follows the type, so it cannot run away and
#   swallow the rest of the line.
# - `organo` is `.+?` (any character, including a hyphen), not `[^-]+?`. CeRDEF
#   mixes four courts in one feed, and some of their names carry an internal
#   hyphen as part of the name itself (e.g. a regional tax commission rendered
#   "Comm. Trib. Reg. - Abruzzo"). A char class that excludes '-' truncates the
#   organo at that internal hyphen and then fails to match at all, because
#   nothing after it looks like "Sezione/Collegio". Anchoring on the literal
#   "Sezione/Collegio" tail (present or not) instead of on the first bare
#   hyphen lets the lazy quantifier walk past any hyphen that belongs to the
#   organo's own name.
_ROW = re.compile(
    r"^(?P<tipo>.+?)\s+del\s+(?P<data>\d{2}/\d{2}/(?P<anno>\d{4}))\s+"
    r"n\.\s*(?P<numero>[\w-]+)\s*-\s*(?P<organo>.+?)"
    r"(?:\s*-\s*Sezione/Collegio\s*(?P<sez>.+))?$"
)

# Deliberately NOT the same shape as `italgiure.py`'s `_ART` (gotcha 9 — treat
# any alphabetic tail as a suffix, not an enumerated ordinal list). That rule
# is safe for `italgiure` because it splices `numero` back together with
# everything after it into one query, so an over-matched suffix loses
# nothing. This adapter keeps only `numero` and drops the rest of the
# reference, so an over-match is real data loss, not redundancy — and "any
# lowercase word" over-matches constantly, because most of what follows an
# article number in the references this API builds
# (`caseLawService.buildCaseLawReference`) is a lowercase act name: "art. 3
# legge n. 241 del 1990", "art. 33 codice del consumo", "art. 1 preleggi".
# Measured live before this fix: the space-separated group swallowed the
# first word of the act every time, and CeRDEF's index does not hold that
# longer phrase — "articolo 33 codice" returns 0 where "articolo 33" returns
# 10; "articolo 3 legge" returns 6 where "articolo 3" returns 10.
#
# The fix enumerates the real ordinal suffixes instead, for the
# SPACE-separated form only — the HYPHENATED form stays free
# (`-[a-z]{2,}`, any letters). A hyphen never separates an article number
# from the first word of an act name in this API's own references, so there
# is no over-match risk to guard against there, and staying permissive is
# what lets an ordinal past this list (Normattiva goes well past "decies",
# e.g. the civil code's own "2409 octiesdecies") still parse whole, exactly
# as Normattiva itself renders it — hyphenated, never space-separated
# ("2409-octiesdecies", never "2409 octiesdecies").
_ORDINALI = (
    r"bis|ter|quater|quinquies|sexies|septies|octies|novies|decies|"
    r"undecies|duodecies|terdecies|quaterdecies|quinquiesdecies|"
    r"sexiesdecies|septiesdecies|octiesdecies|noviesdecies"
)
_ART = re.compile(
    r"(?:(?i:art\.?|articolo))\s*"
    r"(\d+(?:-[a-z]{2,}|\s+(?:" + _ORDINALI + r")\b)?)"
)


def _extract_xml(page: str) -> str:
    m = _XML_VAR.search(page)
    if not m:
        return ""
    return m.group(1).replace("\\/", "/").replace('\\"', '"').replace("\\'", "'")


class CerdefAdapter:
    organo = "CeRDEF"
    coverage = (
        "Cassazione, Corte cost. e Commissioni tributarie, dal 1979 — il "
        "collegamento alla norma è per solo numero di articolo, senza il "
        "codice di appartenenza: precisione minore delle altre fonti"
    )

    async def _fetch_page(self, parole: str, criterio: str) -> str:
        """POST the search after the session-cookie GET; returns the raw HTML.

        Split out of `_search` so a caller that needs to verify parsing
        coverage independently (the live test does — comparing the raw
        `<estremi>` count against `_ROW`'s output) can fetch the exact same
        page without duplicating the form fields or the two-request
        handshake."""
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
        # Session cookie first: the endpoint rejects a cold session. The
        # shared ClientSession keeps a cookie jar, so this is the whole
        # handshake.
        await http_client.request("GET", _EP, source="cerdef",
                                  headers=http_headers())
        result = await http_client.request(
            "POST", _EP, source="cerdef", data=form,
            headers=http_headers({"Referer": _EP}),
        )
        return result.text

    async def _search(self, parole: str, criterio: str, limite: int) -> SourceResult:
        try:
            page = await self._fetch_page(parole, criterio)
        except Exception as exc:  # noqa: BLE001 — reported, never swallowed
            log.warning("CeRDEF search failed", parole=parole[:60], error=str(exc))
            return SourceResult(organo=self.organo, ok=False, error=str(exc),
                                coverage=self.coverage)

        xml = _extract_xml(page)
        decisioni: list[Decisione] = []
        for estremi in _ESTREMI.findall(xml)[:limite]:
            testo = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", estremi)).strip()
            m = _ROW.match(testo)
            if not m:
                # A row CeRDEF sent but this parser cannot read is not the
                # same as "no such row" — dropping it silently would shrink
                # the lawyer's result count with no way to notice (gotcha
                # 18). Logging the raw text is what lets the next shape
                # CeRDEF invents show up in the logs instead of quietly
                # vanishing.
                log.warning("CeRDEF row did not match the expected shape",
                           estremi=testo[:200])
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
        """Reformulates into the spelled-out phrasing CeRDEF's index actually
        holds, dropping the act. See the module docstring for why that
        tradeoff is accepted for this source specifically, and why a
        reference with no article number is refused rather than searched
        verbatim."""
        m = _ART.search(riferimento)
        if not m:
            # No article number to extract: searching the raw reference as a
            # phrase would be noise, not a match — same posture as
            # `italgiure.build_norma_query` refusing an unsafe query instead
            # of running one.
            return SourceResult(
                organo=self.organo, decisioni=[], ok=True,
                coverage="il riferimento non indica un numero di articolo: "
                         "specificarlo per poter cercare",
            )
        numero = m.group(1).strip()
        # Exact phrase: the index matches literally, so "tutte le parole"
        # would return decisions containing the words anywhere, which is
        # noise.
        return await self._search(f"articolo {numero}", criterio="2", limite=limite)

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
