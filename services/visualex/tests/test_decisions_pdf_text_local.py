"""The Cassazione's PDF reader on real decisions (design 2026-10-05 §11).

The real PDFs are local only (the repository is public): `fixtures/decisions/private/`, git-ignored,
see the README there. Without them this module is skipped; the same rules run on synthetic PDFs in
`test_decisions_pdf_text.py`. Nothing here quotes a private person's name: courts, institutions
and phrases of law only.
"""
import pathlib
import re

import pytest

from visualex_api.services.decisions.pdf_text import text_from_pdf

PRIVATE = pathlib.Path(__file__).parent / "fixtures" / "decisions" / "private"
FIXTURES = sorted(PRIVATE.glob("*.clean.pdf"))

pytestmark = pytest.mark.skipif(not PRIVATE.exists() or not any(PRIVATE.glob("*.clean.pdf")),
                                reason="real decisions are local only")

# a centred heading read by hand in each fixture (Task 2, 2026-10-05)
_HEADINGS = {
    "snciv_05626_2022.clean.pdf": "FATTI DI CAUSA",
    "snciv_05628_2022.clean.pdf": "RILEVATO CHE",
    "snciv_26034_2026.clean.pdf": "CONSIDERATO CHE",
    "snciv_26035_2026.clean.pdf": "CONSIDERATO CHE",
}


def _text(name: str) -> dict:
    return text_from_pdf((PRIVATE / name).read_bytes())


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.name)
def test_no_page_furniture_is_left(path):
    out = text_from_pdf(path.read_bytes())
    whole = "\n".join(out.values())
    for furniture in ("copia non ufficiale", "Data pubblicazione:", "Relatore:", "(cid:", "Oggetto:"):
        assert furniture not in whole, furniture
    assert "  " not in whole.replace("\n\n", "")


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.name)
def test_the_text_is_whole_and_ends_in_the_dispositivo(path):
    out = text_from_pdf(path.read_bytes())
    assert out["motivazione"] and out.get("dispositivo", "").startswith(("P.", "PQM.", "PER QUESTI MOTIVI"))
    assert "\n\n" in out["motivazione"]


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.name)
def test_a_centred_heading_starts_its_own_paragraph(path):
    out = text_from_pdf(path.read_bytes())
    assert f"\n\n{_HEADINGS[path.name]}\n\n" in out["motivazione"]


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.name)
def test_no_running_header_or_footer_leaks_into_the_text(path):
    whole = "\n\n".join(text_from_pdf(path.read_bytes()).values())
    assert re.search(r"Ric[.,]\s*\d{4}\s+n\.", whole) is None


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.name)
def test_no_paragraph_runs_several_numbered_points_together(path):
    out = text_from_pdf(path.read_bytes())
    for block in out.values():
        for paragraph in block.split("\n\n"):
            assert len(paragraph) <= 6000, paragraph[:80]


def test_a_line_ending_in_a_spaced_dash_joins_with_a_space():
    out = _text("snciv_05626_2022.clean.pdf")
    assert "CORTE DEI CONTI - SEZIONI RIUNITE" in out["motivazione"]
    out = _text("snciv_26035_2026.clean.pdf")
    assert ("dato atto - ancora una volta incontestatamente in questa sede - "
            "dell\u2019ammissibilit\u00e0 dell\u2019appello") in out["motivazione"]


def test_one_physical_baseline_is_never_split_by_the_row_grid():
    out = _text("snciv_05628_2022.clean.pdf")
    whole = "\n\n".join(out.values())
    assert "ASSESSORATO DELL'ISTRUZIONE E DELLA FORMAZIONE PROFESSIONALE" in whole
    assert out["dispositivo"].count("per il versamento") == 1


def test_hanging_numbered_points_are_separate_paragraphs():
    out = _text("snciv_05628_2022.clean.pdf")
    whole = "\n\n".join(out.values())
    for n in range(1, 57):
        assert re.search(rf"(?:^|\n\n){n}\.", whole), n
    assert "\n\n13.11 ricorso \u00e8 inammissibile" in whole
    assert "\n\n19.11 giudizio di ottemperanza" in whole
    assert "\n\n52.1e modalit\u00e0 esecutive" in whole


@pytest.mark.parametrize("path", ["snciv_26034_2026.clean.pdf", "snciv_26035_2026.clean.pdf"])
def test_existing_paragraph_starts_are_unaffected(path):
    out = _text(path)
    assert "\n\nRILEVATO CHE\n\n" in out["motivazione"]
    assert "\n\nCONSIDERATO CHE\n\n" in out["motivazione"]


def test_margin_debris_is_dropped_not_kept_as_a_false_heading():
    out = _text("snciv_05626_2022.clean.pdf")
    whole = "\n\n".join(out.values())
    assert "(A," not in whole
    assert "presupposti fattuali con esplicazione solo di" in whole


def test_flush_left_lines_on_a_page_with_an_indented_mode_stay_one_paragraph():
    out = _text("snciv_05628_2022.clean.pdf")["motivazione"]
    assert ("avverso la sentenza n. 451/2020 del CONSIGLIO DI GIUSTIZIA AMMINISTRATIVA DELLA "
            "REGIONE SICILIA - PALERMO, depositata il 22/06/2020. Udita la relazione della causa "
            "svolta nella camera di consiglio del 08/02/2022 dal Consigliere") in out
    assert "\n\n2. in particolare" in out and "\n\n3. il Consiglio di giustizia" in out
    assert ("alla corretta esegesi del giudicato formatosi sui decreto ingiuntivo, nei limiti "
            "dell'ottemperanza") in out


def test_a_short_last_page_takes_the_documents_left_edge():
    out = "\n\n".join(_text("snciv_26035_2026.clean.pdf").values())
    assert "Cos\u00ec deciso in Roma, nella camera di consiglio del 29 settembre 2026." in out


def test_right_aligned_role_labels_end_their_paragraph():
    out = _text("snciv_05626_2022.clean.pdf")["motivazione"]
    assert "\n\n- intimati -\n\navverso la sentenza n. 13/2020/RIS" in out
    out = _text("snciv_26034_2026.clean.pdf")["motivazione"]
    assert "\n\n- controricorrente e ricorrente incidentale \u2013\n\navverso la sentenza della Corte" in out


async def test_the_async_form_reads_a_real_decision():
    from visualex_api.services.decisions.pdf_text import text_from_pdf_async
    out = await text_from_pdf_async(FIXTURES[0].read_bytes())
    assert out["motivazione"]
