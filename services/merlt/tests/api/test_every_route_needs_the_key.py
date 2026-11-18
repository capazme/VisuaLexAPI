"""MERL-T answers only a caller with its key (scan A.2).

The only caller of MERL-T's API is the VisuaLex server, which sends ``X-API-Key``. Every route of
the app needs the key, except the health check (the containers' own probe) and the root page,
which says nothing. A stack with no key configured refuses everything: there is no open mode.
The key is not handed out by a route (the old bootstrap route gave an admin key to whoever asked
first on an empty table), and the interactive API pages are off unless MERLT_DOCS is set.

These tests read the real app's routes, so a router added later without the key fails here.
"""

import os
from types import SimpleNamespace

import pytest
from fastapi.routing import APIRoute, APIWebSocketRoute
from fastapi.testclient import TestClient

from merlt.api.auth import verify_api_key
from merlt.rlcf.database import get_async_session_dep

OPEN = {"/health", "/"}


def _app():
    from merlt.app import app

    return app


def _calls(dependant) -> list:
    """Every callable a route depends on, at any depth (require_role depends on verify_api_key)."""
    found, stack = [], [dependant]
    while stack:
        current = stack.pop()
        for sub in current.dependencies:
            found.append(sub.call)
            stack.append(sub)
    return found


def test_every_route_but_the_health_check_needs_the_key():
    unguarded = [
        route.path
        for route in _app().routes
        if isinstance(route, (APIRoute, APIWebSocketRoute))
        and route.path not in OPEN
        and verify_api_key not in _calls(route.dependant)
    ]
    assert unguarded == []


def test_the_key_is_never_made_optional():
    assert verify_api_key not in _app().dependency_overrides


def test_no_route_hands_out_a_key():
    paths = {getattr(route, "path", "") for route in _app().routes}
    assert not any(path.endswith("/api-keys/bootstrap") for path in paths)


def test_there_is_no_websocket():
    assert not [route for route in _app().routes if isinstance(route, APIWebSocketRoute)]


@pytest.mark.skipif(os.getenv("MERLT_DOCS") is not None, reason="MERLT_DOCS is set in this environment")
def test_the_api_pages_are_off_by_default():
    app = _app()
    assert app.docs_url is None and app.redoc_url is None and app.openapi_url is None


class _NoKeyInTheTable:
    """A session whose lookup finds no key: what an unknown key meets."""

    async def execute(self, *_args, **_kwargs):
        return SimpleNamespace(scalar_one_or_none=lambda: None)


@pytest.fixture
def client():
    app = _app()

    async def session():
        yield _NoKeyInTheTable()

    app.dependency_overrides[get_async_session_dep] = session
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_async_session_dep, None)


@pytest.mark.parametrize("path", [
    "/api/v1/traces",
    "/api/v1/api-keys/",
    "/api/v1/feedback/mappings",
    "/api/v1/auth/authority/u1",
    "/api/v1/profile/full?user_id=u1",
])
def test_a_request_without_a_key_is_refused(client, path):
    assert client.get(path).status_code == 401


def test_a_request_with_an_unknown_key_is_refused(client):
    assert client.get("/api/v1/api-keys/", headers={"X-API-Key": "not-a-key"}).status_code == 401
