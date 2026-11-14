"""`text_source` from VisuaLex: the AKN fallback is never stored as an article's text (scan A.7).

When Normattiva's HTML cannot be read VisuaLex serves the AKN export and says so
(`text_source: "akn"`). That string is not the article's text (root CLAUDE.md, rule 23:
accents transliterated, a markdown heading). The client carries the field; `get_document`,
which ingestion stores from, refuses an AKN text as it refuses an error, so the article is
read again later; `get_article`, which shows the text to a model, keeps it with its mark.
Strings are synthetic.
"""

from __future__ import annotations

import httpx
import pytest

from merlt.clients.models import Norma, NormaVisitata
from merlt.clients.visualex_client import VisuaLexClient

AKN = "### Art. 3\n\n1. Ogni provvedimento e' motivato."
HTML = "Art. 3\n\n1. Ogni provvedimento è motivato."
NV = NormaVisitata(norma=Norma(tipo_atto="legge", data="1990-08-07", numero_atto="241"), numero_articolo="3")


def _client_answering(item: dict) -> VisuaLexClient:
    client = VisuaLexClient(base_url="http://visualex.test")
    client._client = httpx.AsyncClient(
        base_url="http://visualex.test",
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json=[item])),
    )
    return client


async def test_the_client_carries_the_source():
    akn = await _client_answering({"article_text": AKN, "url": "u", "norma_data": {}, "text_source": "akn"}).get_article(NV)
    html = await _client_answering({"article_text": HTML, "url": "u", "norma_data": {}, "text_source": "html"}).get_article(NV)
    before = await _client_answering({"article_text": HTML, "url": "u", "norma_data": {}}).get_article(NV)
    assert (akn.text, akn.text_source) == (AKN, "akn")
    assert html.text_source == "html"
    assert before.text_source == "html"  # an API from before the field


async def test_get_document_never_hands_an_akn_text_to_ingestion():
    client = _client_answering({"article_text": AKN, "url": "u", "norma_data": {}, "text_source": "akn"})
    with pytest.raises(Exception, match="AKN"):
        await client.get_document(NV)


async def test_get_document_still_hands_the_html_text():
    client = _client_answering({"article_text": HTML, "url": "u", "norma_data": {}, "text_source": "html"})
    assert await client.get_document(NV) == (HTML, "u")
