# services/merlt/merlt/pipeline/massimario/citations.py
"""The citation grammar for the Massimario's reviews (spec §5.5).

Anchored on each `Rv.`: the decision a massima number belongs to is the one
cited just before it. Then Cassazione citations without `Rv.` and the Corte
costituzionale. Nothing is guessed: a citation the grammar cannot read, or
whose year it cannot establish, is counted, and kept as a reference without
identity.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Optional

from .identity import CASSAZIONE, CORTE_COSTITUZIONALE, CitedDecision, DecisionIdentity
from .rv_bands import RvBands

_MESI = {
    "gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4, "maggio": 5, "giugno": 6,
    "luglio": 7, "agosto": 8, "settembre": 9, "ottobre": 10, "novembre": 11, "dicembre": 12,
}
_DATE = re.compile(
    r"(\d{1,2})\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{4})"
    r"|(\d{1,2})[º°]?\s+(" + "|".join(_MESI) + r")\s+(\d{4})",
    re.IGNORECASE,
)
_YEAR = re.compile(r"(\d{4})(?!\d)")
_RV = re.compile(r"Rv\.?\s*(?:n\.\s*)?(\d{6})(?:\s*[-–]\s*(\d{2})|(\d{2})(?!\d))?")
# Case-sensitive on purpose: citations write "Sez." with a capital, prose writes "sezione 3".
_SEZ = re.compile(
    r"Sez(?:ione|\.)?\s*"
    r"(U(?:[Nn](?:ite)?)?\.?|un\.|VI\s*-\s*(?:[1-5]|III|II|IV|V|I)|[1-7](?:\s*-\s*[1-6])?|L\.?|T\.?|F\.?|VII|VI|IV|V|III|II|I)"
    r"(?![A-Za-z0-9])(?:\s*(civ|pen)\.?)?"
)
_NUM = re.compile(
    r"(?:\bn\.?\s*,?\s*|(?:sentenza|ordinanza|sent\.|ord\.)\s+(?:n\.\s*)?)"
    r"0*(\d{1,6})(?:\s*/\s*(\d{4}|\d{2})(?!\d))?",
    re.IGNORECASE,
)
_BARE = re.compile(r"\s*,\s*0*(\d{1,6})\s*/\s*(\d{4}|\d{2})(?!\d)")
_DEL = re.compile(r"\s*,?\s*del\s*", re.IGNORECASE)
_DEP = re.compile(r"dep(?:\.|osit\w*)\s*(?:il\s*)?", re.IGNORECASE)
_DEP_BEFORE = re.compile(r"dep(?:\.|osit\w*)\s*(?:il\s*)?$", re.IGNORECASE)
_ACT_BEFORE = re.compile(
    r"(?:\blegge|(?-i:\bl\.)|d\.\s*lgs\.?|d\.\s*l\.|\bdecreto|d\.\s*P\.\s*R\.|\bartt?\.|\bregolamento|\bdirettiva)"
    r"\s*(?:[\w.(),]+\s*){0,3}$",
    re.IGNORECASE,
)
_CONSULTA = re.compile(
    r"(?:Corte\s+cost(?:ituzionale)?\.?|C\.\s*cost\.)\s*,?\s*(?:(?:sent(?:enza)?|ord(?:inanza)?)\.?\s*)?"
    r"n\.\s*0*(\d{1,4})\s*(?:/\s*(\d{4})|del\s+(\d{4}))",
    re.IGNORECASE,
)
_SAME_DECISION = re.compile(r"[\s,e–-]*")
_RELATORE = re.compile(r"[A-Za-zÀ-ÿ'’.\s-]{2,40}")
_WINDOW = 190


@dataclass
class CitationScan:
    decisions: list[CitedDecision] = field(default_factory=list)
    rv_total: int = 0
    rv_recognized: int = 0
    forms: Counter = field(default_factory=Counter)
    unrecognized: list[str] = field(default_factory=list)
    reasons: Counter = field(default_factory=Counter)


def _two_digit_year(raw: str) -> int:
    value = int(raw)
    if value > 100:
        return value
    return 2000 + value if value <= 30 else 1900 + value


def _date_parts(match: re.Match) -> tuple[int, Optional[str]]:
    """(year, ISO date or None if the day/month are impossible)."""
    d1, m1, y1, d2, mese, y2 = match.groups()
    if y1:
        year, month, day = int(y1), int(m1), int(d1)
    else:
        year, month, day = int(y2), _MESI[mese.lower()], int(d2)
    iso = f"{year:04d}-{month:02d}-{day:02d}" if 1 <= month <= 12 and 1 <= day <= 31 else None
    return year, iso


def _norm_section(raw: str) -> str:
    section = re.sub(r"\s+", "", raw).rstrip(".").upper()
    return "U" if section.startswith("UN") else section


def _read_citation(window: str) -> Optional[dict]:
    """The last decision cited in `window`, or None; {'act_number': True} for a law's number."""
    candidates = [(m.start(), m.end(), int(m.group(1)), m.group(2)) for m in _NUM.finditer(window)]
    for sez in _SEZ.finditer(window):
        bare = _BARE.match(window, sez.end())
        if bare:
            candidates.append((bare.start(1), bare.end(), int(bare.group(1)), bare.group(2)))
    if not candidates:
        return None
    start, end, numero, slash = max(candidates, key=lambda c: c[0])
    before = window[:start]
    tail40 = before[-40:]
    act = _ACT_BEFORE.search(tail40)
    if act and not any(s.start() > act.start() for s in _SEZ.finditer(tail40)):
        return {"act_number": True}  # "legge n. 89 del 2001", "art. 360, n. 5": not a decision

    anno: Optional[int] = None
    data: Optional[str] = None
    forma: Optional[str] = None
    year_end = end
    if slash:
        anno, forma = _two_digit_year(slash), "slash"
    else:
        after_del = _DEL.match(window, end)
        if after_del:
            date = _DATE.match(window, after_del.end())
            if date:
                (anno, data), forma, year_end = _date_parts(date), "del_data", date.end()
            else:
                year = _YEAR.match(window, after_del.end())
                if year:
                    anno, forma, year_end = int(year.group(1)), "del_anno", year.end()
    # Dates and deposits are read only from this citation: from its section label on.
    sections = list(_SEZ.finditer(before))
    cit_start = sections[-1].start() if sections else start
    if anno is None:
        hearing = [d for d in _DATE.finditer(before, cit_start) if not _DEP_BEFORE.search(before[: d.start()])]
        if hearing:
            (anno, data), forma = _date_parts(hearing[-1]), "data_prima"
    deposit = None
    for dep in _DEP.finditer(window, cit_start):
        after = _DATE.match(window, dep.end()) or _YEAR.match(window, dep.end())
        if after:
            deposit = (_date_parts(after)[0] if after.re is _DATE else int(after.group(1)), dep, after)
    if deposit is not None:
        year_value, dep, after = deposit
        anno, forma = year_value, f"{forma}+dep" if forma else "dep"
        if dep.start() >= year_end:
            year_end = max(year_end, after.end())
    tail = _DEP.sub("", window[year_end:])
    tail = re.sub(r"\d{1,2}\s*[./]\s*\d{1,2}\s*[./]\s*\d{4}|\b\d{4}\b", "", tail).strip(" ,;:()–-\n")
    relatore = (
        tail if tail and tail[0].isupper() and _RELATORE.fullmatch(tail)
        and not tail.lower().startswith(("est", "rel")) else None
    )
    return {
        "start": cit_start,
        "numero": numero,
        "anno": anno,
        "forma": forma,
        "data": data,
        "sezione": _norm_section(sections[-1].group(1)) if sections else None,
        "arch": sections[-1].group(2) if sections else None,
        "relatore": relatore,
    }


def _decision(read: dict, rv: list[str], *, review_year: int, archivio: Optional[str],
              bands: Optional[RvBands], forma: Optional[str] = None) -> CitedDecision:
    arch = {"civ": "civile", "pen": "penale"}.get((read["arch"] or "").lower()[:3]) or archivio
    d = CitedDecision(
        corte=CASSAZIONE, numero=read["numero"], anno=read["anno"], archivio=arch,
        sezione=read["sezione"], relatore=read["relatore"], data_udienza=read["data"],
        rv=list(rv), forma=forma or read["forma"] or "",
    )
    if d.numero <= 0:
        d.motivo_senza_identita = "numero_non_valido"  # measured on the corpus: "n. 0/2015"
        return d
    if arch is None:
        d.motivo_senza_identita = "archivio_ignoto"
        return d
    if d.anno is None:
        d.anno_implicito, d.forma = True, "implicito"
        if not rv or bands is None or not bands.contains(arch, review_year, int(rv[0][:6])):
            d.motivo_senza_identita = "anno_non_verificato"  # no year: no guessed link either
            return d
        d.anno = review_year
    if not 1930 <= d.anno <= review_year + 1:
        d.motivo_senza_identita = "anno_fuori_intervallo"
        return d
    d.identity = DecisionIdentity(CASSAZIONE, d.numero, d.anno, arch)
    return d


def _rv_label(match: re.Match) -> str:
    suffix = match.group(2) or match.group(3)
    return f"{match.group(1)}-{suffix}" if suffix else match.group(1)


def _sample(text: str, at: int) -> str:
    return text[max(0, at - 110): at + 20].replace("\n", " ")


def parse_citations(text: str, *, review_year: int, archivio: Optional[str],
                    bands: Optional[RvBands]) -> CitationScan:
    scan = CitationScan()
    consumed: list[tuple[int, int]] = []
    previous: Optional[CitedDecision] = None
    previous_end = 0

    for rv in _RV.finditer(text):
        scan.rv_total += 1
        label = _rv_label(rv)
        lo = max(previous_end, rv.start() - _WINDOW)
        window = text[lo:rv.start()]
        cut = window.rfind(";")
        if cut >= 0:
            window, lo = window[cut + 1:], lo + cut + 1
        if previous is not None and _SAME_DECISION.fullmatch(window):
            previous.rv.append(label)
            scan.rv_recognized += 1
            scan.forms["stesso_precedente"] += 1
            consumed.append((lo, rv.end()))
            previous_end = rv.end()
            continue
        read = _read_citation(window)
        previous_end = rv.end()
        if read is None or read.get("act_number"):
            scan.unrecognized.append(_sample(text, rv.start()))
            scan.reasons["nessuna_pronuncia"] += 1
            previous = None
            continue
        decision = _decision(read, [label], review_year=review_year, archivio=archivio, bands=bands)
        scan.decisions.append(decision)
        scan.rv_recognized += 1
        scan.forms[decision.forma] += 1
        if decision.identity is None:
            scan.reasons[decision.motivo_senza_identita] += 1
        consumed.append((lo + read["start"], rv.end()))
        previous = decision

    for sez in _SEZ.finditer(text):
        if any(a <= sez.start() < b for a, b in consumed):
            continue
        chunk = text[sez.start(): sez.start() + 120]
        stop = re.search(r"Rv\.|;|\)", chunk)
        if stop:
            chunk = chunk[:stop.start()]
        number = _NUM.search(chunk, len(sez.group(0))) or _BARE.match(chunk, len(sez.group(0)))
        if number is None or number.start() - len(sez.group(0)) > 25:
            continue
        read = _read_citation(chunk[: number.end() + 40])
        if not read or read.get("act_number") or read["anno"] is None:
            continue
        decision = _decision(read, [], review_year=review_year, archivio=archivio, bands=bands, forma="senza_rv")
        scan.decisions.append(decision)
        scan.forms["senza_rv"] += 1
        consumed.append((sez.start(), sez.start() + len(chunk)))

    for match in _CONSULTA.finditer(text):
        anno = int(match.group(2) or match.group(3))
        numero = int(match.group(1))
        decision = CitedDecision(corte=CORTE_COSTITUZIONALE, numero=numero, anno=anno, archivio=None, forma="consulta")
        if numero > 0 and 1956 <= anno <= review_year + 1:
            decision.identity = DecisionIdentity(CORTE_COSTITUZIONALE, numero, anno)
        else:
            decision.motivo_senza_identita = "anno_fuori_intervallo"
        scan.decisions.append(decision)
        scan.forms["consulta"] += 1
    return scan
