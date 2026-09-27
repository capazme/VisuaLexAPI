"""
Generic Entity Extractor
========================

Estrattore generico configurabile per tutti i tipi di entità.

Invece di creare una classe per ogni tipo di entità, questo estrattore
può essere configurato dinamicamente per estrarre qualsiasi tipo definito
in EntityType.

I prompt e parametri sono caricati da config/extractors.yaml.

Esempio:
    >>> extractor = GenericExtractor(llm_service, EntityType.SOGGETTO)
    >>> entities = await extractor.extract(content)
"""

from typing import TYPE_CHECKING

from merlt.pipeline.enrichment.extractors.base import BaseEntityExtractor
from merlt.pipeline.enrichment.models import EntityType

if TYPE_CHECKING:
    from merlt.rlcf.ai_service import OpenRouterService


class GenericExtractor(BaseEntityExtractor):
    """
    Estrattore generico per qualsiasi tipo di entità.

    Può essere configurato per estrarre qualsiasi tipo definito in EntityType.
    Il prompt e i parametri sono caricati da config/extractors.yaml usando
    il valore dell'EntityType come chiave.

    Attributes:
        _entity_type: Tipo di entità da estrarre

    Example:
        >>> # Estrae soggetti giuridici
        >>> extractor = GenericExtractor(llm, EntityType.SOGGETTO)
        >>> entities = await extractor.extract(content)
        >>>
        >>> # Estrae termini
        >>> extractor = GenericExtractor(llm, EntityType.TERMINE)
        >>> entities = await extractor.extract(content)
    """

    def __init__(
        self,
        llm_service: "OpenRouterService",
        entity_type: EntityType,
    ):
        """
        Inizializza l'estrattore generico.

        Args:
            llm_service: Servizio OpenRouter per chiamate LLM
            entity_type: Tipo di entità da estrarre
        """
        super().__init__(llm_service)
        self._entity_type = entity_type

    @property
    def entity_type(self) -> EntityType:
        return self._entity_type


# Factory per creare estrattori per tipo
def create_extractor(
    llm_service: "OpenRouterService",
    entity_type: EntityType,
) -> BaseEntityExtractor:
    """
    Factory per creare l'estrattore appropriato per un tipo di entità.

    Per i tipi core (CONCETTO, PRINCIPIO, DEFINIZIONE) usa gli estrattori
    specializzati. Per tutti gli altri usa GenericExtractor.

    Args:
        llm_service: Servizio OpenRouter
        entity_type: Tipo di entità

    Returns:
        Estrattore appropriato per il tipo

    Example:
        >>> extractor = create_extractor(llm, EntityType.SOGGETTO)
        >>> entities = await extractor.extract(content)
    """
    from merlt.pipeline.enrichment.extractors import (
        ConceptExtractor,
        PrincipleExtractor,
        DefinitionExtractor,
    )

    # Usa estrattori specializzati per i tipi core
    if entity_type == EntityType.CONCETTO:
        return ConceptExtractor(llm_service)
    elif entity_type == EntityType.PRINCIPIO:
        return PrincipleExtractor(llm_service)
    elif entity_type == EntityType.DEFINIZIONE:
        return DefinitionExtractor(llm_service)
    else:
        # Per tutti gli altri tipi usa GenericExtractor
        return GenericExtractor(llm_service, entity_type)
