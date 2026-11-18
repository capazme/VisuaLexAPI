"""uvicorn's access log keeps method, path and status, never a query string: a search a person
typed (`?q=...`) stays out of MERL-T's logs."""

import logging

import pytest

from merlt.api.access_log import ACCESS_LOGGER, NoQueryInAccessLog, install

MARKER = "PRIVATE-SEARCH-91c2"


def _access_record(path: str) -> logging.LogRecord:
    # The record uvicorn's protocol writes for each request.
    return logging.LogRecord(
        name=ACCESS_LOGGER, level=logging.INFO, pathname=__file__, lineno=0,
        msg='%s - "%s %s HTTP/%s" %d', args=("10.0.0.2:51000", "GET", path, "1.1", 200), exc_info=None,
    )


def test_the_query_string_is_dropped_and_the_rest_kept():
    record = _access_record(f"/api/v1/graph/entities/search?q={MARKER}&limit=10")
    assert NoQueryInAccessLog().filter(record) is True
    line = record.getMessage()
    assert MARKER not in line
    assert line == '10.0.0.2:51000 - "GET /api/v1/graph/entities/search HTTP/1.1" 200'


def test_a_path_without_a_query_is_untouched():
    record = _access_record("/health")
    NoQueryInAccessLog().filter(record)
    assert record.getMessage() == '10.0.0.2:51000 - "GET /health HTTP/1.1" 200'


def test_install_adds_the_filter_once():
    name = "test.access.once"
    install(name)
    install(name)
    assert sum(isinstance(f, NoQueryInAccessLog) for f in logging.getLogger(name).filters) == 1


def test_the_app_installs_it():
    pytest.importorskip("merlt.app", reason="needs the whole MERL-T environment (CI)")
    assert any(isinstance(f, NoQueryInAccessLog) for f in logging.getLogger(ACCESS_LOGGER).filters)
