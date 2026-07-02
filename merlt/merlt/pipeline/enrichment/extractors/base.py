"""
Base Entity Extractor
=====================

Interfaccia astratta per estrattori di entità LLM-based.

Ogni estrattore implementa la logica per estrarre un tipo specifico
di entità giuridica da testo.

I prompt e parametri sono caricati da file YAML di configurazione
per permettere modifiche senza toccare il codice.

Esempio implementazione:
    class MyExtractor(BaseEntityExtractor):
        @property
        def entity_type(self) -> EntityType:
            return EntityType.CONCETTO
"""

import logging
import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Dict, List, Optional, TYPE_CHECKING

import yaml

if TYPE_CHECKING:
    from merlt.rlcf.ai_service import OpenRouterService
    from merlt.pipeline.enrichment.models import (
        EnrichmentContent,
        ExtractedEntity,
        EntityType,
    )

logger = logging.getLogger(__name__)

# Cache per configurazione YAML
_CONFIG_CACHE: Optional[Dict[str, Any]] = None


def _load_extractors_config() -> Dict[str, Any]:
    """Carica configurazione extractors da YAML."""
    global _CONFIG_CACHE

    if _CONFIG_CACHE is None:
        config_path = Path(__file__).parent.parent / "config" / "extractors.yaml"
        if config_path.exists():
            with open(config_path, "r", encoding="utf-8") as f:
                _CONFIG_CACHE = yaml.safe_load(f)
        else:
            logger.warning(f"Config file non trovato: {config_path}")
            _CONFIG_CACHE = {}

    return _CONFIG_CACHE


class BaseEntityExtractor(ABC):
    """
    Interfaccia base per estrattori di entità.

    Ogni estrattore deve:
    - Definire il tipo di entità che estrae

    Prompt, parametri e validazione sono caricati da config/extractors.yaml.

    Attributes:
        llm: Servizio OpenRouter per chiamate LLM
        _config: Configurazione caricata da YAML

    Example:
        >>> extractor = ConceptExtractor(llm_service)
        >>> entities = await extractor.extract(content)
        >>> for entity in entities:
        ...     print(f"{entity.nome}: {entity.descrizione}")
    """

    def __init__(self, llm_service: "OpenRouterService"):
        """
        Inizializza l'estrattore.

        Args:
            llm_service: Servizio OpenRouter per chiamate LLM
        """
        self.llm = llm_service
        self._config = _load_extractors_config()

    @property
    @abstractmethod
    def entity_type(self) -> "EntityType":
        """Tipo di entità estratto da questo estrattore."""
        pass

    @property
    def extractor_config(self) -> Dict[str, Any]:
        """Configurazione specifica per questo estrattore."""
        return self._config.get(self.entity_type.value, {})

    @property
    def response_schema(self) -> Dict[str, Any]:
        """Schema JSON per response parsing (da YAML)."""
        return self.extractor_config.get("response_schema", {
            "type": "object",
            "properties": {
                "entities": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "nome": {"type": "string"},
                            "descrizione": {"type": "string"},
                        },
                        "required": ["nome"]
                    }
                }
            },
            "required": ["entities"]
        })

    @property
    def validation_config(self) -> Dict[str, Any]:
        """Configurazione validazione (da YAML)."""
        return self.extractor_config.get("validation", {})

    def _get_prompt_template(self) -> str:
        """Carica template prompt da YAML config."""
        return self.extractor_config.get("prompt", self._get_default_prompt())

    def _get_default_prompt(self) -> str:
        """Prompt di default se non presente in YAML."""
        return """Analizza il testo ed estrai entità giuridiche.

TESTO:
{text}

Rispondi in JSON con formato: {{"entities": [...]}}"""

    def _build_prompt(self, content: "EnrichmentContent") -> str:
        """
        Costruisce il prompt per l'estrazione.

        Args:
            content: Contenuto da processare

        Returns:
            Prompt formattato
        """
        template = self._get_prompt_template()
        return template.format(
            text=content.text,
            source=content.source,
            content_type=content.content_type,
            article_refs=", ".join(content.article_refs),
        )

    def _get_system_prompt(self) -> str:
        """Prompt di sistema per l'LLM (da YAML)."""
        return self._config.get("system_prompt", """Sei un esperto di diritto italiano.
Estrai entità giuridiche strutturate. Rispondi SEMPRE in formato JSON valido.""")

    def _get_llm_config(self) -> Dict[str, Any]:
        """Configurazione LLM (da YAML)."""
        llm_config = self._config.get("llm", {})
        return {
            "model": os.environ.get(
                "LLM_ENRICHMENT_MODEL",
                llm_config.get("default_model", "google/gemini-2.5-flash")
            ),
            "temperature": llm_config.get("temperature", 0.0),
            "max_tokens": llm_config.get("max_tokens", 2000),
            "timeout": llm_config.get("timeout", 60),
        }

    async def extract(
        self,
        content: "EnrichmentContent"
    ) -> List["ExtractedEntity"]:
        """
        Estrae entità dal contenuto usando LLM.

        Args:
            content: Contenuto da processare

        Returns:
            Lista di entità estratte

        Example:
            >>> entities = await extractor.extract(content)
            >>> print(f"Estratte {len(entities)} entità")
        """
        from merlt.pipeline.enrichment.models import ExtractedEntity

        try:
            prompt = self._build_prompt(content)
            llm_config = self._get_llm_config()

            # Chiama LLM con JSON response
            response = await self.llm.generate_json_completion(
                prompt=prompt,
                json_schema=self.response_schema,
                system_prompt=self._get_system_prompt(),
                model=llm_config["model"],
                temperature=llm_config["temperature"],
                max_tokens=llm_config["max_tokens"],
                timeout=llm_config["timeout"],
            )

            # Parsa risposta
            entities = self._parse_response(response, content)

            logger.debug(
                f"Estratte {len(entities)} {self.entity_type.value} da {content.id}"
            )
            return entities

        except Exception as e:
            logger.error(f"Errore estrazione {self.entity_type.value}: {e}")
            return []

    def _parse_response(
        self,
        response: Dict[str, Any],
        content: "EnrichmentContent"
    ) -> List["ExtractedEntity"]:
        """
        Parsa risposta LLM in entità strutturate.

        Args:
            response: Risposta JSON dall'LLM
            content: Contenuto originale (per metadata)

        Returns:
            Lista di ExtractedEntity
        """
        from merlt.pipeline.enrichment.models import ExtractedEntity

        entities = []
        # Gemini può restituire null invece di [], gestiamo entrambi i casi
        raw_entities = response.get("entities") or []

        for raw in raw_entities:
            try:
                entity = ExtractedEntity(
                    nome=raw.get("nome", "").strip(),
                    tipo=self.entity_type,
                    descrizione=raw.get("descrizione", "").strip(),
                    articoli_correlati=self._normalize_articles(
                        raw.get("articoli_correlati", [])
                    ),
                    fonte=content.source,
                    confidence=raw.get("confidence", 1.0),
                    raw_context=content.text[:500],  # Primi 500 char per reference
                )

                # Valida entità
                if self._validate_entity(entity):
                    entities.append(entity)

            except Exception as e:
                logger.warning(f"Errore parsing entità: {e}")
                continue

        return entities

    def _normalize_articles(self, articles: List[str]) -> List[str]:
        """Normalizza riferimenti articoli in URN."""
        urns = []
        for art in articles:
            if isinstance(art, str):
                # Estrai numero
                import re
                match = re.search(r'\d+', art)
                if match:
                    num = match.group()
                    urn = f"https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art{num}"
                    urns.append(urn)
        return urns

    def _validate_entity(self, entity: "ExtractedEntity") -> bool:
        """
        Valida un'entità estratta.

        Il gate di qualità del nome (lunghezza + firme junk) è delegato alla
        funzione condivisa ``is_valid_entity_name`` (unica fonte di verità,
        riusata da tutti i write site e dal backfill). Qui restano solo i
        controlli specifici configurati da YAML (descrizione minima, termini
        esclusi).

        Args:
            entity: Entità da validare

        Returns:
            True se valida
        """
        from merlt.pipeline.enrichment.quality import is_valid_entity_name

        # Gate condiviso su nome (junk signatures + lunghezza per-tipo)
        if not is_valid_entity_name(entity.nome, entity.tipo):
            return False

        validation = self.validation_config

        # Descrizione minima (se richiesta)
        min_desc = validation.get("min_description_length", 0)
        if min_desc > 0 and len(entity.descrizione or "") < min_desc:
            return False

        # Termini esclusi (lista extra specifica per estrattore da YAML)
        excluded = validation.get("excluded_terms", [])
        nome_lower = entity.nome.lower()
        if nome_lower in excluded:
            return False

        return True
