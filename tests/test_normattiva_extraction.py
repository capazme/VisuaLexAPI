"""Offline regression corpus for the Normattiva article extractor.

Every scraper in this repo parses third-party HTML, so a break means the site
changed. These fixtures freeze what the site looked like when the extractor was
known good; a diff here is the signal that a selector needs updating.
"""
import hashlib
from pathlib import Path

import pytest

from visualex_api.services.normattiva_scraper import NormattivaScraper

FIXTURES = Path(__file__).parent / "fixtures" / "normattiva"

CASES = [
    "akn_comma_div.html",
    "akn_just_text.html",
    "abrogato.html",
    "attachment.html",
    "fallback.html",
]


@pytest.fixture(scope="module")
def scraper():
    return NormattivaScraper()


@pytest.mark.parametrize("fixture_name", CASES)
@pytest.mark.asyncio
async def test_every_branch_yields_text(scraper, fixture_name):
    html = (FIXTURES / fixture_name).read_text(encoding="utf-8")
    text = await scraper.estrai_da_html(html)
    assert isinstance(text, str)
    assert len(text.strip()) > 50, f"{fixture_name} produced no usable text"


@pytest.mark.asyncio
async def test_extraction_preserves_italian_accents(scraper):
    """The reading surface shows this text to a lawyer verbatim.

    Normattiva's Akoma Ntoso export transliterates accents ("attivita'", "e'");
    the HTML rendering does not. This asserts we stay on the accented side.
    """
    html = (FIXTURES / "akn_comma_div.html").read_text(encoding="utf-8")
    text = await scraper.estrai_da_html(html)
    assert "'" not in text.replace("dell'", "").replace("all'", "").replace("l'", "") \
        or any(ch in text for ch in "àèéìòù"), "accented characters disappeared"


@pytest.mark.asyncio
async def test_parse_failure_reports_the_real_cause(scraper):
    """A malformed page must not raise NameError from the error path itself."""
    with pytest.raises(Exception) as exc:
        await scraper.estrai_da_html("<html><body>nothing useful here</body></html>")
    assert "logger" not in str(exc.value), (
        "the except block referenced an undefined name instead of reporting the cause"
    )


# The test above cannot reach the bug it names: estrai_da_html raises ParsingError
# on a missing div.bodyTesto before any extractor branch runs, and the four
# _estrai_testo_* branches *return* an error string rather than raising. This is
# the test that actually covers those four except blocks.
@pytest.mark.parametrize("method_name", [
    "_estrai_testo_akn_dettagliato",
    "_estrai_testo_akn_semplice",
    "_estrai_testo_allegato",
    "_estrai_testo_fallback",
])
def test_extractor_error_paths_report_the_real_cause(scraper, method_name):
    """Each branch must RAISE on failure, reporting the real cause.

    Two bugs met here. The module defines `log`; all four blocks called an
    undefined `logger`, so every extraction failure surfaced as "name 'logger'
    is not defined". And once that was fixed the blocks *returned* the string
    "Error in _estrai_...", which is truthy — so it flowed past get_document's
    emptiness guard, skipped the AKN fallback, and was rendered to the reader as
    the text of the article with HTTP 200, then cached for 24h.
    """
    from visualex_api.tools.exceptions import ParsingError

    with pytest.raises(ParsingError) as exc:
        getattr(scraper, method_name)("not a tag")

    message = str(exc.value)
    assert "logger" not in message, (
        f"{method_name} reported the undefined name instead of the real cause"
    )
    assert method_name in message, "the raised error should name the failing extractor"


class TestRepealedArticleWithMalformedMarkup:
    """A repealed article must never come back as its label alone.

    For c.p. art. 524 Normattiva's bodyTesto is malformed — the attachment span
    is opened inside an <a> and closed after it — so once html.parser has
    repaired the tree the `div.ins-akn.art_abrogato-akn` is a sibling of the
    span `_estrai_testo_allegato` reads, and the API answered
    'Codice Penale-art. 524' with HTTP 200 for 19 articles of the codice
    penale (523-526, 530, 539, 541-543, 545-555). Art. 544 is the healthy
    shape: same notice, inside the span, and its output is frozen.
    """

    @pytest.mark.asyncio
    async def test_orphan_abrogation_notice_is_appended(self, scraper):
        html = (FIXTURES / "cp_524_abrogato_malformed_trimmed.html").read_text(encoding="utf-8")
        text = await scraper.estrai_da_html(html)
        assert text == (
            "Codice Penale-art. 524\n\n"
            "((ARTICOLO ABROGATO DALLA L. 15 FEBBRAIO 1996, N. 66))"
        )

    @pytest.mark.asyncio
    async def test_orphan_notice_link_is_collected(self, scraper):
        html = (FIXTURES / "cp_524_abrogato_malformed_trimmed.html").read_text(encoding="utf-8")
        result = await scraper.estrai_da_html(html, get_link_dict=True)
        assert "ARTICOLO ABROGATO DALLA L. 15 FEBBRAIO 1996" in result["testo"]
        assert result["link"]["L. 15 FEBBRAIO 1996, N. 66"].endswith("legge:1996-02-15;66")

    @pytest.mark.asyncio
    async def test_healthy_repealed_article_is_unchanged(self, scraper):
        """gotcha 23: the in-span case parsed before and its text is frozen."""
        html = (FIXTURES / "cp_544_abrogato_trimmed.html").read_text(encoding="utf-8")
        text = await scraper.estrai_da_html(html)
        assert text == "Art. 544. \n\n((ARTICOLO ABROGATO DALLA L. 5 AGOSTO 1981, N. 442))"

    @pytest.mark.asyncio
    async def test_in_span_notice_is_not_appended_twice(self, scraper):
        html = (FIXTURES / "cp_544_abrogato_trimmed.html").read_text(encoding="utf-8")
        text = await scraper.estrai_da_html(html)
        assert text.count("ARTICOLO ABROGATO") == 1


# `article_text` is not just any string: it is the offset space every stored
# highlight and note is anchored to (gotcha 23). `test_every_branch_yields_text`
# only checks `len > 50`, which two very differently-formatted outputs can both
# clear — it would not notice a stray space or a reordered line. This pins the
# exact sha256 of what the extractor produces for each of the five whole-page
# fixtures, plus art. 544 (the healthy in-span abrogation shape, contrasted
# with art. 524's malformed one above). A failure here means the extractor's
# output changed for one of these inputs — deliberate or not, that is a change
# to every highlight and note offset stored against it, and must be reviewed
# as such before the fixture (or this hash) is updated.
FROZEN_TEXT_SHA256 = {
    "akn_comma_div.html": "c98b1ef2caecb3daf236cb912dfade4bbe4db3bb378d48221f586d374401f4f4",
    "akn_just_text.html": "154ba79f6ece9bbb6ec5915b84065aeb9c60950556a69fa4a5e70d559d873cce",
    "abrogato.html": "6d06df4c2674d688ec0024301b5ed04ddce42387ef4260e60d602b2b8911f6e5",
    "attachment.html": "d69cc4cfcd7ea042c1a230e5b9037d94564451408b637b929adbb5868fb20ef8",
    "fallback.html": "1181881d79d0dd1a31c7e79ea6ace6627022ee2f164c3498a497a9fd3b4fcaba",
    "cp_544_abrogato_trimmed.html": "5c06313f7d36e5f171cf3f63393029fcea1b83bf48cd539618efcb66f402a87a",
}


@pytest.mark.parametrize("fixture_name,expected_sha256", sorted(FROZEN_TEXT_SHA256.items()))
@pytest.mark.asyncio
async def test_extracted_text_matches_the_frozen_sha256(scraper, fixture_name, expected_sha256):
    html = (FIXTURES / fixture_name).read_text(encoding="utf-8")
    text = await scraper.estrai_da_html(html)
    actual = hashlib.sha256(text.encode("utf-8")).hexdigest()
    assert actual == expected_sha256, (
        f"{fixture_name} extracted text changed — every highlight/note offset "
        f"anchored to it is now wrong unless this is a deliberate, reviewed change"
    )
