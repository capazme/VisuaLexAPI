"""
Enrichment Graph Writer
=======================

Scrive entità arricchite nel Knowledge Graph.

Responsabilità:
- Crea/aggiorna nodi per concetti, principi, definizioni
- Crea relazioni tra entità e norme
- Crea nodi Dottrina ristrutturati
- Gestisce transazioni e retry

Configurazione: config/writers.yaml

Esempio:
    writer = EnrichmentGraphWriter(graph_client)
    written = await writer.write_batch(linked_entities, content)
"""

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, TYPE_CHECKING

import yaml

from merlt.pipeline.enrichment.linkers.normalization import normalize_name
from merlt.pipeline.enrichment.models import (
    EnrichmentContent,
    LinkedEntity,
    EntityType,
)

if TYPE_CHECKING:
    from merlt.storage.graph import FalkorDBClient

logger = logging.getLogger(__name__)

# Cache configurazione
_WRITER_CONFIG: Optional[Dict[str, Any]] = None


def _load_writer_config() -> Dict[str, Any]:
    """Carica configurazione writer da YAML."""
    global _WRITER_CONFIG

    if _WRITER_CONFIG is None:
        config_path = Path(__file__).parent.parent / "config" / "writers.yaml"
        if config_path.exists():
            with open(config_path, "r", encoding="utf-8") as f:
                _WRITER_CONFIG = yaml.safe_load(f)
        else:
            logger.warning(f"Config file non trovato: {config_path}")
            _WRITER_CONFIG = {}

    return _WRITER_CONFIG


class EnrichmentGraphWriter:
    """
    Writer per scrittura entità nel grafo.

    Crea nodi e relazioni usando query Cypher configurate
    in writers.yaml.

    Attributes:
        graph: Client FalkorDB
        config: Configurazione da YAML
        schema_version: Versione schema per tracking

    Example:
        >>> writer = EnrichmentGraphWriter(graph_client)
        >>> written = await writer.write_batch(linked, content)
        >>> print(f"Scritti {len(written)} entità")
    """

    def __init__(
        self,
        graph_client: "FalkorDBClient",
        schema_version: Optional[str] = None,
    ):
        """
        Inizializza il writer.

        Args:
            graph_client: Client FalkorDB
            schema_version: Override versione schema
        """
        self.graph = graph_client
        self._config = _load_writer_config()

        self.schema_version = (
            schema_version or
            self._config.get("schema_version", "2.1")
        )

        # Parametri
        general = self._config.get("general", {})
        self.batch_size = general.get("batch_size", 50)
        self.retry_count = general.get("retry_count", 3)

    async def write_batch(
        self,
        entities: List[LinkedEntity],
        content: EnrichmentContent
    ) -> List[LinkedEntity]:
        """
        Scrive un batch di entità nel grafo.

        Args:
            entities: Entità linkate da scrivere
            content: Contenuto originale (per metadata)

        Returns:
            Lista entità scritte con successo
        """
        written = []

        for entity in entities:
            try:
                await self._write_entity(entity, content)
                written.append(entity)
            except Exception as e:
                logger.error(f"Errore scrittura {entity.node_id}: {e}")

        return written

    # Mapping EntityType.value → chiave query in writers.yaml
    _TYPE_TO_QUERY_KEY: Dict[str, str] = {
        "concetto": "concept",
        "principio": "principle",
        "definizione": "definition",
        "soggetto": "soggetto",
        "ruolo": "ruolo",
        "modalita": "modalita",
        "fatto": "fatto",
        "atto": "atto",
        "procedura": "procedura",
        "termine": "termine",
        "effetto": "effetto",
        "responsabilita": "responsabilita",
        "rimedio": "rimedio",
        "sanzione": "sanzione",
        "caso": "caso",
        "eccezione": "eccezione",
        "clausola": "clausola",
    }

    async def _write_entity(
        self,
        linked: LinkedEntity,
        content: EnrichmentContent
    ) -> None:
        """
        Scrive singola entità nel grafo.

        Supporta tutte le 17 tipologie di entità definite in EntityType.
        """
        entity = linked.entity
        queries = self._config.get("cypher_create", {})

        # Trova la query per il tipo di entità
        query_key = self._TYPE_TO_QUERY_KEY.get(entity.tipo.value)
        if not query_key:
            logger.warning(f"Tipo entità non supportato: {entity.tipo}")
            return

        query = queries.get(query_key)
        if not query:
            logger.warning(f"Query non configurata per {entity.tipo} (key: {query_key})")
            return

        # Costruisci parametri base (comuni a tutte le entità)
        params = {
            "node_id": linked.node_id,
            "nome": entity.nome,
            "nome_normalizzato": normalize_name(entity.nome),
            "descrizione": linked.final_descrizione,
            "fonte": entity.fonte,
            "schema_version": self.schema_version,
        }

        # Aggiungi parametri specifici per tipo
        params.update(self._get_type_specific_params(entity))

        # Esegui query
        await self.graph.query(query, params)

        # Crea relazioni con articoli correlati
        await self._write_relations(linked, content)

    def _get_type_specific_params(self, entity) -> Dict[str, Any]:
        """
        Restituisce parametri specifici per tipo di entità.

        Ogni tipo di nodo può avere proprietà specifiche che devono
        essere passate alla query Cypher.
        """
        tipo = entity.tipo.value
        params: Dict[str, Any] = {}

        if tipo == "concetto":
            params["ambito"] = getattr(entity, "ambito", "diritto_civile")
        elif tipo == "principio":
            params["livello"] = getattr(entity, "livello", "codicistico")
        elif tipo == "definizione":
            params["tipo_definizione"] = getattr(entity, "tipo_definizione", "dottrinale")
        elif tipo == "soggetto":
            params["tipo_soggetto"] = getattr(entity, "tipo_soggetto", "ruolo")
        elif tipo == "ruolo":
            params["contesto"] = getattr(entity, "contesto", "contrattuale")
        elif tipo == "modalita":
            params["tipo_modalita"] = getattr(entity, "tipo_modalita", "obbligo")
            params["correlativo"] = getattr(entity, "correlativo", "")
        elif tipo == "fatto":
            params["tipo_fatto"] = getattr(entity, "tipo_fatto", "naturale")
            params["effetti"] = getattr(entity, "effetti", [])
        elif tipo == "atto":
            params["tipo_atto"] = getattr(entity, "tipo_atto", "negoziale")
            params["forma"] = getattr(entity, "forma", "libera")
        elif tipo == "procedura":
            params["tipo_procedura"] = getattr(entity, "tipo_procedura", "giudiziale")
            params["fasi"] = getattr(entity, "fasi", [])
        elif tipo == "termine":
            params["tipo_termine"] = getattr(entity, "tipo_termine", "prescrizione")
            params["durata"] = getattr(entity, "durata", "")
            params["decorrenza"] = getattr(entity, "decorrenza", "")
        elif tipo == "effetto":
            params["tipo_effetto"] = getattr(entity, "tipo_effetto", "costitutivo")
        elif tipo == "responsabilita":
            params["tipo_responsabilita"] = getattr(entity, "tipo_responsabilita", "contrattuale")
        elif tipo == "rimedio":
            params["tipo_rimedio"] = getattr(entity, "tipo_rimedio", "generale")
        elif tipo == "sanzione":
            params["tipo_sanzione"] = getattr(entity, "tipo_sanzione", "civile")
        elif tipo == "caso":
            params["esito"] = getattr(entity, "esito", "")
            params["principi_applicati"] = getattr(entity, "principi_applicati", [])
        elif tipo == "eccezione":
            params["regola_generale"] = getattr(entity, "regola_generale", "")
        elif tipo == "clausola":
            params["tipo_clausola"] = getattr(entity, "tipo_clausola", "accessoria")

        return params

    async def _write_relations(
        self,
        linked: LinkedEntity,
        content: EnrichmentContent
    ) -> None:
        """
        Crea relazioni tra entità e norme usando mapping da config.

        Il mapping entity_type → relation_type è definito in writers.yaml
        (sezione entity_relation_mapping) per garantire:
        - Zero hardcoding nel codice
        - Rigore epistemologico (relazioni da knowledge-graph.md)
        - Sperimentabilità (cambia YAML, non Python)
        """
        entity = linked.entity
        entity_type = entity.tipo.value  # es. "concetto", "soggetto", etc.

        # Leggi mapping da config (ZERO hardcoding)
        mapping = self._config.get("entity_relation_mapping", {}).get(entity_type)
        if not mapping:
            logger.debug(f"Nessun mapping relazione per tipo: {entity_type}")
            return

        # Estrai configurazione per questo tipo
        query_key = mapping.get("query_key")
        param_name = mapping.get("param_name")

        if not query_key or not param_name:
            logger.warning(f"Mapping incompleto per {entity_type}: {mapping}")
            return

        # Cerca la query Cypher
        queries = self._config.get("cypher_relations", {})
        rel_query = queries.get(query_key)

        if not rel_query:
            logger.warning(f"Query Cypher non trovata: {query_key}")
            return

        # Crea relazione per ogni articolo correlato
        article_refs = entity.articoli_correlati or content.article_refs
        relations_created = 0

        for urn in article_refs:
            try:
                await self.graph.query(
                    rel_query,
                    {
                        "urn": urn,
                        param_name: linked.node_id,
                        "fonte": entity.fonte,
                    }
                )
                relations_created += 1
            except Exception as e:
                logger.debug(f"Relazione non creata per {urn}: {e}")

        if relations_created > 0:
            rel_type = mapping.get("relation_type", "UNKNOWN")
            logger.debug(
                f"Creata {relations_created} relazione/i {rel_type} "
                f"per {entity_type}:{linked.node_id}"
            )

    async def write_dottrina(
        self,
        content: EnrichmentContent,
        concetti_ids: List[str],
        principi_ids: List[str],
    ) -> Optional[str]:
        """
        Crea nodo Dottrina ristrutturato.

        Args:
            content: Contenuto originale
            concetti_ids: ID concetti estratti
            principi_ids: ID principi estratti

        Returns:
            node_id del nodo creato o None
        """
        queries = self._config.get("cypher_create", {})
        query = queries.get("dottrina")

        if not query:
            logger.warning("Query dottrina non configurata")
            return None

        # Genera node_id
        article_num = content.metadata.get("article_num", "unknown")
        node_id = f"dottrina:{content.content_type}:{article_num}"

        params = {
            "node_id": node_id,
            "tipo": content.content_type,
            "testo": content.text,
            "autore": "Brocardi" if "brocardi" in content.source else content.source,
            "fonte": content.source,
            "concetti_trattati": concetti_ids,
            "principi_trattati": principi_ids,
            "schema_version": self.schema_version,
        }

        try:
            await self.graph.query(query, params)

            # Crea relazioni COMMENTA con norme
            rel_queries = self._config.get("cypher_relations", {})
            commenta_query = rel_queries.get("dottrina_commenta_norma")

            if commenta_query:
                for urn in content.article_refs:
                    try:
                        await self.graph.query(
                            commenta_query,
                            {"dottrina_id": node_id, "urn": urn}
                        )
                    except Exception as e:
                        logger.debug("dottrina_link_failed: %s", str(e))

            return node_id

        except Exception as e:
            logger.error(f"Errore creazione Dottrina: {e}")
            return None

    async def cleanup_old_dottrina(
        self,
        min_version: str = "2.0",
        batch_size: int = 1000
    ) -> int:
        """
        Cancella nodi Dottrina con schema vecchio.

        Args:
            min_version: Versione minima da mantenere
            batch_size: Nodi per batch

        Returns:
            Totale nodi cancellati
        """
        queries = self._config.get("cleanup", {})
        query = queries.get("delete_old_dottrina")

        if not query:
            # Fallback query
            query = """
                MATCH (d:Dottrina)
                WHERE NOT exists(d.schema_version) OR d.schema_version < $min_version
                WITH d LIMIT $batch_size
                DETACH DELETE d
                RETURN count(d) as deleted
            """

        total_deleted = 0

        while True:
            try:
                result = await self.graph.query(
                    query,
                    {"min_version": min_version, "batch_size": batch_size}
                )
                deleted = result[0]["deleted"] if result else 0
                total_deleted += deleted

                if deleted < batch_size:
                    break

                logger.info(f"Cancellati {total_deleted} nodi Dottrina...")

            except Exception as e:
                logger.error(f"Errore cleanup: {e}")
                break

        logger.info(f"Totale Dottrina cancellati: {total_deleted}")
        return total_deleted

    async def ensure_indexes(self) -> None:
        """Crea indici per nuovi nodi se non esistono."""
        indexes = self._config.get("indexes", [])

        for idx in indexes:
            label = idx.get("label")
            prop = idx.get("property")
            idx_type = idx.get("type", "index")

            if idx_type == "unique":
                query = f"CREATE CONSTRAINT IF NOT EXISTS FOR (n:{label}) REQUIRE n.{prop} IS UNIQUE"
            else:
                query = f"CREATE INDEX IF NOT EXISTS FOR (n:{label}) ON (n.{prop})"

            try:
                await self.graph.query(query)
                logger.debug(f"Indice creato: {label}.{prop}")
            except Exception as e:
                logger.debug(f"Indice già esistente o errore: {e}")
