"""A decision's text is frozen, on real decisions (design 2026-10-05 §8.5).

The real records and PDFs are local only (the repository is public): `fixtures/decisions/private/`,
git-ignored. Without them this module is skipped; the same check runs on synthetic cases in
`test_decisions_text_frozen.py`. The golden file holds a SHA-256 and a length per case, never the
text, under keys that name the court, the number and the year only.
"""
import json
import pathlib

import pytest

from tests.test_decisions_text_frozen import GOLDEN, fingerprint
from visualex_api.services.decisions import curia, giustizia_amministrativa
from visualex_api.services.decisions.italgiure import to_decision
from visualex_api.services.decisions.pdf_text import text_from_pdf

PRIVATE = pathlib.Path(__file__).parent / "fixtures" / "decisions" / "private"

_CASSAZIONE = PRIVATE.exists() and any(PRIVATE.glob("*.clean.pdf"))
_CURIA = PRIVATE.exists() and any(PRIVATE.glob("curia_6*"))
_GA = PRIVATE.exists() and any(PRIVATE.glob("ga_*.xml"))


def local_cases() -> dict:
    """{key: testo} for each private decision: the text from its PDF, and the fallback from the
    record's own text field. Keys: cassazione_<archive>_<number>_<year>_<pdf|campo>."""
    cases = {}
    for pdf in sorted(PRIVATE.glob("*.clean.pdf")):
        kind, number, year = pdf.name.removesuffix(".clean.pdf").split("_")
        archivio = "civile" if kind == "snciv" else "penale"
        stem = f"cassazione_{archivio}_{number}_{year}"
        cases[f"{stem}_pdf"] = text_from_pdf(pdf.read_bytes())
        record = PRIVATE / f"{kind}_{number}_{year}.json"
        if record.exists():
            doc = json.loads(record.read_text())["response"]["docs"][0]
            cases[f"{stem}_campo"] = to_decision(doc, archivio).testo
    return cases


def local_curia_cases() -> dict:
    """{key: testo} for each private CGUE judgment (`curia_<CELEX>.xhtml`, or `.html` in the former
    format). Keys: <court>_<number>_<year>."""
    cases = {}
    for path in sorted(PRIVATE.glob("curia_6*")):
        celex = path.name.removeprefix("curia_").split(".")[0]
        corte = "tribunale_ue" if celex[5:7] == "TJ" else "corte_giustizia_ue"
        identity = curia.identity_of(curia.Hit(celex, None, None, "", ""), corte)
        markup = path.read_text(encoding="utf-8")
        testo = curia.text_from_xhtml(markup)[0] if path.suffix == ".xhtml" else curia.text_from_old_html(markup)
        cases[f"{corte}_{identity.numero}_{identity.anno}"] = testo
    return cases


def local_ga_cases() -> dict:
    """{key: testo} for each private document of the administrative courts (`ga_<key>.xml`, the
    key as the convention writes it with «_» for «:»: `ga_consiglio_di_stato_sent_2270_2019.xml`)."""
    return {path.stem.removeprefix("ga_"): giustizia_amministrativa.text_from_document(path.read_bytes())
            for path in sorted(PRIVATE.glob("ga_*.xml"))}


CASES = local_cases() if _CASSAZIONE else {}
GA_CASES = local_ga_cases() if _GA else {}


@pytest.mark.skipif(not _GA, reason="real decisions are local only")
@pytest.mark.parametrize("key", sorted(GA_CASES))
def test_the_projection_of_a_real_administrative_decision_is_frozen(key):
    assert key in GOLDEN, f"{key} has no golden entry"
    assert fingerprint(GA_CASES[key]) == GOLDEN[key]
CURIA_CASES = local_curia_cases() if _CURIA else {}


@pytest.mark.skipif(not _CURIA, reason="real decisions are local only")
@pytest.mark.parametrize("key", sorted(CURIA_CASES))
def test_the_projection_of_a_real_cgue_judgment_is_frozen(key):
    assert key in GOLDEN, f"{key} has no golden entry"
    assert fingerprint(CURIA_CASES[key]) == GOLDEN[key]


@pytest.mark.skipif(not _CASSAZIONE, reason="real decisions are local only")
@pytest.mark.parametrize("key", sorted(CASES))
def test_the_projection_of_a_real_decision_is_frozen(key):
    assert key in GOLDEN, f"{key} has no golden entry"
    assert fingerprint(CASES[key]) == GOLDEN[key]
