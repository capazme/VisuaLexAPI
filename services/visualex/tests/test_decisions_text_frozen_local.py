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
from visualex_api.services.decisions.italgiure import to_decision
from visualex_api.services.decisions.pdf_text import text_from_pdf

PRIVATE = pathlib.Path(__file__).parent / "fixtures" / "decisions" / "private"

pytestmark = pytest.mark.skipif(not PRIVATE.exists() or not any(PRIVATE.glob("*.clean.pdf")),
                                reason="real decisions are local only")


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


CASES = local_cases() if PRIVATE.exists() else {}


@pytest.mark.parametrize("key", sorted(CASES))
def test_the_projection_of_a_real_decision_is_frozen(key):
    assert key in GOLDEN, f"{key} has no golden entry"
    assert fingerprint(CASES[key]) == GOLDEN[key]
