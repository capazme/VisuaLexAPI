"""
Enrichment Linkers
==================

Utility condivise per normalizzazione nomi entità.

``EntityLinker`` (linking/dedup verso il grafo, usato dalla pipeline batch
storica) è stato rimosso insieme a quella pipeline; ``normalization`` resta
perché è condivisa con ``EnrichmentGraphWriter``.
"""

from merlt.pipeline.enrichment.linkers.normalization import (
    normalize_name,
    normalize_for_search,
)

__all__ = [
    "normalize_name",
    "normalize_for_search",
]
