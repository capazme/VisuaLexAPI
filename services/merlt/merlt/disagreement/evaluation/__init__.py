"""
Disagreement Evaluation Module
==============================

Metriche e tools per valutazione di LegalDisagreementNet.

Componenti:
- metrics: DisagreementMetrics, compute_metrics()
- human_eval: Human evaluation tools per gold standard
"""

from merlt.disagreement.evaluation.metrics import (
    DisagreementMetrics,
    compute_disagreement_metrics,
    compute_pairwise_metrics,
)

__all__ = [
    "DisagreementMetrics",
    "compute_disagreement_metrics",
    "compute_pairwise_metrics",
]
