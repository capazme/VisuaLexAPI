"""An article retrieved through several chunks counts once."""
import pytest

from merlt.benchmark.metrics import (
    compute_graded_relevance_metrics,
    compute_retrieval_metrics,
    distinct_in_order,
)

A, B, C = "urn:a", "urn:b", "urn:c"


def test_distinct_in_order_keeps_the_first_occurrence():
    assert distinct_in_order([A, A, B, A, C]) == [A, B, C]


def test_ndcg_never_exceeds_one():
    metrics = compute_graded_relevance_metrics([[A, A, A, B]], [{A: 3, B: 2}])
    assert metrics.ndcg_at_5 == pytest.approx(1.0)
    assert metrics.ndcg_at_10 == pytest.approx(1.0)


def test_a_repeated_article_does_not_push_another_out_of_the_top_five():
    metrics = compute_retrieval_metrics([[A, A, A, A, A, B]], [[A, B]])
    assert metrics.recall_at_5 == pytest.approx(1.0)
