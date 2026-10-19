"""An article retrieved through several chunks counts once."""
import math

import pytest

from merlt.benchmark.metrics import (
    compute_graded_relevance_metrics,
    compute_retrieval_metrics,
    distinct_in_order,
    hit_rate,
    mrr,
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


def test_mrr_and_hit_rate_see_the_rank_of_the_article_not_of_the_chunk():
    # Chunks of A fill the top ranks; the relevant B is the 2nd article.
    retrieved = [[A, A, A, B]]
    relevant = [[B]]
    metrics = compute_retrieval_metrics(retrieved, relevant)
    assert metrics.mrr == pytest.approx(0.5)
    assert metrics.recall_at_1 == pytest.approx(0.0)
    assert metrics.hit_rate_at_5 == pytest.approx(1.0)
    # The plain functions score what they are given: the aggregates deduplicate.
    assert mrr(retrieved, relevant) == pytest.approx(0.25)


def test_hit_rate_is_not_lost_when_chunks_fill_the_first_five():
    metrics = compute_retrieval_metrics([[A, A, A, A, A, B]], [[B]])
    assert metrics.hit_rate_at_5 == pytest.approx(1.0)
    assert hit_rate([[A, A, A, A, A, B]], [[B]], k=5) == pytest.approx(0.0)


def test_the_graded_vote_still_counts():
    # The better article (A: 3) comes second, so the order is penalised.
    metrics = compute_graded_relevance_metrics([[B, B, A]], [{A: 3, B: 2}])
    # [B, A] against the ideal [A, B]: (3 + 7/log2(3)) / (7 + 3/log2(3)).
    expected = (3 + 7 / math.log2(3)) / (7 + 3 / math.log2(3))
    assert metrics.ndcg_at_5 < 1.0
    assert metrics.ndcg_at_5 == pytest.approx(expected)


def test_empty_inputs():
    plain = compute_retrieval_metrics([], [])
    assert plain.num_queries == 0
    assert plain.recall_at_5 == 0.0
    graded = compute_graded_relevance_metrics([], [])
    assert graded.num_queries == 0
    assert graded.ndcg_at_5 == 0.0
    assert distinct_in_order([]) == []
    assert compute_retrieval_metrics([[]], [[A]]).recall_at_5 == 0.0


def test_by_category_deduplicates_too():
    retrieved = [[A, A, A, A, A, B], [C, C, C, C, C, A]]
    relevant = [[A, B], [C, A]]
    metrics = compute_retrieval_metrics(retrieved, relevant, categories=["x", "y"])
    assert metrics.by_category["x"].recall_at_5 == pytest.approx(1.0)
    assert metrics.by_category["y"].recall_at_5 == pytest.approx(1.0)

    graded = compute_graded_relevance_metrics(
        [[A, A, A, B], [C, C, A]],
        [{A: 3, B: 2}, {C: 3, A: 2}],
        categories=["x", "y"],
    )
    assert graded.by_category["x"].ndcg_at_5 == pytest.approx(1.0)
    assert graded.by_category["y"].ndcg_at_5 == pytest.approx(1.0)
