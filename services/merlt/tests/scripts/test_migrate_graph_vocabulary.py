"""The migration's pure parts, its vector half (Qdrant in memory) and its run."""
import json

import pytest
from qdrant_client import QdrantClient, models

from merlt.scripts import migrate_graph_vocabulary as mig
from merlt.storage.graph.schema import point_id

CODE = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2"
CC = CODE + "~art2043"
SEED_ID = "5c56c793-69f3-4fbf-87e6-c4bf54c28c26"


def test_estremi_are_rewritten_only_for_codes_the_table_knows():
    rows = [
        {"id": 1, "urn": CODE + "~art1321", "estremi": "Art. 1321 codice civile"},
        {"id": 2, "urn": CODE + "~art1322", "estremi": "Art. 1322 c.c."},
        {"id": 3, "urn": "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1992-02-17;154~art11", "estremi": "Art. 11 L. 154/1992"},
    ]
    assert mig.plan_estremi(rows) == [{"id": 1, "estremi": "Art. 1321 c.c."}]


def _collection() -> QdrantClient:
    client = QdrantClient(":memory:")
    client.create_collection("chunks", vectors_config=models.VectorParams(size=4, distance=models.Distance.COSINE))
    client.upsert("chunks", points=[
        models.PointStruct(id=123456789, vector=[1, 0, 0, 0], payload={"article_urn": CC, "source_type": "norma", "text": "a"}),
        # the same article, ingested by another process: another hash() id
        models.PointStruct(id=987654321, vector=[1, 0, 0, 0], payload={"article_urn": CC, "source_type": "norma", "text": "a"}),
        models.PointStruct(id=555, vector=[0, 1, 0, 0], payload={"article_urn": CC, "source_type": "massima", "massima_index": 2, "text": "m"}),
        models.PointStruct(id=SEED_ID, vector=[0, 0, 1, 0], payload={"article_urn": "concetto:accordo", "source_type": "concettogiuridico", "text": "c"}),
    ])
    return client


def test_lazy_points_get_stable_ids_and_duplicates_go():
    client = _collection()
    report = mig.migrate_qdrant(client, "chunks", apply=True)
    assert report == {
        "rekeyed": 2, "duplicates_dropped": 1, "retyped": {"concettogiuridico": 1}, "urns_canonicalized": 0, "unkeyed": 0,
    }
    ids = {str(p.id) for p in client.scroll("chunks", limit=10)[0]}
    assert ids == {point_id(CC, "norma"), point_id(CC, "massima", 2), SEED_ID}
    assert client.retrieve("chunks", ids=[SEED_ID])[0].payload["source_type"] == "concetto"


def test_a_second_run_changes_nothing():
    client = _collection()
    mig.migrate_qdrant(client, "chunks", apply=True)
    assert mig.migrate_qdrant(client, "chunks", apply=True) == {
        "rekeyed": 0, "duplicates_dropped": 0, "retyped": {}, "urns_canonicalized": 0, "unkeyed": 0,
    }


def test_a_dry_run_reports_and_writes_nothing():
    client = _collection()
    assert mig.migrate_qdrant(client, "chunks", apply=False)["rekeyed"] == 2
    assert len(client.scroll("chunks", limit=10)[0]) == 4


def test_a_crash_between_upsert_and_delete_converges():
    # The new point was written and the old one survived: the old one is a duplicate.
    plan = mig.plan_qdrant([
        (123, {"article_urn": CC, "source_type": "norma"}),
        (point_id(CC, "norma"), {"article_urn": CC, "source_type": "norma"}),
    ])
    assert plan["rekey"] == [] and plan["drop"] == [123]


def test_a_lazy_point_without_an_article_is_reported_never_rekeyed():
    # point_id("", ...) is one id for every such point: re-keyed, all but one would be dropped.
    plan = mig.plan_qdrant([
        (11, {"source_type": "norma", "text": "a"}),
        (12, {"article_urn": "", "source_type": "norma", "text": "b"}),
    ])
    assert (plan["rekey"], plan["drop"], plan["unkeyed"]) == ([], [], [11, 12])
    client = QdrantClient(":memory:")
    client.create_collection("chunks", vectors_config=models.VectorParams(size=4, distance=models.Distance.COSINE))
    client.upsert("chunks", points=[models.PointStruct(id=11, vector=[1, 0, 0, 0], payload={"source_type": "norma"})])
    assert mig.migrate_qdrant(client, "chunks", apply=True)["unkeyed"] == 1
    assert [p.id for p in client.scroll("chunks", limit=10)[0]] == [11]


BARE = "urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043"


def test_a_bare_article_urn_is_wrapped_as_the_graph_keys_it():
    # The graph migration wraps a bare `urn:nir:` key into the Normattiva URL; a point that
    # names its article bare must name it the same way, or the bridge never meets the node.
    plan = mig.plan_qdrant([
        (SEED_ID, {"article_urn": BARE + "!vig=2020-01-01", "source_type": "norma"}),
        (321, {"article_urn": BARE, "source_type": "norma"}),
    ])
    assert plan["urn_fixes"] == [(SEED_ID, CC)]
    assert [(old, new, payload["article_urn"]) for old, new, payload in plan["rekey"]] == [(321, point_id(CC, "norma"), CC)]


# The run: the Qdrant half is checked before the graph is touched, and each half reports at once


class _Falkor:
    def __init__(self):
        self.connected = False

    async def connect(self):
        self.connected = True

    async def close(self):
        pass


class _Qdrant:
    def __init__(self, exists=True):
        self.exists = exists

    def collection_exists(self, collection_name):
        return self.exists


def _stub_run(monkeypatch, tmp_path, qdrant):
    import merlt.scripts.load_seed_libro_iv as seed

    seed_file = tmp_path / "seed.json"
    seed_file.write_text('{"nodes": []}', encoding="utf-8")
    monkeypatch.setattr(seed, "SEED_GRAPH_JSON", seed_file)
    falkor = _Falkor()
    calls = []

    async def migrate_graph(client, **kwargs):
        calls.append("graph")
        return {"relations": {"cita": 1}}

    async def ensure_graph_indexes(client, apply):
        return 0

    async def integrity_report(client):
        return {"isolated_nodes": 0}

    monkeypatch.setattr(mig, "FalkorDBClient", lambda: falkor)
    monkeypatch.setattr(mig, "_qdrant_client", lambda: qdrant)
    monkeypatch.setattr(mig, "migrate_graph", migrate_graph)
    monkeypatch.setattr(mig, "ensure_graph_indexes", ensure_graph_indexes)
    monkeypatch.setattr(mig, "integrity_report", integrity_report)
    monkeypatch.setattr(mig, "ensure_payload_indexes", lambda client, collection, apply: [])
    return falkor, calls


async def test_a_missing_collection_stops_the_run_before_the_graph_is_touched(monkeypatch, tmp_path):
    falkor, calls = _stub_run(monkeypatch, tmp_path, _Qdrant(exists=False))
    with pytest.raises(SystemExit, match="collection"):
        await mig._run(apply=True, batch=10)
    assert calls == [] and falkor.connected is False


async def test_the_graph_report_survives_a_failure_of_the_vector_half(monkeypatch, tmp_path, capsys):
    _, calls = _stub_run(monkeypatch, tmp_path, _Qdrant())

    def broken(client, collection, *, apply, batch=256):
        raise RuntimeError("qdrant went away")

    monkeypatch.setattr(mig, "migrate_qdrant", broken)
    with pytest.raises(RuntimeError):
        await mig._run(apply=True, batch=10)
    assert calls == ["graph"]
    lines = [json.loads(line) for line in capsys.readouterr().err.splitlines() if line.startswith("{")]
    assert lines == [{
        "half": "graph", "applied": True, "graph": {"relations": {"cita": 1}},
        "indexes": 0, "integrity": {"isolated_nodes": 0},
    }]


async def test_each_half_reports_on_stderr_and_the_whole_on_stdout(monkeypatch, tmp_path, capsys):
    _stub_run(monkeypatch, tmp_path, _Qdrant())
    monkeypatch.setattr(mig, "migrate_qdrant", lambda client, collection, *, apply, batch=256: {"rekeyed": 0})
    report = await mig._run(apply=False, batch=10)
    halves = [json.loads(line) for line in capsys.readouterr().err.splitlines() if line.startswith("{")]
    assert [half["half"] for half in halves] == ["graph", "vectors"]
    assert halves[1] == {"half": "vectors", "applied": False, "vectors": {"rekeyed": 0}, "indexes": []}
    assert report["graph"] == halves[0]["graph"] and report["vectors"] == halves[1]["vectors"]
