"""Corte di cassazione from the CED's Solr endpoint (SentenzeWeb).

Three things to know before editing.

Coverage is a rolling five years: SentenzeWeb publishes the most recent five,
and decisions age out. An empty answer therefore means "nothing in the last
five years", never "nothing" — which is why `coverage` is filled in.

The link to a norm is a string match over the decision's OCR text, so every
row is `LinkKind.MATCHED`. `build_norma_query` deliberately never emits a
bare "art. N" without the act it names: a decision citing art. 2043 of the
code of civil procedure would otherwise land in the results for art. 2043 of
the civil code, and the lawyer would be reading case law about the wrong
article. When no act can be identified at all, `build_norma_query` returns
`None` and the caller must not run any query — see `cerca_per_norma`.

Every value spliced into a Solr query is escaped with `_escape_phrase`: this
is a Ministry of Justice endpoint reachable from a free-text field (Task 8),
and an unescaped double quote closes a phrase clause early, turning the rest
of the caller's input into live query syntax (`OR *:*` matches everything).
"""
from __future__ import annotations

import json
import re

import structlog

from ...tools.tls import italgiure_ssl_context
from ..http_client import http_client
from .base import Decisione, LinkKind, SourceResult, http_headers

log = structlog.get_logger()

_BASE = "https://www.italgiure.giustizia.it/sncass"
_SELECT = f"{_BASE}/isapi/hc.dll/sn.solr/sn-collection/select?app.query"
_DOC = f"{_BASE}/?dsm=0&provvedimento="

# Any alphabetic tail, not an enumerated ordinal list (gotcha 9) — Normattiva
# goes well past "decies" ("2409 octiesdecies" exists in the civil code).
#
# The tail requires at least two letters in a row (`{2,}`), not one. Every
# real Italian ordinal suffix (bis, ter, quater, ... octiesdecies) is at
# least three letters; a single letter is not a suffix, it is the start of an
# abbreviation like "c.c." or "c.p.c.". `[a-z]+` alone swallowed the "c" of
# "art. 2043 c.c." into the article number (captured "2043 c", leaving only
# ".c." as the act text) — the periods in the abbreviation break any run of
# 2+ letters, so `{2,}` leaves those abbreviations untouched.
_ART = re.compile(r"(?:art\.?|articolo)\s*(\d+(?:[-\s][a-z]{2,})?)", re.I)


def _escape_phrase(value: str) -> str:
    """Escape a value bound for a double-quoted Solr phrase clause.

    Every value this function touches ends up inside `"..."`; the only way
    out of a quoted phrase is an unescaped double quote (Solr's own escape
    character is backslash, so an unescaped backslash right before a real
    quote does it too). Escaping those two — backslash first, so the
    backslash added for the quote below isn't itself re-escaped — keeps the
    value inside the phrase no matter what it contains, which closes the
    whole class of injection: `art. 2043" OR *:*` can no longer terminate
    the clause and turn `OR *:*` into live query syntax.

    Other Solr special characters (wildcards, boolean operators, field
    delimiters) carry no meaning inside an intact phrase — Solr tokenises
    phrase content through the field's analyzer, not the query parser — so
    leaving them unescaped preserves legitimate references such as
    "2409-octiesdecies" instead of mangling them.
    """
    return value.replace("\\", "\\\\").replace('"', '\\"')


def build_norma_query(riferimento: str) -> str | None:
    """A Solr `ocr:` clause whose every variant keeps the act it belongs to.

    The act name can sit on either side of the article number ("art. 2043
    c.c." or "codice civile art. 2043"); whichever side actually carries text
    is what gets spliced into the phrase, in the order it was written — never
    reordered into a phrase nobody writes.

    Returns `None` when an article number was recognised but no act names it
    on either side (e.g. a bare "art. 2043"). Running a query in that case
    would return case law about "art. N" of every code, indistinguishable
    from an answer about the one the lawyer meant — an unsafe bare-article
    clause, just reached from a different branch. The caller must treat
    `None` as "nothing safe to search", not as an empty string.
    """
    riferimento = riferimento.strip()
    m = _ART.search(riferimento)
    if not m:
        # No article recognised at all: no numero to conflate across codes,
        # so searching the raw reference verbatim carries none of the risk
        # above.
        return f'ocr:("{_escape_phrase(riferimento)}")' if riferimento else 'ocr:("")'

    numero = _escape_phrase(m.group(1).strip())
    dopo = _escape_phrase(riferimento[m.end():].strip(" ,;"))
    prima = _escape_phrase(riferimento[:m.start()].strip(" ,;"))

    if dopo:
        variants = [
            f'"art. {numero} {dopo}"',
            f'"articolo {numero} {dopo}"',
            f'"{numero} {dopo}"',
        ]
    elif prima:
        # The act precedes the number ("codice civile art. 2043"): keep that
        # order, don't splice it after the number where nobody writes it.
        variants = [
            f'"{prima} art. {numero}"',
            f'"{prima} articolo {numero}"',
            f'"{prima} {numero}"',
        ]
    else:
        return None

    return "ocr:(" + " OR ".join(variants) + ")"


def _scalar(value) -> str:
    """Solr answers most `fl` fields as a scalar, but `datdep` comes back as a
    single-element JSON array even though the field only ever holds one
    value (measured live). `str()` on a list stringifies the Python
    repr — `"['20250702']"` — instead of the date, so multivalued fields are
    unwrapped to their first entry before being stored."""
    if isinstance(value, list):
        return str(value[0]) if value else ""
    return str(value) if value is not None else ""


class ItalgiureAdapter:
    organo = "Cassazione"
    coverage = "ultimi 5 anni"

    async def _query(self, q: str, limite: int) -> dict:
        ctx = await italgiure_ssl_context()
        # Session cookie first: the endpoint rejects a cold session. The
        # shared ClientSession keeps a cookie jar, so this is the whole
        # handshake.
        await http_client.request(
            "GET", f"{_BASE}/", source="italgiure", ssl=ctx, headers=http_headers()
        )
        result = await http_client.request(
            "POST", _SELECT, source="italgiure", ssl=ctx,
            data={"q": q, "rows": str(limite), "wt": "json",
                  "fl": "numdec,anno,szdec,datdep", "sort": "score desc"},
            headers=http_headers({"Referer": f"{_BASE}/",
                                  "X-Requested-With": "XMLHttpRequest"}),
        )
        return json.loads(result.text)

    def _to_result(self, data: dict) -> SourceResult:
        decisioni = [
            Decisione(
                organo=self.organo,
                numero=_scalar(doc.get("numdec")),
                anno=int(_scalar(doc.get("anno")) or 0),
                sezione=_scalar(doc.get("szdec")),
                data=_scalar(doc.get("datdep")),
                link_kind=LinkKind.MATCHED,
                url=f"{_DOC}{_scalar(doc.get('anno'))}-{_scalar(doc.get('numdec'))}",
            )
            for doc in data.get("response", {}).get("docs", [])
        ]
        return SourceResult(organo=self.organo, decisioni=decisioni, ok=True,
                            coverage=self.coverage)

    async def cerca_per_norma(self, riferimento: str, limite: int = 10) -> SourceResult:
        query = build_norma_query(riferimento)
        if query is None:
            # No act names the article on either side: a query here would
            # return decisions about "art. N" of every code, presented as if
            # they answered the one the lawyer typed. An honest empty answer
            # beats a confident wrong one — the posture of this whole design.
            return SourceResult(
                organo=self.organo, decisioni=[], ok=True,
                coverage="il riferimento non indica l'atto di appartenenza: "
                         "specificarlo (es. \"c.c.\") per poter cercare",
            )
        try:
            # Parsing is inside the same try as the request: a malformed
            # field (e.g. a non-numeric "anno") must become ok=False, not
            # raise out of the adapter past its own error boundary.
            data = await self._query(query, limite)
            return self._to_result(data)
        except Exception as exc:  # noqa: BLE001 — reported, never swallowed
            log.warning("Italgiure query failed", riferimento=riferimento, error=str(exc))
            return SourceResult(organo=self.organo, ok=False, error=str(exc),
                                coverage=self.coverage)

    async def cerca_libera(self, testo: str, limite: int = 10) -> SourceResult:
        try:
            data = await self._query(f'ocr:("{_escape_phrase(testo)}")', limite)
            return self._to_result(data)
        except Exception as exc:  # noqa: BLE001 — reported, never swallowed
            log.warning("Italgiure free search failed", testo=testo[:60], error=str(exc))
            return SourceResult(organo=self.organo, ok=False, error=str(exc),
                                coverage=self.coverage)

    async def leggi(self, numero: str, anno: int) -> Decisione | None:
        """Never fabricates a result: only returns a `Decisione` built from a
        doc Solr actually returned. An empty `docs` list means "not found",
        answered as `None`, not a synthesised row for the number requested."""
        try:
            q = (f'numdec:"{_escape_phrase(str(numero))}" '
                 f'AND anno:"{_escape_phrase(str(anno))}"')
            data = await self._query(q, 1)
            result = self._to_result(data)
        except Exception as exc:  # noqa: BLE001 — reported, never swallowed
            log.warning("Italgiure lookup failed", numero=numero, anno=anno, error=str(exc))
            return None
        return result.decisioni[0] if result.decisioni else None
