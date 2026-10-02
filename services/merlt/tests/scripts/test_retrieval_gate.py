"""The gate scores articles in their canonical form, and never passes on no data."""
import pytest
from qdrant_client import QdrantClient, models

from merlt.scripts import retrieval_gate as gate
from merlt.scripts.retrieval_gate import summarize

CC = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453"
OTHER = CC.replace("art1453", "art1454")


def test_a_versioned_urn_and_its_repetition_are_one_article():
    summary = summarize([[CC + "!vig=2020-01-01", CC]], [[CC]], [{CC: 3}])
    assert summary == {
        "queries": 1, "recall_at_5": pytest.approx(1.0), "mrr": pytest.approx(1.0),
        "hit_rate_at_5": pytest.approx(1.0), "ndcg_at_10": pytest.approx(1.0),
    }


def test_a_hit_without_an_article_takes_no_rank():
    summary = summarize([["", OTHER, CC]], [[CC]], [{CC: 3}])
    assert summary["mrr"] == pytest.approx(0.5)


def test_only_the_top_articles_are_scored():
    fillers = [f"{CC}{i}" for i in range(gate.TOP_K)]
    summary = summarize([fillers + [CC]], [[CC]], [{CC: 3}])
    assert summary["mrr"] == 0
    assert summary["ndcg_at_10"] == 0


def test_no_query_is_no_score():
    with pytest.raises(ValueError, match="no queries"):
        summarize([], [], [])


def test_a_query_without_relevant_articles_is_refused():
    # recall_at_k counts a query with nothing relevant as a perfect 1.0
    with pytest.raises(ValueError, match="relevant"):
        summarize([[CC]], [[]], [{}])


def test_a_query_without_grades_is_refused():
    with pytest.raises(ValueError, match="relevant"):
        summarize([[CC]], [[CC]], [{}])


def _qdrant(points: int) -> QdrantClient:
    client = QdrantClient(":memory:")
    client.create_collection("chunks", vectors_config=models.VectorParams(size=2, distance=models.Distance.COSINE))
    if points:
        client.upsert("chunks", points=[models.PointStruct(id=1, vector=[1, 0], payload={"article_urn": CC})])
    return client


def test_a_missing_collection_stops_the_gate():
    with pytest.raises(SystemExit, match="missing or empty"):
        gate.require_points(QdrantClient(":memory:"), "chunks")


def test_an_empty_collection_stops_the_gate():
    with pytest.raises(SystemExit, match="missing or empty"):
        gate.require_points(_qdrant(0), "chunks")


def test_a_collection_with_points_is_measured():
    assert gate.require_points(_qdrant(1), "chunks") == 1
