"""Judgments of the Court of Justice of the EU and of the General Court (design 2026-10-12 §4).

The source is the Publications Office's repository (CELLAR), the repository EUR-Lex serves:
EUR-Lex's own page answers a server with its firewall's challenge (HTTP 202, an empty body,
measured on 12 October 2026), while CELLAR serves the same documents by CELEX. Each judgment
links to its EUR-Lex page, which the reader's browser opens.

A lookup is two requests:

1. One SPARQL query to CELLAR's endpoint: the judgments (CELEX type `CJ` for the Court, `TJ` for
   the General Court) of the case's year whose Italian case identifier holds the number. The
   code keeps only exact case tokens of the right letter («C-594/12» is not «T-594/12» nor
   «C-1594/12»). A judgment on joined cases is filed under the first case: a reference to
   another of them finds it here, and its identity is the first case's.
2. The judgment's Italian XHTML (the Court's own markup since about 2009, `coj-` classes or the
   same classes unprefixed), or, for an older judgment, the HTML EUR-Lex used to publish.

The text keeps the source's characters (root rule 23): each paragraph or table cell becomes a
line, a numbered point's number starts its line («1 La domanda …»), runs of ASCII whitespace
from the markup's layout become one space; nothing else is added, dropped or changed, except
the footnote calls and the footnotes, which are the Court's references to the procedure
language (kept as the attribute `lingua_processuale`), the old format's editorial keywords and
summary (`Parole chiave`, `Massima`), and the General Court's closing table of contents.
`tests/test_decisions_text_frozen.py` pins the projection of synthetic documents.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

import warnings

import structlog
from bs4 import BeautifulSoup, NavigableString, Tag, XMLParsedAsHTMLWarning

from ...tools.exceptions import DocumentNotFoundError
from .http import decisions_http_client, http_headers
from .model import Decision, Identity

log = structlog.get_logger()

SPARQL_URL = "https://publications.europa.eu/webapi/rdf/sparql"
CELLAR_URL = "https://publications.europa.eu/resource/celex/"
# opened by the reader's browser, never fetched (EUR-Lex's firewall refuses a server)
EURLEX_PAGE = "https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:"
SOURCE = {
    "nome": "Corte di giustizia dell'Unione europea — EUR-Lex (Ufficio delle pubblicazioni)",
    "licenza": "Riutilizzo autorizzato con citazione della fonte (decisione 2011/833/UE)",
}

#: corte → (the case's letter, the judgment's CELEX type)
COURTS: dict[str, tuple[str, str]] = {"corte_giustizia_ue": ("C", "CJ"), "tribunale_ue": ("T", "TJ")}
_TIMEOUT = 20

_DASHES = "-‐‑‒–—"
# A case as the source writes it: «C‑634/21», «T-612/17», «26-62» (cases before 1989 have no letter).
_CASE_TOKEN = re.compile(r"(?<![\w/])(?:([CTF])\s*[" + _DASHES + r"]\s*)?(\d{1,4})\s*[" + _DASHES + r"/]\s*(\d{2})(?!\d)")
_CELEX = re.compile(r"^6(\d{4})(CJ|TJ)(\d{4})$")
_ORDINALS = {"prima": "I", "seconda": "II", "terza": "III", "quarta": "IV", "quinta": "V", "sesta": "VI",
             "settima": "VII", "ottava": "VIII", "nona": "IX", "decima": "X"}
_MONTHS = ("gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto",
           "settembre", "ottobre", "novembre", "dicembre")


@dataclass(frozen=True)
class Hit:
    """A judgment the SPARQL query found: its CELEX, ECLI, date, Italian title and case line."""
    celex: str
    ecli: str | None
    date: str | None
    title: str
    cases: str


def case_tokens(text: str) -> list[tuple[str | None, int, int]]:
    """The cases a source's case line names, as (letter, number, two-digit year)."""
    return [(m.group(1).upper() if m.group(1) else None, int(m.group(2)), int(m.group(3)))
            for m in _CASE_TOKEN.finditer(text)]


def case_label(letter: str | None, numero: int, anno: int) -> str:
    """«C-634/21», «T-612/17», «26/62»: the case as the convention writes it (plain dash, a slash)."""
    yy = f"{anno % 100:02d}"
    return f"{letter}-{numero}/{yy}" if letter else f"{numero}/{yy}"


def _letter_matches(token_letter: str | None, corte: str, anno: int) -> bool:
    letter = COURTS[corte][0]
    if token_letter is None:  # the Court of Justice before 1989 wrote no letter
        return corte == "corte_giustizia_ue" and anno < 1990
    return token_letter == letter


def sparql_query(corte: str, numero: int, anno: int, *, by_year: bool = True) -> str:
    """The query: integers and fixed codes only, nothing a caller wrote."""
    celex_type = COURTS[corte][1]
    year = f'cdm:resource_legal_year "{int(anno)}"^^<http://www.w3.org/2001/XMLSchema#gYear> ;' if by_year else ""
    # «634/21» as the source writes a case since 1989, «26-62» before: the code checks the exact
    # token, the filter only keeps the answer small enough for the limit
    case = f"{int(numero)}/{int(anno) % 100:02d}"
    old = f"{int(numero)}-{int(anno) % 100:02d}"
    return (
        "PREFIX cdm: <http://publications.europa.eu/ontology/cdm#> "
        "SELECT DISTINCT ?celex ?ecli ?date ?title ?case WHERE { "
        f"?w {year} "
        f'cdm:resource_legal_type "{celex_type}"^^<http://www.w3.org/2001/XMLSchema#string> ; '
        "cdm:resource_legal_id_celex ?celex ; cdm:work_date_document ?date . "
        "OPTIONAL { ?w cdm:case-law_ecli ?ecli } "
        "?e cdm:expression_belongs_to_work ?w ; "
        "cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/ITA> ; "
        "cdm:expression_case-law_identifier_case ?case ; cdm:expression_title ?title . "
        f'FILTER(CONTAINS(STR(?case), "{case}") || CONTAINS(STR(?case), "{old}")) '
        "} LIMIT 200"
    )


def hits_from_sparql(payload: Any, corte: str, numero: int, anno: int) -> list[Hit]:
    """The judgments of this case among the query's answers, one per CELEX."""
    if not isinstance(payload, dict):
        raise ValueError("SPARQL: risposta non leggibile")
    rows = payload.get("results", {}).get("bindings")
    if not isinstance(rows, list):
        raise ValueError("SPARQL: risposta non leggibile")
    found: dict[str, Hit] = {}
    for row in rows:
        value = lambda key: (row.get(key) or {}).get("value") if isinstance(row, dict) else None  # noqa: E731
        celex, cases = value("celex"), value("case")
        if not isinstance(celex, str) or not _CELEX.match(celex) or not isinstance(cases, str):
            continue
        if not any(n == numero and yy == anno % 100 and _letter_matches(letter, corte, anno)
                   for letter, n, yy in case_tokens(cases)):
            continue
        found.setdefault(celex, Hit(celex, value("ecli"), value("date"), value("title") or "", cases))
    return sorted(found.values(), key=lambda h: h.celex)


def _formation(title: str) -> str | None:
    """«Sentenza della Corte (Prima Sezione) del …» → «I»; «Grande Sezione» → «grande»; none → None."""
    m = re.search(r"\(([^)]*)\)", title.split("#", 1)[0])
    if not m:
        return None
    words = m.group(1).strip().lower()
    if "grande" in words:
        return "grande"
    if "plenaria" in words:
        return "plenaria"
    if "impugnazion" in words:
        return "impugnazioni"
    first = words.split()[0] if words.split() else ""
    roman = _ORDINALS.get(first)
    if roman is None and words.startswith("sezione "):
        roman = _ORDINALS.get(words.split()[1]) if len(words.split()) > 1 else None
    if roman is None:
        return None
    return f"{roman} ampliata" if "ampliata" in words else roman


def _parties(title: str) -> str | None:
    parts = [p.strip().rstrip(".") for p in title.split("#")]
    return parts[1] if len(parts) > 1 and parts[1] else None


def identity_of(hit: Hit, corte: str) -> Identity:
    m = _CELEX.match(hit.celex)
    assert m  # hits_from_sparql keeps only these
    return Identity(corte, int(m.group(3)), int(m.group(1)))


# --- the text ---------------------------------------------------------------------------------

_WS = re.compile(r"[ \t\r\n\f\v]+")


def _text(node: Tag) -> str:
    for call in node.select("span.coj-note, span.note"):
        # «( *1 )»: a footnote call, with the brackets around it
        before, after = call.previous_sibling, call.next_sibling
        if (isinstance(before, NavigableString) and isinstance(after, NavigableString)
                and before.rstrip().endswith("(") and after.lstrip().startswith(")")):
            before.replace_with(before.rstrip()[:-1])
            after.replace_with(after.lstrip()[1:])
        call.decompose()
    return _WS.sub(" ", node.get_text("")).strip()


def _classes(node: Tag) -> set[str]:
    return {c[4:] if c.startswith("coj-") else c for c in (node.get("class") or [])}


def _lines(node: Tag, out: list[tuple[str, str]]) -> None:
    """(kind, line) pairs in document order; kind is the paragraph's class without `coj-`."""
    for child in node.children:
        if isinstance(child, NavigableString) or not isinstance(child, Tag):
            continue
        if child.name == "p":
            line = _text(child)
            if line:
                out.append((" ".join(sorted(_classes(child))) or "p", line))
        elif child.name == "table":
            for row in child.find_all("tr"):
                if row.find_parent("table") is not child:
                    continue  # a nested table is read where it sits, through its cell
                cells = row.find_all("td", recursive=False)
                count = cells[0].find("p", class_=re.compile(r"(^|coj-)count$")) if cells else None
                inner: list[tuple[str, str]] = []
                for cell in cells[1:] if count else cells:
                    _lines(cell, inner)
                if count and inner:
                    number = _text(count)
                    inner[0] = (inner[0][0], f"{number} {inner[0][1]}" if number else inner[0][1])
                out.extend(inner)
        elif child.name in ("div", "tbody", "td", "span"):
            _lines(child, out)


def _blocks_from_lines(lines: list[str]) -> dict[str, str]:
    start = next((i for i, line in enumerate(lines) if line.strip().lower() == "sentenza"), None)
    end = next((i for i, line in enumerate(lines) if line.startswith("Per questi motivi")), None)
    epigrafe = lines[: start + 1] if start is not None else []
    body_from = start + 1 if start is not None else 0
    motivazione = lines[body_from:end] if end is not None else lines[body_from:]
    dispositivo = lines[end:] if end is not None else []
    return {key: "\n\n".join(value) for key, value in (
        ("epigrafe", epigrafe), ("motivazione", motivazione), ("dispositivo", dispositivo)) if value}


def text_from_xhtml(markup: str) -> tuple[dict[str, str], str | None]:
    """The Court's XHTML → (blocks, procedure language)."""
    with warnings.catch_warnings():
        # read with the HTML parser on purpose: the classes are what the reader needs
        warnings.simplefilter("ignore", XMLParsedAsHTMLWarning)
        soup = BeautifulSoup(markup, "lxml")
    body = soup.body or soup
    language = None
    for note in body.find_all("p", class_=re.compile(r"(^|coj-)note$")):
        m = re.search(r"Lingu[ae] process[^:]*:\s*(.+?)\.?\s*$", _text(note))
        if m:
            language = m.group(1)
        note.decompose()
    pairs: list[tuple[str, str]] = []
    _lines(body, pairs)
    lines: list[str] = []
    for kind, line in pairs:
        if "sum-title-1" in kind.split() and line.strip().lower() == "indice":
            break  # the General Court's closing table of contents
        lines.append(line)
    return _blocks_from_lines(lines), language


_OLD_SECTIONS = {"I1": "epigrafe", "I2": "epigrafe", "MO": "motivazione", "CO": "motivazione", "DI": "dispositivo"}


def text_from_old_html(markup: str) -> dict[str, str]:
    """EUR-Lex's former HTML (judgments before about 2009): sections by anchor, the keywords and
    the summary left out."""
    soup = BeautifulSoup(markup, "lxml")
    root = soup.find(id="TexteOnly")
    if root is None:
        return {}
    blocks: dict[str, list[str]] = {}
    section: str | None = None
    for node in root.find_all(["a", "p"]):
        if node.name == "a" and node.get("name"):
            section = _OLD_SECTIONS.get(node["name"])
            continue
        if node.name == "p" and section and not node.find("p"):
            line = _text(node)
            if line:
                blocks.setdefault(section, []).append(line)
    return {key: "\n\n".join(value) for key, value in blocks.items() if value}


# --- the reader --------------------------------------------------------------------------------

class CuriaReader:
    async def _sparql(self, query: str) -> Any:
        result = await decisions_http_client.request(
            "GET", SPARQL_URL, source="curia", params={"query": query}, timeout=_TIMEOUT, max_retries=1,
            headers=http_headers({"Accept": "application/sparql-results+json"}))
        return json.loads(result.text)

    async def find(self, corte: str, numero: int, anno: int) -> list[Hit]:
        """The case's judgments: by the case's year first, then (a case joined to one of an
        earlier year) by its number and year anywhere."""
        hits = hits_from_sparql(await self._sparql(sparql_query(corte, numero, anno)), corte, numero, anno)
        if not hits:
            hits = hits_from_sparql(await self._sparql(sparql_query(corte, numero, anno, by_year=False)),
                                    corte, numero, anno)
        return hits

    async def _document(self, celex: str, accept: str) -> str | None:
        try:
            result = await decisions_http_client.request(
                "GET", f"{CELLAR_URL}{celex}", source="curia", timeout=_TIMEOUT, max_retries=1,
                headers=http_headers({"Accept": accept, "Accept-Language": "ita"}))
        except DocumentNotFoundError:
            return None  # no such format in Italian
        return result.text

    async def text(self, celex: str) -> tuple[dict[str, str], str | None]:
        xhtml = await self._document(celex, "application/xhtml+xml")
        if xhtml is not None:
            return text_from_xhtml(xhtml)
        old = await self._document(celex, "text/html")
        return (text_from_old_html(old), None) if old is not None else ({}, None)

    async def lookup(self, corte: str, numero: int, anno: int) -> list[Decision]:
        """Every judgment of the case (none, one, or a rare second one), each with its text."""
        decisions = []
        for hit in await self.find(corte, numero, anno):
            testo, language = await self.text(hit.celex)
            if not testo:
                log.warning("CGUE judgment found without a readable Italian text", celex=hit.celex)
            decisions.append(to_decision(hit, corte, testo, language))
        return decisions


def to_decision(hit: Hit, corte: str, testo: dict[str, str], language: str | None) -> Decision:
    identity = identity_of(hit, corte)
    cases = [case_label(letter or None, n, 1900 + yy if yy > 30 else 2000 + yy)
             for letter, n, yy in case_tokens(hit.cases)]
    return Decision(
        identita=identity,
        sezione=_formation(hit.title),
        tipo="sentenza",
        data_decisione=hit.date if hit.date and re.fullmatch(r"\d{4}-\d{2}-\d{2}", hit.date) else None,
        ecli=hit.ecli,
        parti=_parties(hit.title),
        cause_riunite=cases if len(cases) > 1 else None,
        lingua_processuale=language,
        testo=testo,
        fonte={**SOURCE, "url": f"{EURLEX_PAGE}{hit.celex}"},
    )
