"""
Enrichment Linkers
==================

Componenti per entity linking e deduplicazione.

Componenti:
- EntityLinker: Linking entità estratte al grafo esistente con dedup
- normalization: Utility per normalizzazione nomi

Esempio:
    from merlt.pipeline.enrichment.linkers import EntityLinker

    linker = EntityLinker(graph_client, similarity_threshold=0.85)
    linked = await linker.link_batch(extracted_entities)
"""

from merlt.pipeline.enrichment.linkers.entity_linker import EntityLinker
from merlt.pipeline.enrichment.linkers.normalization import (
    normalize_name,
    normalize_for_search,
)

__all__ = [
    "EntityLinker",
    "normalize_name",
    "normalize_for_search",
]
