"""
Definition Extractor
====================

Estrattore per definizioni legali esplicite presenti nei testi.

Le definizioni sono enunciati che stabiliscono il significato preciso
di un termine giuridico, spesso introdotte da frasi come
"si intende per...", "è definito come...", etc.

Configurazione: config/extractors.yaml → definizione

Esempio:
    >>> extractor = DefinitionExtractor(llm_service)
    >>> entities = await extractor.extract(content)
"""

from merlt.pipeline.enrichment.extractors.base import BaseEntityExtractor
from merlt.pipeline.enrichment.models import EntityType


class DefinitionExtractor(BaseEntityExtractor):
    """
    Estrattore per definizioni legali.

    Estrae definizioni esplicite come:
    - "Per obbligazione si intende..."
    - "Il contratto è l'accordo..."
    - "La mora del debitore consiste in..."

    Configurazione caricata da config/extractors.yaml (sezione "definizione").

    Example:
        >>> extractor = DefinitionExtractor(llm_service)
        >>> entities = await extractor.extract(content)
    """

    @property
    def entity_type(self) -> EntityType:
        return EntityType.DEFINIZIONE
