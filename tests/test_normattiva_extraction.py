"""Offline regression corpus for the Normattiva article extractor.

Every scraper in this repo parses third-party HTML, so a break means the site
changed. These fixtures freeze what the site looked like when the extractor was
known good; a diff here is the signal that a selector needs updating.
"""
from pathlib import Path

import pytest

from visualex_api.services.normattiva_scraper import NormattivaScraper

FIXTURES = Path(__file__).parent / "fixtures" / "normattiva"

CASES = [
    "akn_comma_div.html",
    "akn_just_text.html",
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
