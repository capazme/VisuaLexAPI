"""
Concept Extractor
=================

Estrattore per concetti giuridici (es. buona fede, dolo, colpa, etc.).

I concetti sono entità astratte che rappresentano nozioni giuridiche
fondamentali usate nel diritto civile italiano.

Configurazione: config/extractors.yaml → concetto

Esempio:
    >>> extractor = ConceptExtractor(llm_service)
    >>> entities = await extractor.extract(content)
    >>> for e in entities:
    ...     print(f"Concetto: {e.nome}")
"""

from merlt.pipeline.enrichment.extractors.base import BaseEntityExtractor
from merlt.pipeline.enrichment.models import EntityType


class ConceptExtractor(BaseEntityExtractor):
    """
    Estrattore per concetti giuridici.

    Estrae concetti astratti come:
    - Buona fede (oggettiva/soggettiva)
    - Dolo, colpa
    - Inadempimento
    - Responsabilità contrattuale
    - Diligenza del buon padre di famiglia

    Configurazione caricata da config/extractors.yaml (sezione "concetto").

    Example:
        >>> extractor = ConceptExtractor(llm_service)
        >>> entities = await extractor.extract(content)
    """

    @property
    def entity_type(self) -> EntityType:
        return EntityType.CONCETTO
