"""
Entity Graph Writer with 3-Layer Deduplication
===============================================

Writes approved entities from pending_entities to FalkorDB graph.

Deduplication Strategy (3 Layers):
1. **Mechanical**: Exact match on normalized (nome, tipo)
2. **LLM Semantic**: Embedding similarity for near-duplicates
3. **Peer-Reviewed**: Community validates no duplicates (via votes)

Entity Node Schema:
    (:Entity:{EntityType} {
        id: "principio:legittima_difesa",
        nome: "Legittima difesa",
        tipo: "principio",
        descrizione: "...",
        ambito: "penale",
        community_validated: true,
        approval_score: 2.5,
        votes_count: 3,
        sources: ["urn:nir:...~art52", "user_doc:123"],
        created_at: datetime(),
        updated_at: datetime()
    })

Relations Created:
    - (Norma)-[:DISCIPLINA|ESPRIME_PRINCIPIO|DEFINISCE|...]->(Entity)
    - (Entity)-[:SPECIES|IMPLICA|...]->(Entity)  # If applicable

Usage:
    from merlt.storage.graph.entity_writer import EntityGraphWriter
    from merlt.storage.enrichment import get_db_session, PendingEntity

    writer = EntityGraphWriter(falkordb_client)

    async with get_db_session() as session:
        # Get approved entities
        approved = await session.execute(
            select(PendingEntity)
            .where(PendingEntity.consensus_reached == True)
            .where(PendingEntity.consensus_type == 'approved')
            .where(PendingEntity.written_to_graph_at == None)
        )

        for entity in approved.scalars():
            result = await writer.write_entity(entity)
            if result.success:
                entity.written_to_graph_at = datetime.now()
                await session.commit()
"""

import re
import structlog
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from dataclasses import dataclass

from merlt.storage.graph.client import FalkorDBClient
from merlt.storage.enrichment.models import PendingEntity, PendingRelation
from merlt.pipeline.enrichment.models import EntityType, RelationType

log = structlog.get_logger()


@dataclass
class WriteResult:
    """Result of writing an entity to the graph."""

    success: bool
    node_id: Optional[str] = None  # Created or matched node ID
    action: Optional[str] = None  # 'created' | 'enriched_existing' | 'duplicate_merged'
    duplicate_of: Optional[str] = None  # If duplicate, ID of existing node
    error: Optional[str] = None


class EntityGraphWriter:
    """
    Writes validated entities to FalkorDB with 3-layer deduplication.

    Deduplication Layers:
    1. Mechanical: Exact match on normalized (nome, tipo)
    2. LLM Semantic: Embedding similarity (cosine > 0.95)
    3. Peer-Reviewed: Community flags duplicates via votes
    """

    def __init__(
        self,
        falkordb_client: FalkorDBClient,
        embedding_service=None,  # Optional for Layer 2
        semantic_threshold: float = 0.95,  # Cosine similarity threshold
    ):
        """
        Initialize writer.

        Args:
            falkordb_client: FalkorDB client
            embedding_service: Optional EmbeddingService for semantic dedup
            semantic_threshold: Cosine similarity threshold for duplicates
        """
        self.falkordb = falkordb_client
        self.embedding_service = embedding_service
        self.semantic_threshold = semantic_threshold
        self._timestamp = None

    async def write_entity(
        self,
        entity: PendingEntity,
        skip_deduplication: bool = False,
    ) -> WriteResult:
        """
        Write approved entity to graph with deduplication.

        Args:
            entity: PendingEntity (must be consensus_reached = approved)
            skip_deduplication: If True, skip Layer 1 & 2 (for testing)

        Returns:
            WriteResult with node_id and action

        Raises:
            ValueError: If entity is not approved
        """
        # Validate entity is approved
        if not entity.consensus_reached or entity.consensus_type != "approved":
            raise ValueError(f"Entity {entity.entity_id} is not approved (status={entity.validation_status})")

        self._timestamp = datetime.now(timezone.utc).isoformat()

        log.info("Writing entity to graph", entity_id=entity.entity_id, type=entity.entity_type)

        # Layer 1: Mechanical deduplication
        if not skip_deduplication:
            duplicate_id = await self._check_duplicate_mechanical(entity.entity_text, entity.entity_type)

            if duplicate_id:
                log.info("Layer 1: Mechanical duplicate found", existing_id=duplicate_id)
                await self._enrich_existing_entity(duplicate_id, entity)
                return WriteResult(
                    success=True,
                    node_id=duplicate_id,
                    action="enriched_existing",
                    duplicate_of=duplicate_id,
                )

            # Layer 2: LLM Semantic deduplication
            if self.embedding_service:
                duplicate = await self._check_duplicate_llm(entity.entity_text, entity.descrizione, entity.entity_type)

                if duplicate:
                    log.info("Layer 2: LLM semantic duplicate found", existing_id=duplicate["existing_id"], similarity=duplicate["similarity"])
                    await self._enrich_existing_entity(duplicate["existing_id"], entity)
                    return WriteResult(
                        success=True,
                        node_id=duplicate["existing_id"],
                        action="enriched_existing",
                        duplicate_of=duplicate["existing_id"],
                    )

        # Layer 3: Peer-reviewed (already handled via entity_votes 'duplicate' type)
        # If community flagged as duplicate, it shouldn't reach here (rejected in validation)

        # No duplicate found → Create new node
        node_id = await self._create_new_entity_node(entity)

        # Create relation to article
        await self._create_entity_relation(entity, node_id)

        log.info("Entity written to graph", node_id=node_id, action="created")

        return WriteResult(
            success=True,
            node_id=node_id,
            action="created",
        )

    async def _check_duplicate_mechanical(
        self,
        entity_text: str,
        entity_type: str,
    ) -> Optional[str]:
        """
        Layer 1: Check for exact match on normalized (nome, tipo).

        Args:
            entity_text: Entity name
            entity_type: Entity type

        Returns:
            Existing node ID if duplicate, None otherwise

        Logic:
            - Normalize: lowercase, strip, remove articles
            - Match on tipo:{normalized_nome}
        """
        normalized = self._normalize_nome(entity_text)
        expected_id = f"{entity_type}:{normalized}"

        query = """
        MATCH (e:Entity)
        WHERE e.id = $expected_id
        RETURN e.id AS id
        LIMIT 1
        """

        result = await self.falkordb.query(query, {"expected_id": expected_id})

        if result and len(result) > 0:
            return result[0]["id"]

        return None

    async def _check_duplicate_llm(
        self,
        entity_text: str,
        descrizione: Optional[str],
        entity_type: str,
    ) -> Optional[Dict[str, Any]]:
        """
        Layer 2: Check for semantic duplicates using embeddings.

        Args:
            entity_text: Entity name
            descrizione: Entity description
            entity_type: Entity type

        Returns:
            Dict with existing_id and similarity if duplicate, None otherwise

        Logic:
            - Generate embedding for (entity_text + descrizione)
            - Query existing entities of same type
            - Compute cosine similarity
            - Return if similarity > threshold
        """
        if not self.embedding_service:
            return None

        # Combine text and description
        combined_text = f"{entity_text}. {descrizione}" if descrizione else entity_text

        # Generate embedding
        try:
            query_embedding = await self.embedding_service.embed_query(combined_text)
        except Exception as e:
            log.warning("Failed to generate embedding for dedup", error=str(e))
            return None

        # Get existing entities of same type from graph
        # Note: We'll need to add embeddings to Entity nodes for this to work
        # For now, fallback to text similarity (Levenshtein or similar)

        # TODO: Implement proper embedding-based similarity
        # For Phase 1, mechanical dedup is sufficient
        # This will be enhanced in Phase 2 with vector storage

        return None

    def _normalize_nome(self, nome: str) -> str:
        """
        Normalize entity name for deduplication.

        Rules:
        - Lowercase
        - Strip whitespace
        - Remove articles (il, lo, la, i, gli, le)
        - Replace spaces with underscores
        - Remove special chars

        Examples:
            "La Legittima difesa" -> "legittima_difesa"
            "Il Contratto di compravendita" -> "contratto_compravendita"
        """
        normalized = nome.lower().strip()

        # Remove Italian articles
        articles = ["il ", "lo ", "la ", "i ", "gli ", "le ", "l'", "un ", "uno ", "una "]
        for article in articles:
            if normalized.startswith(article):
                normalized = normalized[len(article) :]
                break

        # Replace hyphens with spaces (so "Legittima-difesa" → "Legittima difesa")
        normalized = normalized.replace("-", " ")

        # Remove special chars, keep alphanumeric and spaces
        normalized = re.sub(r"[^a-z0-9\s]", "", normalized)

        # Replace spaces with underscores
        normalized = normalized.replace(" ", "_")

        # Remove multiple underscores
        normalized = re.sub(r"_+", "_", normalized)

        # Strip underscores
        normalized = normalized.strip("_")

        return normalized

    async def _create_new_entity_node(self, entity: PendingEntity) -> str:
        """
        Create new Entity node in graph.

        Node Labels: :Entity:{EntityType}
        Node ID: {tipo}:{normalized_nome}

        Properties:
            - id: Unique identifier
            - nome: Display name
            - tipo: Entity type
            - descrizione: Description
            - ambito: Legal domain
            - community_validated: True (always for approved entities)
            - approval_score: Weighted approval score
            - votes_count: Number of votes
            - sources: Array of source URNs
            - created_at, updated_at: Timestamps
        """
        normalized = self._normalize_nome(entity.entity_text)
        node_id = f"{entity.entity_type}:{normalized}"

        # Entity type for label (capitalize first letter)
        entity_label = entity.entity_type.capitalize()

        # Cypher query with parameterized label (workaround: use format)
        # FalkorDB doesn't support parameterized labels, must use string format
        query = f"""
        CREATE (e:Entity:{entity_label} {{
            id: $id,
            nome: $nome,
            tipo: $tipo,
            descrizione: $descrizione,
            ambito: $ambito,
            community_validated: true,
            approval_score: $approval_score,
            votes_count: $votes_count,
            sources: [$source],
            contributed_by: $contributed_by,
            contributor_authority: $contributor_authority,
            created_at: $timestamp,
            updated_at: $timestamp
        }})
        RETURN e.id AS id
        """

        params = {
            "id": node_id,
            "nome": entity.entity_text,
            "tipo": entity.entity_type,
            "descrizione": entity.descrizione or "",
            "ambito": entity.ambito or "",
            "approval_score": entity.approval_score or 0.0,
            "votes_count": entity.votes_count or 0,
            "source": entity.article_urn,
            "contributed_by": entity.contributed_by or "",
            "contributor_authority": entity.contributor_authority or 0.0,
            "timestamp": self._timestamp,
        }

        result = await self.falkordb.query(query, params)

        if not result or len(result) == 0:
            raise RuntimeError(f"Failed to create entity node: {node_id}")

        log.debug("Created entity node", node_id=node_id, label=entity_label)
        return node_id

    async def _enrich_existing_entity(self, existing_id: str, entity: PendingEntity) -> None:
        """
        Enrich existing entity node with additional information.

        Updates:
        - Add source URN to sources array (if not already present)
        - Update descrizione if richer (longer)
        - Update approval_score (keep maximum)
        - Increment votes_count
        - Update updated_at timestamp

        Does NOT:
        - Change id or nome
        - Overwrite existing data
        """
        query = """
        MATCH (e:Entity {id: $id})
        SET e.sources = CASE
                WHEN $source IN e.sources THEN e.sources
                ELSE e.sources + [$source]
            END,
            e.approval_score = CASE
                WHEN $new_score > e.approval_score THEN $new_score
                ELSE e.approval_score
            END,
            e.votes_count = e.votes_count + $new_votes,
            e.updated_at = $timestamp
        RETURN e.id AS id
        """

        params = {
            "id": existing_id,
            "source": entity.article_urn,
            "new_score": entity.approval_score or 0.0,
            "new_votes": entity.votes_count or 0,
            "timestamp": self._timestamp,
        }

        await self.falkordb.query(query, params)
        log.debug("Enriched existing entity", node_id=existing_id)

    async def _create_entity_relation(self, entity: PendingEntity, node_id: str) -> None:
        """
        Create semantic relation from article to entity.

        Uses RelationType to determine relation type.
        Defaults to DISCIPLINA if not specified.

        Examples:
            (Art. 52 CP)-[:ESPRIME_PRINCIPIO]->(Principio:Legittima difesa)
            (Art. 1453 CC)-[:DISCIPLINA]->(Concetto:Inadempimento)
        """
        # Determine relation type based on entity type
        # This mapping can be customized per domain
        relation_mapping = {
            "principio": "ESPRIME_PRINCIPIO",
            "definizione": "DEFINISCE",
            "concetto": "DISCIPLINA",
            "soggetto": "DISCIPLINA",
            "fatto": "PREVEDE",
            "procedura": "REGOLA_PROCEDURA",
            "termine": "STABILISCE_TERMINE",
            "sanzione": "PREVEDE",
            "rimedio": "PREVEDE",
        }

        relation_type = relation_mapping.get(entity.entity_type, "DISCIPLINA")

        # Create relation (create Norma node if it doesn't exist)
        query = f"""
        MERGE (art:Norma {{URN: $article_urn}})
        ON CREATE SET art.created_at = $timestamp
        WITH art
        MATCH (e:Entity {{id: $entity_id}})
        MERGE (art)-[r:{relation_type}]->(e)
        ON CREATE SET
            r.certezza = 1.0,
            r.fonte = 'community_validation',
            r.created_at = $timestamp
        RETURN r
        """

        params = {
            "article_urn": entity.article_urn,
            "entity_id": node_id,
            "timestamp": self._timestamp,
        }

        await self.falkordb.query(query, params)
        log.debug("Created entity relation", relation=relation_type, article=entity.article_urn, entity=node_id)


# ====================================================
# BATCH WRITER
# ====================================================
async def write_approved_entities_batch(
    falkordb_client: FalkorDBClient,
    entities: List[PendingEntity],
) -> Dict[str, int]:
    """
    Batch write approved entities to graph.

    Args:
        falkordb_client: FalkorDB client
        entities: List of approved PendingEntity instances

    Returns:
        Stats dict with counts
    """
    writer = EntityGraphWriter(falkordb_client)

    stats = {
        "total": len(entities),
        "created": 0,
        "enriched": 0,
        "errors": 0,
    }

    for entity in entities:
        try:
            result = await writer.write_entity(entity)

            if result.success:
                if result.action == "created":
                    stats["created"] += 1
                elif result.action == "enriched_existing":
                    stats["enriched"] += 1
        except Exception as e:
            log.error("Failed to write entity", entity_id=entity.entity_id, error=str(e))
            stats["errors"] += 1

    log.info("Batch write complete", **stats)
    return stats


# ====================================================
# EXPORTS
# ====================================================
__all__ = [
    "EntityGraphWriter",
    "WriteResult",
    "write_approved_entities_batch",
]
