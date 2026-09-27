"""EU consolidated texts.

For regulations and directives VisuaLex reads the Official Journal page
(`/eli/…/oj/ita`) — the act as published. That is the wrong text for an act
that has been amended: Dir. 2002/58/CE without the 2009 amendment has no
cookie rule in art. 5(3); Reg. 910/2014 was rewritten by Reg. 2024/1183.
EUR-Lex publishes consolidated versions under a sector-0 CELEX
("02002L0058-20091219"); a request may name one and VisuaLex serves it.
"""
import re
from unittest.mock import AsyncMock, patch

import pytest

from app import NormaController
from visualex_api.services.eurlex_scraper import EurlexScraper
from visualex_api.tools.exceptions import ValidationError
from visualex_api.tools.norma import Norma, NormaVisitata

CONSOLIDATED = "https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=CELEX:02002L0058-20091219"
OJ = "https://eur-lex.europa.eu/eli/dir/2002/58/oj/ita"


@pytest.fixture
def client():
    return NormaController().app.test_client()


class TestModel:
    def test_without_the_field_the_oj_url_is_unchanged(self):
        norma = Norma(tipo_atto="direttiva ue", data="2002", numero_atto="58")
        assert norma.url == OJ

    def test_the_field_selects_the_consolidated_url(self):
        norma = Norma(tipo_atto="direttiva ue", data="2002", numero_atto="58",
                      celex_consolidated="02002L0058-20091219")
        assert norma.url == CONSOLIDATED

    def test_the_article_urn_follows_the_act_url(self):
        norma = Norma(tipo_atto="direttiva ue", data="2002", numero_atto="58",
                      celex_consolidated="02002L0058-20091219")
        nv = NormaVisitata(norma=norma, numero_articolo="5")
        assert nv.urn == CONSOLIDATED

    def test_to_dict_round_trips_the_field(self):
        norma = Norma(tipo_atto="direttiva ue", data="2002", numero_atto="58",
                      celex_consolidated="02002L0058-20091219")
        nv = NormaVisitata(norma=norma, numero_articolo="5")
        data = nv.to_dict()
        assert data["celex_consolidated"] == "02002L0058-20091219"
        assert data["url"] == CONSOLIDATED
        again = NormaVisitata.from_dict(data)
        assert again.norma.celex_consolidated == "02002L0058-20091219"
        assert again.urn == CONSOLIDATED

    def test_to_dict_omits_the_field_when_unset(self):
        nv = NormaVisitata(norma=Norma(tipo_atto="direttiva ue", data="2002", numero_atto="58"),
                           numero_articolo="5")
        assert "celex_consolidated" not in nv.to_dict()

    def test_consolidated_and_oj_versions_are_different_visits(self):
        base = dict(tipo_atto="direttiva ue", data="2002", numero_atto="58")
        oj = NormaVisitata(norma=Norma(**base), numero_articolo="5")
        cons = NormaVisitata(norma=Norma(**base, celex_consolidated="02002L0058-20091219"),
                             numero_articolo="5")
        assert oj != cons
        assert hash(oj) != hash(cons)

    def test_a_malformed_celex_is_rejected(self):
        with pytest.raises(ValidationError):
            Norma(tipo_atto="direttiva ue", data="2002", numero_atto="58",
                  celex_consolidated="32002L0058").url  # sector 3 is the OJ act, not a consolidation

    def test_a_celex_with_a_trailing_newline_is_rejected(self):
        # `$` matches before a trailing newline; the URL must not carry one.
        with pytest.raises(ValidationError):
            Norma(tipo_atto="direttiva ue", data="2002", numero_atto="58",
                  celex_consolidated="02002L0058-20091219\n").url

    def test_str_names_the_consolidated_version(self):
        # The 404 reads "Articolo N non presente in …": the OJ text and a
        # consolidation do not have the same articles, so name the version.
        plain = Norma(tipo_atto="direttiva ue", data="2002", numero_atto="58")
        cons = Norma(tipo_atto="direttiva ue", data="2002", numero_atto="58",
                     celex_consolidated="02002L0058-20091219")
        assert str(plain) == "direttiva ue 2002, n. 58"
        assert str(cons) == "direttiva ue 2002, n. 58 (consolidato 02002L0058-20091219)"
        assert str(NormaVisitata(norma=cons, numero_articolo="99")).endswith(
            "(consolidato 02002L0058-20091219) art. 99")

    def test_get_uri_accepts_the_field_directly(self):
        scraper = EurlexScraper()
        assert scraper.get_uri("direttiva ue", "2002", "58",
                               celex_consolidated="02002L0058-20091219") == CONSOLIDATED
        assert scraper.get_uri("direttiva ue", "2002", "58") == OJ


class TestRequestThreading:
    @pytest.fixture(autouse=True)
    def _no_network(self):
        # create_norma_visitata_from_data probes the tree for the annex lookup
        # and the AKN index for the existence check; both are network.
        with patch("app.get_tree", AsyncMock(return_value=([], 0, {}))), \
             patch("app.fetch_act_index", AsyncMock(return_value=None)), \
             patch("app.add_to_history"):
            yield

    async def test_fetch_norma_data_carries_the_consolidated_url(self, client):
        response = await client.post("/fetch_norma_data", json={
            "act_type": "direttiva ue", "date": "2002", "act_number": "58",
            "article": "5", "celex_consolidated": "02002L0058-20091219",
        })
        assert response.status_code == 200
        norma_data = (await response.get_json())["norma_data"][0]
        assert norma_data["url"] == CONSOLIDATED
        assert norma_data["urn"] == CONSOLIDATED
        assert norma_data["celex_consolidated"] == "02002L0058-20091219"

    async def test_without_the_field_nothing_changes(self, client):
        response = await client.post("/fetch_norma_data", json={
            "act_type": "direttiva ue", "date": "2002", "act_number": "58", "article": "5",
        })
        norma_data = (await response.get_json())["norma_data"][0]
        assert norma_data["url"] == OJ

    async def test_the_field_on_a_normattiva_act_is_a_400(self, client):
        response = await client.post("/fetch_norma_data", json={
            "act_type": "codice civile", "article": "2043",
            "celex_consolidated": "02002L0058-20091219",
        })
        assert response.status_code == 400
        assert "EUR-Lex" in (await response.get_json())["error"]


from pathlib import Path

from bs4 import BeautifulSoup

from visualex_api.tools.exceptions import DocumentNotFoundError
from visualex_api.tools.treextractor import (
    _extract_eurlex_rubriche,
    _parse_eurlex_tree,
    strip_amendment_markers,
)

FIXTURES = Path(__file__).parent / "fixtures" / "eurlex"


def soup_of(name):
    return BeautifulSoup((FIXTURES / name).read_text(encoding="utf-8"), "html.parser")


class TestConsolidatedArticleText:
    async def test_flat_consolidated_page(self):
        text = await EurlexScraper().extract_article_text(
            soup_of("eprivacy_consolidated_20091219.html"), "5")
        lines = text.split("\n")
        assert lines[0] == "Articolo 5"
        assert lines[1] == "Riservatezza delle comunicazioni"
        assert lines[2].startswith("1. Gli Stati membri assicurano")
        assert "▼" not in text, "modref markers are not text"
        assert "Articolo 6" not in text, "the next article must not leak in"

    async def test_suffixed_article_in_both_spellings(self):
        soup = soup_of("eprivacy_consolidated_20091219.html")
        hyphen = await EurlexScraper().extract_article_text(soup, "14-bis")
        space = await EurlexScraper().extract_article_text(soup, "14 bis")
        assert hyphen == space
        assert hyphen.startswith("Articolo 14 bis\nProcedura di comitato\n1. La Commissione")

    async def test_subdivision_wrapped_consolidated_page(self):
        text = await EurlexScraper().extract_article_text(
            soup_of("eidas_consolidated_20241018_trimmed.html"), "50")
        assert text.startswith("Articolo 50\nAbrogazione\n1. La direttiva 1999/93/CE")
        assert "2. I riferimenti alla direttiva abrogata" in text
        assert "Articolo 51" not in text

    async def test_paragraph_numbers_are_separated_from_their_text(self):
        # eIDAS renders "1." in a <span class="no-parag"> beside the text; a
        # bare get_text(strip=True) would glue them into "1.Il presente".
        text = await EurlexScraper().extract_article_text(
            soup_of("eidas_consolidated_20241018_trimmed.html"), "2")
        assert "\n1. " in text or text.split("\n")[2].startswith("1. ")

    async def test_the_last_article_does_not_swallow_the_annex(self):
        # A flat page (no eli-subdivision wrapper) ends its articles with an
        # `title-annex-*` heading; the sibling walk must stop there.
        html = ('<html><body>'
                '<p class="title-article-norm">Articolo 52</p>'
                '<p class="stitle-article-norm">Entrata in vigore</p>'
                '<p class="norm">Il presente regolamento entra in vigore.</p>'
                '<p class="title-annex-1">ALLEGATO I</p>'
                '<p class="title-annex-2">REQUISITI PER I CERTIFICATI QUALIFICATI</p>'
                '<p class="norm">I certificati qualificati contengono:</p>'
                '</body></html>')
        text = await EurlexScraper().extract_article_text(BeautifulSoup(html, "html.parser"), "52")
        assert text == "Articolo 52\nEntrata in vigore\nIl presente regolamento entra in vigore."

    async def test_missing_article_raises(self):
        with pytest.raises(DocumentNotFoundError):
            await EurlexScraper().extract_article_text(
                soup_of("eidas_consolidated_20241018_trimmed.html"), "999")

    async def test_oj_pages_take_the_old_path(self):
        text = await EurlexScraper().extract_article_text(soup_of("gdpr_oj_trimmed.html"), "1")
        assert text.startswith("Articolo 1")
        assert "Oggetto e finalità" in text

    async def test_inline_amendment_markers_are_not_text(self):
        soup = soup_of("eprivacy_consolidated_20091219.html")
        scraper = EurlexScraper()
        text4 = await scraper.extract_article_text(soup, "4")
        assert text4.split("\n")[1] == "Sicurezza del trattamento"
        text13 = await scraper.extract_article_text(soup, "13")
        assert "►" not in text13 and "◄" not in text13

    @pytest.mark.parametrize("fixture", [
        "eprivacy_consolidated_20091219.html",
        "eidas_consolidated_20241018_trimmed.html",
    ])
    async def test_no_article_carries_a_marker_or_a_deletion_placeholder(self, fixture):
        # Every article the tree yields, on both consolidated markups: no
        # "►M2 … ◄" inline marker, no "▼M2" block marker, no "—————" left by a
        # deleted point. The markers are not text (gotcha 23).
        soup = soup_of(fixture)
        scraper = EurlexScraper()
        result, count, _ = await _parse_eurlex_tree(soup, CONSOLIDATED, link=False, details=False)
        assert count > 0
        for item in result:
            text = await scraper.extract_article_text(soup, item["numero"])
            assert not re.search(r"[►◄▼]", text), (fixture, item["numero"])
            assert not re.search(r"—{3,}", text), (fixture, item["numero"])

    async def test_markers_nested_in_the_body_are_not_text(self):
        # On the 2024 eIDAS consolidation the "▼M2" / "▼B" markers sit inside
        # `div.norm` and the point grids, not beside the title, so a class
        # check on the article's siblings never sees them: art. 12 read
        # "…internazionali; ▼M2 c) facilita…" and art. 24 "…qualificati: ▼M2
        # a) informa…", with a "▼M2 ————— ▼B" where a point was deleted.
        soup = soup_of("eidas_consolidated_20241018_trimmed.html")
        scraper = EurlexScraper()
        text12 = await scraper.extract_article_text(soup, "12")
        assert "▼" not in text12 and "—————" not in text12
        assert "norme europee e internazionali;\nc) facilita" in text12
        assert "8. Entro il 18 settembre 2025" in text12
        text24 = await scraper.extract_article_text(soup, "24")
        assert "▼" not in text24 and "—————" not in text24
        assert "servizi fiduciari qualificati:\na) informa l’organismo di vigilanza" in text24
        assert "lettera i);\nk) se i prestatori" in text24


class TestOneLinePerPoint:
    """Ruling: one line per lettered point, wherever EUR-Lex put the grid.

    The OJ path already gives one row per line (`extract_table_text`); the
    consolidated text is the offset space the archive anchors on (gotcha 23),
    so its shape must not depend on whether the points are siblings of the
    title, nested in the paragraph's own `div.norm`, or class-less divs.
    """

    async def test_sibling_points_are_one_line_each(self):
        # eIDAS art. 3: 48 definitions as `grid-list` siblings of the title.
        text = await EurlexScraper().extract_article_text(
            soup_of("eidas_consolidated_20241018_trimmed.html"), "3")
        lines = text.split("\n")
        assert lines[:3] == ["Articolo 3", "Definizioni",
                             "Ai fini del presente regolamento si intende per:"]
        assert lines[3].startswith("1) «identificazione elettronica»")
        assert lines[4].startswith("2) «mezzi di identificazione elettronica»")
        assert sum(1 for line in lines if re.match(r"\d+\) ", line)) >= 40

    async def test_points_nested_in_a_paragraph_start_their_own_lines(self):
        # eIDAS art. 12 §3: the grid sits inside the paragraph's div.norm.
        text = await EurlexScraper().extract_article_text(
            soup_of("eidas_consolidated_20241018_trimmed.html"), "12")
        lines = text.split("\n")
        i = lines.index("3. Il quadro di interoperabilità risponde ai seguenti criteri:")
        assert lines[i + 1].startswith("a) mira a essere neutrale")
        assert lines[i + 2].startswith("b) segue, ove possibile")
        assert lines[i + 3].startswith("c) facilita l’applicazione")
        assert lines[i + 4].startswith("4. Il quadro di interoperabilità è composto da:")

    async def test_sub_points_of_a_point_start_their_own_lines(self):
        # eIDAS art. 3 n. 16 lists a) to d) inside the definition.
        text = await EurlexScraper().extract_article_text(
            soup_of("eidas_consolidated_20241018_trimmed.html"), "3")
        lines = text.split("\n")
        i = next(k for k, line in enumerate(lines) if line.startswith("16) «servizio fiduciario»"))
        assert lines[i].endswith("elementi seguenti:")
        assert lines[i + 1].startswith("a) il rilascio di certificati")
        assert lines[i + 2].startswith("b) la convalida di certificati")
        j = next(k for k, line in enumerate(lines) if line.startswith("17) «servizio fiduciario qualificato»"))
        assert all(re.match(r"[a-z]\) ", line) for line in lines[i + 1:j]), "n. 16 ends where n. 17 starts"

    async def test_lettered_points_of_the_flat_page_are_text(self):
        # ePrivacy art. 2 renders each point as a class-less
        # <div style="margin-left: 24pt"><p class="norm">a) …</p></div>; the
        # walk used to drop them all — 13 points across art. 2, 4 and 10.
        soup = soup_of("eprivacy_consolidated_20091219.html")
        text = await EurlexScraper().extract_article_text(soup, "2")
        lines = text.split("\n")
        assert lines[3] == "Si applicano inoltre le seguenti definizioni:"
        assert lines[4].startswith("a) «utente»: qualsiasi persona fisica")
        assert lines[5].startswith("b) «dati relativi al traffico»")
        assert lines[-1].startswith("i) «violazione dei dati personali»")
        assert len(lines) == 12  # e) was deleted by Dir. 2009/136/CE
        text4 = await EurlexScraper().extract_article_text(soup, "4")
        assert sum(1 for line in text4.split("\n") if line.startswith("— ")) == 3
        text10 = await EurlexScraper().extract_article_text(soup, "10")
        assert text10.split("\n")[3].startswith("a) possa annullare, in via temporanea")

    async def test_the_openings_the_other_tests_pin_are_unchanged(self):
        eidas = soup_of("eidas_consolidated_20241018_trimmed.html")
        text1 = await EurlexScraper().extract_article_text(eidas, "1")
        assert text1.startswith("Articolo 1\nOggetto\n")
        text50 = await EurlexScraper().extract_article_text(eidas, "50")
        assert text50.startswith("Articolo 50\nAbrogazione\n1. La direttiva 1999/93/CE")


class TestNoSpaceBeforePunctuation:
    """EUR-Lex closes a span early and the get_text separator lands before
    the punctuation: "1 quater ." where "1 bis." reads correctly, "f bis )",
    "articolo 14 bis , paragrafo 2". Normalised in the consolidated path only,
    before any text is stored."""

    def test_unit_cases(self):
        from visualex_api.services.eurlex_scraper import _cons_text
        assert _cons_text(BeautifulSoup("<p>1 quater .</p>", "html.parser")) == "1 quater."
        assert _cons_text(BeautifulSoup("<p>lettera a )</p>", "html.parser")) == "lettera a)"
        assert _cons_text(BeautifulSoup("<p>articolo 14 bis , paragrafo 2 ;</p>", "html.parser")) == \
            "articolo 14 bis, paragrafo 2;"
        assert _cons_text(BeautifulSoup("<p>1. Il presente regolamento</p>", "html.parser")) == \
            "1. Il presente regolamento"
        # The opening side: a footnote reference reads "( 1 )" on the page.
        assert _cons_text(BeautifulSoup("<p>nota ( 1 ) fine</p>", "html.parser")) == "nota (1) fine"
        assert _cons_text(BeautifulSoup("<p>« testo</p>", "html.parser")) == "«testo"
        # A real footnote reference: literal parens around a superscript link.
        assert _cons_text(BeautifulSoup(
            '<p>del Consiglio (<a href="#E0001"><span class="superscript">1</span></a>).</p>',
            "html.parser")) == "del Consiglio (1)."

    async def test_the_real_lines_that_had_the_wart(self):
        eidas = soup_of("eidas_consolidated_20241018_trimmed.html")
        text24 = await EurlexScraper().extract_article_text(eidas, "24")
        lines = text24.split("\n")
        assert any(line.startswith("1 quater. Entro il 21 maggio 2025") for line in lines)
        assert any(line.startswith("f bis) fatto salvo") for line in lines)
        assert " ." not in text24 and " )" not in text24 and " ," not in text24
        eprivacy = soup_of("eprivacy_consolidated_20091219.html")
        text4 = await EurlexScraper().extract_article_text(eprivacy, "4")
        assert any(line.startswith("1 bis. Fatta salva la direttiva 95/46/CE") for line in text4.split("\n"))
        assert "articolo 14 bis, paragrafo 2." in text4

    async def test_footnote_references_read_as_the_page_shows_them(self):
        # "( 1 )" — literal parens around a superscript link — is "(1)".
        eidas = soup_of("eidas_consolidated_20241018_trimmed.html")
        text2 = await EurlexScraper().extract_article_text(eidas, "2")
        assert "del Parlamento europeo e del Consiglio (1)." in text2
        text3 = await EurlexScraper().extract_article_text(eidas, "3")
        assert "del Parlamento europeo e del Consiglio (2);" in text3
        eprivacy = soup_of("eprivacy_consolidated_20091219.html")
        text2 = await EurlexScraper().extract_article_text(eprivacy, "2")
        assert "(direttiva quadro) (1)." in text2
        assert "( " not in text2 and "( " not in text3

    @pytest.mark.parametrize("fixture", [
        "eprivacy_consolidated_20091219.html",
        "eidas_consolidated_20241018_trimmed.html",
    ])
    async def test_no_line_keeps_a_space_before_punctuation(self, fixture):
        soup = soup_of(fixture)
        scraper = EurlexScraper()
        result, _, _ = await _parse_eurlex_tree(soup, CONSOLIDATED, link=False, details=False)
        for item in result:
            text = await scraper.extract_article_text(soup, item["numero"])
            assert not re.search(r"\s[.,;:)]", text), (fixture, item["numero"])
            assert not re.search(r"[(«]\s", text), (fixture, item["numero"])

    async def test_the_oj_path_is_untouched(self):
        # The normalisation lives in _cons_text; an OJ page never reaches it.
        with patch("visualex_api.services.eurlex_scraper._cons_text",
                   side_effect=AssertionError("the OJ path must not use _cons_text")):
            text = await EurlexScraper().extract_article_text(soup_of("gdpr_oj_trimmed.html"), "4")
        assert text.startswith("Articolo 4")
        assert "Definizioni" in text


class TestConsolidatedRubriche:
    def test_flat_page(self):
        rubriche = _extract_eurlex_rubriche(soup_of("eprivacy_consolidated_20091219.html"))
        assert rubriche["5"] == "Riservatezza delle comunicazioni"
        assert rubriche["14-bis"] == "Procedura di comitato"
        assert len(rubriche) == 23

    def test_subdivision_page(self):
        rubriche = _extract_eurlex_rubriche(soup_of("eidas_consolidated_20241018_trimmed.html"))
        assert rubriche["1"] == "Oggetto"
        assert rubriche["50"] == "Abrogazione"

    def test_oj_page_unchanged(self):
        rubriche = _extract_eurlex_rubriche(soup_of("gdpr_oj_trimmed.html"))
        assert rubriche["1"] == "Oggetto e finalità"
        assert rubriche["17"] == "Diritto alla cancellazione («diritto all'oblio»)"

    def test_inline_markers_are_stripped_from_rubriche(self):
        rubriche = _extract_eurlex_rubriche(soup_of("eprivacy_consolidated_20091219.html"))
        assert rubriche["4"] == "Sicurezza del trattamento"


class TestStripAmendmentMarkers:
    def test_examples(self):
        assert strip_amendment_markers("►M2 Sicurezza del trattamento ◄") == "Sicurezza del trattamento"
        assert strip_amendment_markers("personali»: ◄ violazione") == "personali»: violazione"
        assert strip_amendment_markers("Articolo 5") == "Articolo 5"


class TestConsolidatedTree:
    CONS = "https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=CELEX:02002L0058-20091219"

    async def test_flat_page_lists_suffixed_articles_in_order(self):
        result, count, metadata = await _parse_eurlex_tree(
            soup_of("eprivacy_consolidated_20091219.html"), self.CONS, link=False, details=True)
        numbers = [item["numero"] for item in result if isinstance(item, dict)]
        assert count == 23
        assert numbers[13:17] == ["14", "14-bis", "15", "15-bis"]
        assert metadata["rubriche"]["14-bis"] == "Procedura di comitato"

    async def test_headings_carry_their_title_and_precede_their_articles(self):
        result, count, _ = await _parse_eurlex_tree(
            soup_of("eidas_consolidated_20241018_trimmed.html"), self.CONS, link=False, details=True)
        assert result[0] == "CAPO I DISPOSIZIONI GENERALI"
        assert result[1] == {"numero": "1"}
        assert count >= 6  # Capo I (art. 1-5) + art. 50

    async def test_heading_title_survives_a_modref_between_number_and_title(self):
        # Live eIDAS: a "▼M2" marker sits between "SEZIONE 2" and its title,
        # and the index read a bare "SEZIONE 2".
        html = ('<html><body>'
                '<p class="title-division-1">SEZIONE 2</p>'
                '<p class="modref">▼M2</p>'
                '<p class="title-division-2">Servizi fiduciari non qualificati</p>'
                '<p class="title-article-norm">Articolo 17</p>'
                '<p class="stitle-article-norm">Requisiti generali</p>'
                '</body></html>')
        result, count, _ = await _parse_eurlex_tree(
            BeautifulSoup(html, "html.parser"), self.CONS, link=False, details=True)
        assert result[0] == "SEZIONE 2 Servizi fiduciari non qualificati"
        assert result[1] == {"numero": "17"}
        assert count == 1

    async def test_headings_are_omitted_without_details(self):
        result, _, _ = await _parse_eurlex_tree(
            soup_of("eidas_consolidated_20241018_trimmed.html"), self.CONS, link=False, details=False)
        assert all(isinstance(item, dict) for item in result)

    async def test_link_true_falls_back_to_an_anchor_on_the_consolidated_url(self):
        result, _, _ = await _parse_eurlex_tree(
            soup_of("eprivacy_consolidated_20091219.html"), self.CONS, link=True, details=False)
        first = result[0]
        assert first["numero"] == "1"
        assert first["url"] == f"{self.CONS}#art_1"

    async def test_oj_page_unchanged(self):
        result, count, metadata = await _parse_eurlex_tree(
            soup_of("gdpr_oj_trimmed.html"), "https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita",
            link=False, details=True)
        numbers = [item["numero"] for item in result if isinstance(item, dict)]
        assert numbers == ["1", "2", "3", "4", "17"]
        assert "CAPO I" in result
