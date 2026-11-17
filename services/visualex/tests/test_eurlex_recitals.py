"""Recitals (considerando) of EU acts.

Two markups: the modern OJ page wraps each recital in
`<div class="eli-subdivision" id="rct_N">` with the number in the first table
cell; the legacy page (pre-2010 acts) has class-less `<p>(N) text</p>`
paragraphs between "considerando quanto segue:" and the enacting formula.
Consolidated texts have no preamble at all and must yield nothing.
"""
from pathlib import Path

from bs4 import BeautifulSoup

from visualex_api.services.eurlex_scraper import extract_recitals

FIXTURES = Path(__file__).parent / "fixtures" / "eurlex"


def soup_of(name):
    return BeautifulSoup((FIXTURES / name).read_text(encoding="utf-8"), "html.parser")


class TestModernMarkup:
    def test_reads_number_and_text_from_the_rct_divs(self):
        recitals = extract_recitals(soup_of("gdpr_oj_trimmed.html"))
        numbers = [r["number"] for r in recitals]
        assert numbers == ["1", "2", "3", "173"]
        assert recitals[0]["text"].startswith("La protezione delle persone fisiche")

    def test_the_number_cell_is_not_part_of_the_text(self):
        first = extract_recitals(soup_of("gdpr_oj_trimmed.html"))[0]
        assert not first["text"].startswith("(1)")

    def test_footnote_call_outs_are_dropped(self):
        # Recital 173 cites Dir. 2002/58/CE with a footnote "(18)" rendered as
        # <a>(<span class="oj-super oj-note-tag">18</span>)</a>.
        last = extract_recitals(soup_of("gdpr_oj_trimmed.html"))[-1]
        assert "(18)" not in last["text"]
        assert "direttiva 2002/58/CE" in last["text"]

    def test_multi_paragraph_recital_keeps_paragraph_breaks(self):
        html = (
            '<div class="eli-subdivision" id="rct_9"><table><tbody><tr>'
            '<td><p class="oj-normal">(9)</p></td>'
            '<td><p class="oj-normal">Primo capoverso.</p>'
            '<p class="oj-normal">Secondo capoverso.</p></td>'
            '</tr></tbody></table></div>'
        )
        assert extract_recitals(BeautifulSoup(html, "html.parser")) == [
            {"number": "9", "text": "Primo capoverso.\nSecondo capoverso."}
        ]


class TestLegacyMarkup:
    def test_reads_the_paragraph_sequence_after_the_preamble_marker(self):
        recitals = extract_recitals(soup_of("eprivacy_oj_legacy.html"))
        assert [r["number"] for r in recitals[:3]] == ["1", "2", "3"]
        assert recitals[0]["text"].startswith("La direttiva 95/46/CE")
        # Dir. 2002/58/CE has 49 recitals.
        assert recitals[-1]["number"] == "49"
        assert len(recitals) == 49

    def test_stops_at_the_enacting_formula(self):
        html = (
            "<p>considerando quanto segue:</p>"
            "<p>(1) Primo.</p><p>(2) Secondo.</p>"
            "<p>HANNO ADOTTATO LA PRESENTE DIRETTIVA:</p>"
            "<p>(1) Questo è il paragrafo 1 dell'articolo 1, non un considerando.</p>"
        )
        recitals = extract_recitals(BeautifulSoup(html, "html.parser"))
        assert [r["number"] for r in recitals] == ["1", "2"]

    def test_numbers_must_be_consecutive(self):
        # A "(4)" footnote reference paragraph between recitals is not recital 4
        # if recital 3 has not been seen.
        html = (
            "<p>considerando quanto segue:</p>"
            "<p>(1) Primo.</p><p>(4) Nota a piè di pagina.</p><p>(2) Secondo.</p>"
            "<p>HA ADOTTATO IL PRESENTE REGOLAMENTO:</p>"
        )
        recitals = extract_recitals(BeautifulSoup(html, "html.parser"))
        assert [r["number"] for r in recitals] == ["1", "2"]


class TestNoRecitals:
    def test_consolidated_text_yields_nothing(self):
        assert extract_recitals(soup_of("eprivacy_consolidated_20091219.html")) == []
        assert extract_recitals(soup_of("eidas_consolidated_20241018_trimmed.html")) == []

    def test_empty_document(self):
        assert extract_recitals(BeautifulSoup("<div>nulla</div>", "html.parser")) == []


# --- The text as the source writes it (spec 2026-11-17 §7.2, root CLAUDE.md rule 23) -------------
#
# No mark is stored on a recital yet, so these rules settle the text once before the freeze
# (`test_recitals_text_frozen.py`).

def _modern(number, *paragraphs):
    cells = "".join(f'<p class="oj-normal">{p}</p>' for p in paragraphs)
    return BeautifulSoup(
        f'<div class="eli-subdivision" id="rct_{number}"><table><tbody><tr>'
        f'<td><p class="oj-normal">({number})</p></td><td>{cells}</td>'
        "</tr></tbody></table></div>",
        "html.parser",
    )


def _call(n):
    return f'<a href="#ntr{n}">(<span class="oj-super oj-note-tag">{n}</span>)</a>'


def _legacy(*paragraphs, formula=True):
    body = "".join(f"<p>{p}</p>" for p in paragraphs)
    end = "<p>HANNO ADOTTATO LA PRESENTE DIRETTIVA:</p>" if formula else ""
    return BeautifulSoup(f"<p>considerando quanto segue:</p>{body}{end}", "html.parser")


def _by_number(name):
    return {r["number"]: r["text"] for r in extract_recitals(soup_of(name))}


class TestTheSourcesSpacing:
    def test_a_footnote_call_before_a_comma_leaves_no_space(self):
        recitals = extract_recitals(_modern(173, f"del Consiglio\xa0{_call(19)}, compresi gli"))
        assert recitals[0]["text"] == "del Consiglio, compresi gli"

    def test_a_footnote_call_before_a_word_leaves_one_space(self):
        recitals = extract_recitals(_modern(3, f"del Consiglio\xa0{_call(18)} ha come"))
        assert recitals[0]["text"] == "del Consiglio ha come"

    def test_an_italic_before_a_comma_adds_no_space(self):
        recitals = extract_recitals(_modern(5, 'l\'<span class="oj-italic">acquis</span>, che'))
        assert recitals[0]["text"] == "l'acquis, che"

    def test_a_br_inside_a_paragraph_is_one_space(self):
        assert extract_recitals(_modern(7, "prima<br/>seconda"))[0]["text"] == "prima seconda"

    def test_a_line_break_inside_a_paragraph_is_one_space(self):
        assert extract_recitals(_modern(7, "prima\n   seconda"))[0]["text"] == "prima seconda"

    def test_the_no_break_space_stays(self):
        assert extract_recitals(_modern(8, "l'articolo\xa05 "))[0]["text"] == "l'articolo\xa05"

    def test_gdpr_recital_173_reads_consiglio_comma(self):
        text = _by_number("gdpr_oj_trimmed.html")["173"]
        assert "del Consiglio, compresi" in text
        assert "Consiglio , " not in text

    def test_gdpr_recital_3_keeps_its_space_before_a_word(self):
        assert "del Consiglio ha come" in _by_number("gdpr_oj_trimmed.html")["3"]

    def test_a_legacy_footnote_call_is_kept_as_printed(self):
        # The legacy page prints the call as text glued to the word: nothing tells it from the text.
        assert "dati(4) richiede" in _by_number("eprivacy_oj_legacy.html")["1"]


class TestLegacyParagraphsBetweenRecitals:
    def test_a_paragraph_without_a_number_joins_the_recital_before_it(self):
        soup = _legacy("(1) Primo.", "Seguito del primo.", "(2) Secondo.")
        assert extract_recitals(soup) == [
            {"number": "1", "text": "Primo.\nSeguito del primo."},
            {"number": "2", "text": "Secondo."},
        ]

    def test_a_footnote_paragraph_out_of_sequence_is_still_skipped(self):
        soup = _legacy("(1) Primo.", "(4) Nota a piè di pagina.", "(2) Secondo.")
        assert extract_recitals(soup) == [
            {"number": "1", "text": "Primo."},
            {"number": "2", "text": "Secondo."},
        ]

    def test_paragraphs_after_the_last_recital_stay_out_without_an_enacting_formula(self):
        soup = _legacy("(1) Primo.", "Articolo 1", "Testo dell'articolo.", formula=False)
        assert extract_recitals(soup) == [{"number": "1", "text": "Primo."}]

    def test_the_first_articles_heading_ends_the_preamble(self):
        # No enacting formula, and a footnote paragraph after the articles carries the next number.
        soup = _legacy("(1) Primo.", "(2) Secondo.", "Articolo 1", "Testo dell'articolo.", "(3) Nota.", formula=False)
        assert extract_recitals(soup) == [
            {"number": "1", "text": "Primo."},
            {"number": "2", "text": "Secondo."},
        ]

    def test_a_continuation_that_names_an_article_is_still_a_continuation(self):
        soup = _legacy("(1) Primo.", "Articolo 1 della direttiva 95/46/CE.", "(2) Secondo.")
        assert extract_recitals(soup)[0]["text"] == "Primo.\nArticolo 1 della direttiva 95/46/CE."

    def test_an_empty_paragraph_adds_no_newline(self):
        soup = _legacy("(1) Primo.", "", "  ", "(2) Secondo.")
        assert extract_recitals(soup)[0] == {"number": "1", "text": "Primo."}

    def test_the_new_legacy_fixture_reads_every_recital_in_sequence(self):
        # Dir. 2000/31/CE, from CELLAR: 65 numbered recitals after «considerando quanto segue:».
        numbers = [r["number"] for r in extract_recitals(soup_of("dir_2000_31_oj_legacy_preamble_trimmed.html"))]
        assert numbers == [str(n) for n in range(1, 66)]
