"""
MERL-T Enrichment Pipeline
==========================

Pipeline per arricchire il Knowledge Graph con entità strutturate
(Concetti, Principi, Definizioni) estratte da fonti testuali.

Caratteristiche:
- **Riproducibile**: Stessa input → stesso output
- **Scalabile**: Da Libro IV a tutta la legislazione
- **Robusto**: Gestione errori, retry, checkpoint
- **Incrementale**: Può essere eseguito più volte senza duplicati

Esempio:
    from merlt import LegalKnowledgeGraph
    from merlt.pipeline.enrichment import EnrichmentConfig, BrocardiSource, ManualSource

    kg = LegalKnowledgeGraph()
    await kg.connect()

    config = EnrichmentConfig(
        sources=[
            BrocardiSource(),
            ManualSource(path="data/manuali/libro_iv/"),
        ],
        entity_types=["concetto", "principio", "definizione"],
        scope={"libro": "IV", "articoli": (1173, 2059)},
    )

    result = await kg.enrich(config)
    print(f"Creati {result.total_entities} entità")
"""

from merlt.pipeline.enrichment.config import EnrichmentConfig
from merlt.pipeline.enrichment.models import (
    EnrichmentContent,
    ExtractedEntity,
    ExtractedRelation,
    EnrichmentResult,
    EntityType,
)
from merlt.pipeline.enrichment.pipeline import EnrichmentPipeline

__all__ = [
    # Config
    "EnrichmentConfig",
    # Models
    "EnrichmentContent",
    "ExtractedEntity",
    "ExtractedRelation",
    "EnrichmentResult",
    "EntityType",
    # Pipeline
    "EnrichmentPipeline",
]
