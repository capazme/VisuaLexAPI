"""
Enrichment Extractors
=====================

Estrattori per entità giuridiche.

Estrattori LLM-based:
- ConceptExtractor: Estrae concetti giuridici (buona fede, dolo, etc.)
- PrincipleExtractor: Estrae principi giuridici (affidamento, etc.)
- DefinitionExtractor: Estrae definizioni legali esplicite
- GenericExtractor: Estrattore generico per tutti i tipi di entità

Estrattore Meccanicistico (NO LLM):
- MechanisticExtractor: Estrae entità da dati strutturati Brocardi
  - PRECEDENTE: Da massime giurisprudenziali
  - BROCARDO: Da massime latine
  - Relazioni CITA: Da cross-references testuali

Factory:
- create_extractor: Crea l'estrattore appropriato per un tipo di entità
- create_mechanistic_extractor: Crea estrattore meccanicistico

Esempio:
    from merlt.pipeline.enrichment.extractors import create_extractor
    from merlt.pipeline.enrichment.models import EntityType

    # Usa la factory per creare l'estrattore appropriato
    extractor = create_extractor(llm_service, EntityType.SOGGETTO)
    entities = await extractor.extract(content)

    # Estrazione meccanicistica (zero costi API)
    from merlt.pipeline.enrichment.extractors import MechanisticExtractor
    mech = MechanisticExtractor()
    result = mech.extract_all(brocardi_info, article_urn)
"""

from merlt.pipeline.enrichment.extractors.base import BaseEntityExtractor
from merlt.pipeline.enrichment.extractors.concept import ConceptExtractor
from merlt.pipeline.enrichment.extractors.principle import PrincipleExtractor
from merlt.pipeline.enrichment.extractors.definition import DefinitionExtractor
from merlt.pipeline.enrichment.extractors.generic import (
    GenericExtractor,
    create_extractor,
)
from merlt.pipeline.enrichment.extractors.mechanistic import (
    MechanisticExtractor,
    MechanisticExtractionResult,
    create_mechanistic_extractor,
)

__all__ = [
    "BaseEntityExtractor",
    "ConceptExtractor",
    "PrincipleExtractor",
    "DefinitionExtractor",
    "GenericExtractor",
    "create_extractor",
    # Mechanistic (no LLM)
    "MechanisticExtractor",
    "MechanisticExtractionResult",
    "create_mechanistic_extractor",
]
