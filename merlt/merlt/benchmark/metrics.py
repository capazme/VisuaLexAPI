"""
Metriche di Information Retrieval per RAG Benchmark
====================================================

Implementa metriche standard per valutare la qualità del retrieval:
- Recall@K: Percentuale di documenti rilevanti trovati nei top-K
- MRR: Mean Reciprocal Rank
- Hit Rate: Percentuale di query con almeno un risultato rilevante
- NDCG: Normalized Discounted Cumulative Gain

Uso:
    >>> from merlt.benchmark.metrics import recall_at_k, mrr, hit_rate
    >>>
    >>> retrieved = ["doc1", "doc2", "doc3"]
    >>> relevant = ["doc2", "doc4"]
    >>>
    >>> print(recall_at_k(retrieved, relevant, k=3))  # 0.5
    >>> print(mrr([retrieved], [relevant]))  # 0.5
"""

from typing import List, Set, Union, Dict, Any, Optional
from dataclasses import dataclass, field
import statistics


@dataclass
class RetrievalMetrics:
    """
    Risultati aggregati di un benchmark di retrieval.

    Attributes:
        recall_at_1: Recall con k=1
        recall_at_5: Recall con k=5
        recall_at_10: Recall con k=10
        mrr: Mean Reciprocal Rank
        hit_rate_at_5: Percentuale query con hit nei top-5
        num_queries: Numero totale di query valutate
        by_category: Metriche disaggregate per categoria query
    """
    recall_at_1: float
    recall_at_5: float
    recall_at_10: float
    mrr: float
    hit_rate_at_5: float
    num_queries: int
    by_category: Dict[str, "RetrievalMetrics"] = None

    def to_dict(self) -> Dict[str, Any]:
        """Converte in dizionario per serializzazione JSON."""
        result = {
            "recall_at_1": round(self.recall_at_1, 4),
            "recall_at_5": round(self.recall_at_5, 4),
            "recall_at_10": round(self.recall_at_10, 4),
            "mrr": round(self.mrr, 4),
            "hit_rate_at_5": round(self.hit_rate_at_5, 4),
            "num_queries": self.num_queries,
        }
        if self.by_category:
            result["by_category"] = {
                cat: metrics.to_dict()
                for cat, metrics in self.by_category.items()
            }
        return result


@dataclass
class GradedRelevanceMetrics:
    """
    Risultati di un benchmark con valutazione graduata (0-3).

    Questa metrica è più appropriata per similarity search rispetto
    al Recall binario, perché riconosce gradi di rilevanza.

    Attributes:
        mean_relevance_at_k: Score medio di rilevanza nei top-K (0-3)
        ndcg_at_k: Normalized DCG con gradi di rilevanza
        queries_with_score_3: % query con almeno un risultato score=3
        queries_with_score_2_plus: % query con almeno un risultato score>=2
        num_queries: Numero totale di query valutate
        by_category: Metriche disaggregate per categoria
    """
    mean_relevance_at_5: float
    mean_relevance_at_10: float
    ndcg_at_5: float
    ndcg_at_10: float
    queries_with_score_3: float  # % query con almeno un risultato perfetto
    queries_with_score_2_plus: float  # % query con almeno un buon risultato
    num_queries: int
    by_category: Optional[Dict[str, "GradedRelevanceMetrics"]] = None

    def to_dict(self) -> Dict[str, Any]:
        """Converte in dizionario per serializzazione JSON."""
        result = {
            "mean_relevance_at_5": round(self.mean_relevance_at_5, 4),
            "mean_relevance_at_10": round(self.mean_relevance_at_10, 4),
            "ndcg_at_5": round(self.ndcg_at_5, 4),
            "ndcg_at_10": round(self.ndcg_at_10, 4),
            "queries_with_score_3": round(self.queries_with_score_3, 4),
            "queries_with_score_2_plus": round(self.queries_with_score_2_plus, 4),
            "num_queries": self.num_queries,
        }
        if self.by_category:
            result["by_category"] = {
                cat: metrics.to_dict()
                for cat, metrics in self.by_category.items()
            }
        return result


@dataclass
class LatencyMetrics:
    """
    Risultati di un benchmark di latenza.

    Attributes:
        operation: Nome dell'operazione misurata
        num_samples: Numero di campioni
        min_ms: Latenza minima in millisecondi
        max_ms: Latenza massima in millisecondi
        mean_ms: Latenza media in millisecondi
        median_ms: Latenza mediana (p50)
        p90_ms: 90° percentile
        p99_ms: 99° percentile
    """
    operation: str
    num_samples: int
    min_ms: float
    max_ms: float
    mean_ms: float
    median_ms: float
    p90_ms: float
    p99_ms: float

    def to_dict(self) -> Dict[str, Any]:
        """Converte in dizionario per serializzazione JSON."""
        return {
            "operation": self.operation,
            "num_samples": self.num_samples,
            "min_ms": round(self.min_ms, 3),
            "max_ms": round(self.max_ms, 3),
            "mean_ms": round(self.mean_ms, 3),
            "median_ms": round(self.median_ms, 3),
            "p90_ms": round(self.p90_ms, 3),
            "p99_ms": round(self.p99_ms, 3),
        }


def recall_at_k(
    retrieved: List[str],
    relevant: Union[List[str], Set[str]],
    k: int
) -> float:
    """
    Calcola Recall@K.

    Recall@K = |{documenti rilevanti nei top-K}| / |{tutti i documenti rilevanti}|

    Args:
        retrieved: Lista ordinata di ID documenti recuperati
        relevant: Set di ID documenti rilevanti (ground truth)
        k: Numero di risultati da considerare

    Returns:
        Recall score in [0, 1]

    Example:
        >>> recall_at_k(["a", "b", "c"], ["b", "d"], k=3)
        0.5  # 1 rilevante trovato su 2 totali
    """
    if not relevant:
        return 1.0  # Se non ci sono rilevanti, recall è 1 per convenzione

    relevant_set = set(relevant)
    retrieved_at_k = set(retrieved[:k])

    hits = len(retrieved_at_k & relevant_set)
    return hits / len(relevant_set)


def precision_at_k(
    retrieved: List[str],
    relevant: Union[List[str], Set[str]],
    k: int
) -> float:
    """
    Calcola Precision@K.

    Precision@K = |{documenti rilevanti nei top-K}| / K

    Args:
        retrieved: Lista ordinata di ID documenti recuperati
        relevant: Set di ID documenti rilevanti (ground truth)
        k: Numero di risultati da considerare

    Returns:
        Precision score in [0, 1]
    """
    if k == 0:
        return 0.0

    relevant_set = set(relevant)
    retrieved_at_k = set(retrieved[:k])

    hits = len(retrieved_at_k & relevant_set)
    return hits / k


def hit_at_k(
    retrieved: List[str],
    relevant: Union[List[str], Set[str]],
    k: int
) -> bool:
    """
    Verifica se c'è almeno un documento rilevante nei top-K.

    Args:
        retrieved: Lista ordinata di ID documenti recuperati
        relevant: Set di ID documenti rilevanti (ground truth)
        k: Numero di risultati da considerare

    Returns:
        True se almeno un rilevante è nei top-K
    """
    relevant_set = set(relevant)
    retrieved_at_k = set(retrieved[:k])
    return len(retrieved_at_k & relevant_set) > 0


def reciprocal_rank(
    retrieved: List[str],
    relevant: Union[List[str], Set[str]]
) -> float:
    """
    Calcola Reciprocal Rank per una singola query.

    RR = 1 / (posizione del primo documento rilevante)

    Args:
        retrieved: Lista ordinata di ID documenti recuperati
        relevant: Set di ID documenti rilevanti (ground truth)

    Returns:
        RR score in [0, 1], 0 se nessun rilevante trovato

    Example:
        >>> reciprocal_rank(["a", "b", "c"], ["b"])
        0.5  # Primo rilevante in posizione 2 → 1/2
    """
    relevant_set = set(relevant)

    for i, doc in enumerate(retrieved, start=1):
        if doc in relevant_set:
            return 1.0 / i

    return 0.0


def mrr(
    all_retrieved: List[List[str]],
    all_relevant: List[Union[List[str], Set[str]]]
) -> float:
    """
    Calcola Mean Reciprocal Rank su multiple query.

    MRR = (1/N) * sum(RR_i)

    Args:
        all_retrieved: Lista di risultati per ogni query
        all_relevant: Lista di ground truth per ogni query

    Returns:
        MRR score in [0, 1]

    Example:
        >>> mrr(
        ...     [["a", "b"], ["x", "y", "z"]],
        ...     [["b"], ["z"]]
        ... )
        0.417  # (0.5 + 0.333) / 2
    """
    if not all_retrieved:
        return 0.0

    rr_scores = [
        reciprocal_rank(retrieved, relevant)
        for retrieved, relevant in zip(all_retrieved, all_relevant)
    ]

    return statistics.mean(rr_scores)


def hit_rate(
    all_retrieved: List[List[str]],
    all_relevant: List[Union[List[str], Set[str]]],
    k: int
) -> float:
    """
    Calcola Hit Rate@K (percentuale di query con almeno un hit).

    Args:
        all_retrieved: Lista di risultati per ogni query
        all_relevant: Lista di ground truth per ogni query
        k: Numero di risultati da considerare

    Returns:
        Hit rate in [0, 1]
    """
    if not all_retrieved:
        return 0.0

    hits = sum(
        1 for retrieved, relevant in zip(all_retrieved, all_relevant)
        if hit_at_k(retrieved, relevant, k)
    )

    return hits / len(all_retrieved)


def dcg_at_k(relevance_scores: List[float], k: int) -> float:
    """
    Calcola Discounted Cumulative Gain@K.

    DCG@K = sum_{i=1}^{K} (2^rel_i - 1) / log2(i + 1)

    Args:
        relevance_scores: Lista di score di rilevanza (es. [3, 2, 0, 1])
        k: Numero di risultati da considerare

    Returns:
        DCG score
    """
    import math

    dcg = 0.0
    for i, rel in enumerate(relevance_scores[:k], start=1):
        dcg += (2 ** rel - 1) / math.log2(i + 1)

    return dcg


def ndcg_at_k(
    retrieved_relevance: List[float],
    ideal_relevance: List[float],
    k: int
) -> float:
    """
    Calcola Normalized DCG@K.

    NDCG@K = DCG@K / IDCG@K

    Args:
        retrieved_relevance: Score di rilevanza nell'ordine recuperato
        ideal_relevance: Score di rilevanza nell'ordine ideale (decrescente)
        k: Numero di risultati da considerare

    Returns:
        NDCG score in [0, 1]
    """
    dcg = dcg_at_k(retrieved_relevance, k)
    idcg = dcg_at_k(sorted(ideal_relevance, reverse=True), k)

    if idcg == 0:
        return 0.0

    return dcg / idcg


def compute_latency_metrics(
    latencies_ms: List[float],
    operation: str
) -> LatencyMetrics:
    """
    Calcola metriche di latenza da una lista di misurazioni.

    Args:
        latencies_ms: Lista di latenze in millisecondi
        operation: Nome dell'operazione misurata

    Returns:
        LatencyMetrics con statistiche aggregate
    """
    if not latencies_ms:
        return LatencyMetrics(
            operation=operation,
            num_samples=0,
            min_ms=0, max_ms=0, mean_ms=0,
            median_ms=0, p90_ms=0, p99_ms=0
        )

    sorted_latencies = sorted(latencies_ms)
    n = len(sorted_latencies)

    # Calcola percentili
    p90_idx = int(n * 0.90)
    p99_idx = int(n * 0.99)

    return LatencyMetrics(
        operation=operation,
        num_samples=n,
        min_ms=min(sorted_latencies),
        max_ms=max(sorted_latencies),
        mean_ms=statistics.mean(sorted_latencies),
        median_ms=statistics.median(sorted_latencies),
        p90_ms=sorted_latencies[min(p90_idx, n - 1)],
        p99_ms=sorted_latencies[min(p99_idx, n - 1)],
    )


def compute_retrieval_metrics(
    all_retrieved: List[List[str]],
    all_relevant: List[Union[List[str], Set[str]]],
    categories: List[str] = None
) -> RetrievalMetrics:
    """
    Calcola tutte le metriche di retrieval aggregate.

    Args:
        all_retrieved: Lista di risultati per ogni query
        all_relevant: Lista di ground truth per ogni query
        categories: Lista opzionale di categorie per ogni query

    Returns:
        RetrievalMetrics con tutte le metriche aggregate

    Example:
        >>> metrics = compute_retrieval_metrics(
        ...     [["a", "b", "c"], ["x", "y"]],
        ...     [["b"], ["z"]],
        ...     categories=["concettuale", "normativa"]
        ... )
        >>> print(metrics.recall_at_5)
        0.5
    """
    # Metriche globali
    recall_1 = statistics.mean([
        recall_at_k(ret, rel, k=1)
        for ret, rel in zip(all_retrieved, all_relevant)
    ]) if all_retrieved else 0.0

    recall_5 = statistics.mean([
        recall_at_k(ret, rel, k=5)
        for ret, rel in zip(all_retrieved, all_relevant)
    ]) if all_retrieved else 0.0

    recall_10 = statistics.mean([
        recall_at_k(ret, rel, k=10)
        for ret, rel in zip(all_retrieved, all_relevant)
    ]) if all_retrieved else 0.0

    mrr_score = mrr(all_retrieved, all_relevant)
    hit_rate_5 = hit_rate(all_retrieved, all_relevant, k=5)

    # Metriche per categoria
    by_category = None
    if categories:
        by_category = {}
        unique_cats = set(categories)

        for cat in unique_cats:
            cat_indices = [i for i, c in enumerate(categories) if c == cat]
            cat_retrieved = [all_retrieved[i] for i in cat_indices]
            cat_relevant = [all_relevant[i] for i in cat_indices]

            if cat_retrieved:
                by_category[cat] = RetrievalMetrics(
                    recall_at_1=statistics.mean([
                        recall_at_k(ret, rel, k=1)
                        for ret, rel in zip(cat_retrieved, cat_relevant)
                    ]),
                    recall_at_5=statistics.mean([
                        recall_at_k(ret, rel, k=5)
                        for ret, rel in zip(cat_retrieved, cat_relevant)
                    ]),
                    recall_at_10=statistics.mean([
                        recall_at_k(ret, rel, k=10)
                        for ret, rel in zip(cat_retrieved, cat_relevant)
                    ]),
                    mrr=mrr(cat_retrieved, cat_relevant),
                    hit_rate_at_5=hit_rate(cat_retrieved, cat_relevant, k=5),
                    num_queries=len(cat_retrieved),
                    by_category=None  # No nested categories
                )

    return RetrievalMetrics(
        recall_at_1=recall_1,
        recall_at_5=recall_5,
        recall_at_10=recall_10,
        mrr=mrr_score,
        hit_rate_at_5=hit_rate_5,
        num_queries=len(all_retrieved),
        by_category=by_category
    )


# =============================================================================
# GRADED RELEVANCE - Metriche per valutazione graduata (EXP-016)
# =============================================================================

def graded_relevance_at_k(
    retrieved: List[str],
    relevance_scores: Dict[str, int],
    k: int
) -> float:
    """
    Calcola la media dello score di rilevanza nei top-K risultati.

    Scoring graduato (0-3):
    - 3: Articolo esattamente sul tema (es. query "contratto" → art. 1321)
    - 2: Articolo fortemente correlato (es. query "contratto" → art. 1322)
    - 1: Articolo tangenzialmente correlato
    - 0: Non rilevante

    Args:
        retrieved: Lista ordinata di URN recuperati
        relevance_scores: Dizionario URN → score (0-3)
        k: Numero di risultati da considerare

    Returns:
        Mean relevance score in [0, 3]

    Example:
        >>> graded_relevance_at_k(
        ...     ["urn:art1321", "urn:art1322", "urn:art1500"],
        ...     {"urn:art1321": 3, "urn:art1322": 2},
        ...     k=3
        ... )
        1.667  # (3 + 2 + 0) / 3
    """
    if k == 0 or not retrieved:
        return 0.0

    scores = []
    for urn in retrieved[:k]:
        score = relevance_scores.get(urn, 0)
        scores.append(score)

    return statistics.mean(scores) if scores else 0.0


def has_score_at_least(
    retrieved: List[str],
    relevance_scores: Dict[str, int],
    k: int,
    min_score: int
) -> bool:
    """
    Verifica se almeno un risultato nei top-K ha score >= min_score.

    Args:
        retrieved: Lista ordinata di URN recuperati
        relevance_scores: Dizionario URN → score (0-3)
        k: Numero di risultati da considerare
        min_score: Score minimo richiesto

    Returns:
        True se almeno un risultato ha score >= min_score
    """
    for urn in retrieved[:k]:
        if relevance_scores.get(urn, 0) >= min_score:
            return True
    return False


def compute_graded_relevance_metrics(
    all_retrieved: List[List[str]],
    all_relevance_scores: List[Dict[str, int]],
    categories: List[str] = None
) -> GradedRelevanceMetrics:
    """
    Calcola metriche di rilevanza graduata aggregate.

    Args:
        all_retrieved: Lista di risultati per ogni query
        all_relevance_scores: Lista di dizionari URN→score per ogni query
        categories: Lista opzionale di categorie per ogni query

    Returns:
        GradedRelevanceMetrics con tutte le metriche aggregate

    Example:
        >>> metrics = compute_graded_relevance_metrics(
        ...     [["urn:a", "urn:b"], ["urn:x", "urn:y"]],
        ...     [{"urn:a": 3, "urn:b": 2}, {"urn:x": 1}],
        ...     categories=["concettuale", "concettuale"]
        ... )
        >>> print(metrics.mean_relevance_at_5)
        1.25
    """
    if not all_retrieved:
        return GradedRelevanceMetrics(
            mean_relevance_at_5=0.0,
            mean_relevance_at_10=0.0,
            ndcg_at_5=0.0,
            ndcg_at_10=0.0,
            queries_with_score_3=0.0,
            queries_with_score_2_plus=0.0,
            num_queries=0,
            by_category=None
        )

    # Mean relevance@K
    mean_rel_5 = statistics.mean([
        graded_relevance_at_k(ret, scores, k=5)
        for ret, scores in zip(all_retrieved, all_relevance_scores)
    ])

    mean_rel_10 = statistics.mean([
        graded_relevance_at_k(ret, scores, k=10)
        for ret, scores in zip(all_retrieved, all_relevance_scores)
    ])

    # NDCG con graded relevance
    ndcg_scores_5 = []
    ndcg_scores_10 = []

    for retrieved, relevance_scores in zip(all_retrieved, all_relevance_scores):
        # Relevance nell'ordine recuperato
        retrieved_rel = [relevance_scores.get(urn, 0) for urn in retrieved]
        # Relevance ideale (ordinata decrescente)
        ideal_rel = sorted(relevance_scores.values(), reverse=True) if relevance_scores else [0]

        ndcg_scores_5.append(ndcg_at_k(retrieved_rel, ideal_rel, k=5))
        ndcg_scores_10.append(ndcg_at_k(retrieved_rel, ideal_rel, k=10))

    ndcg_5 = statistics.mean(ndcg_scores_5) if ndcg_scores_5 else 0.0
    ndcg_10 = statistics.mean(ndcg_scores_10) if ndcg_scores_10 else 0.0

    # Percentuale query con risultato score=3 (perfetto)
    queries_score_3 = sum(
        1 for ret, scores in zip(all_retrieved, all_relevance_scores)
        if has_score_at_least(ret, scores, k=5, min_score=3)
    ) / len(all_retrieved)

    # Percentuale query con risultato score>=2 (buono)
    queries_score_2_plus = sum(
        1 for ret, scores in zip(all_retrieved, all_relevance_scores)
        if has_score_at_least(ret, scores, k=5, min_score=2)
    ) / len(all_retrieved)

    # Metriche per categoria
    by_category = None
    if categories:
        by_category = {}
        unique_cats = set(categories)

        for cat in unique_cats:
            cat_indices = [i for i, c in enumerate(categories) if c == cat]
            if not cat_indices:
                continue

            cat_retrieved = [all_retrieved[i] for i in cat_indices]
            cat_scores = [all_relevance_scores[i] for i in cat_indices]

            by_category[cat] = compute_graded_relevance_metrics(
                cat_retrieved, cat_scores, categories=None
            )

    return GradedRelevanceMetrics(
        mean_relevance_at_5=mean_rel_5,
        mean_relevance_at_10=mean_rel_10,
        ndcg_at_5=ndcg_5,
        ndcg_at_10=ndcg_10,
        queries_with_score_3=queries_score_3,
        queries_with_score_2_plus=queries_score_2_plus,
        num_queries=len(all_retrieved),
        by_category=by_category
    )
