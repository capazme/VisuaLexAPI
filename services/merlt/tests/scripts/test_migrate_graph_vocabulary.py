"""The migration's pure parts and its vector half (Qdrant in memory)."""
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
    assert report == {"rekeyed": 2, "duplicates_dropped": 1, "retyped": {"concettogiuridico": 1}, "urns_canonicalized": 0}
    ids = {str(p.id) for p in client.scroll("chunks", limit=10)[0]}
    assert ids == {point_id(CC, "norma"), point_id(CC, "massima", 2), SEED_ID}
    assert client.retrieve("chunks", ids=[SEED_ID])[0].payload["source_type"] == "concetto"


def test_a_second_run_changes_nothing():
    client = _collection()
    mig.migrate_qdrant(client, "chunks", apply=True)
    assert mig.migrate_qdrant(client, "chunks", apply=True) == {
        "rekeyed": 0, "duplicates_dropped": 0, "retyped": {}, "urns_canonicalized": 0,
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
