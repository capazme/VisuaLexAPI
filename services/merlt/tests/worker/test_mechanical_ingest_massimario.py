# services/merlt/tests/worker/test_mechanical_ingest_massimario.py
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from merlt.pipeline.massimario.report import add_graph_counts
from merlt.worker import mechanical_ingest_tasks as tasks


class FakeSession:
    def __init__(self, batch):
        self.batch = batch

    async def execute(self, _statement):
        return SimpleNamespace(scalar_one_or_none=lambda: self.batch)

    async def commit(self):
        pass


def fake_batch():
    return SimpleNamespace(
        id="b1", source="massimario", source_ref='{"volume": 9001}', status="parsing",
        nodes=None, edges=None, extras=None, conflict_report=None, stats=None, error=None,
    )


async def test_massimario_batch_keeps_its_report_and_extras():
    batch = fake_batch()

    @asynccontextmanager
    async def session():
        yield FakeSession(batch)

    report = {"urn_conflicts": [], "stats": {"nodes_total": 1}, "massimario": {}}
    parsed = {"nodes": [{"id": "x", "labels": ["Norma"], "properties": {}}], "edges": [],
              "extras": {"chunks": [{"point_id": "p"}]}, "report": report}
    adapter = SimpleNamespace(parse=AsyncMock(return_value=parsed))
    graph = MagicMock(connect=AsyncMock(), close=AsyncMock())
    with patch("merlt.storage.enrichment.database.init_db", new=AsyncMock()), \
         patch("merlt.storage.enrichment.database.get_db_session", new=session), \
         patch("merlt.pipeline.mechanical_ingestion.parser.get_adapter", return_value=adapter), \
         patch("merlt.storage.graph.client.FalkorDBClient", return_value=graph), \
         patch("merlt.pipeline.massimario.report.add_graph_counts", new=AsyncMock()) as counts, \
         patch("merlt.pipeline.mechanical_ingestion.conflict_report.build_conflict_report", new=AsyncMock()) as generic:
        result = await tasks._run_parse_and_stage("b1")
    assert result["status"] == "pending_review"
    assert batch.extras == {"chunks": [{"point_id": "p"}]}
    assert batch.conflict_report is report and batch.stats == report["stats"]
    counts.assert_awaited_once()
    generic.assert_not_awaited()


async def test_add_graph_counts():
    graph = MagicMock(query=AsyncMock(side_effect=[[{"c": 1}], [{"c": 2}]]))
    nodes = [{"id": "u1", "labels": ["Norma"]}, {"id": "u2", "labels": ["Norma"]},
             {"id": "k1", "labels": ["AttoGiudiziario"]}, {"id": "k2", "labels": ["AttoGiudiziario"]}]
    report = {"stats": {"nodes_total": 4}, "massimario": {"norme": {}, "pronunce": {}}}
    await add_graph_counts(graph, nodes, report)
    assert report["massimario"]["norme"]["gia_nel_grafo"] == 1
    assert report["massimario"]["pronunce"]["gia_nel_grafo"] == 2
    assert (report["stats"]["nodes_update"], report["stats"]["nodes_new"]) == (3, 1)
