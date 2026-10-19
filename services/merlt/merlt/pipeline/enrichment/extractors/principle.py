"""
Principle Extractor
===================

Estrattore per principi giuridici (es. principio di buona fede,
affidamento, libertà contrattuale, etc.).

I principi sono norme di secondo livello che guidano l'interpretazione
e l'applicazione delle regole giuridiche.

Configurazione: config/extractors.yaml → principio

Esempio:
    >>> extractor = PrincipleExtractor(llm_service)
    >>> entities = await extractor.extract(content)
"""

from merlt.pipeline.enrichment.extractors.base import BaseEntityExtractor
from merlt.pipeline.enrichment.models import EntityType


class PrincipleExtractor(BaseEntityExtractor):
    """
    Estrattore per principi giuridici.

    Estrae principi come:
    - Principio di buona fede
    - Principio dell'affidamento
    - Autonomia contrattuale
    - Libertà delle forme
    - Principio consensualistico
    - Tutela della parte debole

    Configurazione caricata da config/extractors.yaml (sezione "principio").

    Example:
        >>> extractor = PrincipleExtractor(llm_service)
        >>> entities = await extractor.extract(content)
    """

    @property
    def entity_type(self) -> EntityType:
        return EntityType.PRINCIPIO
