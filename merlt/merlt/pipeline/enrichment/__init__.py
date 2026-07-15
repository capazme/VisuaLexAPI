"""
MERL-T Enrichment Pipeline
==========================

Modelli e utility condivisi dall'enrichment del Knowledge Graph con entità
strutturate (Concetti, Principi, Definizioni).

La pipeline batch storica (EnrichmentPipeline + fonti Brocardi/manuali) è
stata rimossa: il percorso attivo è ``pipeline/live_enrichment.py``
(LiveEnrichmentService), che riusa direttamente questi modelli e gli
extractor in ``pipeline/enrichment/extractors/``.
"""

from merlt.pipeline.enrichment.models import (
    EnrichmentContent,
    ExtractedEntity,
    ExtractedRelation,
    EnrichmentResult,
    EntityType,
)

__all__ = [
    # Models
    "EnrichmentContent",
    "ExtractedEntity",
    "ExtractedRelation",
    "EnrichmentResult",
    "EntityType",
]
