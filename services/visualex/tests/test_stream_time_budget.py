"""The article stream has a time budget of its own, tied to the request (14 Nov 2026).

Quart sends every response body under `RESPONSE_TIMEOUT` (60 s by default) and, when it runs
out, closes the body with a 200 and no error. `/stream_article_text` reads the articles one
after the other, so a request of 20-40 articles or more was cut there silently: the reader saw
«40 di 100» and nothing else. The route now sets its own budget (articles × an allowance, under
a hard cap) and, past it, ends with an explicit error line instead of a silent cut.
"""
import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

import app as app_module
from app import NormaController


def fake_nv(n):
    return SimpleNamespace(numero_articolo=str(n), to_dict=lambda n=n: {"numero_articolo": str(n)})


async def stream(controller, count, seconds_each, fails=()):
    async def slow(_self, _scraper, nv, *_args, **_kwargs):
        await asyncio.sleep(seconds_each)
        if nv.numero_articolo in fails:
            raise TimeoutError("upstream read timed out")
        return "testo", "https://example.invalid/x", None, {}

    with patch.object(NormaController, "create_norma_visitata_from_data",
                      AsyncMock(return_value=[fake_nv(n) for n in range(1, count + 1)])), \
            patch.object(NormaController, "get_scraper_for_norma", lambda self, nv: object()), \
            patch.object(NormaController, "_document_in_force", slow), \
            patch.object(NormaController, "_page_extras_for", AsyncMock(return_value={})):
        response = await controller.app.test_client().post(
            "/stream_article_text", json={"act_type": "legge", "article": "1"})
        raw = await response.get_data(as_text=True)
    return response.status_code, [json.loads(line) for line in raw.splitlines() if line.strip()]


@pytest.fixture
def controller():
    c = NormaController()
    # The framework's default stands in for 60 s: shorter than the stream below.
    c.app.config["RESPONSE_TIMEOUT"] = 0.5
    return c


async def test_a_slow_stream_within_its_budget_is_not_cut(controller, monkeypatch):
    monkeypatch.setattr(app_module, "STREAM_SECONDS_PER_ARTICLE", 1.0)
    monkeypatch.setattr(app_module, "STREAM_MAX_SECONDS", 60.0)
    status, lines = await stream(controller, count=4, seconds_each=0.3)
    assert status == 200
    assert [line["norma_data"]["numero_articolo"] for line in lines] == ["1", "2", "3", "4"]
    assert all("error" not in line for line in lines)


async def test_a_stream_over_its_budget_ends_with_an_error_line(controller, monkeypatch):
    monkeypatch.setattr(app_module, "STREAM_SECONDS_PER_ARTICLE", 0.2)
    monkeypatch.setattr(app_module, "STREAM_MAX_SECONDS", 60.0)
    monkeypatch.setattr(app_module, "STREAM_MIN_SECONDS", 0.0)
    controller.app.config["RESPONSE_TIMEOUT"] = 60
    status, lines = await stream(controller, count=4, seconds_each=0.3)
    assert status == 200
    last = lines[-1]
    assert last["kind"] == "time_budget"
    assert "Caricamento interrotto" in last["error"]
    # What was not sent is named, so the client can ask for it again.
    sent = [line["norma_data"]["numero_articolo"] for line in lines[:-1]]
    assert sent + last["missing"] == ["1", "2", "3", "4"]


async def test_a_timeout_inside_one_article_is_that_articles_error(controller, monkeypatch):
    monkeypatch.setattr(app_module, "STREAM_SECONDS_PER_ARTICLE", 10.0)
    controller.app.config["RESPONSE_TIMEOUT"] = 60
    status, lines = await stream(controller, count=3, seconds_each=0.01, fails=("2",))
    assert [("error" in line) for line in lines] == [False, True, False]
    assert all(line.get("kind") != "time_budget" for line in lines)


async def test_the_hard_cap_bounds_the_budget(controller, monkeypatch):
    monkeypatch.setattr(app_module, "STREAM_SECONDS_PER_ARTICLE", 100.0)
    monkeypatch.setattr(app_module, "STREAM_MAX_SECONDS", 0.5)
    monkeypatch.setattr(app_module, "STREAM_MIN_SECONDS", 0.0)
    controller.app.config["RESPONSE_TIMEOUT"] = 60
    status, lines = await stream(controller, count=4, seconds_each=0.3)
    assert lines[-1]["kind"] == "time_budget"


async def test_a_short_request_keeps_at_least_a_minute(controller, monkeypatch):
    monkeypatch.setattr(app_module, "STREAM_SECONDS_PER_ARTICLE", 0.1)
    monkeypatch.setattr(app_module, "STREAM_MIN_SECONDS", 1.5)
    controller.app.config["RESPONSE_TIMEOUT"] = 60
    status, lines = await stream(controller, count=2, seconds_each=0.3)
    assert all("error" not in line for line in lines) and len(lines) == 2


def test_the_defaults_cover_a_request_at_the_article_ceiling():
    # 180 articles at the full allowance fit under the cap: above the ceiling (100, or 150).
    assert app_module.STREAM_MAX_SECONDS >= 180 * app_module.STREAM_SECONDS_PER_ARTICLE
