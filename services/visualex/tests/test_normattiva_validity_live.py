"""The validity window, read off live Normattiva pages (`-m live`).

Excluded from the default run: it asks the real portal for six article pages,
three seconds apart, through the same path the app uses (the controller builds
the request, the scraper fetches and caches the page, `read_validity` reads it).
It is how the extraction is re-checked when the portal changes its markup:
`test_normattiva_validity.py` freezes what the pages looked like, this shows
what they look like now.

    cd services/visualex && .venv/bin/python -m pytest tests/test_normattiva_validity_live.py -m live -q
"""
import asyncio

import pytest

from app import NormaController, normattiva_scraper
from visualex_api.services.normattiva_validity import read_validity

pytestmark = pytest.mark.live

PAUSE = 3  # seconds between two requests to the portal

CASES = {
    # A middle version: both ends of the window, and the version's number.
    "cc_1284_at_2007-12-29": (
        {"act_type": "codice civile", "article": "1284", "version": "vigente", "version_date": "2007-12-29"},
        {"state": "historical", "valid_from": "2003-12-25", "valid_to": "2007-12-29",
         "version_number": 7, "request_in_window": True},
    ),
    # The next version starts on the next day: windows are contiguous.
    "cc_1284_at_2007-12-30": (
        {"act_type": "codice civile", "article": "1284", "version": "vigente", "version_date": "2007-12-30"},
        {"state": "historical", "valid_from": "2007-12-30", "version_number": 8, "request_in_window": True},
    ),
    # An article that did not exist yet: only the end of the window is stated.
    "cpc_183bis_at_2010-01-01": (
        {"act_type": "codice di procedura civile", "article": "183-bis", "version": "vigente",
         "version_date": "2010-01-01"},
        {"state": "not_yet", "valid_from": None, "valid_to": "2014-09-12", "request_in_window": True},
    ),
    # A repealed article, read today: the notice is the text.
    "cp_594_current": (
        {"act_type": "codice penale", "article": "594", "version": "vigente"},
        {"state": "abrogated", "valid_to": None},
    ),
    # The original text of an article amended since.
    "st_lav_18_original": (
        {"act_type": "legge", "act_number": "300", "date": "1970-05-20", "article": "18", "version": "originale"},
        {"state": "historical"},
    ),
    # A text still in force.
    "cc_2043_current": (
        {"act_type": "codice civile", "article": "2043", "version": "vigente"},
        {"state": "current", "valid_to": None},
    ),
}


@pytest.mark.parametrize("name", CASES)
async def test_the_window_the_portal_states(name):
    request, expected = CASES[name]
    await asyncio.sleep(PAUSE)
    controller = NormaController.__new__(NormaController)
    [nv] = await controller.create_norma_visitata_from_data(request)
    _, urn = await normattiva_scraper.get_document(nv)

    found = await read_validity(
        normattiva_scraper.cache, urn,
        article=nv.numero_articolo, requested_date=nv.data_versione,
    )

    assert found is not None, f"{name}: the page could not be read ({urn})"
    for key, value in expected.items():
        assert found[key] == value, f"{name}: {key} is {found[key]!r}, expected {value!r}"
    if name == "st_lav_18_original":
        assert found["valid_from"].startswith("1970-")
