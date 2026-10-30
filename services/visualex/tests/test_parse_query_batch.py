"""POST /parse_query_batch: up to 200 norms read as /parse_query reads one, and no further
(design docs/superpowers/specs/2026-10-29-document-analysis-design.md §4.4, §6.2)."""
import json
from unittest.mock import AsyncMock, patch

import pytest
import structlog

import app as app_module
from app import NormaController

# Strings a brief would cite: what must never reach a log line.
CITED = ["art. 609-bis c.p.", "art. 4 St. lav.", "art. 2087 c.c."]


@pytest.fixture
def controller():
    return NormaController()


async def _post(controller, body, raw=None):
    client = controller.app.test_client()
    if raw is not None:
        response = await client.post("/parse_query_batch", data=raw, headers={"Content-Type": "application/json"})
    else:
        response = await client.post("/parse_query_batch", json=body)
    return response.status_code, await response.get_json()


@pytest.mark.asyncio
async def test_reads_each_string_in_order_as_parse_query_does(controller):
    queries = ["art. 4, n. 7, GDPR", "art. 2043 c.c.", "statuto dei lavoratori", "art. 2 d.m.", "T.U.E.", "buongiorno"]
    status, body = await _post(controller, {"queries": queries})
    assert status == 200
    results = body["results"]
    assert len(results) == len(queries)
    gdpr, code, statute, decree, ambiguous, nothing = results
    assert gdpr == {"recognized": True, "source": "nl_parser", "identifies_act": True,
                    "parsed": {"act_type": "regolamento ue", "act_number": "679", "date": "2016", "article": "4"}}
    assert code["parsed"] == {"act_type": "codice civile", "article": "2043"} and code["identifies_act"] is True
    assert statute["source"] == "alias" and statute["identifies_act"] is True
    # Read, and names no act: the browser sends it to «Da completare»
    assert decree["recognized"] is True and decree["identifies_act"] is False
    for refused in (ambiguous, nothing):
        assert refused == {"recognized": False, "parsed": None, "source": None, "identifies_act": False}


@pytest.mark.asyncio
async def test_builds_no_urn_so_no_request_leaves(controller):
    # The URN step is the one that asks Normattiva and logs the norm: the batch never takes it.
    with patch.object(controller, "create_norma_visitata_from_data", AsyncMock()) as build:
        status, body = await _post(controller, {"queries": ["art. 2 l. 241/1990"]})
    assert status == 200 and build.await_count == 0
    assert set(body["results"][0]) == {"recognized", "parsed", "source", "identifies_act"}


@pytest.mark.asyncio
async def test_reads_the_same_as_parse_query(controller):
    from visualex_api.tools.norm_query import read_norm_query

    queries = ["art. 82, par. 1, GDPR", "art. 360, primo comma, n. 3, c.p.c.", "art. 18 T.U. sicurezza", "d.lgs. 81/2008"]
    _, body = await _post(controller, {"queries": queries})
    for query, result in zip(queries, body["results"]):
        params, source = read_norm_query(query)
        assert (result["parsed"], result["source"]) == (params, source)
        with patch.object(controller, "create_norma_visitata_from_data", AsyncMock(return_value=[])):
            single = await (await controller.app.test_client().post("/parse_query", json={"query": query})).get_json()
        assert (single["parsed"], single["source"], single["identifies_act"]) == (
            result["parsed"], result["source"], result["identifies_act"])


@pytest.mark.asyncio
@pytest.mark.parametrize("body, limit", [
    ({}, "non-empty list"),
    ({"queries": []}, "non-empty list"),
    ({"queries": "art. 1 c.c."}, "non-empty list"),
    ([], "non-empty list"),
    ({"queries": ["art. 1 c.c."] * 201}, "At most 200 queries"),
    ({"queries": ["art. 1 c.c.", ""]}, "non-empty string"),
    ({"queries": ["art. 1 c.c.", "   "]}, "non-empty string"),
    ({"queries": ["art. 1 c.c.", 5]}, "non-empty string"),
    ({"queries": [None]}, "non-empty string"),
    ({"queries": ["a" * 201]}, "at most 200 characters"),
])
async def test_anything_else_is_a_400_that_names_the_limit(controller, body, limit):
    status, answer = await _post(controller, body)
    assert status == 400 and limit in answer["error"]


@pytest.mark.asyncio
async def test_the_limits_themselves_pass(controller):
    status, body = await _post(controller, {"queries": ["a" * 200] + ["art. 1 c.c."] * 199})
    assert status == 200 and len(body["results"]) == 200


@pytest.mark.asyncio
async def test_a_body_over_48_kb_is_refused_whatever_it_holds(controller):
    # 200 strings of 200 accented letters, escaped: within the counts, over the bytes
    raw = json.dumps({"queries": ["è" * 200] * 200}).encode()
    assert len(raw) > 48 * 1024
    status, answer = await _post(controller, None, raw=raw)
    assert status == 400 and "48 KB" in answer["error"]


@pytest.mark.asyncio
async def test_a_body_that_is_not_json_is_a_400(controller):
    status, answer = await _post(controller, None, raw=b"queries=art. 1 c.c.")
    assert status == 400 and "JSON" in answer["error"]


@pytest.fixture
def captured_logs(monkeypatch):
    """Every structured record the app writes during the test. structlog writes to stdout,
    which a bare `caplog` never sees, and the app caches its logger on first use: the
    module's logger is rebound inside the capture so the capture holds its records."""
    with structlog.testing.capture_logs() as records:
        monkeypatch.setattr(app_module, "log", structlog.get_logger())
        yield records


def _no_string_in(records, strings):
    dump = repr(records)
    return all(s not in dump for s in strings) and "609-bis" not in dump and "St. lav" not in dump


@pytest.mark.asyncio
async def test_the_log_holds_the_count_and_the_duration_never_a_string(controller, captured_logs):
    status, _ = await _post(controller, {"queries": CITED})
    assert status == 200
    batch = [r for r in captured_logs if r["event"] == "parse_query_batch"]
    assert len(batch) == 1
    assert batch[0]["queries"] == 3 and batch[0]["failed"] == 0 and isinstance(batch[0]["duration_ms"], int)
    assert set(batch[0]) == {"event", "log_level", "queries", "failed", "duration_ms"}
    assert _no_string_in(captured_logs, CITED)


@pytest.mark.asyncio
async def test_a_string_that_makes_the_reading_fail_is_counted_never_logged(controller, captured_logs, monkeypatch):
    real = app_module.read_norm_query

    def reading(query):
        if query == CITED[0]:
            raise ValueError(f"cannot read {query!r}")
        return real(query)

    monkeypatch.setattr(app_module, "read_norm_query", reading)
    status, body = await _post(controller, {"queries": CITED})
    assert status == 200
    assert body["results"][0] == {"recognized": False, "parsed": None, "source": None, "identifies_act": False}
    assert body["results"][1]["recognized"] is True
    assert [r["failed"] for r in captured_logs if r["event"] == "parse_query_batch"] == [1]
    assert _no_string_in(captured_logs, CITED)


@pytest.mark.asyncio
async def test_a_failure_of_the_handler_logs_the_type_only(controller, captured_logs, monkeypatch):
    def broken(queries):
        raise RuntimeError(f"broken on {queries[0]!r}")

    monkeypatch.setattr(app_module, "_read_norm_queries", broken)
    status, body = await _post(controller, {"queries": CITED})
    assert status == 500 and body == {"error": "Internal error"}
    errors = [r for r in captured_logs if r["event"] == "Error in parse_query_batch"]
    assert errors and errors[0]["error_type"] == "RuntimeError"
    assert _no_string_in(captured_logs, CITED)
