"""
Enrichment Sources
==================

Fonti dati per la pipeline di enrichment.

Fonti disponibili:
- BrocardiEnrichmentSource: Estrae spiegazioni, ratio, brocardi da brocardi.it
- ManualEnrichmentSource: Estrae contenuto da manuali PDF

Esempio:
    from merlt.pipeline.enrichment.sources import BrocardiSource, ManualSource

    config = EnrichmentConfig(
        sources=[
            BrocardiSource(),
            ManualSource(path="data/manuali/libro_iv/"),
        ],
    )
"""

from merlt.pipeline.enrichment.sources.base import BaseEnrichmentSource
from merlt.pipeline.enrichment.sources.brocardi import BrocardiEnrichmentSource
from merlt.pipeline.enrichment.sources.manual import ManualEnrichmentSource

# Alias brevi per comodità
BrocardiSource = BrocardiEnrichmentSource
ManualSource = ManualEnrichmentSource

__all__ = [
    "BaseEnrichmentSource",
    "BrocardiEnrichmentSource",
    "ManualEnrichmentSource",
    # Alias
    "BrocardiSource",
    "ManualSource",
]
