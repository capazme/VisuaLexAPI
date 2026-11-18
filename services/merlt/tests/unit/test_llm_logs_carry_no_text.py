"""MERL-T's logs never carry a model's text or a provider's raw error.

A model's answer repeats the person's question and the documents it read; a provider's raw error
may echo the request. Neither belongs in the logs: they keep lengths, status codes and
OpenRouter's own short error. The exceptions raised carry the same short form, since they end up
in logs (`str(e)`) and in the fallback answer.

A marker string stands for the private text: it must not appear anywhere in what was logged.
The HTTP session is a fake: no network, no key, no database.
"""

import json

import pytest
from structlog.testing import capture_logs

from merlt.rlcf.ai_service import AIModelConfig, OpenRouterService

MARKER = "PRIVATE-TEXT-7f3a"


class _Response:
    def __init__(self, status: int, body: dict):
        self.status = status
        self._body = body

    async def json(self):
        return self._body

    async def text(self):
        return json.dumps(self._body)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class _Session:
    closed = False

    def __init__(self, status: int, body: dict):
        self.status, self.body = status, body

    def post(self, url, json=None, headers=None, timeout=None):
        return _Response(self.status, self.body)


def _service(status: int, body: dict) -> OpenRouterService:
    service = OpenRouterService()
    session = _Session(status, body)

    async def fake_session():
        return session

    service._get_session = fake_session
    return service


ANSWER_NOT_JSON = {"choices": [{"message": {"content": f"Not JSON at all: {MARKER} {MARKER}"}}], "usage": {}}
ANSWER_JSON = {"choices": [{"message": {"content": json.dumps({"answer": MARKER})}}], "usage": {}}
PROVIDER_ERROR = {
    "error": {
        "code": 400,
        "message": "Provider returned error",
        "metadata": {"raw": f"invalid request: the prompt was '{MARKER}'", "provider_name": "X"},
    }
}
NO_CHOICES = {"id": "gen-1", "echo": MARKER}


def _assert_no_marker(captured, *more) -> None:
    text = json.dumps(captured, default=str) + " ".join(str(m) for m in more)
    assert MARKER not in text


@pytest.fixture(autouse=True)
def _key(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "k")


async def test_a_json_answer_is_not_logged():
    with capture_logs() as captured:
        result = await _service(200, ANSWER_JSON).generate_json_completion(
            prompt="x", json_schema={"type": "object", "properties": {"answer": {"type": "string"}}})
    assert result == {"answer": MARKER}
    _assert_no_marker(captured)


async def test_an_answer_that_is_not_json_is_not_logged():
    with capture_logs() as captured, pytest.raises(Exception) as raised:
        await _service(200, ANSWER_NOT_JSON).generate_json_completion(
            prompt="x", json_schema={"type": "object", "properties": {"answer": {"type": "string"}}})
    _assert_no_marker(captured, raised.value)


@pytest.mark.parametrize("call", ["completion", "json", "response"])
async def test_a_provider_error_is_logged_without_its_raw_text(call):
    service = _service(400, PROVIDER_ERROR)
    with capture_logs() as captured:
        try:
            if call == "completion":
                await service.generate_completion(prompt="x", api_key="k")
            elif call == "json":
                await service.generate_json_completion(prompt="x", json_schema={"type": "object"})
            else:
                fallback = await service.generate_response("QA", {"question": "q"}, AIModelConfig(name="m", api_key="k"))
                _assert_no_marker([], fallback)
        except Exception as exc:  # noqa: BLE001
            _assert_no_marker([], exc)
    _assert_no_marker(captured)
    # What the logs keep is enough to act on: the status and OpenRouter's own short message.
    logged = json.dumps(captured, default=str)
    assert "400" in logged and "Provider returned error" in logged


async def test_an_answer_without_choices_is_logged_without_its_body():
    with capture_logs() as captured, pytest.raises(Exception) as raised:
        await _service(200, NO_CHOICES).generate_completion(prompt="x", api_key="k")
    _assert_no_marker(captured, raised.value)
