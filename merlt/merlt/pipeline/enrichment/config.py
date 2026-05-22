"""
Enrichment Configuration
========================

Configurazione esternalizzata per la pipeline di enrichment.

Esempio:
    from merlt.pipeline.enrichment import EnrichmentConfig
    from merlt.pipeline.enrichment.sources import BrocardiSource, ManualSource

    config = EnrichmentConfig(
        sources=[
            BrocardiSource(),
            ManualSource(path="data/manuali/libro_iv/"),
        ],
        entity_types=["concetto", "principio", "definizione"],
        scope={"libro": "IV", "articoli": (1173, 2059)},
        llm_model="google/gemini-2.5-flash",  # Da .env LLM_ENRICHMENT_MODEL
    )
"""

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, TYPE_CHECKING, Tuple, Union

if TYPE_CHECKING:
    from merlt.pipeline.enrichment.sources.base import BaseEnrichmentSource

from merlt.pipeline.enrichment.models import EntityType


def _get_env_or_default(key: str, default: str) -> str:
    """Ottiene valore da env o usa default."""
    value = os.environ.get(key, default)
    # Risolvi riferimenti ${VAR}
    if value.startswith("${") and value.endswith("}"):
        var_name = value[2:-1]
        return os.environ.get(var_name, default)
    return value


@dataclass
class EnrichmentScope:
    """
    Scope dell'enrichment (quali articoli processare).

    Attributes:
        libro: Libro del codice civile (es. "IV" per Obbligazioni)
        titolo: Titolo specifico (opzionale)
        articoli: Range articoli come tuple (start, end) o lista
        urns: Lista specifica di URN da processare
    """
    libro: Optional[str] = None
    titolo: Optional[str] = None
    articoli: Optional[Union[Tuple[int, int], List[int]]] = None
    urns: Optional[List[str]] = None

    def matches_article(self, article_num: int) -> bool:
        """Verifica se un articolo rientra nello scope."""
        if self.articoli is None:
            return True
        if isinstance(self.articoli, tuple):
            return self.articoli[0] <= article_num <= self.articoli[1]
        return article_num in self.articoli

    def matches_urn(self, urn: str) -> bool:
        """Verifica se un URN rientra nello scope."""
        if self.urns is not None:
            return urn in self.urns
        # Estrai numero articolo da URN per controllare range
        # URN format: urn:nir:stato:legge:1942-03-16;262~art1337
        try:
            if "~art" in urn:
                art_num = int(urn.split("~art")[-1].split("-")[0])
                return self.matches_article(art_num)
        except (ValueError, IndexError):
            pass
        return True


@dataclass
class EnrichmentConfig:
    """
    Configurazione per pipeline di enrichment.

    Centralizza tutti i parametri per un'esecuzione riproducibile.

    Attributes:
        sources: Lista di fonti da cui estrarre
        entity_types: Tipi di entità da estrarre
        scope: Filtro articoli (libro, range, etc.)
        llm_model: Modello LLM per estrazione
        llm_temperature: Temperatura LLM (0.0 = deterministico)
        checkpoint_dir: Directory per checkpoint/resume
        retry_count: Numero retry per errori transitori
        batch_size: Batch size per processing parallelo
        similarity_threshold: Soglia per deduplicazione
        merge_strategy: Strategia merge duplicati
        log_extractions: Se loggare ogni estrazione
        audit_log_path: Path per audit log JSON Lines
        dry_run: Se True, non scrive nel grafo

    Example:
        >>> config = EnrichmentConfig(
        ...     sources=[BrocardiSource()],
        ...     scope=EnrichmentScope(articoli=(1173, 2059)),
        ... )
        >>> result = await kg.enrich(config)
    """

    # Fonti dati (popolate dopo init)
    sources: List["BaseEnrichmentSource"] = field(default_factory=list)

    # Tipi entità da estrarre
    entity_types: List[EntityType] = field(default_factory=lambda: [
        EntityType.CONCETTO,
        EntityType.PRINCIPIO,
        EntityType.DEFINIZIONE,
    ])

    # Scope (quale parte del codice)
    scope: Optional[EnrichmentScope] = None

    # LLM Configuration
    llm_model: str = field(default_factory=lambda: _get_env_or_default(
        "LLM_ENRICHMENT_MODEL",
        "google/gemini-2.5-flash"
    ))
    llm_temperature: float = 0.0  # Deterministico per riproducibilità

    # Robustezza
    checkpoint_dir: Path = field(default_factory=lambda: Path("data/checkpoints/enrichment/"))
    retry_count: int = 3
    retry_delay_seconds: float = 1.0
    batch_size: int = 10
    max_concurrent: int = 5  # Max richieste LLM parallele

    # Deduplicazione
    similarity_threshold: float = 0.85
    merge_strategy: str = "prefer_manual"  # "prefer_manual", "prefer_brocardi", "merge_all"

    # Logging
    log_extractions: bool = True
    audit_log_path: Path = field(default_factory=lambda: Path("logs/enrichment_audit.jsonl"))

    # Debug
    dry_run: bool = False  # Se True, non scrive nel grafo
    verbose: bool = False

    # Schema version (per tracking)
    schema_version: str = "2.1"

    def __post_init__(self):
        """Validazione e setup post-init."""
        # Crea directory checkpoint se non esiste
        self.checkpoint_dir.mkdir(parents=True, exist_ok=True)

        # Crea directory log se non esiste
        self.audit_log_path.parent.mkdir(parents=True, exist_ok=True)

        # Converti entity_types da stringhe se necessario
        if self.entity_types and isinstance(self.entity_types[0], str):
            self.entity_types = [
                EntityType(t) if isinstance(t, str) else t
                for t in self.entity_types
            ]

    def to_dict(self) -> Dict[str, Any]:
        """Serializza config per logging/checkpoint."""
        return {
            "entity_types": [t.value for t in self.entity_types],
            "scope": {
                "libro": self.scope.libro if self.scope else None,
                "articoli": self.scope.articoli if self.scope else None,
            } if self.scope else None,
            "llm_model": self.llm_model,
            "llm_temperature": self.llm_temperature,
            "retry_count": self.retry_count,
            "batch_size": self.batch_size,
            "similarity_threshold": self.similarity_threshold,
            "merge_strategy": self.merge_strategy,
            "schema_version": self.schema_version,
            "sources": [s.__class__.__name__ for s in self.sources],
        }

    @classmethod
    def for_libro_iv(cls, **kwargs) -> "EnrichmentConfig":
        """
        Factory per configurazione Libro IV (Obbligazioni).

        Scope: articoli 1173-2059 del Codice Civile.

        Example:
            >>> config = EnrichmentConfig.for_libro_iv(
            ...     sources=[BrocardiSource(), ManualSource("path/")]
            ... )
        """
        return cls(
            scope=EnrichmentScope(
                libro="IV",
                articoli=(1173, 2059),
            ),
            **kwargs
        )

    @classmethod
    def for_test(cls, **kwargs) -> "EnrichmentConfig":
        """
        Factory per configurazione test (pochi articoli).

        Scope: 5 articoli chiave per testing rapido.
        """
        return cls(
            scope=EnrichmentScope(
                articoli=[1321, 1337, 1375, 1414, 1453],
            ),
            checkpoint_dir=Path("data/checkpoints/enrichment_test/"),
            audit_log_path=Path("logs/enrichment_test_audit.jsonl"),
            **kwargs
        )
