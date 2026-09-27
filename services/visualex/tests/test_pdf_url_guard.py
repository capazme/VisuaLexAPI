"""Tests for the export_pdf SSRF guard.

The urn a client sends to /export_pdf ends up in Playwright's page.goto(), so
anything that is not Normattiva must be rejected before a browser is opened.
"""

import pytest

from visualex_api.services.pdfextractor import extract_pdf, is_allowed_pdf_urn


ALLOWED = [
    "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990;241",
    "https://www.normattiva.it",
    "https://www.normattiva.it/",
    "http://www.normattiva.it/atto/x",
    "https://normattiva.it/atto/x",
    "  https://www.normattiva.it/atto/x  ",
    "https://WWW.NORMATTIVA.IT/atto/x",
]

REJECTED = [
    # host that merely starts with the allowed one
    "https://www.normattiva.it.evil.com/x",
    # allowed host smuggled into userinfo, path, query or fragment
    "https://www.normattiva.it@evil.com/",
    "https://evil.com/https://www.normattiva.it/",
    "https://evil.com/?u=https://www.normattiva.it/",
    "https://evil.com#www.normattiva.it",
    # the addresses an SSRF actually aims at
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost:3001/admin",
    "http://127.0.0.1:5000/",
    # non-http schemes
    "file:///etc/passwd",
    "javascript:alert(1)",
    # junk
    "",
    None,
    12345,
]


@pytest.mark.parametrize("urn", ALLOWED)
def test_allows_normattiva(urn):
    assert is_allowed_pdf_urn(urn) is True


@pytest.mark.parametrize("urn", REJECTED)
def test_rejects_everything_else(urn):
    assert is_allowed_pdf_urn(urn) is False


@pytest.mark.asyncio
async def test_extract_pdf_refuses_before_opening_a_browser():
    """The guard must fire inside extract_pdf, not only in the route handler."""
    with pytest.raises(ValueError, match="normattiva"):
        await extract_pdf("http://169.254.169.254/latest/meta-data/")
