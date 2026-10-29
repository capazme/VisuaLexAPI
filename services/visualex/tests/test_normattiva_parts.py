"""An article Normattiva splits into parts is said to be partial (G-387, «intanto subito l'avviso»).

Art. 1 l. 296/2006 has 14 parts in the page's tree, «1 (commi 1-100)» … «1 (commi
1301-1364)», and its URN serves the first only: comma 773 (part 8) was not there and
nothing said so. The parts are read from the page the scraper cached; the text comes
through untouched (root CLAUDE.md, rule 23). The pages are the captures in
`fixtures/normattiva/` (README there) and the portal's markup.
"""
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from visualex_api.services.normattiva_parts import extract_parts, partial_notice, parts_fields
from tests.test_validity_wire import (  # noqa: F401 - fixtures
    ARTICLE_ENDPOINTS, FakeCache, TEXT, URN, ask, brocardi, controller, normattiva_serving, requested,
    _no_history_writes,
)
from tests.validity_pages import page

L296_TREE = page("l296_2006_art1_parts_tree_trimmed.html")
DLGS23_TREE = page("dlgs23_2015_tree_trimmed.html")
LOAD = "/atto/caricaArticolo?art.versione=3&amp;art.idArticolo=2&amp;art.progressivo={k}&amp;"


def tree(*entries):
    """A tree in the portal's markup: (label, progressivo) per entry."""
    items = "".join(
        f'<li><a href="" onclick="return showArticle(\'{LOAD.format(k=k)}\', this);" class="numero_articolo">{label}</a></li>'
        for label, k in entries
    )
    return f'<html><body><div id="albero"><ul>{items}</ul></div></body></html>'


class TestRealPages:
    def test_the_fourteen_parts_of_art_1_l_296_2006(self):
        parts = extract_parts(L296_TREE, article="1")
        assert [(p["progressivo"], p["commi_dal"], p["commi_al"]) for p in parts] == [
            (k, str(100 * (k - 1) + 1), "1364" if k == 14 else str(100 * k)) for k in range(1, 15)
        ]
        assert parts[7]["url"] == (
            "https://www.normattiva.it/atto/caricaArticolo?art.versione=151&art.idGruppo=0&art.flagTipoArticolo=0"
            "&art.codiceRedazionale=006G0318&art.idArticolo=1&art.idSottoArticolo=1&art.idSottoArticolo1=10"
            "&art.dataPubblicazioneGazzetta=2006-12-27&art.progressivo=8"
        )
        assert partial_notice(parts) == "testo parziale: commi 1-100 di 1364 (diviso in 14 parti)"

    def test_an_earlier_version_s_parts_are_not_the_article_s(self):
        """The tree lists «agg.149 (commi 1-100)» too: a version of art. 1, never art. 149."""
        assert extract_parts(L296_TREE, article="149") == []

    def test_an_article_listed_whole_has_no_parts(self):
        assert extract_parts(DLGS23_TREE, article="3") == []

    def test_a_page_with_no_tree_cannot_say(self):
        assert extract_parts(page("dlgs23_2015_art3_update_notes_trimmed.html"), article="3") is None
        assert extract_parts("", article="3") is None


class TestTheTree:
    def test_the_article_is_compared_by_key(self):
        parts = extract_parts(tree(("2 bis (commi 1-50)", 1), ("2 bis (commi 51-60)", 2), ("2 (commi 1-9)", 1)),
                              article="2-bis")
        assert [(p["commi_dal"], p["commi_al"]) for p in parts] == [("1", "50"), ("51", "60")]

    def test_a_code_s_label_with_art(self):
        assert len(extract_parts(tree(("art. 7 (commi 1-100)", 1), ("art. 7 (commi 101-120)", 2)), article="7")) == 2

    def test_ordered_by_progressivo_and_never_twice(self):
        parts = extract_parts(tree(("7 (commi 101-120)", 2), ("7 (commi 1-100)", 1), ("7 (commi 1-100)", 1)), article="7")
        assert [p["progressivo"] for p in parts] == [1, 2]

    def test_a_progressivo_is_read_as_the_page_writes_it(self):
        """Another page may count from 0: the number is the page's, the key is the comma range."""
        parts = extract_parts(tree(("7 (commi 1-100)", 0), ("7 (commi 101-120)", 1)), article="7")
        assert [p["progressivo"] for p in parts] == [0, 1]

    def test_an_entry_without_its_link_is_skipped(self):
        raw = tree(("7 (commi 1-100)", 1)).replace("showArticle", "somethingElse")
        assert extract_parts(raw, article="7") == []

    def test_linear_on_a_hostile_page(self):
        hostile = "<a class=\"numero_articolo\">" + "7 (commi " * 20_000 + "<a " + " " * 200_000 + ">"
        started = time.perf_counter()
        extract_parts(hostile * 3, article="7")
        assert time.perf_counter() - started < 2


class TestFields:
    def test_split_and_whole(self):
        parts = extract_parts(L296_TREE, article="1")
        assert parts_fields(parts) == {"parti": parts, "testo_parziale": True}
        assert parts_fields([]) == {"parti": [], "testo_parziale": False}
        assert parts_fields(None) == {"parti": None, "testo_parziale": False}


class TestOnTheWire:
    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_a_split_article_is_said_to_be_partial(self, controller, brocardi, endpoint):
        [result] = await ask(controller, endpoint, requested(article="1"), scraper=normattiva_serving(L296_TREE))
        assert result["article_text"] == TEXT
        assert result["testo_parziale"] is True
        assert len(result["parti"]) == 14 and result["parti"][7]["commi_dal"] == "701"

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_a_whole_article_is_not(self, controller, brocardi, endpoint):
        [result] = await ask(controller, endpoint, requested(), scraper=normattiva_serving(DLGS23_TREE))
        assert (result["parti"], result["testo_parziale"]) == ([], False)

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_the_akn_export_holds_the_whole_article(self, controller, brocardi, endpoint):
        scraper = normattiva_serving(L296_TREE)
        scraper.get_document.return_value = ("### Art. 1\n\n1. …", URN)
        [result] = await ask(controller, endpoint, requested(article="1"), scraper=scraper)
        assert (result["parti"], result["testo_parziale"]) == (None, False)

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_one_reader_failing_leaves_the_other(self, controller, brocardi, endpoint):
        with patch("app.extract_update_notes", side_effect=RuntimeError("boom")):
            [result] = await ask(controller, endpoint, requested(article="1"), scraper=normattiva_serving(L296_TREE))
        assert result["article_text"] == TEXT
        assert result["note_aggiornamento"] is None and result["note_non_lette"] is True
        assert result["testo_parziale"] is True

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_an_eur_lex_text_carries_no_parts(self, controller, brocardi, endpoint):
        eurlex = SimpleNamespace(get_document=AsyncMock(return_value=(TEXT, "https://eur-lex.example/x")),
                                 cache=FakeCache({"https://eur-lex.example/x": L296_TREE}))
        with patch("app.eurlex_scraper", eurlex):
            [result] = await ask(controller, endpoint, requested(tipo_atto="regolamento ue"))
        assert not {"parti", "testo_parziale"} & set(result)
