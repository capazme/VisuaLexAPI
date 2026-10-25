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
    _extract_eurlex_title,
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

    async def test_oj_missing_article_is_not_served_as_a_longer_number(self):
        # "Articolo 17" starts with "Articolo 1": a page without art. 1 used to
        # answer a request for it with art. 17 (inventory row 3.1).
        soup = soup_of("gdpr_oj_trimmed.html")
        soup.find("p", class_="oj-ti-art", string="Articolo 1").decompose()
        with pytest.raises(DocumentNotFoundError):
            await EurlexScraper().extract_article_text(soup, "1")
        text17 = await EurlexScraper().extract_article_text(soup, "17")
        assert text17.startswith("Articolo 17")

    async def test_oj_missing_article_in_a_class_less_page(self):
        # The legacy page reaches the eli-subdivision strategy last; the same
        # guard holds there.
        html = ('<html><body><div class="eli-subdivision">'
                '<p>Articolo 17</p><p>Diritto alla cancellazione</p>'
                '</div></body></html>')
        with pytest.raises(DocumentNotFoundError):
            await EurlexScraper().extract_article_text(BeautifulSoup(html, "html.parser"), "1")

    @pytest.mark.parametrize("markup", ["oj-ti-art, nbsp", "oj-ti-art", "class with art", "class-less", "eli-subdivision"])
    async def test_oj_article_15_is_never_served_as_15_bis(self, markup):
        # Synthetic page (fixtures/eurlex/README.md): its only article 15 is «Articolo 15 bis».
        # A request for art. 15 was served art. 15 bis, the wrong article as the one asked
        # (the class of inventory row 3.1). The suffix served must be the one asked, none for none.
        html = (FIXTURES / "synthetic_oj_article_15_bis.html").read_text(encoding="utf-8")
        if markup != "oj-ti-art, nbsp":
            html = html.replace("&nbsp;", " ")
        if markup == "class with art":
            html = html.replace('class="oj-ti-art"', 'class="title-art"')
        elif markup == "class-less":
            html = re.sub(r' class="[^"]*"', "", html)
        elif markup == "eli-subdivision":
            html = re.sub(r' class="[^"]*"', "", html).replace("<body>", '<body><div class="eli-subdivision">')
        scraper = EurlexScraper()
        with pytest.raises(DocumentNotFoundError):
            await scraper.extract_article_text(BeautifulSoup(html, "html.parser"), "15")
        if markup != "eli-subdivision":  # one subdivision holds every article: no boundary to test
            text14 = await scraper.extract_article_text(BeautifulSoup(html, "html.parser"), "14")
            assert text14.split("\n")[:3] == ["Articolo\xa014" if "nbsp" in markup else "Articolo 14",
                                               "Disposizioni generali", "Testo dell'articolo 14."]
        # The article that is there opens, asked in any spelling, non-breaking spaces included.
        for spelling in ("15 bis", "15-bis", "15bis"):
            asked = await scraper.extract_article_text(BeautifulSoup(html, "html.parser"), spelling)
            assert asked.replace("\xa0", " ").split("\n")[:2] == ["Articolo 15 bis", "Articolo inserito"], spelling

    @pytest.mark.parametrize("heading,article,heads", [
        ("Articolo 15 bis", "15", False),
        ("Articolo 15bis", "15", False),
        ("Articolo 15-ter", "15", False),
        ("Articolo 15 quinquiesdecies", "15", False),
        ("Articolo 15 bis", "15 bis", True),
        ("Articolo 15 bis decies", "15 bis", False),
        ("Articolo 150", "15", False),
        ("Articolo 15", "15", True),
        ("Articolo 15Terzi", "15", True),     # a rubrica run on, not an ordinal
        ("Articolo 15 Bisogna", "15", True),
    ])
    def test_the_number_ends_with_the_heading(self, heading, article, heads):
        from visualex_api.services.eurlex_scraper import _heads_article
        assert _heads_article(heading, f"Articolo {article}") is heads

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


# The title block of the OJ page of regulation (EU) 2016/679, as EUR-Lex and CELLAR serve it
# (13 October 2026); the trimmed fixture leaves it out. An annex heading shares the class.
GDPR_TITLE = """<html><body><hr class="oj-separator"/><div class="eli-container">
<div class="eli-main-title" id="tit_1">
<p class="oj-doc-ti" id="d1e40-1-1">
REGOLAMENTO (UE) 2016/679 DEL PARLAMENTO EUROPEO E DEL CONSIGLIO
</p>
<p class="oj-doc-ti">del 27 aprile 2016
</p>
<p class="oj-doc-ti">relativo alla protezione delle persone fisiche con riguardo al trattamento dei dati personali, nonché alla libera circolazione di tali dati e che abroga la direttiva 95/46/CE (regolamento generale sulla protezione dei dati)</p>
<p class="oj-doc-ti">(Testo rilevante ai fini del SEE)</p>
</div>
<div class="eli-subdivision" id="anx_1"><p class="oj-doc-ti">ALLEGATO I</p></div>
</div></body></html>"""


class TestEurlexTitle:
    def test_oj_page_gives_the_subject(self):
        title = _extract_eurlex_title(BeautifulSoup(GDPR_TITLE, "html.parser"))
        assert title == (
            "relativo alla protezione delle persone fisiche con riguardo al trattamento dei dati personali, "
            "nonché alla libera circolazione di tali dati e che abroga la direttiva 95/46/CE "
            "(regolamento generale sulla protezione dei dati)"
        )

    def test_consolidated_page(self):
        assert _extract_eurlex_title(soup_of("eprivacy_consolidated_20091219.html")) == (
            "relativa al trattamento dei dati personali e alla tutela della vita privata nel settore "
            "delle comunicazioni elettroniche (direttiva relativa alla vita privata e alle comunicazioni elettroniche)"
        )

    def test_legacy_page_reads_its_description(self):
        assert _extract_eurlex_title(soup_of("eprivacy_oj_legacy.html")) == (
            "relativa al trattamento dei dati personali e alla tutela della vita privata nel settore "
            "delle comunicazioni elettroniche (direttiva relativa alla vita privata e alle comunicazioni elettroniche)"
        )

    def test_an_eli_page_without_a_description_reads_its_italian_eli_title(self):
        # The /eli/ address of a legacy act (dir. 2002/58) has no DC.description: the title was ''.
        assert _extract_eurlex_title(soup_of("eprivacy_eli_legacy_trimmed.html")) == (
            "relativa al trattamento dei dati personali e alla tutela della vita privata nel settore "
            "delle comunicazioni elettroniche (direttiva relativa alla vita privata e alle comunicazioni elettroniche)"
        )

    def test_never_a_title_in_another_language(self):
        soup = soup_of("eprivacy_eli_legacy_trimmed.html")
        soup.find("meta", attrs={"property": "eli:title", "lang": "it"}).decompose()
        assert _extract_eurlex_title(soup) == ""

    def test_a_flat_page_takes_the_first_run_only(self):
        flat = GDPR_TITLE.replace('<div class="eli-main-title" id="tit_1">', "<div>").replace(
            '<div class="eli-subdivision" id="anx_1"><p class="oj-doc-ti">ALLEGATO I</p></div>',
            '<p class="oj-normal">IL PARLAMENTO EUROPEO</p><p class="oj-doc-ti">ALLEGATO I</p>')
        title = _extract_eurlex_title(BeautifulSoup(flat, "html.parser"))
        assert title.startswith("relativo alla protezione") and "ALLEGATO" not in title

    def test_a_title_without_a_date_is_not_a_subject(self):
        page = '<p class="oj-doc-ti">TRATTATO SUL FUNZIONAMENTO DELL\'UNIONE EUROPEA</p><p class="oj-doc-ti">ALLEGATO I</p>'
        assert _extract_eurlex_title(BeautifulSoup(page, "html.parser")) == ""

    def test_a_page_without_one_says_nothing(self):
        assert _extract_eurlex_title(soup_of("gdpr_oj_trimmed.html")) == ""

    async def test_the_tree_carries_it(self):
        url = "https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=CELEX:02002L0058-20091219"
        _, _, metadata = await _parse_eurlex_tree(soup_of("eprivacy_consolidated_20091219.html"), url)
        assert metadata["title"].startswith("relativa al trattamento dei dati personali")


class TestStripAmendmentMarkers:
    def test_examples(self):
        assert strip_amendment_markers("►M2 Sicurezza del trattamento ◄") == "Sicurezza del trattamento"
        assert strip_amendment_markers("personali»: ◄ violazione") == "personali»: violazione"
        assert strip_amendment_markers("Articolo 5") == "Articolo 5"


class TestWhitespaceRunsAreLinear:
    """`\\s*[►◄▼]…` and `\\s+([.,;:)])` restarted at every blank of a run and scanned the rest of
    it each time: 0.85 s a pass on 20,000 blanks, three passes per element (consolidated path).
    Matched now only from a run's first blank, with the same result."""

    OLD_MARK = re.compile(r"\s*[►◄▼](?:[A-Z]\d*)?\s*")
    OLD_PUNCT = re.compile(r"\s+([.,;:)])")

    def test_same_result_as_the_quadratic_patterns(self):
        import random
        from visualex_api.services.eurlex_scraper import _SPACE_BEFORE_PUNCTUATION
        from visualex_api.tools.treextractor import _AMENDMENT_MARK

        rng = random.Random(20261022)
        alphabet = [" ", " ", "\xa0", "\n", "\t", "►", "◄", "▼", "M", "B", "2", "a", "x", ".", ",", ";", ")", "("]
        for _ in range(5000):
            text = "".join(rng.choice(alphabet) for _ in range(rng.randint(0, 24)))
            assert _AMENDMENT_MARK.sub(" ", text) == self.OLD_MARK.sub(" ", text), repr(text)
            assert _SPACE_BEFORE_PUNCTUATION.sub(r"\1", text) == self.OLD_PUNCT.sub(r"\1", text), repr(text)

    @pytest.mark.parametrize("blank", [" ", "\xa0", "\n"])
    def test_a_long_run_of_blanks_costs_linear_time(self, blank):
        import time
        from visualex_api.services.eurlex_scraper import _cons_text

        text = "x" + blank * 50_000 + "x"
        start = time.perf_counter()
        assert strip_amendment_markers(text) == (text if blank == "\n" else "x x")
        _cons_text(BeautifulSoup(f"<p>{text}</p>", "html.parser"))
        # Before: about 5 s for these 50,000 blanks. A linear pass takes milliseconds.
        assert time.perf_counter() - start < 0.5


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


class TestTreeFailuresAreNotKept:
    async def test_a_failed_page_is_asked_again(self):
        from types import SimpleNamespace
        from unittest.mock import AsyncMock, patch
        from visualex_api.tools import treextractor
        url = "https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=CELEX:32099R9999"
        page = (FIXTURES / "gdpr_oj_trimmed.html").read_text(encoding="utf-8")
        fetch = AsyncMock(side_effect=[RuntimeError("waf"), page])
        # the scraper's copy of the page, which the tree reads first: empty, and kept out of
        # the repository's download/cache
        eurlex_copy = SimpleNamespace(get=AsyncMock(return_value=None), set=AsyncMock())
        manager = SimpleNamespace(get_persistent=lambda namespace: eurlex_copy)
        with patch.object(treextractor, "_fetch_with_playwright", fetch), \
                patch.object(treextractor, "get_cache_manager", lambda: manager), \
                patch.object(treextractor._tree_cache, "get", AsyncMock(return_value=None)), \
                patch.object(treextractor._tree_cache, "set", AsyncMock()):
            _, count, _ = await treextractor.get_tree(url, details=True, return_metadata=True)
            assert count == 0
            _, count, metadata = await treextractor.get_tree(url, details=True, return_metadata=True)
        assert count > 0 and metadata["rubriche"]["1"] == "Oggetto e finalità"
        assert fetch.await_count == 2


class TestQuotedArticles:
    """An amending act's OJ page quotes, in table cells, the articles it replaces or inserts in
    another act. Dir. 2009/136 has six articles; it quotes art. 21, 22, 23, 23 bis and 27 of dir.
    2002/22 (and 14 bis, 15 bis of dir. 2002/58), which were listed in its index and served as
    its own: art. 23 asked was art. 23 of dir. 2002/22."""

    URL = "https://eur-lex.europa.eu/eli/dir/2009/136/oj/ita"

    async def test_the_index_lists_the_acts_own_articles_only(self):
        result, count, metadata = await _parse_eurlex_tree(soup_of("amending_dir_2009_136_trimmed.html"), self.URL)
        assert [item["numero"] for item in result] == ["1", "2", "3", "4", "5", "6"]
        assert count == 6
        assert sorted(metadata["rubriche"], key=int) == ["1", "2", "3", "4", "5", "6"]
        assert metadata["rubriche"]["6"] == "Destinatari"

    @pytest.mark.parametrize("article", ["21", "22", "23", "27", "23 bis", "14 bis", "15 bis", "20", "37"])
    async def test_a_quoted_article_is_not_found(self, article):
        with pytest.raises(DocumentNotFoundError):
            await EurlexScraper().extract_article_text(soup_of("amending_dir_2009_136_trimmed.html"), article)

    @pytest.mark.parametrize("article,rubrica", [("1", "Modifiche alla direttiva 2002/22/CE (direttiva servizio universale)"),
                                                 ("4", "Recepimento"), ("6", "Destinatari")])
    async def test_the_acts_own_articles_are_served(self, article, rubrica):
        text = await EurlexScraper().extract_article_text(soup_of("amending_dir_2009_136_trimmed.html"), article)
        assert text.split("\n")[:2] == [f"Articolo\xa0{article}", rubrica]

    @pytest.mark.parametrize("markup", ["oj-ti-art", "class-less", "eli-subdivision"])
    async def test_a_quoted_heading_before_the_acts_own_article_of_that_number(self, markup):
        # Synthetic: art. 1 quotes, in a table cell and with no «, an «Articolo 3» of another
        # act; the act's own art. 3 comes after it and is the one served and listed.
        quoted = ('<table><tr><td><p class="oj-ti-art">Articolo 3</p>'
                  '<p class="oj-normal">Testo citato di un altro atto.</p></td></tr></table>')
        html = ('<html><body><p class="oj-ti-art">Articolo 1</p><p class="oj-normal">Modifiche.</p>' + quoted +
                '<p class="oj-ti-art">Articolo 3</p><p class="oj-normal">Testo proprio dell\'articolo 3.</p></body></html>')
        if markup == "class-less":
            html = re.sub(r' class="[^"]*"', "", html)
        elif markup == "eli-subdivision":
            html = (re.sub(r' class="[^"]*"', "", html)
                    .replace("<body>", '<body><div class="eli-subdivision">')
                    .replace("<p>Articolo 3</p><p>Testo proprio", '</div><div class="eli-subdivision"><p>Articolo 3</p><p>Testo proprio'))
        text = await EurlexScraper().extract_article_text(BeautifulSoup(html, "html.parser"), "3")
        assert text.split("\n")[:2] == ["Articolo 3", "Testo proprio dell'articolo 3."]
        result, _, _ = await _parse_eurlex_tree(BeautifulSoup(html, "html.parser"), self.URL)
        assert [item["numero"] for item in result] == ["1", "3"]

    async def test_a_page_without_tables_keeps_every_article(self):
        # The legacy ELI page of dir. 2002/58: class-less paragraphs, no table cells, no «.
        result, count, _ = await _parse_eurlex_tree(soup_of("eprivacy_eli_legacy_trimmed.html"),
                                                    "https://eur-lex.europa.eu/eli/dir/2002/58/oj/ita")
        assert [item["numero"] for item in result] == [str(n) for n in range(1, 22)]
        text = await EurlexScraper().extract_article_text(soup_of("eprivacy_eli_legacy_trimmed.html"), "15")
        assert text.startswith("Articolo 15")

    async def test_the_index_reads_the_suffix(self):
        # Synthetic page (fixtures/eurlex/README.md): «Articolo 15 bis» is article 15-bis, not 15.
        result, _, metadata = await _parse_eurlex_tree(soup_of("synthetic_oj_article_15_bis.html"), self.URL)
        assert [item["numero"] for item in result] == ["14", "15-bis", "16"]
        assert metadata["rubriche"]["15-bis"] == "Articolo inserito"
        text = await EurlexScraper().extract_article_text(soup_of("synthetic_oj_article_15_bis.html"), "15-bis")
        assert text.startswith("Articolo\xa015\xa0bis")


class TestEliTitleOfTheItalianExpression:
    def test_the_italian_meta_of_another_resource_is_not_the_title(self):
        soup = soup_of("eprivacy_eli_legacy_trimmed.html")
        soup.find("meta", attrs={"property": "eli:title", "lang": "it"})["about"] = "http://data.europa.eu/eli/dir/2002/58/oj"
        assert _extract_eurlex_title(soup) == ""


class TestGluedHeading:
    """A class-less page whose heading and text share an element reads «Articolo 15 bisTesto…»:
    the ordinal glued to the text was not taken for one, and art. 15 asked was served art. 15 bis
    (found by the mcp-legal-it review). Synthetic page (fixtures/eurlex/README.md)."""

    async def test_art_15_is_not_found(self):
        with pytest.raises(DocumentNotFoundError):
            await EurlexScraper().extract_article_text(soup_of("synthetic_classless_glued_15_bis.html"), "15")

    @pytest.mark.parametrize("article", ["15 bis", "15-bis", "15bis"])
    async def test_art_15_bis_is_served_from_its_heading(self, article):
        text = await EurlexScraper().extract_article_text(soup_of("synthetic_classless_glued_15_bis.html"), article)
        assert text == "Articolo 15 bis\nTesto dell'articolo 15 bis."

    async def test_the_index_lists_15_bis_once(self):
        result, _, _ = await _parse_eurlex_tree(soup_of("synthetic_classless_glued_15_bis.html"),
                                                "https://eur-lex.europa.eu/eli/reg/2000/1/oj/ita")
        assert [item["numero"] for item in result] == ["14", "15-bis", "16"]

    @pytest.mark.parametrize("heading,article,heads", [
        ("Articolo 15 bisTesto", "15", False),
        ("Articolo 15terDisposizioni", "15", False),
        ("Articolo 1 Bisogna", "1", True),
        ("Articolo 1Terzi", "1", True),
        ("Articolo 1Testo", "1", True),
    ])
    def test_a_glued_ordinal_is_an_ordinal(self, heading, article, heads):
        from visualex_api.services.eurlex_scraper import _heads_article
        assert _heads_article(heading, f"Articolo {article}") is heads


class TestTitleAsTheJournalPrintsIt:
    def test_the_ai_act_keeps_the_journals_comma(self):
        # «(CE) n, 300/2008» is the Official Journal's own Italian title (OJ and consolidated page alike): we show it as published, never corrected.
        title = _extract_eurlex_title(soup_of("aiact_consolidated_20260727_title_trimmed.html"))
        assert title.startswith("che stabilisce regole armonizzate sull'intelligenza artificiale e modifica i regolamenti "
                                "(CE) n, 300/2008, (UE) n, 167/2013, (UE) n, 168/2013, (UE) 2018/858")
        assert title.endswith("(UE) 2020/1828 (regolamento sull'intelligenza artificiale)")

    @pytest.mark.parametrize("fixture,subject", [
        ("dir_85_374_eli_title_trimmed.html",
         "relativa al ravvicinamento delle disposizioni legislative, regolamentari ed amministrative degli "
         "Stati Membri in materia di responsabilità per danno da prodotti difettosi"),
        ("dir_64_221_eli_title_trimmed.html",
         "per il coordinamento dei provvedimenti speciali riguardanti il trasferimento e il soggiorno degli "
         "stranieri, giustificati da motivi d'ordine pubblico, di pubblica sicurezza e di sanità pubblica"),
    ])
    def test_an_older_title_without_commas_round_its_date(self, fixture, subject):
        # «… del Consiglio del 25 luglio 1985 relativa al …»: the subject was '' while the date needed commas.
        assert _extract_eurlex_title(soup_of(fixture)) == subject

    @pytest.mark.parametrize("content,subject", [
        ("Direttiva 2001/29/CE del Parlamento europeo e del Consiglio dell'11 luglio 2001 concernente l'armonizzazione",
         "concernente l'armonizzazione"),
        ("Direttiva 93/13/CEE del Consiglio, del 5 aprile 1993 concernente le clausole abusive", "concernente le clausole abusive"),
        ("Direttiva 93/13/CEE del Consiglio del 5 aprile 1993, concernente le clausole abusive", "concernente le clausole abusive"),
        ("Direttiva 85/374/CEE del Consiglio del 25 luglio 1985 (GU L 210 del 7.8.1985)", ""),
    ])
    def test_the_date_read_with_or_without_its_commas(self, content, subject):
        page = f'<meta about="http://data.europa.eu/eli/dir/1/1/oj/ita" content="{content}" lang="it" property="eli:title"/>'
        assert _extract_eurlex_title(BeautifulSoup(page, "html.parser")) == subject

    def test_a_title_without_a_date_still_says_nothing(self):
        # Reg. 17/1962 names itself «CEE Consiglio: Regolamento n. 17 : Primo regolamento …»: no date, no subject.
        page = ('<meta about="http://data.europa.eu/eli/reg/1962/17/oj/ita" content="CEE Consiglio: Regolamento n. 17 : '
                'Primo regolamento d\'applicazione degli articoli 85 e 86 del trattato" lang="it" property="eli:title"/>')
        assert _extract_eurlex_title(BeautifulSoup(page, "html.parser")) == ""


class TestConsolidatedTitleFromTheFirstRun:
    def test_the_gdpr_consolidated_has_its_subject_in_title_doc_first(self):
        # CELEX 02016R0679-20160504: `title-doc-last` holds only «(Testo rilevante ai fini del SEE)».
        assert _extract_eurlex_title(soup_of("gdpr_consolidated_20160504_title_trimmed.html")) == (
            "relativo alla protezione delle persone fisiche con riguardo al trattamento dei dati personali, "
            "nonché alla libera circolazione di tali dati e che abroga la direttiva 95/46/CE "
            "(regolamento generale sulla protezione dei dati)"
        )

    def test_a_name_split_over_two_lines_is_no_date_line(self):
        # «DEL PARLAMENTO EUROPEO…» opens with «del» but holds no date: the subject follows the date.
        page = ('<div class="eli-main-title"><p class="oj-doc-ti">REGOLAMENTO (UE) 2016/679</p>'
                '<p class="oj-doc-ti">DEL PARLAMENTO EUROPEO E DEL CONSIGLIO</p>'
                '<p class="oj-doc-ti">del 27 aprile 2016</p>'
                '<p class="oj-doc-ti">relativo alla protezione delle persone fisiche</p></div>')
        assert _extract_eurlex_title(BeautifulSoup(page, "html.parser")) == "relativo alla protezione delle persone fisiche"


class TestHeadingGluedToTheParagraphBefore:
    """Dir. 85/374's legacy OJ page reads «… l'interruzione della prescrizione. Articolo 11</p>»: art. 11
    was not listed, not found, and its text was served at the end of art. 10's
    (fixtures/eurlex/README.md)."""

    URL = "https://eur-lex.europa.eu/eli/dir/1985/374/oj/ita"

    async def test_the_index_lists_art_11(self):
        result, count, _ = await _parse_eurlex_tree(soup_of("dir_85_374_eli_legacy_text_trimmed.html"), self.URL)
        assert [item["numero"] for item in result] == [str(n) for n in range(1, 23)] and count == 22

    async def test_art_11_is_served_from_its_glued_heading(self):
        text = await EurlexScraper().extract_article_text(soup_of("dir_85_374_eli_legacy_text_trimmed.html"), "11")
        assert text.startswith("Articolo 11\nGli stati membri prevedono nella loro legislazione che i diritti conferiti")
        assert text.endswith("un procedimento giudiziario contro il produttore.")

    async def test_art_10_stops_before_it(self):
        # Art. 10's text loses the tail it carried until now: the heading and the whole of art. 11.
        text = await EurlexScraper().extract_article_text(soup_of("dir_85_374_eli_legacy_text_trimmed.html"), "10")
        assert text.startswith("Articolo 10\n1. Gli stati membri prevedono")
        assert text.endswith("che disciplinano la sospensione o l'interruzione della prescrizione.")
        assert "Articolo 11" not in text

    async def test_art_12_is_unchanged(self):
        text = await EurlexScraper().extract_article_text(soup_of("dir_85_374_eli_legacy_text_trimmed.html"), "12")
        assert text.startswith("Articolo 12\nLa responsabilità del produttore") and "Articolo 13" not in text

    @pytest.mark.parametrize("page", [
        # A sentence ending on an article that has a heading of its own is a reference.
        "<p>Articolo 1</p><p>Testo. Articolo 2</p><p>Articolo 2</p><p>Testo.</p>",
        # Not the article right after the one before it.
        "<p>Articolo 1</p><p>Testo. Articolo 5</p><p>Altro.</p>",
        # A paragraph with a class is not a legacy page's.
        '<p>Articolo 1</p><p class="oj-normal">Testo. Articolo 2</p><p>Altro.</p>',
        # Nothing after it: art. 3 does not exist, the sentence ends the act's text.
        "<p>Articolo 2</p><p>… misure previste. Articolo 3</p>",
        "<p>Articolo 2</p><p>… misure previste; Articolo 3</p>",
        "<p>Articolo 2</p><p>… misure previste. Articolo 3</p><p> </p><p>\xa0</p>",
        # Another heading after it: art. 3 would have no body.
        "<p>Articolo 2</p><p>Testo. Articolo 3</p><p>Articolo 4</p><p>Testo.</p>",
        # A paragraph in a table cell is another act's text, as a heading there is.
        "<p>Articolo 2</p><table><tr><td><p>blah. Articolo 3</p><p>Testo.</p></td></tr></table><p>Altro.</p>",
        # A quoted paragraph, likewise.
        "<p>Articolo 2</p><p>«Testo. Articolo 3</p><p>Altro.</p>",
        # Real cross-references: no sentence ends before them, or the number is not one.
        "<p>Articolo 2</p><p>Le misure previste dall'Articolo 3</p><p>Altro.</p>",
        "<p>Articolo 2</p><p>Testo. Articolo 2 bis</p><p>Altro.</p>",
        "<p>Articolo 2</p><p>Testo. Articolo 7</p><p>Altro.</p>",
    ])
    def test_only_the_next_article_with_no_heading_of_its_own(self, page):
        from visualex_api.tools.treextractor import glued_headings
        assert glued_headings(BeautifulSoup(page, "html.parser")) == {}

    def test_a_glued_heading_with_a_body_after_it_is_one(self):
        from visualex_api.tools.treextractor import glued_headings
        page = "<p>Articolo 2</p><p>Testo. Articolo 3</p><p> </p><p>Corpo.</p>"
        assert {n: start for n, (_, start) in glued_headings(BeautifulSoup(page, "html.parser")).items()} == {"3": 7}

    URL_SYNTHETIC = "https://eur-lex.europa.eu/eli/dir/1/1/oj/ita"
    TAIL = "<p>Articolo 1</p><p>Testo.</p><p>Articolo 2</p><p>Primo.</p><p>… misure previste. Articolo 3</p>"

    async def test_a_last_sentence_ending_on_a_missing_article_lists_no_article(self):
        # Bartolo's repro: the index listed an art. 3, served as «Articolo 3» with no body.
        result, count, _ = await _parse_eurlex_tree(BeautifulSoup(self.TAIL, "html.parser"), self.URL_SYNTHETIC)
        assert [item["numero"] for item in result] == ["1", "2"] and count == 2
        with pytest.raises(DocumentNotFoundError):
            await EurlexScraper().extract_article_text(BeautifulSoup(self.TAIL, "html.parser"), "3")

    async def test_the_article_before_keeps_its_tail(self):
        text = await EurlexScraper().extract_article_text(BeautifulSoup(self.TAIL, "html.parser"), "2")
        assert text == "Articolo 2\nPrimo.\n… misure previste. Articolo 3"


class TestDescriptionSubjectIsLinear:
    """`(?:,\\s*|\\s+)dell?…` restarted at every blank of a run and scanned the rest of it each time:
    0.75 s on 20,000 blanks. Matched now only from a run's first blank, with the same result."""

    OLD = re.compile(r"(?:,\s*|\s+)dell?['’\s]\s*\d{1,2}[°º]?\s+\S+\s+\d{4}\s*,?\s*(.+)$",
                     re.IGNORECASE | re.DOTALL)

    def test_same_matches_as_the_quadratic_pattern(self):
        import random
        from visualex_api.tools.treextractor import _EURLEX_DESCRIPTION_SUBJECT

        rng = random.Random(20261025)
        tokens = [" ", " ", "\xa0", "\n", "\t", ",", "del", "dell'", "dell’", "DEL", "de", "l", "1", "25",
                  "°", "luglio", "1985", "x", "relativa", "(", ")"]
        for _ in range(20000):
            text = "".join(rng.choice(tokens) for _ in range(rng.randint(0, 18)))
            new, old = _EURLEX_DESCRIPTION_SUBJECT.search(text), self.OLD.search(text)
            assert (new and (new.span(), new.group(1))) == (old and (old.span(), old.group(1))), repr(text)

    @pytest.mark.parametrize("text", [
        "x" + " " * 50_000 + "x",
        "x" + "\xa0" * 50_000 + "x",
        "Direttiva del 25 luglio" + " " * 50_000,
    ])
    def test_a_long_run_of_blanks_costs_linear_time(self, text):
        import time
        start = time.perf_counter()
        page = f'<meta about="http://data.europa.eu/eli/dir/1/1/oj/ita" content="{text}" lang="it" property="eli:title"/>'
        assert _extract_eurlex_title(BeautifulSoup(page, "html.parser")) == ""
        # Before: about 6 s for these 50,000 blanks. A linear pass takes milliseconds.
        assert time.perf_counter() - start < 0.5
