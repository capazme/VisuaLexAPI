"""Every call to the language models goes out with the owner's rule (G-456): only providers that
neither train on the text nor keep it, asked on each request.

OpenRouter routes a request to one of a model's providers. ``provider.data_collection: "deny"``
leaves out the endpoints that train on the data, and ``provider.zdr: true`` the ones that keep it;
when no endpoint of the model qualifies, the request fails rather than falling back. The model is
chosen at run time (the admin's configuration, the parsing model, the experts' own), so the rule
rides on every request, whatever the model.

The HTTP session is a fake: no network, no key, no database.
"""

import json

import pytest

from merlt.rlcf.ai_service import AIModelConfig, OpenRouterService

RULE = {"data_collection": "deny", "zdr": True}


class _FakeResponse:
    status = 200

    def __init__(self, content: str):
        self._body = {"choices": [{"message": {"content": content}}], "usage": {}}

    async def json(self):
        return self._body

    async def text(self):
        return json.dumps(self._body)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class _FakeSession:
    closed = False

    def __init__(self, content: str):
        self.content = content
        self.calls: list[dict] = []

    def post(self, url, json=None, headers=None, timeout=None):
        self.calls.append({"url": url, "json": json, "headers": headers})
        return _FakeResponse(self.content)


def _service(content: str = '{"answer": "ok"}') -> tuple[OpenRouterService, _FakeSession]:
    service = OpenRouterService()
    session = _FakeSession(content)

    async def fake_session():
        return session

    service._get_session = fake_session
    return service, session


async def _every_call(service: OpenRouterService, model: str) -> None:
    await service.generate_completion(prompt="Che cosa dice l'art. 2043 c.c.?", model=model, api_key="k")
    await service.generate_response_async(prompt="Riassumi", model=model)
    await service.generate_json_completion(
        prompt="Estrai", json_schema={"type": "object", "properties": {"answer": {"type": "string"}}},
        model=model, api_key="k")
    await service.generate_response(
        "QA", {"question": "Che cos'è la colpa?", "context": "art. 43 c.p."},
        AIModelConfig(name=model, api_key="k"))


@pytest.fixture(autouse=True)
def _key(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "k")


@pytest.mark.parametrize("model", ["google/gemini-2.5-flash", "anthropic/claude-sonnet-4.5", "any/model-set-by-the-admin"])
async def test_every_call_denies_training_and_retention_whatever_the_model(model):
    service, session = _service()
    await _every_call(service, model)
    assert len(session.calls) == 4
    for call in session.calls:
        assert call["url"].endswith("/chat/completions")
        assert call["json"]["model"] == model
        assert call["json"]["provider"] == RULE


async def test_a_structured_answer_keeps_the_rule():
    service, session = _service()
    await service.generate_completion(prompt="x", api_key="k", response_format={"type": "json_object"})
    assert session.calls[0]["json"]["response_format"] == {"type": "json_object"}
    assert session.calls[0]["json"]["provider"] == RULE


async def test_one_request_cannot_loosen_the_next():
    service, session = _service()
    await service.generate_completion(prompt="x", api_key="k")
    session.calls[0]["json"]["provider"]["zdr"] = False
    session.calls[0]["json"]["provider"]["data_collection"] = "allow"
    await service.generate_completion(prompt="y", api_key="k")
    assert session.calls[1]["json"]["provider"] == RULE


async def test_the_requests_say_they_come_from_visualex():
    service, session = _service()
    await _every_call(service, "google/gemini-2.5-flash")
    for call in session.calls:
        headers = call["headers"]
        assert headers["HTTP-Referer"] == "https://visualex.org"
        assert headers["X-OpenRouter-Title"] == "VisuaLex"
        assert "rlcf-framework" not in json.dumps(headers)
