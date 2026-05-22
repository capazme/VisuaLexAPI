"""
Entity Linker
=============

Componente per linking e deduplicazione entità estratte.

Responsabilità:
- Link entità al grafo esistente (se già presente)
- Deduplicazione multi-fonte
- Merge intelligente di entità duplicate
- Normalizzazione nomi per chiavi univoche

Configurazione: config/linkers.yaml

Esempio:
    linker = EntityLinker(graph_client)
    linked = await linker.link_batch(extracted_entities)
"""

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, TYPE_CHECKING

import yaml

from merlt.pipeline.enrichment.linkers.normalization import (
    normalize_name,
    compute_similarity,
    are_variants,
)
from merlt.pipeline.enrichment.models import (
    ExtractedEntity,
    LinkedEntity,
    EntityType,
)

if TYPE_CHECKING:
    from merlt.storage.graph import FalkorDBClient

logger = logging.getLogger(__name__)

# Cache configurazione
_LINKER_CONFIG: Optional[Dict[str, Any]] = None


def _load_linker_config() -> Dict[str, Any]:
    """Carica configurazione linker da YAML."""
    global _LINKER_CONFIG

    if _LINKER_CONFIG is None:
        config_path = Path(__file__).parent.parent / "config" / "linkers.yaml"
        if config_path.exists():
            with open(config_path, "r", encoding="utf-8") as f:
                _LINKER_CONFIG = yaml.safe_load(f)
        else:
            logger.warning(f"Config file non trovato: {config_path}")
            _LINKER_CONFIG = {}

    return _LINKER_CONFIG


class EntityLinker:
    """
    Linker per entità estratte.

    Gestisce linking al grafo esistente e deduplicazione
    multi-fonte con merge intelligente.

    Attributes:
        graph: Client FalkorDB
        config: Configurazione da YAML
        _cache: Cache lookup risultati

    Example:
        >>> linker = EntityLinker(graph_client)
        >>> linked = await linker.link_batch(entities)
        >>> for le in linked:
        ...     print(f"{le.node_id}: {'nuovo' if le.is_new else 'merge'}")
    """

    def __init__(
        self,
        graph_client: "FalkorDBClient",
        similarity_threshold: Optional[float] = None,
        merge_strategy: Optional[str] = None,
    ):
        """
        Inizializza l'entity linker.

        Args:
            graph_client: Client FalkorDB per lookup
            similarity_threshold: Override soglia similarità
            merge_strategy: Override strategia merge
        """
        self.graph = graph_client
        self._config = _load_linker_config()
        self._cache: Dict[str, Optional[Dict]] = {}

        # Parametri (override o da config)
        linker_config = self._config.get("entity_linker", {})
        self.similarity_threshold = (
            similarity_threshold or
            linker_config.get("similarity_threshold", 0.85)
        )
        self.merge_strategy = (
            merge_strategy or
            linker_config.get("merge_strategy", "merge_all")
        )
        self.source_priority = linker_config.get("source_priority", [
            "manuale", "brocardi", "giurisprudenza", "altro"
        ])

    async def link_batch(
        self,
        entities: List[ExtractedEntity]
    ) -> List[LinkedEntity]:
        """
        Processa un batch di entità per linking/dedup.

        Args:
            entities: Lista di entità estratte

        Returns:
            Lista di LinkedEntity con info su nuovo/merge
        """
        linked = []
        seen_in_batch: Dict[str, LinkedEntity] = {}

        for entity in entities:
            # Dedup intra-batch prima
            normalized = normalize_name(entity.nome)
            if normalized in seen_in_batch:
                # Merge con entità già vista nel batch
                existing = seen_in_batch[normalized]
                merged = self._merge_entities(existing, entity)
                seen_in_batch[normalized] = merged
                continue

            # Link con grafo esistente
            le = await self._link_single(entity)
            seen_in_batch[normalized] = le

        linked = list(seen_in_batch.values())
        return linked

    async def _link_single(
        self,
        entity: ExtractedEntity
    ) -> LinkedEntity:
        """
        Link singola entità con grafo esistente.

        Args:
            entity: Entità da linkare

        Returns:
            LinkedEntity con info nuovo/esistente
        """
        normalized = normalize_name(entity.nome)
        node_id = f"{entity.tipo.value}:{normalized}"

        # Check cache
        if node_id in self._cache:
            cached = self._cache[node_id]
            if cached:
                return LinkedEntity(
                    entity=entity,
                    node_id=node_id,
                    is_new=False,
                    merged_from=[entity.fonte, cached.get("fonte", "unknown")],
                    final_descrizione=self._merge_descriptions(
                        entity.descrizione,
                        cached.get("descrizione", ""),
                        entity.fonte
                    ),
                )

        # Query grafo
        existing = await self._query_existing(entity.tipo, normalized)

        if existing:
            self._cache[node_id] = existing
            return LinkedEntity(
                entity=entity,
                node_id=existing.get("node_id", node_id),
                is_new=False,
                merged_from=[entity.fonte] + existing.get("fonti", []),
                final_descrizione=self._merge_descriptions(
                    entity.descrizione,
                    existing.get("descrizione", ""),
                    entity.fonte
                ),
            )

        # Nuova entità
        self._cache[node_id] = None
        return LinkedEntity(
            entity=entity,
            node_id=node_id,
            is_new=True,
            merged_from=[entity.fonte],
            final_descrizione=entity.descrizione,
        )

    async def _query_existing(
        self,
        entity_type: EntityType,
        normalized_name: str
    ) -> Optional[Dict[str, Any]]:
        """Query grafo per entità esistente."""
        queries = self._config.get("cypher_queries", {})

        # Seleziona query per tipo
        if entity_type == EntityType.CONCETTO:
            query_template = queries.get("find_concept")
        elif entity_type == EntityType.PRINCIPIO:
            query_template = queries.get("find_principle")
        elif entity_type == EntityType.DEFINIZIONE:
            query_template = queries.get("find_definition")
        else:
            return None

        if not query_template:
            return None

        try:
            result = await self.graph.query(
                query_template,
                {"nome_normalizzato": normalized_name}
            )
            if result:
                return dict(result[0])
        except Exception as e:
            logger.warning(f"Errore query existing: {e}")

        return None

    def _merge_entities(
        self,
        existing: LinkedEntity,
        new_entity: ExtractedEntity
    ) -> LinkedEntity:
        """Merge due entità in una."""
        # Aggiungi fonte
        merged_from = existing.merged_from + [new_entity.fonte]
        merged_from = list(set(merged_from))  # Dedup

        # Merge descrizione
        final_desc = self._merge_descriptions(
            existing.final_descrizione,
            new_entity.descrizione,
            new_entity.fonte
        )

        return LinkedEntity(
            entity=existing.entity,
            node_id=existing.node_id,
            is_new=existing.is_new,
            merged_from=merged_from,
            final_descrizione=final_desc,
        )

    def _merge_descriptions(
        self,
        desc1: str,
        desc2: str,
        new_source: str
    ) -> str:
        """
        Merge due descrizioni secondo strategia configurata.

        Args:
            desc1: Descrizione esistente
            desc2: Nuova descrizione
            new_source: Fonte della nuova descrizione
        """
        if not desc2:
            return desc1
        if not desc1:
            return desc2

        if self.merge_strategy == "longest":
            return desc1 if len(desc1) >= len(desc2) else desc2

        elif self.merge_strategy == "prefer_manual":
            if "manuale" in new_source.lower():
                return desc2
            return desc1

        elif self.merge_strategy == "prefer_brocardi":
            if "brocardi" in new_source.lower():
                return desc2
            return desc1

        else:  # merge_all
            # Usa la più lunga per default
            return desc1 if len(desc1) >= len(desc2) else desc2

    async def find_similar(
        self,
        name: str,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Trova entità simili per nome (fuzzy).

        Args:
            name: Nome da cercare
            limit: Max risultati

        Returns:
            Lista di entità simili trovate
        """
        queries = self._config.get("cypher_queries", {})
        query = queries.get("find_similar")

        if not query:
            return []

        normalized = normalize_name(name)
        # Usa primi 5 char per search
        partial = normalized[:5] if len(normalized) > 5 else normalized

        try:
            result = await self.graph.query(
                query,
                {"partial_name": partial, "limit": limit}
            )
            return [dict(r) for r in result]
        except Exception as e:
            logger.warning(f"Errore find_similar: {e}")
            return []
