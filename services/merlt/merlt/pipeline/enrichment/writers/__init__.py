"""
Enrichment Writers
==================

Componenti per scrittura nel grafo delle entità arricchite.

Componenti:
- EnrichmentGraphWriter: Scrive nodi e relazioni nel grafo

Configurazione: config/writers.yaml

Esempio:
    from merlt.pipeline.enrichment.writers import EnrichmentGraphWriter

    writer = EnrichmentGraphWriter(graph_client)
    written = await writer.write_batch(linked_entities, content)
"""

from merlt.pipeline.enrichment.writers.graph_writer import EnrichmentGraphWriter

__all__ = [
    "EnrichmentGraphWriter",
]
