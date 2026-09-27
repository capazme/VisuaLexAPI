"""
Gold Standard Regression Testing for MERL-T Expert System.

Provides infrastructure for:
- Managing validated query-response pairs
- Running regression tests against the pipeline
- Comparing responses using semantic + structural similarity
- Reporting pass/fail status and degradation detection

Example:
    >>> from merlt.experts.regression import GoldStandardSuite, RegressionRunner
    >>>
    >>> suite = GoldStandardSuite.load("gold_standard.json")
    >>> runner = RegressionRunner(suite, pipeline=my_pipeline)
    >>> results = await runner.run()
    >>> print(results.summary())
"""

from .models import (
    GoldStandardQuery,
    ExpectedResponse,
    RegressionResult,
    QueryResult,
    SimilarityScore,
    RegressionReport,
)

from .suite import (
    GoldStandardSuite,
    SuiteConfig,
)

from .runner import (
    RegressionRunner,
    RunnerConfig,
)

from .comparator import (
    ResponseComparator,
    SemanticComparator,
    StructuralComparator,
    CombinedComparator,
    ComparatorConfig,
)

__all__ = [
    # Models
    "GoldStandardQuery",
    "ExpectedResponse",
    "RegressionResult",
    "QueryResult",
    "SimilarityScore",
    "RegressionReport",
    # Suite
    "GoldStandardSuite",
    "SuiteConfig",
    # Runner
    "RegressionRunner",
    "RunnerConfig",
    # Comparator
    "ResponseComparator",
    "SemanticComparator",
    "StructuralComparator",
    "CombinedComparator",
    "ComparatorConfig",
]
