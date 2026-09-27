"""Backup → wipe → restore → restart → verify, on a throwaway stack.

Needs Docker: run with DATAKIT_DOCKER_TESTS=1. The stack is
'datakit-selftest' on its own ports; the development stack is not touched.
"""
import json
import os
import subprocess
import urllib.request

import pytest

from datakit import cli
from datakit.target import REPO_ROOT

pytestmark = pytest.mark.skipif(
    os.environ.get("DATAKIT_DOCKER_TESTS") != "1", reason="needs Docker: set DATAKIT_DOCKER_TESTS=1"
)

STACK = "datakit-selftest"
PORTS = {
    "VISUALEX_PG_PORT": "55436", "VISUALEX_REDIS_PORT": "56381", "VISUALEX_FALKOR_PORT": "56382",
    "VISUALEX_QDRANT_PORT": "56343", "VISUALEX_QDRANT_GRPC_PORT": "56344",
}
COMPOSE = ["docker", "compose", "-f", str(REPO_ROOT / "infra" / "compose.yml"), "-p", STACK]
STORES = ["postgres", "falkordb", "qdrant"]
QDRANT = f"http://127.0.0.1:{PORTS['VISUALEX_QDRANT_PORT']}"
TARGET = ["--stack", STACK, "--volumes", "merlt_uploads"]


def sh(*args):
    return subprocess.run(list(args), check=True, capture_output=True, text=True).stdout


def qdrant(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(QDRANT + path, data=data, method=method,
                                     headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read())


@pytest.fixture(scope="module")
def stack():
    assert STACK != "visualex"
    saved = dict(os.environ)
    os.environ.update(PORTS, VISUALEX_STACK=STACK)
    sh(*COMPOSE, "up", "-d", "--wait", *STORES)
    try:
        yield
    finally:
        subprocess.run([*COMPOSE, "down", "-v"], check=False, capture_output=True)
        subprocess.run(["docker", "volume", "rm", "-f", f"{STACK}_merlt_uploads"], check=False, capture_output=True)
        os.environ.clear()
        os.environ.update(saved)


def seed():
    for db in ("visualex_platform", "merlt"):
        sh("docker", "exec", f"{STACK}-postgres", "psql", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1",
           "-c", "CREATE TABLE notes (id int primary key, body text); INSERT INTO notes VALUES (1,'a'),(2,'b'),(3,'c');")
    sh("docker", "exec", f"{STACK}-falkordb", "redis-cli", "GRAPH.QUERY", "g", "CREATE (:A {x:1})-[:R]->(:B {x:2})")
    qdrant("PUT", "/collections/c", {"vectors": {"size": 4, "distance": "Cosine"}})
    qdrant("PUT", "/collections/c/points?wait=true",
           {"points": [{"id": i, "vector": [0.1 * i, 0.2, 0.3, 0.4]} for i in (1, 2, 3)]})
    sh("docker", "volume", "create", "--label", f"com.docker.compose.project={STACK}",
       "--label", "com.docker.compose.volume=merlt_uploads", f"{STACK}_merlt_uploads")
    sh("docker", "run", "--rm", "-v", f"{STACK}_merlt_uploads:/v", "alpine:3.20",
       "sh", "-c", "echo note > /v/a.txt && mkdir /v/d && echo n > /v/d/b.txt")


def wipe():
    sh(*COMPOSE, "down", "-v")
    subprocess.run(["docker", "volume", "rm", "-f", f"{STACK}_merlt_uploads"], check=False, capture_output=True)
    sh(*COMPOSE, "up", "-d", "--wait", *STORES)


def test_backup_restore_roundtrip(stack, tmp_path):
    seed()
    out = tmp_path / "backup"
    assert cli.main(["backup", *TARGET, "--out", str(out)]) == 0
    stores = json.loads((out / "manifest.json").read_text())["stores"]
    assert stores["postgres"]["counts"] == {"visualex_platform": {"notes": 3}, "merlt": {"notes": 3}}
    assert stores["falkordb"]["counts"] == {"g": {"nodes": 2, "edges": 1}}
    assert stores["qdrant"]["counts"] == {"c": 3}
    assert stores["volumes"]["counts"] == {"merlt_uploads": 2}

    wipe()
    assert cli.main(["restore", str(out), *TARGET]) == 0

    # The AOF trap: a plain restart must bring the graph back, not an empty one.
    sh(*COMPOSE, "restart", "falkordb")
    sh(*COMPOSE, "up", "-d", "--wait", "falkordb")
    assert cli.main(["verify", str(out), *TARGET]) == 0

    # Restoring over stores that now hold data must refuse.
    with pytest.raises(RuntimeError, match="not empty|exists"):
        cli.main(["restore", str(out), *TARGET])
