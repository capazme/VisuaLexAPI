"""The Cassazione's text from its original PDF (design 2026-10-05 §11), on synthetic PDFs.

The repository is public, so no real decision is committed: `decisions_pdf_synth.make_pdf`
builds PDFs laid out the way the court's are (A4 595 x 842, one text line per `Text`, positions
measured on the real files: first-page header at y0 750-800, the «Oggetto» box at x0 407, running
footers at y0 49-72, body at x0 70-103, the rotated watermark at x about 560). The same rules run
on the real files in `test_decisions_pdf_text_local.py`, which skips when they are not on disk.
"""
import re

import pytest

from tests.decisions_pdf_synth import Text, make_pdf
from visualex_api.services.decisions.pdf_text import (
    MAX_BYTES, MAX_PAGES, PdfRefused, _furniture, _left_per_page, _lines, _POINT, _paragraphs,
    text_from_pdf, text_from_pdf_async)


def _flow(x, y, lines, step=14):
    return [Text(x, y - i * step, t) for i, t in enumerate(lines)]


def _decision(pqm="P.Q.M.") -> bytes:
    """Four pages; every rule of the reader has a line here. Page 0's body edge is 85, page 1's
    is 70 (drift), page 2's 100; the last page is short."""
    p0 = [Text(85, 800, "Civile Ord. Sez. 1 Num. 12345 Anno 2026"),
          Text(85, 786, "Presidente: PRIMO PRESIDENTE"),
          Text(85, 772, "Relatore: CONSIGLIERE ESTENSORE"),
          Text(85, 758, "Data pubblicazione: 01/01/2026"),
          Text(407, 735, "Oggetto: appalti"), Text(407, 721, "pubblici di lavori"),
          Text(560, 300, "copia non ufficiale", rotate=True),  # the vertical watermark
          Text(255, 700, "ORDINANZA"),
          Text(424, 660, "- ricorrente -"),                     # right-aligned, below the title
          Text(255, 640, "contro"),
          Text(400, 620, "- controricorrente -")]
    p0 += _flow(85, 600, ["sul ricorso proposto da una societa di costruzioni contro il",
                          "Ministero competente, avverso la sentenza della Corte di appello,",
                          "visti gli atti della CORTE DEI CONTI -",
                          "SEZIONI RIUNITE, depositati il giorno stabilito."])
    p0 += _flow(85, 524, ["Udita la relazione svolta nella camera di consiglio dal consigliere.",
                          "Il giudice del (cid:9)rinvio ha deciso la causa in via definitiva."])  # a gap
    p0 += [Text(255, 480, "FATTI DI CAUSA")]
    p0 += [Text(100, 460, "La societa ricorrente ha agito in giudizio contro l'amministrazione per")]  # indent
    p0 += _flow(85, 446, ["il pagamento di un corrispettivo contrattuale, assumendo che il",
                          "territorio dell'Emilia-", "Romagna fosse compreso nell'appalto."])
    p0 += [Text(100, 400, "La Corte di appello ha rigettato la domanda,"),
           Text(85, 386, "ritenendo il contratto privo dei requisiti di forma richiesti dalla legge.")]
    p0 += [Text(85, 74.5, "Il Presidente estensore"),
           Text(85, 51.5, "Ric. 2020 n. 12345 sez. SU - ud. 14-12-2021")]

    p1 = [Text(85, 800, "r.g. n. 27512/2022"), Text(85, 776, "Cons. est. Estensore"),
          Text(255, 720, "CONSIDERATO CHE"),
          Text(70, 704, "il ricorso si articola nei motivi che seguono."),
          Text(55, 690, "7. va premessa la questione di giurisdizione, rilevabile"),
          Text(70, 676, "anche d'ufficio in ogni stato e grado del giudizio."),
          Text(55, 652, "13.11 ricorso è inammissibile"),          # OCR: «Il» read as «11»
          Text(70, 638, "perche' privo di specificita'."),
          Text(55, 614, "52.1e modalità esecutive"),                # OCR: «le» read as «1e»
          Text(70, 600, "sono quelle indicate nel decreto."),
          Text(70, 576, "la condanna al pagamento della somma di euro"),
          Text(55, 562, "612.000,00 subordinatamente alla prova,"),    # outdented, not points
          Text(55, 548, "22.06.2020 depositata la sentenza,"),
          Text(55, 534, "1,5 milioni di euro oltre accessori."),
          Text(440, 510, "- intimati -"),                               # right-aligned label
          Text(70, 496, "avverso la sentenza della Corte di appello, depositata il giorno."),
          Text(70, 472, "presupposti fattuali con esplicazione solo di motivi"),
          Text(540, 479, "(A,", size=18),                              # stamp debris in the margin
          Text(70, 458, "diritto proposti dalla parte."),
          Text(100, 420, "Il secondo motivo e' fondato; la questione si pone nei confronti dell'"),
          # one baseline in three pieces, y0 124.77 / 124.52 / 124.27 across a /3 rounding boundary,
          # the middle piece (by x) the lowest
          Text(70, 141, "la parte ricorrente nei confronti dell'"),
          Text(70, 127.256, "ASSESSORATO DELL'ISTRUZIONE"),
          Text(440, 127.006, "PROFESSIONALE"),
          Text(330, 126.756, "E DELLA FORMAZIONE"),
          Text(70, 100, "contro"),                    # a body line in the band, at y 100 here only
          Text(85, 76, "Il Presidente estensore"),     # a footer at about the same y as page 0's
          Text(85, 51.5, "2"), Text(140, 51.5, "Ric, 2021 n. 039U Su. SU - ud. 08-02-2022"),
          Text(290, 32, "-2-")]
    p2 = [Text(85, 800, "r.g. n. 27512/2022")]
    p2 += _flow(100, 700, ["ritenuto che la domanda sia fondata e che le spese seguano la",
                          "soccombenza, la Corte decide come segue."])
    p2 += [Text(255 if len(pqm) < 8 else 230, 640, pqm)]
    p2 += _flow(100, 620, ["la Corte accoglie il ricorso e cassa la sentenza impugnata",
                          "con rinvio; condanna la parte soccombente alle spese."])
    p2 += [Text(100, 88, "contro"),                     # the same short line, at another y
           Text(85, 51.5, "-3-"), Text(130, 51.5, "Ric. 2020 n. 12345 sez. SU - ud. 14-12-2021"),
           Text(297, 32, "3")]
    p2 += [Text(85, 74.5, "Il Presidente estensore")]
    p3 = [Text(108, 700, "Così deciso in Roma, nella camera di consiglio del 29 settembre"),
          Text(85, 686, "2026."), Text(297, 51.5, "-4-")]
    return make_pdf([p0, p1, p2, p3])


@pytest.fixture(scope="module")
def decision():
    return _decision()


@pytest.fixture(scope="module")
def out(decision):
    return text_from_pdf(decision)


def _whole(out):
    return "\n\n".join(out.values())


def test_the_generator_lays_out_like_the_courts_pdfs(decision):
    # the positions the reader sees, against those measured on the real files
    lines = _lines(decision)
    page0 = [l for l in lines if l["page"] == 0]
    header = [l for l in page0 if l["text"].startswith(("Civile", "Presidente", "Relatore", "Data pub"))]
    assert len(header) == 4 and all(749 <= l["y"] <= 800 for l in header)
    oggetto = [l for l in page0 if l["text"].startswith(("Oggetto", "pubblici"))]
    assert len(oggetto) == 2 and all(round(l["x0"]) == 407 for l in oggetto)
    footers = [l for l in page0 if l["text"].startswith(("Ric.", "Il Presidente"))]
    assert all(48 <= l["y"] <= 73 for l in footers) and len(footers) == 2
    assert all(l["width"] == 595 and l["height"] == 842 for l in lines)
    assert not any("copia non ufficiale" in l["text"] for l in lines)  # rotated: not upright
    # one text line per Tj: the three pieces of the split baseline stay three pieces, at the
    # y0 the real file had (124.77 / 124.52 / 124.27)
    import io
    from pdfminer.high_level import extract_pages
    from pdfminer.layout import LTTextLine

    def text_lines(node):
        for child in node:
            if isinstance(child, LTTextLine):
                yield child
            elif hasattr(child, "__iter__"):
                yield from text_lines(child)

    pieces = sorted(round(l.y0, 2) for l in text_lines(list(extract_pages(io.BytesIO(decision)))[1])
                    if 124 < l.y0 < 125)
    assert pieces == [124.27, 124.52, 124.77]
    assert {round(y / 3) for y in pieces} == {41, 42}   # a fixed /3 grid would split them


def test_the_first_page_header_and_the_oggetto_box_are_dropped(out):
    whole = _whole(out)
    for furniture in ("Civile Ord.", "Presidente:", "Relatore:", "Data pubblicazione:",
                      "Oggetto:", "pubblici di lavori"):
        assert furniture not in whole, furniture
    # the title and the right-aligned labels below it are text
    assert whole.startswith("ORDINANZA\n\n- ricorrente -\n\ncontro\n\n- controricorrente -\n\nsul ricorso")


def test_the_rotated_watermark_is_dropped(decision, out):
    assert "copia non ufficiale" not in _whole(out)
    # it is in the file, as upright=False text: dropping it is the reader's doing
    from pdfminer.high_level import extract_pages
    from pdfminer.layout import LTChar
    import io

    def chars(node):
        for child in node:
            if isinstance(child, LTChar):
                yield child
            elif hasattr(child, "__iter__"):
                yield from chars(child)

    assert any(not c.upright for page in extract_pages(io.BytesIO(decision)) for c in chars(page))


def test_running_footers_and_page_numbers_are_dropped(out):
    whole = _whole(out)
    assert re.search(r"Ric[.,]\s*\d{4}\s+n\.", whole) is None   # also the OCR-varied «Ric, 2021 n. 039U Su. SU»
    assert "Il Presidente estensore" not in whole               # the same footer at the same y on 3 pages
    assert "r.g. n. 27512/2022" not in whole and "Cons. est." not in whole
    assert not re.search(r"(?:^|\n\n)(?:-\s*\d\s*-|\d)(?:\n\n|$)", whole)  # «2», «-2-», «-3-», «4»
    assert "-3-" not in whole and "-4-" not in whole


def test_a_page_number_fused_with_the_footer_is_dropped_with_it(decision):
    # «2 Ric, 2021 …» and «-3- Ric. 2020 …»: the row merge puts the number left of the footer
    lines = _lines(decision)
    fused = [i for i, l in enumerate(lines)
             if l["text"].startswith(("2 Ric,", "-3- Ric."))]
    assert len(fused) == 2
    assert set(fused) <= _furniture(lines)


def test_a_body_line_in_the_band_that_repeats_at_another_y_is_kept(out):
    # «contro» sits in the bottom band at y 100 on page 1 and at y 88 on page 2: not a footer
    assert "FORMAZIONE PROFESSIONALE contro ritenuto che la domanda" in _whole(out)
    assert out["dispositivo"].count("contro") == 1 and "alle spese.\n\ncontro\n\nCos" in out["dispositivo"]


def test_a_footer_at_the_same_y_on_two_pages_is_dropped(decision):
    lines = _lines(decision)
    for i, l in enumerate(lines):
        if l["text"] == "Il Presidente estensore":
            assert i in _furniture(lines)
    assert sum(1 for l in lines if l["text"] == "Il Presidente estensore") == 3


def test_unmapped_glyphs_are_removed(out):
    whole = _whole(out)
    assert "(cid:" not in whole
    assert "Il giudice del rinvio ha deciso" in whole
    assert "  " not in whole.replace("\n\n", "")


def test_an_indent_and_a_vertical_gap_each_start_a_paragraph(out):
    m = out["motivazione"]
    # a gap of 34 pt before «Udita la relazione»
    assert "stabilito.\n\nUdita la relazione" in m
    # an indented first line, then continuation lines back at the margin
    assert ("\n\nLa societa ricorrente ha agito in giudizio contro l'amministrazione per il "
            "pagamento di un corrispettivo contrattuale") in m
    assert "appalto.\n\nLa Corte di appello ha rigettato la domanda, ritenendo" in m
    # the ordinary lines of a paragraph are joined by one space
    assert "visti gli atti della CORTE DEI CONTI - SEZIONI RIUNITE, depositati" in m


def test_a_centred_heading_starts_its_own_paragraph(out):
    m = out["motivazione"]
    assert "\n\nFATTI DI CAUSA\n\nLa societa" in m
    assert "\n\nCONSIDERATO CHE\n\nil ricorso si articola" in m


def test_a_line_ending_in_a_hyphen_joins_without_a_space(out):
    assert "territorio dell'Emilia-Romagna fosse compreso" in out["motivazione"]


def test_a_line_ending_in_a_spaced_dash_joins_with_a_space(out):
    # the character before the dash is a space, not a letter: two words, not one broken in two
    assert "CORTE DEI CONTI - SEZIONI RIUNITE" in out["motivazione"]
    assert "CONTI -SEZIONI" not in out["motivazione"] and "CONTI-SEZIONI" not in out["motivazione"]


def test_numbered_points_are_separate_paragraphs_even_when_ocr_misreads_them(out):
    m = out["motivazione"]
    assert "\n\n7. va premessa la questione di giurisdizione, rilevabile anche d'ufficio" in m
    assert "\n\n13.11 ricorso è inammissibile perche' privo di specificita'." in m
    assert "\n\n52.1e modalità esecutive sono quelle indicate nel decreto." in m


def test_an_amount_a_date_or_a_decimal_at_a_line_start_is_not_a_numbered_point(out):
    for text in ("612.000,00 subordinatamente", "22.06.2020 depositata", "1,5 milioni"):
        assert _POINT.match(text) is None, text
    for text in ("13.11 ricorso", "52.1e modalità", "7. va premessa", "47.il giudice", "8) altro"):
        assert _POINT.match(text), text
    # the three outdented lines stay in the sentence they belong to
    assert ("la condanna al pagamento della somma di euro 612.000,00 subordinatamente alla prova, "
            "22.06.2020 depositata la sentenza, 1,5 milioni di euro oltre accessori.") in out["motivazione"]


def test_right_aligned_role_labels_end_their_paragraph(out):
    assert ("\n\n- intimati -\n\navverso la sentenza della Corte di appello, depositata il giorno."
            in out["motivazione"])


def test_margin_debris_is_dropped_not_kept_as_a_false_heading(out):
    m = out["motivazione"]
    assert "(A," not in m
    assert "presupposti fattuali con esplicazione solo di motivi diritto proposti dalla parte." in m


def test_the_left_edge_is_read_per_page(out):
    # page 0's edge is 85 (the document's), page 2's is 100: against the document-wide edge every
    # line of page 2 would be indented by 15 pt and start a paragraph of its own
    m = out["motivazione"]
    assert ("PROFESSIONALE contro ritenuto che la domanda sia fondata e che le spese seguano la "
            "soccombenza, la Corte decide come segue.") in m
    assert "\n\nsoccombenza" not in m
    assert "\n\nla Corte accoglie il ricorso e cassa la sentenza impugnata con rinvio;" in out["dispositivo"]


def test_one_physical_baseline_is_never_split_by_the_row_grid(out):
    # y0 124.77 / 124.52 / 124.27: a round(y0 / 3) grid split them (42, 42, 41) and sorted the
    # lowest piece, which sits in the middle by x, ahead of the rest of its line
    whole = _whole(out)
    assert "ASSESSORATO DELL'ISTRUZIONE E DELLA FORMAZIONE PROFESSIONALE" in whole
    assert "FORMAZIONE ASSESSORATO" not in whole and "PROFESSIONALE E DELLA" not in whole


@pytest.mark.parametrize("heading", ["P.Q.M.", "PQM.", "PER QUESTI MOTIVI"])
def test_the_dispositivo_starts_at_its_heading(heading):
    out = text_from_pdf(_decision(heading))
    assert out["dispositivo"].startswith(f"{heading}\n\nla Corte accoglie il ricorso")
    assert out["dispositivo"].endswith("29 settembre 2026.")
    assert "soccombenza, la Corte decide come segue." in out["motivazione"]
    assert heading not in out["motivazione"]


def test_a_short_last_page_takes_the_documents_left_edge(out):
    # the last page has one line at 108 and one at 85, every x0 distinct: no edge of its own
    assert out["dispositivo"].endswith("Così deciso in Roma, nella camera di consiglio del "
                                       "29 settembre 2026.")
    lines = [{"page": 0, "x0": 103.0}] * 5 + [{"page": 1, "x0": 108.0}, {"page": 1, "x0": 85.0}]
    assert _left_per_page(lines) == {0: 103, 1: 103}


def test_furniture_band_repeat_requires_the_same_y_across_pages():
    base = {"height": 842.0, "width": 595.0}
    lines = [
        {**base, "page": 0, "x0": 90.0, "y": 20.0, "text": "contro"},
        {**base, "page": 1, "x0": 90.0, "y": 90.0, "text": "contro"},   # same text, 70 pt apart
        {**base, "page": 0, "x0": 90.0, "y": 53.0, "text": "Il Presidente estensore"},
        {**base, "page": 1, "x0": 90.0, "y": 54.0, "text": "Il Presidente estensore"},  # 1 pt apart
    ]
    drop = _furniture(lines)
    assert 0 not in drop and 1 not in drop
    assert 2 in drop and 3 in drop


def test_a_page_number_token_left_of_the_footer_is_still_furniture():
    base = {"height": 842.0, "width": 595.0, "x0": 90.0, "page": 0, "y": 53.0}
    lines = [{**base, "text": "-2- Ric. 2020 n. 23927 sez. SU - ud. 14-12-2021"},
             {**base, "text": "2 Ric, 2021 n. 039U Su. SU - ud. 08-02-2022"},
             {**base, "text": "contro"}]
    assert _furniture(lines) == {0, 1}


def test_an_outdented_amount_does_not_split_a_paragraph():
    page = {"page": 0, "x1": 480.0, "width": 595.0}
    body = [{**page, "x0": 80.0, "y": 700.0 - 20 * i, "text": t} for i, t in enumerate(
        ["uno due tre", "quattro cinque", "alla somma di euro", "612.000,00 subordinata", "sei"])]
    body[3]["x0"] = 60.0
    body += [{**page, "x0": 80.0, "y": 600.0 - 20 * i, "text": "riga"} for i in range(3)]
    assert len(_paragraphs(body)) == 1


def test_the_paragraphs_never_run_together(out):
    for block in out.values():
        for paragraph in block.split("\n\n"):
            assert len(paragraph) <= 600, paragraph[:80]


# --- refusals -------------------------------------------------------------------------------

def test_not_a_pdf_is_refused():
    with pytest.raises(PdfRefused):
        text_from_pdf(b"<html>Verifica di sicurezza</html>")


def test_a_pdf_over_the_size_limit_is_refused_before_parsing():
    with pytest.raises(PdfRefused):
        text_from_pdf(b"%PDF-1.4\n" + b"0" * MAX_BYTES)


def test_a_truncated_pdf_is_refused_not_crashed(decision):
    with pytest.raises(PdfRefused):
        text_from_pdf(decision[: len(decision) // 3])


def test_a_pdf_over_the_page_limit_is_refused():
    data = make_pdf([[Text(85, 700, "una riga")] for _ in range(MAX_PAGES + 1)])
    with pytest.raises(PdfRefused, match="page limit"):
        text_from_pdf(data)


def test_a_pdf_with_no_text_layer_is_refused():
    with pytest.raises(PdfRefused):
        text_from_pdf(make_pdf([[Text(560, 300, "copia non ufficiale", rotate=True)]]))


async def test_a_timeout_is_refused_not_hung(decision):
    with pytest.raises(PdfRefused):
        await text_from_pdf_async(decision, timeout=0)


async def test_the_async_form_runs_in_a_thread_with_a_time_limit(decision):
    out = await text_from_pdf_async(decision)
    assert out["motivazione"] and out["dispositivo"]
