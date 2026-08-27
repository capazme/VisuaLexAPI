"""Offline corpus for the Brocardi extractor, and the five things it lost."""
from pathlib import Path

import pytest
from bs4 import BeautifulSoup

from visualex_api.services.brocardi_scraper import BrocardiScraper

FIXTURES = Path(__file__).parent / "fixtures" / "brocardi"


@pytest.fixture(scope="module")
def scraper():
    return BrocardiScraper()


def _info(scraper, filename):
    soup = BeautifulSoup((FIXTURES / filename).read_text(encoding="utf-8"), "html.parser")
    info = {"Position": scraper._extract_position(soup)}
    scraper._extract_sections(soup, info)
    return info


class TestSelectorResilience:
    """One class added on brocardi.it currently empties every section."""

    def test_sections_survive_an_extra_class(self, scraper):
        baseline = _info(scraper, "article.html")
        variant = _info(scraper, "article_extra_class.html")
        assert set(baseline) - {"Position"}, "the baseline fixture has no sections at all"
        assert set(baseline) == set(variant), (
            "an added class on the content container emptied the extraction"
        )


class TestPosition:
    def test_the_brocardi_prefix_is_stripped(self, scraper):
        soup = BeautifulSoup((FIXTURES / "article.html").read_text(encoding="utf-8"), "html.parser")
        position = scraper._extract_position(soup)
        assert position
        assert "Brocardi.it" not in position
        assert not position.startswith(">")

    def test_the_live_breadcrumb_prefix_is_stripped(self, scraper):
        """brocardi.it emits "Tu sei qui:Fonti>", not "Brocardi.it >".

        That string is exactly 17 characters, which is what the old [17:] slice
        was really cutting. Stripping only "Brocardi.it >" would leave it in and
        change what the reading surface shows.
        """
        soup = BeautifulSoup((FIXTURES / "article.html").read_text(encoding="utf-8"), "html.parser")
        position = scraper._extract_position(soup)
        assert position.startswith("Codice Civile>"), position[:40]
        assert "Tu sei qui" not in position

    def test_a_shorter_prefix_is_not_truncated(self, scraper):
        """The hardcoded [17:] slice ate 17 characters regardless of content."""
        soup = BeautifulSoup(
            '<div id="breadcrumb">Brocardi.it > Codice civile > Art. 2043</div>',
            "html.parser",
        )
        assert scraper._extract_position(soup).startswith("Codice civile")


class TestCrossReferenceTipoAtto:
    @pytest.mark.parametrize("href,expected", [
        ("https://brocardi.it/codice-di-procedura-civile/libro-primo/art100.html",
         "Codice Procedura Civile"),
        ("https://brocardi.it/codice-di-procedura-penale/libro-primo/art111.html",
         "Codice Procedura Penale"),
        ("https://brocardi.it/codice-civile/libro-quarto/art2043.html", "Codice Civile"),
        ("https://brocardi.it/codice-del-consumo/parte-i/art3.html", "Codice del Consumo"),
        ("https://brocardi.it/codice-della-privacy/parte-i/art1.html", "Codice Privacy"),
    ])
    def test_every_path_is_recognised(self, scraper, href, expected):
        html = f'<div class="text"><a href="{href}">rinvio</a></div>'
        corpo = BeautifulSoup(html, "html.parser")
        refs = scraper._extract_cross_references(corpo)
        assert refs, f"no cross-reference extracted for {href}"
        assert refs[0]["tipo_atto"] == expected


class TestFootnoteTipoMatchesTheTypeScriptUnion:
    def test_only_declared_values_are_emitted(self, scraper):
        info = _info(scraper, "article.html")
        allowed = {"nota", "riferimento", "footnote"}
        for note in info.get("Footnotes", []):
            assert note["tipo"] in allowed, (
                f"{note['tipo']!r} is not in the Footnote['tipo'] union in types/index.ts"
            )


class TestArticleUrlResolution:
    @pytest.mark.asyncio
    async def test_relative_href_keeps_its_path(self, scraper):
        """urljoin against the bare domain drops the path segments."""
        soup = BeautifulSoup(
            '<a href="libro-quarto/titolo-ix/art2043.html">2043</a>', "html.parser"
        )
        url = await scraper._find_article_link(
            soup, "https://brocardi.it/codice-civile/", "2043"
        )
        assert url == "https://brocardi.it/codice-civile/libro-quarto/titolo-ix/art2043.html"

    @pytest.mark.asyncio
    async def test_offsite_subpages_are_not_followed(self, scraper):
        soup = BeautifulSoup(
            '<div class="section-title"><a href="https://example.com/altro.html">x</a></div>',
            "html.parser",
        )
        assert await scraper._find_article_link(
            soup, "https://brocardi.it/codice-civile/", "2043"
        ) is None


class TestGlossario:
    def test_dictionary_links_are_collected(self, scraper):
        html = (
            '<div><a href="/dizionario/1234.html">colpa</a>'
            '<a href="/dizionario/1234.html">colpa</a>'
            '<a href="https://brocardi.it/dizionario/5678.html">dolo</a>'
            '<a href="/codice-civile/art2043.html">art. 2043</a>'
            '<a href="/dizionario/9999.html"></a></div>'
        )
        soup = BeautifulSoup(html, "html.parser")
        entries = scraper._extract_glossario(soup)

        assert [e["termine"] for e in entries] == ["colpa", "dolo"], "dedupe or filtering failed"
        assert entries[0]["url"] == "https://brocardi.it/dizionario/1234.html"
        assert entries[0]["dizionario_id"] == "1234"

    def test_absent_glossary_yields_no_key(self, scraper):
        soup = BeautifulSoup("<div><p>nessun link</p></div>", "html.parser")
        info = {}
        scraper._attach_glossario(soup, info)
        assert "Glossario" not in info


class TestGlossarioProvenance:
    """The Glossario must describe the ARTICLE, not the reader Q&A below it.

    Measured on the captured art. 2043 page: 107 of the 114 /dizionario/ links
    sit inside Brocardi's reader Q&A block, 4 in the article text and 3 in its
    notes. Harvesting all of them would label user-submitted material as the
    article's glossary.
    """

    def test_reader_qa_terms_are_excluded(self, scraper):
        html = (
            '<div class="corpoDelTesto dispositivo">'
            '  <a href="/dizionario/1.html">danno ingiusto</a>'
            '</div>'
            '<div class="new_risposta_quesito">'
            '  <div class="new_risposta_corpo">'
            '    <a href="/dizionario/2.html">prescrizione</a>'
            '    <a href="/dizionario/3.html">azione possessoria</a>'
            '  </div>'
            '</div>'
        )
        soup = BeautifulSoup(html, "html.parser")
        entries = scraper._extract_glossario(soup)
        assert [e["termine"] for e in entries] == ["danno ingiusto"]

    def test_the_real_page_yields_article_terms_only(self, scraper):
        soup = BeautifulSoup(
            (FIXTURES / "article.html").read_text(encoding="utf-8"), "html.parser"
        )
        entries = scraper._extract_glossario(soup)
        # 7 links live outside the Q&A block on this page; dedupe may reduce it.
        assert 0 < len(entries) <= 10, (
            f"expected a handful of article-anchored terms, got {len(entries)} — "
            "the Q&A exclusion is probably not firing"
        )


class TestArticleUrlResolutionReachesProduction:
    """The two tests above exercise _find_article_link directly, which cannot
    tell whether the production caller hands it the right base. These do."""

    @pytest.mark.asyncio
    async def test_look_up_resolves_against_the_page_not_the_domain(self, scraper):
        """look_up used to pass the bare domain, so a path-relative href lost
        its path. Only reachable through look_up, hence this test."""
        from unittest.mock import AsyncMock, patch

        from visualex_api.tools.norma import Norma, NormaVisitata

        page_url = "https://www.brocardi.it/codice-civile/"
        soup = BeautifulSoup(
            '<a href="libro-quarto/titolo-ix/art2043.html">2043</a>', "html.parser"
        )
        nv = NormaVisitata(
            norma=Norma(tipo_atto="codice civile", data="1942-03-16", numero_atto="262"),
            numero_articolo="2043",
            allegato="2",
        )
        with patch.object(scraper, "do_know", new=AsyncMock(return_value=("codice civile", page_url))), \
             patch.object(scraper, "_fetch_soup", new=AsyncMock(return_value=soup)):
            url = await scraper.look_up(nv)

        assert url == "https://www.brocardi.it/codice-civile/libro-quarto/titolo-ix/art2043.html", (
            f"look_up resolved the relative href against the wrong base: {url}"
        )

    @pytest.mark.asyncio
    async def test_offsite_subpages_are_never_requested(self, scraper):
        """Assert the FILTER, not the return value: an off-site URL returns None
        anyway because the egress allowlist blocks it, so a test on the return
        value cannot distinguish the filtered code from the unfiltered code."""
        from unittest.mock import AsyncMock

        requested = []

        async def recording_fetch(url, *, cache_suffix, source):
            requested.append(url)
            return None

        soup = BeautifulSoup(
            '<div class="section-title">'
            '  <a href="https://example.com/altro.html">off-site</a>'
            '  <a href="https://www.brocardi.it/codice-civile/">la pagina stessa</a>'
            '</div>',
            "html.parser",
        )
        scraper._fetch_soup = AsyncMock(side_effect=recording_fetch)
        await scraper._find_article_link(soup, "https://www.brocardi.it/codice-civile/", "2043")

        assert not any("example.com" in u for u in requested), (
            f"followed an off-site link: {requested}"
        )
        assert not any(u.rstrip("/") == "https://www.brocardi.it/codice-civile" for u in requested), (
            f"re-fetched the page it was already on: {requested}"
        )
