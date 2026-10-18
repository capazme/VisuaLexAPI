"""The erasure in a real FalkorDB graph: contributors and vouchers stop being
named, the content stays, a vouched source keeps its protection from the
hygiene sweep. Needs a disposable FalkorDB (CI's integration step).

    FALKORDB_HOST=… FALKORDB_PORT=… python -m pytest tests/privacy/test_user_data_graph.py -m integration -q
"""

from __future__ import annotations

import pytest
import pytest_asyncio

from merlt.privacy.user_data import _erase_graph
from merlt.storage.graph.client import FalkorDBClient

pytestmark = pytest.mark.integration

TEST_GRAPH = "merlt_test_user_data_erasure"


@pytest_asyncio.fixture
async def graph():
    client = FalkorDBClient(graph_name=TEST_GRAPH)
    await client.connect()
    await client.query("MATCH (n) DETACH DELETE n", {})
    yield client
    try:
        await client.query("MATCH (n) DETACH DELETE n", {})
    finally:
        await client.close()


async def test_the_graph_forgets_the_person_and_keeps_the_content(graph):
    await graph.query(
        "CREATE (a:Entity {node_id: 'a', nome: 'concetto', contributed_by: 'me', contributor_authority: 0.8})"
        "-[:RELATED {contributed_by: 'me'}]->"
        "(b:Entity {node_id: 'b', contributed_by: 'other'}), "
        "(s:LiveSource {node_id: 's', confirmed_by: ['me', 'other']}), "
        "(t:LiveSource {node_id: 't', confirmed_by: ['me']})",
        {},
    )
    counts: dict = {}
    await _erase_graph("me", counts, graph_client=graph)

    rows = await graph.query(
        "MATCH (n) RETURN n.node_id AS id, n.contributed_by AS by, n.contributor_authority AS auth, "
        "n.confirmed_by AS vouched, n.nome AS nome ORDER BY id",
        {},
    )
    by_id = {r["id"]: r for r in rows}
    assert by_id["a"]["by"] == "" and by_id["a"]["auth"] == 0.0 and by_id["a"]["nome"] == "concetto"
    assert by_id["b"]["by"] == "other"
    assert by_id["s"]["vouched"][0] == "other" and by_id["s"]["vouched"][1].startswith("erased:")
    # A source only I vouched for keeps one entry, naming nobody: the sweep still spares it.
    assert len(by_id["t"]["vouched"]) == 1 and by_id["t"]["vouched"][0].startswith("erased:")
    rel = await graph.query("MATCH ()-[r:RELATED]->() RETURN r.contributed_by AS by", {})
    assert rel[0]["by"] == ""
    assert counts["graph.contributed_by"] == {"detached": 2}
    assert counts["graph.confirmed_by"] == {"detached": 2}
    # Nothing still names me.
    left = await graph.query(
        "MATCH (n) WHERE n.contributed_by = 'me' OR 'me' IN coalesce(n.confirmed_by, []) RETURN count(n) AS c", {}
    )
    assert left[0]["c"] == 0
