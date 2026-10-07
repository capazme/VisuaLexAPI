"""The Cassazione reader on real decisions: the record and the court's PDF (design 2026-10-05 §11).

Local only (the repository is public): `fixtures/decisions/private/` is git-ignored, see the README
there. Without it this module is skipped; the same rules run on synthetic records and PDFs in
`test_decisions_italgiure.py`. Nothing here quotes a private person: counts, flags and structure.
"""
import json
import pathlib

import pytest

from visualex_api.services.decisions import italgiure
from visualex_api.services.decisions.italgiure import ItalgiureReader, _plausible, pdf_url, to_decision
from visualex_api.services.decisions.pdf_text import read_decision_pdf, text_from_pdf
from visualex_api.services.http_client import HttpResult

PRIVATE = pathlib.Path(__file__).parent / "fixtures" / "decisions" / "private"
RECORDS = sorted(PRIVATE.glob("snciv_*.json"))

pytestmark = pytest.mark.skipif(not PRIVATE.exists() or not any(PRIVATE.glob("snciv_*.clean.pdf")),
                                reason="real decisions are local only")


def _record(path: pathlib.Path) -> dict:
    return json.loads(path.read_text())["response"]["docs"][0]


def _pdf(path: pathlib.Path) -> bytes:
    return path.with_name(path.name.replace(".json", ".clean.pdf")).read_bytes()


@pytest.mark.parametrize("path", RECORDS, ids=lambda p: p.name)
def test_the_pdf_passes_the_checks_against_its_own_record(path):
    doc = _record(path)
    assert pdf_url(doc)
    decision = to_decision(doc, "civile")
    assert _plausible(text_from_pdf(_pdf(path)), decision.testo) is None


@pytest.mark.parametrize("path", RECORDS, ids=lambda p: p.name)
async def test_a_real_record_reads_from_its_pdf(monkeypatch, path):
    doc, pdf = _record(path), _pdf(path)
    calls = []

    async def fake_request(method, url, **kwargs):
        calls.append((method, url))
        if method == "POST":
            return HttpResult(text=json.dumps({"response": {"numFound": 1, "docs": [doc]}}),
                              status=200, headers={})
        if "verbo=attach" in url:
            return HttpResult(text=pdf.decode("latin-1"), status=200, headers={})
        return HttpResult(text="", status=200, headers={})

    monkeypatch.setattr(italgiure.decisions_http_client, "request", fake_request)
    decision, data = await ItalgiureReader().lookup_with_pdf(
        "civile", int(doc["numdec"]), int(doc["anno"]))
    assert decision.testo_origine == "pdf" and data == pdf
    assert decision.testo == text_from_pdf(pdf)
    assert "motivazione" in decision.testo and len(calls) == 2


@pytest.mark.parametrize("path", RECORDS, ids=lambda p: p.name)
def test_the_header_names_the_records_own_number_and_the_text_is_unchanged(path):
    doc, pdf = _record(path), _pdf(path)
    text, header = read_decision_pdf(pdf)
    assert text == text_from_pdf(pdf)
    assert header == (int(doc["numdec"]), int(doc["anno"]))
