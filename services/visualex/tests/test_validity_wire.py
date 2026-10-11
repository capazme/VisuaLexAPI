"""`validity` on the wire, and what a request for a past text must not trigger.

The three handlers that serve an article from the Normattiva scraper add
`validity` next to `article_text`. It is read from the page the scraper cached,
so the text itself must come through untouched: every stored highlight and note
is pinned to it (root CLAUDE.md, rule 23). A request for a past text never asks
Brocardi, and a date after today is refused before any request is made.
"""
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app import NormaController
from visualex_api.services.normattiva_scraper import NormattivaScraper
from tests.validity_pages import synthetic

URN = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241~art3!vig=2007-12-29"
# Odd on purpose: double spaces, a non-breaking space, CRLF and accents must
# reach the client byte for byte.
TEXT = "Art. 3\n\n1.  Ogni provvedimento è motivato.\r\n2. Fine del  testo. àèìòù"
PAGE = synthetic(dal="25-12-2003", al="29-12-2007", label="Art. 3", version=7, updated="11/08/2026")
BROCARDI = ("Libro I", {"Brocardi": ["Nemo iudex"]}, "https://www.brocardi.it/x")

ARTICLE_ENDPOINTS = ["/stream_article_text", "/fetch_article_text", "/fetch_all_data"]
# The three places that call `brocardi_scraper.get_info`.
BROCARDI_ENDPOINTS = ["/stream_article_text", "/fetch_brocardi_info", "/fetch_all_data"]


class FakeCache:
    def __init__(self, entries):
        self.entries = entries

    async def get(self, key):
        return self.entries.get(key)


def requested(version=None, version_date=None, tipo_atto="legge", article="3"):
    """What `create_norma_visitata_from_data` hands the handlers."""
    return SimpleNamespace(
        norma=SimpleNamespace(tipo_atto=tipo_atto),
        numero_articolo=article,
        versione=version,
        data_versione=version_date,
        allegato=None,
        to_dict=lambda: {"tipo_atto": tipo_atto, "numero_articolo": article, "versione": version,
                         "data_versione": version_date},
    )


def normattiva_serving(page=PAGE):
    scraper = NormattivaScraper.__new__(NormattivaScraper)  # no __init__: no cache, no network
    scraper.get_document = AsyncMock(return_value=(TEXT, URN))
    scraper.cache = FakeCache({URN: page} if page is not None else {})
    return scraper


@pytest.fixture
async def controller():
    ctrl = NormaController()
    ctrl.fetch_queue.spacing = 0
    await ctrl.fetch_queue.start()
    yield ctrl
    await ctrl.fetch_queue.stop()


@pytest.fixture
def brocardi():
    scraper = SimpleNamespace(get_info=AsyncMock(return_value=BROCARDI))
    with patch("app.brocardi_scraper", scraper):
        yield scraper


@pytest.fixture(autouse=True)
def _no_history_writes():
    with patch("app.add_to_history"):
        yield


async def ask(controller, endpoint, nv, scraper=None, body=None):
    """POST to an endpoint with the article(s), the scraper and Brocardi replaced."""
    scraper = scraper or normattiva_serving()
    articles = nv if isinstance(nv, list) else [nv]
    request_body = {"act_type": "legge", "article": "3", "show_brocardi_info": True, **(body or {})}
    with patch.object(NormaController, "create_norma_visitata_from_data", AsyncMock(return_value=articles)), \
            patch("app.normattiva_scraper", scraper):
        response = await controller.app.test_client().post(endpoint, json=request_body)
    raw = await response.get_data(as_text=True)
    assert response.status_code == 200, raw
    if endpoint == "/stream_article_text":
        return [json.loads(line) for line in raw.splitlines() if line.strip()]
    return json.loads(raw)


class TestValidityRidesAlong:
    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_the_text_is_untouched_and_the_window_is_added(self, controller, brocardi, endpoint):
        [result] = await ask(controller, endpoint, requested(version="vigente", version_date="2005-06-01"))
        assert result["article_text"] == TEXT
        assert result["url"] == URN
        assert result["validity"] == {
            "state": "historical",
            "valid_from": "2003-12-25",
            "valid_to": "2007-12-29",
            "version_number": 7,
            "act_updated": "2026-08-11",
            "request_in_window": True,
        }

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_it_says_when_the_window_does_not_contain_the_requested_day(self, controller, brocardi, endpoint):
        [result] = await ask(controller, endpoint, requested(version="vigente", version_date="2010-01-01"))
        assert result["validity"]["request_in_window"] is False

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    @pytest.mark.parametrize("page", [None, "<html>not an article page</html>"])
    async def test_without_a_readable_page_the_key_is_simply_absent(self, controller, brocardi, endpoint, page):
        [result] = await ask(controller, endpoint, requested(), scraper=normattiva_serving(page))
        assert result["article_text"] == TEXT
        assert "validity" not in result

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_an_eur_lex_text_carries_no_validity(self, controller, brocardi, endpoint):
        eurlex = SimpleNamespace(get_document=AsyncMock(return_value=(TEXT, "https://eur-lex.example/x")),
                                 cache=FakeCache({"https://eur-lex.example/x": PAGE}))
        with patch("app.eurlex_scraper", eurlex):
            [result] = await ask(controller, endpoint, requested(tipo_atto="regolamento ue"))
        assert result["article_text"] == TEXT
        assert "validity" not in result


class TestARangeAtOneDate:
    """`article: "1-3"` with a date answers one article after the other, and each
    page states its own window: art. 1 did not exist on the day, art. 2 did, and
    the page of art. 3 is not in the cache."""

    @pytest.mark.parametrize("endpoint", ARTICLE_ENDPOINTS)
    async def test_every_article_carries_its_own_window_or_none(self, controller, brocardi, endpoint):
        urns = [f"{URN}#{n}" for n in (1, 2, 3)]
        pages = {
            urns[0]: synthetic(al="12-9-2014", label="Art. 1", content="<span>NON ANCORA ESISTENTE O VIGENTE</span>"),
            urns[1]: synthetic(dal="1-1-2005", al="31-12-2015", label="Art. 2"),
        }
        scraper = NormattivaScraper.__new__(NormattivaScraper)
        scraper.get_document = AsyncMock(side_effect=[(f"testo {n}", urns[n - 1]) for n in (1, 2, 3)])
        scraper.cache = FakeCache(pages)
        asked = [requested(version="vigente", version_date="2010-01-01", article=str(n)) for n in (1, 2, 3)]

        results = await ask(controller, endpoint, asked, scraper=scraper)

        assert [r["article_text"] for r in results] == ["testo 1", "testo 2", "testo 3"]
        assert [r.get("validity", {}).get("state") for r in results] == ["not_yet", "historical", None]
        assert "validity" not in results[2]


class TestBrocardiIsNotAskedForAPastText:
    @pytest.mark.parametrize("endpoint", BROCARDI_ENDPOINTS)
    async def test_the_text_in_force_still_gets_its_doctrine(self, controller, brocardi, endpoint):
        await ask(controller, endpoint, requested(version="vigente"))
        brocardi.get_info.assert_awaited_once()

    @pytest.mark.parametrize("endpoint", BROCARDI_ENDPOINTS)
    @pytest.mark.parametrize("version,version_date", [
        ("vigente", "2007-12-29"),
        ("originale", None),
        ("originale", ""),
        (None, "2007-12-29"),
    ])
    async def test_a_past_text_never_does(self, controller, brocardi, endpoint, version, version_date):
        [result] = await ask(controller, endpoint, requested(version=version, version_date=version_date))
        brocardi.get_info.assert_not_awaited()
        assert not result.get("brocardi_info")

    @pytest.mark.parametrize("endpoint", ["/stream_article_text", "/fetch_all_data"])
    async def test_a_past_text_does_not_wait_for_the_slowest_source(self, controller, brocardi, endpoint):
        """The stream used to gather the text and Brocardi, so a historical read
        took as long as the slower of the two."""
        brocardi.get_info = AsyncMock(side_effect=AssertionError("Brocardi must not be reached"))
        [result] = await ask(controller, endpoint, requested(version="vigente", version_date="2007-12-29"))
        assert result["article_text"] == TEXT
        assert "brocardi_error" not in result
        assert not result.get("brocardi_info")


class TestAFutureDateIsRefusedBeforeAnyRequest:
    BODY = {"act_type": "legge", "act_number": "241", "date": "1990-08-07", "article": "3",
            "version": "vigente", "version_date": "2999-01-01"}

    @pytest.mark.parametrize("endpoint", ["/fetch_norma_data", "/fetch_brocardi_info"] + ARTICLE_ENDPOINTS)
    async def test_every_door_answers_400_and_says_why(self, controller, endpoint):
        scraper = normattiva_serving()
        with patch("app.normattiva_scraper", scraper), \
                patch("app.get_tree", AsyncMock(side_effect=AssertionError("no request may be made"))), \
                patch("app.complete_request_date", AsyncMock(side_effect=AssertionError("no request may be made"))):
            response = await controller.app.test_client().post(endpoint, json=self.BODY)
        assert response.status_code == 400
        assert "futura" in (await response.get_json())["error"]
        scraper.get_document.assert_not_awaited()
