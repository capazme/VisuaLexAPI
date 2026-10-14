"""`POST /fetch_rubriche` gives the act's title with its rubriche: one call decorates a dossier's act block."""
from unittest.mock import AsyncMock, patch

import pytest

from app import NormaController
from visualex_api.services.akn_fetch import AktIndex

ACT_URL = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:2012-12-31;247"


@pytest.fixture
def client():
    return NormaController().app.test_client()


async def test_the_title_comes_with_the_rubriche(client):
    index = AktIndex(
        title="Nuova disciplina dell'ordinamento della professione forense. (13G00018)",
        keys=["1"], rubriche={"1": "Disciplina dell'ordinamento forense"},
    )
    with patch("app.fetch_act_index", AsyncMock(return_value=index)):
        response = await client.post("/fetch_rubriche", json={"urn": ACT_URL + "~art1"})
    body = await response.get_json()
    assert response.status_code == 200
    assert body["title"] == "Nuova disciplina dell'ordinamento della professione forense"
    assert body["rubriche"] == {"1": "Disciplina dell'ordinamento forense"}


async def test_no_index_no_title(client):
    with patch("app.fetch_act_index", AsyncMock(return_value=None)):
        response = await client.post("/fetch_rubriche", json={"urn": ACT_URL})
    assert (await response.get_json())["title"] == ""


async def test_a_failure_answers_no_title(client):
    with patch("app.fetch_act_index", AsyncMock(side_effect=RuntimeError("boom"))):
        response = await client.post("/fetch_rubriche", json={"urn": ACT_URL})
    body = await response.get_json()
    assert response.status_code == 200
    assert body["title"] == ""


EU_URL = "https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=CELEX:32016R0679"


async def test_an_eu_act_gets_its_title_from_the_page(client):
    tree = ([], 0, {"rubriche": {"1": "Oggetto e finalità"}, "title": "relativo alla protezione delle persone fisiche"})
    with patch("app.get_tree", AsyncMock(return_value=tree)):
        response = await client.post("/fetch_rubriche", json={"urn": EU_URL})
    body = await response.get_json()
    assert body["title"] == "relativo alla protezione delle persone fisiche"
    assert body["rubriche"] == {"1": "Oggetto e finalità"}


async def test_an_eu_page_that_cannot_be_read_answers_no_title(client):
    with patch("app.get_tree", AsyncMock(side_effect=RuntimeError("waf"))):
        response = await client.post("/fetch_rubriche", json={"urn": EU_URL})
    body = await response.get_json()
    assert response.status_code == 200
    assert body["title"] == "" and body["rubriche"] == {}
