"""A range of articles needs the act's index: when it cannot be read, the reader is told so.

Until 13 October 2026 `get_tree`'s failure answer (a message and 0, not an exception) was read as
a list of characters: «artt. 1-5» of a regulation whose EUR-Lex page was refused gave no article
and no error, and the search showed nothing at all.
"""
from unittest.mock import AsyncMock, patch

import pytest

from app import NormaController
from visualex_api.tools.text_op import parse_article_input

TREE = ([{"numero": "1"}, {"numero": "2"}, "CAPO II", {"numero": "3"}, {"numero": "4"}, {"numero": "5"}, {"numero": "6"}], 6)
FAILED = ("Unexpected error: Timeout 30000ms exceeded", 0)
EU_RANGE = {"act_type": "Regolamento UE", "act_number": "679", "date": "2016", "article": "1-5"}


@pytest.fixture
def client():
    return NormaController().app.test_client()


class TestParseArticleInput:
    async def test_a_range_reads_the_index(self):
        with patch("visualex_api.tools.text_op.get_tree", new=AsyncMock(return_value=TREE)):
            assert await parse_article_input("2-4", "urn:x") == ["2", "3", "4"]

    @pytest.mark.parametrize("answer", [FAILED, ("Empty response from server", 0), ([], 0)])
    async def test_an_index_that_cannot_be_read_is_said(self, answer):
        with patch("visualex_api.tools.text_op.get_tree", new=AsyncMock(return_value=answer)):
            result = await parse_article_input("1-5", "urn:x")
        assert result["kind"] == "source"
        assert result["error"].startswith("Non riesco a leggere ora l'indice di quest'atto, quindi non posso aprire gli artt. 1-5")

    async def test_an_index_that_raises_is_said_too(self):
        with patch("visualex_api.tools.text_op.get_tree", new=AsyncMock(side_effect=RuntimeError("down"))):
            result = await parse_article_input("1-5", "urn:x")
        assert result["kind"] == "source"

    async def test_digits_in_a_failure_never_become_articles(self):
        # The old loop read each character: «… 2 …» inside the message was art. 2.
        with patch("visualex_api.tools.text_op.get_tree", new=AsyncMock(return_value=("HTTP 404 on page 2", 0))):
            result = await parse_article_input("1-5", "urn:x")
        assert isinstance(result, dict) and result["kind"] == "source"

    async def test_a_range_with_no_article_in_the_index_is_not_found(self):
        with patch("visualex_api.tools.text_op.get_tree", new=AsyncMock(return_value=TREE)):
            result = await parse_article_input("500-510", "urn:x")
        assert result == {"error": "Nessun articolo tra 500 e 510 nell'indice di quest'atto.", "kind": "not_found"}

    async def test_the_whole_act_with_no_index_is_said(self):
        with patch("visualex_api.tools.text_op.get_tree", new=AsyncMock(return_value=FAILED)):
            result = await parse_article_input("", "urn:x")
        assert result["kind"] == "source" and "l'atto intero" in result["error"]

    async def test_a_single_article_needs_no_index(self):
        tree = AsyncMock(return_value=FAILED)
        with patch("visualex_api.tools.text_op.get_tree", new=tree):
            assert await parse_article_input("5", "urn:x") == ["5"]
        tree.assert_not_called()


class TestTheRoutes:
    async def test_an_eu_range_with_an_unreadable_index_is_a_503_in_words(self, client):
        with patch("visualex_api.tools.text_op.get_tree", new=AsyncMock(return_value=FAILED)), \
                patch("app.get_tree", new=AsyncMock(return_value=FAILED)):
            response = await client.post("/fetch_norma_data", json=EU_RANGE)
        body = await response.get_json()
        assert response.status_code == 503
        assert body["error"].startswith("Non riesco a leggere ora l'indice di quest'atto")

    async def test_the_stream_answers_the_same_before_it_starts(self, client):
        with patch("visualex_api.tools.text_op.get_tree", new=AsyncMock(return_value=FAILED)), \
                patch("app.get_tree", new=AsyncMock(return_value=FAILED)):
            response = await client.post("/stream_article_text", json=EU_RANGE)
        assert response.status_code == 503
        assert (await response.get_json())["error"].startswith("Non riesco a leggere ora l'indice")

    async def test_an_empty_range_is_a_404(self, client):
        with patch("visualex_api.tools.text_op.get_tree", new=AsyncMock(return_value=TREE)), \
                patch("app.get_tree", new=AsyncMock(return_value=TREE)):
            response = await client.post("/fetch_norma_data", json={**EU_RANGE, "article": "500-510"})
        assert response.status_code == 404
