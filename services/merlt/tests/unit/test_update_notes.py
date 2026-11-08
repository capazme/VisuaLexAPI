"""Normattiva's update notes reach the experts beside the article's text, never in it (G-386).

VisuaLex answers `note_aggiornamento` (a list of `{numero, testo, ordine,
corte_costituzionale}`), `note_non_lette` and `note_nel_testo` next to
`article_text`. The client carries them, `update_notes_block` labels them for a
model, and the text that ingestion stores stays the article's own. Strings are
synthetic.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx

from merlt.clients.models import Norma, NormaVisitata
from merlt.clients.visualex_client import (
    UPDATE_NOTES_LABEL,
    UPDATE_NOTES_UNREAD,
    ArticleResult,
    NormattivaScraper,
    VisuaLexClient,
    partial_text_notice,
    update_notes_block,
)
from merlt.experts.react_mixin import ReActMixin
from merlt.tools.search import ArticleFetchTool

TEXT = "Art. 3\n\n1. Testo sintetico del comma. (2)"
RULING = {"numero": "2", "testo": "La Corte costituzionale, con sentenza n. 1/2020, …", "ordine": 1,
          "corte_costituzionale": True}
LAW = {"numero": "3", "testo": "Il D.L. 1/2020 ha disposto che …", "ordine": 2, "corte_costituzionale": False}
NV = NormaVisitata(norma=Norma(tipo_atto="decreto legislativo", data="2015-03-04", numero_atto="23"),
                   numero_articolo="3")


def _client_answering(item: dict) -> VisuaLexClient:
    client = VisuaLexClient(base_url="http://visualex.test")
    client._client = httpx.AsyncClient(
        base_url="http://visualex.test",
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json=[item])),
    )
    return client


def _result(**over) -> ArticleResult:
    return ArticleResult(text=TEXT, url="u", norma_data={}, **over)


async def test_the_client_carries_the_notes_and_leaves_the_text_alone():
    client = _client_answering({
        "article_text": TEXT, "url": "u", "norma_data": {},
        "note_aggiornamento": [RULING, LAW], "note_non_lette": False, "note_nel_testo": False,
    })
    article = await client.get_article(NV)
    assert article.text == TEXT
    assert article.note_aggiornamento == [RULING, LAW]
    assert (article.note_non_lette, article.note_nel_testo) == (False, False)
    assert await client.get_document(NV) == (TEXT, "u")


async def test_an_older_answer_carries_no_notes():
    article = await _client_answering({"article_text": TEXT, "url": "u", "norma_data": {}}).get_article(NV)
    assert (article.note_aggiornamento, article.note_non_lette, article.note_nel_testo) == (None, False, False)


def test_the_block_is_labelled_and_marks_the_court():
    assert update_notes_block(_result(note_aggiornamento=[RULING, LAW])) == "\n".join([
        UPDATE_NOTES_LABEL,
        "(2) [Corte costituzionale] La Corte costituzionale, con sentenza n. 1/2020, …",
        "(3) Il D.L. 1/2020 ha disposto che …",
    ])


def test_the_block_says_when_notes_were_not_read():
    assert update_notes_block(_result(note_aggiornamento=None, note_non_lette=True)) == \
        f"{UPDATE_NOTES_LABEL}\n{UPDATE_NOTES_UNREAD}"


def test_no_block_when_there_is_nothing_or_the_text_holds_the_notes():
    assert update_notes_block(_result()) == ""
    assert update_notes_block(_result(note_aggiornamento=[])) == ""
    assert update_notes_block(_result(note_aggiornamento=[RULING], note_nel_testo=True)) == ""


def test_the_notice_stays_when_the_text_holds_the_notes():
    assert update_notes_block(_result(note_aggiornamento=[RULING], note_nel_testo=True, note_non_lette=True)) == \
        f"{UPDATE_NOTES_LABEL}\n{UPDATE_NOTES_UNREAD}"


async def test_the_article_tool_gives_the_block_beside_the_text():
    scraper = NormattivaScraper(client=SimpleNamespace(get_article=AsyncMock(
        return_value=_result(note_aggiornamento=[RULING]))))
    result = await ArticleFetchTool(scraper=scraper).execute(tipo_atto="decreto legislativo", numero_articolo="3")
    assert result.data["text"] == TEXT
    assert result.data["oltre_il_testo"].startswith(UPDATE_NOTES_LABEL)


async def test_a_scraper_without_notes_still_serves_the_text():
    scraper = SimpleNamespace(get_document=AsyncMock(return_value=(TEXT, "u")))
    result = await ArticleFetchTool(scraper=scraper).execute(tipo_atto="codice civile", numero_articolo="3")
    assert (result.data["text"], result.data["oltre_il_testo"]) == (TEXT, "")


def test_the_expert_reads_the_block_after_the_text():
    block = update_notes_block(_result(note_aggiornamento=[RULING]))
    data = {"text": TEXT, "urn": "urn:x", "tipo_atto": "decreto legislativo", "source": "normattiva",
            "oltre_il_testo": block}
    [source] = ReActMixin._extract_sources_from_result(None, SimpleNamespace(success=True, data=data))
    assert source["text"] == f"{TEXT}\n\n{block}"
    [plain] = ReActMixin._extract_sources_from_result(None, SimpleNamespace(success=True, data=dict(data, oltre_il_testo="")))
    assert plain["text"] == TEXT


PARTS = [{"progressivo": k, "commi_dal": str(100 * (k - 1) + 1), "commi_al": "264" if k == 3 else str(100 * k),
          "url": f"https://www.normattiva.it/atto/caricaArticolo?art.progressivo={k}"} for k in (1, 2, 3)]


async def test_the_client_carries_the_parts():
    article = await _client_answering({
        "article_text": TEXT, "url": "u", "norma_data": {}, "parti": PARTS, "testo_parziale": True,
    }).get_article(NV)
    assert (article.parti, article.testo_parziale) == (PARTS, True)
    assert partial_text_notice(article) == "testo parziale: commi 1-100 di 264 (diviso in 3 parti)"


def test_no_notice_for_a_whole_article():
    assert partial_text_notice(_result(parti=[], testo_parziale=False)) == ""
    assert partial_text_notice(_result()) == ""


async def test_the_article_tool_says_the_text_is_partial_before_the_notes():
    scraper = NormattivaScraper(client=SimpleNamespace(get_article=AsyncMock(
        return_value=_result(note_aggiornamento=[RULING], parti=PARTS, testo_parziale=True))))
    result = await ArticleFetchTool(scraper=scraper).execute(tipo_atto="legge", numero_articolo="1")
    assert result.data["text"] == TEXT
    notice, notes = result.data["oltre_il_testo"].split("\n\n")
    assert notice == "testo parziale: commi 1-100 di 264 (diviso in 3 parti)"
    assert notes.startswith(UPDATE_NOTES_LABEL)


async def test_the_client_asks_for_a_part_by_its_commas_or_by_a_comma():
    """G-387 (a): `parte` («701-800») or `comma` («773») reach the API; neither when not given."""
    sent = []

    def answer(request):
        sent.append(json.loads(request.content))
        return httpx.Response(200, json=[{"article_text": TEXT, "url": "u", "norma_data": {"parte": "101-200"},
                                          "parti": PARTS, "testo_parziale": True}])

    client = VisuaLexClient(base_url="http://visualex.test")
    client._client = httpx.AsyncClient(base_url="http://visualex.test", transport=httpx.MockTransport(answer))
    [by_part] = await client.fetch_article_text(act_type="legge", article="1", parte="101-200")
    await client.fetch_article_text(act_type="legge", article="1", comma="150")
    await client.fetch_article_text(act_type="legge", article="1")
    assert sent[0]["parte"] == "101-200" and "comma" not in sent[0]
    assert sent[1]["comma"] == "150" and "parte" not in sent[1]
    assert "parte" not in sent[2] and "comma" not in sent[2]
    assert partial_text_notice(by_part) == "testo parziale: commi 101-200 di 264 (diviso in 3 parti)"


def test_a_part_is_said_when_the_list_is_missing():
    result = ArticleResult(text=TEXT, url="u", norma_data={"parte": "101-200"}, parti=None, testo_parziale=True)
    assert partial_text_notice(result) == "testo parziale: commi 101-200 dell'articolo, diviso in parti"
