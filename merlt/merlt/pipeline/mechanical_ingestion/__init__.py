"""Mechanical (zero-LLM) ingestion — staging + conflict report + promotion.

Governance doc: docs/merlt/slices/ingestion-governance/design.md.

NOTE on package name: the design doc names this `pipeline/ingestion/mechanical/`,
but `merlt/pipeline/ingestion.py` already exists as a module in this package —
a directory `ingestion/` would collide with it. `mechanical_ingestion/` is the
non-colliding equivalent (same tier, discoverable, no behavioural difference).
"""

from merlt.pipeline.mechanical_ingestion.parser import (
    MechanicalSourceAdapter,
    ItaliaCorpusAdapter,
    get_adapter,
    parse_italia_corpus_markdown,
)
from merlt.pipeline.mechanical_ingestion.conflict_report import build_conflict_report
from merlt.pipeline.mechanical_ingestion.promote import (
    PromotionBlockedError,
    promote_batch,
)

__all__ = [
    "MechanicalSourceAdapter",
    "ItaliaCorpusAdapter",
    "get_adapter",
    "parse_italia_corpus_markdown",
    "build_conflict_report",
    "PromotionBlockedError",
    "promote_batch",
]
