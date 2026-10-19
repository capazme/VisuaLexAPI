# services/merlt/tests/api/test_rassegne_router.py
from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from merlt.api.auth import verify_api_key
from merlt.api.rassegne_router import get_rassegne_reader, router


def client(reader):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[verify_api_key] = lambda: None
    app.dependency_overrides[get_rassegne_reader] = lambda: reader
    return TestClient(app)


def test_passes_the_query_through():
    reader = AsyncMock()
    reader.by_norma.return_value = {"total": 0}
    response = client(reader).get("/api/v1/rassegne/by-norma",
                                  params={"urn": "urn:nir:x", "anno": 2024, "archivio": "penale", "cursor": "20"})
    assert response.status_code == 200
    reader.by_norma.assert_awaited_once_with("urn:nir:x", anno=2024, archivio="penale", offset=20, limit=10)


def test_validates_the_query():
    c = client(AsyncMock())
    assert c.get("/api/v1/rassegne/by-norma").status_code == 422
    assert c.get("/api/v1/rassegne/by-norma", params={"urn": "u", "archivio": "misto"}).status_code == 422
    assert c.get("/api/v1/rassegne/by-norma", params={"urn": "u", "cursor": "-1"}).status_code == 422


def test_store_failure_is_503():
    reader = AsyncMock()
    reader.by_norma.side_effect = RuntimeError("qdrant down")
    response = client(reader).get("/api/v1/rassegne/by-norma", params={"urn": "u"})
    assert response.status_code == 503 and response.json() == {"detail": "rassegne_unavailable"}
