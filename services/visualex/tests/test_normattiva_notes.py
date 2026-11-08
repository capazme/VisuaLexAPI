"""The update notes («AGGIORNAMENTO (N)») next to a Normattiva article's text (G-386).

The comma formats' extractor leaves the notes out of `article_text`, and that
output is frozen (root CLAUDE.md, rule 23): art. 3 d.lgs. 23/2015 lost its note on
C. cost. 194/2018. The notes are read from the page the scraper cached, into
their own fields, and the text comes through untouched. The pages are the
captures in `fixtures/normattiva/` (README there) and the portal's markup.
"""
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from visualex_api.services.normattiva_notes import extract_update_notes, update_notes_fields
from visualex_api.services.normattiva_scraper import NormattivaScraper
from visualex_api.tools.selectors import NormattivaSelectors
from tests.test_validity_wire import (  # noqa: F401 - fixtures
    ARTICLE_ENDPOINTS, FakeCache, TEXT, URN, ask, brocardi, controller, normattiva_serving, requested,
    _no_history_writes,
)
from tests.validity_pages import page, synthetic

DLGS23_ART3 = page("dlgs23_2015_art3_update_notes_trimmed.html")
CC_1284 = page("art1284_cc_in_force_update_notes_trimmed.html")
CC_2043 = page("art2043_cc_in_force_no_notes_trimmed.html")


def note_block(heading="AGGIORNAMENTO (5)", text="Il D.L. 1 gennaio 2020, n. 1 ha disposto che …", title=True):
    """One `div.art_aggiornamento-akn` in the portal's markup."""
    head = f'<div class="art_aggiornamento_title-akn">{heading}</div>' if title else ""
    return (
        '<div class="art_aggiornamento-akn">'
        '<div class="art_aggiornamento_separator-akn">-------------</div>'
        f'{head}<div class="art_aggiornamento_testo-akn"><br>\n {text} </div></div>'
    )


def comma_page(text="1. Il testo del comma. (5)", notes=""):
    return synthetic(
        label="Art. 7",
        content=f'<div class="art-comma-div-akn"><span class="art_text_in_comma">{text}</span></div>{notes}',
    )


class TestRealPages:
    def test_the_comma_format_keeps_its_four_notes(self):
        read = extract_update_notes(DLGS23_ART3, article="3")
        assert [(n["numero"], n["ordine"], n["corte_costituzionale"]) for n in read["notes"]] == [
            ("1", 1, False), ("2", 2, True), ("3", 3, False), ("10", 4, True),
        ]
        assert read["unread"] is False
        assert read["in_text"] is False
        ruling = read["notes"][1]["testo"]
        assert ruling.startswith("La Corte Costituzionale, con sentenza 26 settembre - 8 novembre 2018 n. 194")
        # Links as their text, entities decoded, whitespace collapsed, no heading or separator.
        assert "dell'art. 3, comma 1, del decreto legislativo 4 marzo 2015, n. 23 (" in ruling
        assert "AGGIORNAMENTO" not in ruling and "----" not in ruling and "  " not in ruling
        assert "<" not in ruling

    async def test_the_extractor_still_leaves_them_out_of_the_text(self):
        """The gap the field fills: the frozen text has none of them."""
        scraper = NormattivaScraper.__new__(NormattivaScraper)  # no __init__: no cache, no network
        scraper.selectors = NormattivaSelectors()
        extracted = await scraper.estrai_da_html(DLGS23_ART3)
        assert "194" not in extracted and "AGGIORNAMENTO" not in extracted

    def test_a_code_article_carries_its_notes_and_says_they_are_in_the_text(self):
        read = extract_update_notes(CC_1284, article="1284")
        assert len(read["notes"]) == 22
        assert [n["numero"] for n in read["notes"]][:3] == ["129a", "140a", "151a"]
        assert read["notes"][-1]["numero"] == "348"
        assert [n["ordine"] for n in read["notes"]] == list(range(1, 23))
        assert read["unread"] is False  # «((348))» has its note
        assert read["in_text"] is True

    def test_an_article_with_no_notes_is_an_empty_list(self):
        assert extract_update_notes(CC_2043, article="2043") == {"notes": [], "unread": False, "in_text": True}

    @pytest.mark.parametrize("name", ["akn_comma_div.html", "akn_just_text.html"])
    def test_the_comma_formats_with_no_notes(self, name):
        assert extract_update_notes(page(name)) == {"notes": [], "unread": False, "in_text": False}


class TestWhatCannotBeRead:
    def test_a_marker_with_no_note_flags_the_answer(self):
        read = extract_update_notes(comma_page(text="1. Il testo. ((6))", notes=note_block()), article="7")
        assert [n["numero"] for n in read["notes"]] == ["5"]
        assert read["unread"] is True

    def test_bracketed_amended_words_on_a_page_with_no_notes_are_not_markers(self):
        """The portal brackets amended words too: «entro ((30)) giorni»."""
        read = extract_update_notes(comma_page(text="1. Entro ((30)) giorni."), article="7")
        assert read == {"notes": [], "unread": False, "in_text": False}

    def test_a_renumbered_comma_is_not_a_marker(self):
        """«((2)).» opening a line is a comma the amendment renumbered (art. 117 TUB)."""
        page_ = comma_page(text="\n((2)). Il contratto è redatto per iscritto.", notes=note_block())
        assert extract_update_notes(page_, article="7")["unread"] is False
        mid_line = comma_page(text="1. Il testo ((2)). Altro.", notes=note_block())
        assert extract_update_notes(mid_line, article="7")["unread"] is True

    def test_a_year_is_not_a_marker(self):
        page_ = comma_page(text="1. Dal 1° gennaio ((2027)) il saggio …", notes=note_block())
        assert extract_update_notes(page_, article="7")["unread"] is False

    def test_more_headings_than_notes_read_flags_the_answer(self):
        """A heading outside a note block: a note the reader did not see as one."""
        stray = '<div class="art_aggiornamento_title-akn">AGGIORNAMENTO (6)</div><div>Il D.L. … ha disposto …</div>'
        read = extract_update_notes(comma_page(notes=note_block() + stray), article="7")
        assert [n["numero"] for n in read["notes"]] == ["5"]
        assert read["unread"] is True

    def test_a_plain_marker_with_no_note_is_left_alone(self):
        read = extract_update_notes(comma_page(text="1. Il testo. (6)"), article="7")
        assert read == {"notes": [], "unread": False, "in_text": False}

    def test_a_marker_reads_its_note_by_number_and_letter(self):
        page_ = comma_page(text="1. Il testo. (( 129A ))", notes=note_block("AGGIORNAMENTO (129a)"))
        assert extract_update_notes(page_, article="7")["unread"] is False

    @pytest.mark.parametrize("block", [
        note_block(title=False),
        note_block(heading="AGGIORNAMENTO"),
        note_block(heading="NOTA"),
    ])
    def test_a_block_with_no_number_is_skipped_and_flagged(self, block):
        read = extract_update_notes(comma_page(notes=note_block() + block), article="7")
        assert [n["numero"] for n in read["notes"]] == ["5"]
        assert read["unread"] is True

    def test_a_note_heading_is_not_a_marker(self):
        """«AGGIORNAMENTO (5)» is the note's own heading, never a reference to look up."""
        read = extract_update_notes(comma_page(notes=note_block("AGGIORNAMENTO (5)")), article="7")
        assert read["unread"] is False

    def test_another_article_s_page_claims_nothing(self):
        assert extract_update_notes(DLGS23_ART3, article="4") is None

    @pytest.mark.parametrize("raw", ["", "<html>not an article page</html>"])
    def test_a_page_with_no_body_is_unreadable(self, raw):
        assert extract_update_notes(raw) is None

    def test_a_note_with_no_text_div_reads_the_block_less_its_heading(self):
        block = ('<div class="art_aggiornamento-akn"><div class="art_aggiornamento_separator-akn">---</div>'
                 '<div class="art_aggiornamento_title-akn">AGGIORNAMENTO (5)</div> Il  testo\n della nota. </div>')
        [note] = extract_update_notes(comma_page(notes=block), article="7")["notes"]
        assert note["testo"] == "Il testo della nota."


class TestTheCourt:
    @pytest.mark.parametrize("text,expected", [
        ("La Corte costituzionale, con sentenza 8 novembre 2018 n. 194, ha dichiarato …", True),
        ("La CORTE COSTITUZIONALE con SENTENZA n. 1/2020 …", True),
        ("C. cost., sentenza 16 luglio 2024, n. 128 …", True),
        ("La Corte costituzionale, con ordinanza n. 5/2020, ha dichiarato inammissibile …", False),
        ("Il D.L. 12 luglio 2018, n. 87 ha disposto (con l'art. 1, comma 3) che la sentenza …", False),
    ])
    def test_a_word_match_only(self, text, expected):
        [note] = extract_update_notes(comma_page(notes=note_block(text=text)), article="7")["notes"]
        assert note["corte_costituzionale"] is expected


class TestFields:
    def test_a_read_page(self):
        assert update_notes_fields({"notes": [], "unread": False, "in_text": False}) == {
            "note_aggiornamento": [], "note_non_lette": False, "note_nel_testo": False,
        }

    def test_an_unreadable_page_says_the_notes_were_not_read(self):
        assert update_notes_fields(None) == {
            "note_aggiornamento": None, "note_non_lette": True, "note_nel_testo": False,
        }

    def test_the_akn_export_has_its_notes_in_the_text(self):
        assert update_notes_fields(None, akn_text=True) == {
            "note_aggiornamento": None, "note_non_lette": False, "note_nel_testo": True,
        }


class TestOnTheWire:
    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_a_reader_that_fails_never_costs_the_article(self, controller, brocardi, endpoint):
        with patch("app.extract_update_notes", side_effect=RuntimeError("boom")):
            [result] = await ask(controller, endpoint, requested(), scraper=normattiva_serving(DLGS23_ART3))
        assert result["article_text"] == TEXT
        assert (result["note_aggiornamento"], result["note_non_lette"]) == (None, True)

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_the_notes_ride_next_to_an_untouched_text(self, controller, brocardi, endpoint):
        [result] = await ask(controller, endpoint, requested(), scraper=normattiva_serving(DLGS23_ART3))
        assert result["article_text"] == TEXT
        assert [n["numero"] for n in result["note_aggiornamento"]] == ["1", "2", "3", "10"]
        assert result["note_non_lette"] is False
        assert result["note_nel_testo"] is False

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    @pytest.mark.parametrize("page_", [None, "<html>not an article page</html>"])
    async def test_an_unreadable_page_is_null_and_flagged(self, controller, brocardi, endpoint, page_):
        [result] = await ask(controller, endpoint, requested(), scraper=normattiva_serving(page_))
        assert result["article_text"] == TEXT
        assert result["note_aggiornamento"] is None
        assert result["note_non_lette"] is True

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_the_akn_export_s_text_is_not_read_again(self, controller, brocardi, endpoint):
        scraper = normattiva_serving(DLGS23_ART3)
        akn = "### Art. 3\n\n1. Il testo dall'export.\n\nAGGIORNAMENTO (2) …"
        scraper.get_document.return_value = (akn, URN)
        [result] = await ask(controller, endpoint, requested(), scraper=scraper)
        assert result["article_text"] == akn
        assert (result["note_aggiornamento"], result["note_non_lette"], result["note_nel_testo"]) == (None, False, True)

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_an_eur_lex_text_carries_no_notes(self, controller, brocardi, endpoint):
        eurlex = SimpleNamespace(get_document=AsyncMock(return_value=(TEXT, "https://eur-lex.example/x")),
                                 cache=FakeCache({"https://eur-lex.example/x": DLGS23_ART3}))
        with patch("app.eurlex_scraper", eurlex):
            [result] = await ask(controller, endpoint, requested(tipo_atto="regolamento ue"))
        assert not {"note_aggiornamento", "note_non_lette", "note_nel_testo"} & set(result)


def test_the_patterns_stay_linear_on_a_hostile_page():
    """`re` holds the GIL: a pattern quadratic on a page the portal did not mean to serve stalls the loop."""
    hostile = comma_page(text="((" * 50_000 + "1" + " " * 50_000, notes=note_block(heading="AGGIORNAMENTO (" + " " * 50_000))
    started = time.perf_counter()
    extract_update_notes(hostile, article="7")
    assert time.perf_counter() - started < 2
