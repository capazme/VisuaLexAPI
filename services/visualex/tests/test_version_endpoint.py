"""/version reads the product version from the repository root."""
from pathlib import Path

import pytest

from app import NormaController

REPO_ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture(scope="module")
def client():
    return NormaController().app.test_client()


async def test_version_comes_from_the_repository_version_file(client):
    response = await client.get("/version")
    assert response.status_code == 200
    body = await response.get_json()
    assert body["version"] == (REPO_ROOT / "version.txt").read_text().strip()
