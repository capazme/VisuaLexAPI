"""A court decision as a lawyer writes it, read into the reference `/fetch_decision` takes
(design 2026-10-12 §2.1).

The web palette reads the same words in the browser (`apps/web/src/utils/decisionCitationParser.ts`)
and both are pinned to `conventions/sources/golden.json` (`decision_citations`): change the two
together. Unlike the palette, this reader also names a court it recognises and VisuaLex has no
reader for, so that an answer can say which court it read instead of "not recognised".

The words come from a user or a model: every pattern is flat (no nested quantifier), the text
scanned is capped, and `tests/test_decision_citation.py` fuzzes it with a time bound.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from typing import Any

from .model import FIRST_YEAR, MAX_NUMERO, MAX_NUMERO_CAUSA

MAX_SCANNED = 600
_F = re.IGNORECASE | re.ASCII

_COURT = re.compile(
    r"^\s*(?:(corte\s+cost(?:ituzionale)?\.?|c\.\s*cost\.?)|(cass(?:azione)?\.?)|(s\.?\s*u\.?)(?=\s*,?\s*(?:n\.?\s*)?\d))(?=[\s,]|$)",
    _F)
_ARCHIVE = re.compile(r"\b(civ(?:ile)?|pen(?:ale)?)\b", _F)
# A sub-section ("VI-1") is read but its suffix dropped: normalize_section does not know it.
_SECTION = re.compile(
    r"\bsez(?:ione|ioni)?\.?\s*(un(?:ite)?\.?|lav(?:oro)?\.?|fer(?:iale)?\.?|[IVX]{1,4}(?:-[1-9L])?|[1-7](?:-[1-9L])?|[LUF])(?=[\s,.]|$)|\b(SU|S\.U\.)(?=[\s,]|$)",
    _F)
# A pair "n. 10787/2024" or "n. 10787 del 2024". A two-digit year after "del" that opens a date
# ("del 21 aprile", "del 15/12/1999") is a day, not a year; the date's own year is read below.
# The bare "10787/2024" must not be a piece of a date either.
_NUMBER_YEAR = re.compile(
    r"\bn(?:\.|um(?:ero)?\.?)?\s*(\d{1,6})\s*(?:/(\d{4}|\d{2})(?![/.-]\d)|del\s+(?:(\d{4})|(\d{2})(?![\s/.-]*\d|\s+[a-zà-ù])))\b"
    r"|(?<![\d/.-])\b(\d{1,6})\s*/\s*(\d{4}|\d{2})(?![/.-]?\d)\b",
    _F)
_NUMBER_ONLY = re.compile(r"\bn(?:\.|um(?:ero)?\.?)?\s*(\d{1,6})\b", _F)
# The Cassazione numbers a decision when it is deposited: "dep." with a full date or a bare year.
_DEPOSIT_YEAR = re.compile(
    r"\bdep(?:\.|osit(?:ata|ato|o))?\s*(?:il\s+)?(?:\d{1,2}[°º]?\s+[a-zà-ù]{3,9}\s+(\d{4})|\d{1,2}[/.-]\d{1,2}[/.-](\d{4})|(\d{4}))\b",
    _F)
_DATE_YEAR = re.compile(
    r"\b\d{1,2}[°º]?\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})\b"
    r"|\b\d{1,2}[/.-]\d{1,2}[/.-](\d{4})\b",
    _F)

# Courts recognised by name for which VisuaLex has no reader yet: the answer names them. The Italian
# tax courts are «Corte di giustizia tributaria» since l. 130/2022: they are checked before the Court
# of Justice of the Union, whose name they share.
_DASH = "[-\u2010\u2011\u2012\u2013\u2014]"
_UNSUPPORTED: tuple[tuple[re.Pattern[str], str], ...] = tuple(
    (re.compile(r"^\s*(?:" + pattern + r")(?=[\s,.;:(]|$)", _F), name) for pattern, name in (
        (r"cons(?:iglio)?\.?\s*(?:di\s+)?st(?:ato)?\.?|c\.\s*d\.\s*s\.?|cds",
         "Consiglio di Stato"),
        (r"t\.\s*a\.\s*r\.?|tar|tribunale\s+amministrativo(?:\s+regionale)?",
         "Tribunale amministrativo regionale"),
        (r"garante\s+(?:della\s+)?privacy|garante\s+per\s+la\s+protezione\s+dei\s+dati(?:\s+personali)?",
         "Garante per la protezione dei dati personali"),
        (r"corte\s+edu|c\.\s*edu|corte\s+europea\s+dei\s+diritti\s+dell['’]\s*uomo|cedu(?!\s*,?\s*art)",
         "Corte europea dei diritti dell'uomo"),
        (r"(?:corte|c\.)\s*(?:di\s+)?giust(?:izia)?\.?\s*trib\w*\.?",
         "Corte di giustizia tributaria"),
    ))
# The courts of the Union (design 2026-10-12 §3.4, Q13 decided): a court's name, a case number, or
# both; the case's letter names the court (C: the Court of Justice, T: the General Court), whatever
# name precedes it. A case before 1989 has no letter and is read only after «causa».
_TAX_COURT = re.compile(r"^\s*(?:corte|c\.)\s*(?:di\s+)?giust(?:izia)?\.?\s*trib", _F)
_EU_COURT = re.compile(
    r"^\s*(?:cgue|c\.\s*g\.\s*u\.\s*e\.?|cgce|corte\s+giust(?:izia)?\.?|c\.\s*giust\.?|corte\s+di\s+giustizia"
    r"|trib(?:unale)?\.?\s+(?:ue|dell['’]\s*unione\s+europea|i\s+grado|di\s+primo\s+grado))(?=[\s,.;:(]|$)", _F)
_EU_CASE = re.compile(r"(?<![\w/])([CT])\s*" + _DASH + r"?\s*(\d{1,4})\s*/\s*(\d{4}|\d{2})(?![\d/])", _F)
_EU_CASE_FIRST = re.compile(r"^\s*(?:causa\s+|cause\s+riunite\s+)?[CT]\s*" + _DASH + r"?\s*\d", _F)
_OLD_CASE = re.compile(r"\bcausa\s+(\d{1,4})\s*[-/]\s*(\d{2})(?![\d/])", _F)


def _eu_reference(scanned: str, today: date) -> dict[str, Any] | None | bool:
    """The reference to the Court of Justice or the General Court the words name; None when they
    name one of those courts but not a case they can read; False when they name neither."""
    court = _EU_COURT.match(scanned)
    case = _EU_CASE.search(scanned)
    if court is None and not _EU_CASE_FIRST.match(scanned):
        return False
    if case:
        corte = "corte_giustizia_ue" if case.group(1).upper() == "C" else "tribunale_ue"
        numero, anno = int(case.group(2)), expand_two_digit_year(case.group(3))
    else:
        old = _OLD_CASE.search(scanned) if court else None
        if old is None or court.group(0).strip().lower().startswith("trib"):
            return None
        corte, numero, anno = "corte_giustizia_ue", int(old.group(1)), expand_two_digit_year(old.group(2))
    if not 1 <= numero <= MAX_NUMERO_CAUSA or not FIRST_YEAR[corte] <= anno <= today.year:
        return None
    return {"corte": corte, "numero": numero, "anno": anno}


def expand_two_digit_year(raw: str) -> int:
    """The one pivot the web's expandTwoDigitYear uses: "30" → 2030, "31" → 1931."""
    if len(raw) == 2:
        value = int(raw)
        return 2000 + value if value <= 30 else 1900 + value
    return int(raw)


@dataclass(frozen=True)
class Reading:
    """What words name: a reference, a court without a reader, or nothing VisuaLex can read."""
    riferimento: dict[str, Any] | None = None
    corte_non_supportata: str | None = None

    def to_dict(self) -> dict[str, Any]:
        if self.riferimento is not None:
            return {"riferimento": self.riferimento}
        if self.corte_non_supportata is not None:
            return {"corte_non_supportata": self.corte_non_supportata}
        return {"non_riconosciuta": True}


def _section_code(raw: str) -> str:
    s = raw.replace(".", "").lower().split("-")[0]
    if s.startswith("un"):
        return "U"
    if s.startswith("lav"):
        return "L"
    if s.startswith("fer"):
        return "F"
    return s.upper()


def read_decision_citation(text: object, today: date | None = None) -> Reading:
    if not isinstance(text, str):
        return Reading()
    today = today or date.today()
    # Every Unicode space as a plain one: Word and PDFs put a no-break space after «n.» and «sez.»,
    # which the palette's \s reads (JavaScript) and re.ASCII's would not.
    scanned = re.sub(r"\s", " ", text.strip()[:MAX_SCANNED])
    court = _COURT.search(scanned)
    if not court:
        if not _TAX_COURT.match(scanned):
            eu = _eu_reference(scanned, today)
            if eu is not False:
                return Reading(riferimento=eu) if eu else Reading()
        for pattern, name in _UNSUPPORTED:
            if pattern.search(scanned):
                return Reading(corte_non_supportata=name)
        return Reading()
    corte = "corte_costituzionale" if court.group(1) else "cassazione"
    rest = scanned[court.end():]

    pair = _NUMBER_YEAR.search(rest)
    if pair:
        numero_raw = pair.group(1) or pair.group(5)
    else:
        only = _NUMBER_ONLY.search(rest)
        numero_raw = only.group(1) if only else None
    pair_year = (pair.group(2) or pair.group(3) or pair.group(4) or pair.group(6)) if pair else None
    dep = _DEPOSIT_YEAR.search(rest) if corte == "cassazione" else None
    dated = _DATE_YEAR.search(rest)
    if dep:
        raw_year = dep.group(1) or dep.group(2) or dep.group(3)
    else:
        raw_year = pair_year or (dated.group(1) or dated.group(2) if dated else None)
    if numero_raw is None or raw_year is None:
        return Reading()
    numero, anno = int(numero_raw), expand_two_digit_year(raw_year)
    if not 1 <= numero <= MAX_NUMERO or not FIRST_YEAR[corte] <= anno <= today.year:
        return Reading()

    ref: dict[str, Any] = {"corte": corte, "numero": numero, "anno": anno}
    if corte == "cassazione":
        archive = _ARCHIVE.search(rest)
        if archive:
            ref["archivio"] = "civile" if archive.group(1).lower().startswith("civ") else "penale"
        if court.group(3):
            ref["sezione"] = "U"
        section = _SECTION.search(rest)
        if section:
            ref["sezione"] = "U" if section.group(2) else _section_code(section.group(1))
    return Reading(riferimento=ref)
