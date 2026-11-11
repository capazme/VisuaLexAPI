"""One request may not expand to more articles than the ceiling (scan A.4).

«1-3249» used to expand to the whole Codice civile for the price of one request: one request,
thousands of pages fetched from the source. The ceiling counts the articles after expansion and
deduplication, so a long comma list costs the same as a range.
"""
from unittest.mock import AsyncMock, patch

import pytest

from app import NormaController
from visualex_api.tools import text_op
from visualex_api.tools.text_op import parse_article_input

BIG_TREE = ([{"numero": str(n)} for n in range(1, 301)], 300)


@pytest.fixture
def client():
    return NormaController().app.test_client()


class TestCeiling:
    async def test_a_range_within_the_ceiling_passes(self):
        with patch("visualex_api.tools.text_op.get_tree", new=AsyncMock(return_value=BIG_TREE)):
            result = await parse_article_input("1-100", "urn:x")
        assert len(result) == 100

    async def test_a_range_above_the_ceiling_is_refused(self):
        with patch("visualex_api.tools.text_op.get_tree", new=AsyncMock(return_value=BIG_TREE)):
            result = await parse_article_input("1-300", "urn:x")
        assert result["kind"] == "too_many"
        assert "300 articoli" in result["error"] and "100" in result["error"]

    async def test_a_comma_list_counts_too(self):
        many = ",".join(str(n) for n in range(1, 102))
        result = await parse_article_input(many, "urn:x")
        assert result["kind"] == "too_many"

    async def test_many_ranges_are_refused_before_reading_the_index(self):
        tree = AsyncMock(return_value=BIG_TREE)
        with patch("visualex_api.tools.text_op.get_tree", new=tree):
            result = await parse_article_input(",".join(["5000-6000"] * 101), "urn:x")
        assert result["kind"] == "too_many"
        tree.assert_not_awaited()

    async def test_the_index_is_read_once_per_request(self):
        tree = AsyncMock(return_value=BIG_TREE)
        with patch("visualex_api.tools.text_op.get_tree", new=tree):
            assert len(await parse_article_input("1-10, 20-30, 40-50", "urn:x")) == 32
        assert tree.await_count == 1

    async def test_duplicates_count_once(self):
        result = await parse_article_input(",".join(["1"] * 100), "urn:x")
        assert result == ["1"]

    async def test_the_whole_act_is_capped_too(self):
        with patch("visualex_api.tools.text_op.get_tree", new=AsyncMock(return_value=BIG_TREE)):
            result = await parse_article_input("", "urn:x")
        assert result["kind"] == "too_many"

    async def test_the_ceiling_is_a_setting(self, monkeypatch):
        monkeypatch.setattr(text_op, "MAX_ARTICLES_PER_REQUEST", 300)
        with patch("visualex_api.tools.text_op.get_tree", new=AsyncMock(return_value=BIG_TREE)):
            assert len(await parse_article_input("1-300", "urn:x")) == 300

    async def test_the_route_answers_400(self, client):
        many = ",".join(str(n) for n in range(1, 102))
        resp = await client.post("/fetch_norma_data", json={
            "act_type": "codice civile", "article": many})
        assert resp.status_code == 400
        body = await resp.get_json()
        assert "101 articoli" in body["error"]
