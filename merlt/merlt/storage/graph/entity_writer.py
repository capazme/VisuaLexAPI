"""
Entity Graph Writer with Deduplication
=======================================

Writes approved entities from pending_entities to FalkorDB graph.

Deduplication Strategy:
1. **Mechanical**: Exact match on normalized (nome, tipo)
2. **Peer-Reviewed**: Community validates no duplicates (via votes)

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
from merlt.utils.urn_labels import derive_article_fields_from_urn
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
    2. Peer-Reviewed: Community flags duplicates via votes
    """

    def __init__(
        self,
        falkordb_client: FalkorDBClient,
    ):
        """
        Initialize writer.

        Args:
            falkordb_client: FalkorDB client
        """
        self.falkordb = falkordb_client
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
                await self._link_provisional_source(entity.entity_id, duplicate_id)
                return WriteResult(
                    success=True,
                    node_id=duplicate_id,
                    action="enriched_existing",
                    duplicate_of=duplicate_id,
                )

        # Layer 2 (peer-reviewed) already handled via entity_votes 'duplicate' type
        # If community flagged as duplicate, it shouldn't reach here (rejected in validation)

        # No duplicate found → Create new node
        node_id = await self._create_new_entity_node(entity)

        # Create relation to article
        await self._create_entity_relation(entity, node_id)

        # Loop β D.2: if this approved entity originated from a confirmed live
        # source (Phase D.1 confirm-source stamped `pending_entity_id` on the
        # provisional LiveSource node), link the two with a CITA edge so the
        # provenance trail "questo claim nasce da questa fonte live" stays
        # navigable on /grafo. No-op for entities not born of a live source.
        await self._link_provisional_source(entity.entity_id, node_id)

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

        # Provenance / trust (Loop β, task B.1): entities written here have
        # already cleared community consensus, so they carry the highest trust.
        # `provenance` distinguishes them from `lazy_ingest` (auto-scraped) and
        # `seed` (Libro IV snapshot) nodes; `trust` (0..1) feeds the
        # provenance-aware traversal scoring (task B.3).
        provenance = "community_validated"
        trust = 1.0

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
            provenance: $provenance,
            trust: $trust,
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
            "provenance": provenance,
            "trust": trust,
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
        # An enrichment coming from the consensus-approved path lifts the node to
        # `community_validated` / trust 1.0 — but only as an upgrade: a node that
        # is already at trust 1.0 (or higher, defensively) is left untouched so we
        # never downgrade provenance/trust (task B.1).
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
            e.provenance = CASE
                WHEN coalesce(e.trust, 0.0) >= $trust THEN e.provenance
                ELSE $provenance
            END,
            e.trust = CASE
                WHEN coalesce(e.trust, 0.0) >= $trust THEN e.trust
                ELSE $trust
            END,
            e.updated_at = $timestamp
        RETURN e.id AS id
        """

        params = {
            "id": existing_id,
            "source": entity.article_urn,
            "new_score": entity.approval_score or 0.0,
            "new_votes": entity.votes_count or 0,
            "provenance": "community_validated",
            "trust": 1.0,
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

        # A2: give a freshly-created Norma stub a minimal identity derived from
        # the URN so it never renders as a raw URL. ON CREATE only — an existing
        # (seed/community) node is never overwritten. Both may be None when the
        # URN has no article segment; the SET then just writes null (harmless).
        numero_articolo, estremi = derive_article_fields_from_urn(entity.article_urn)

        # Create relation (create Norma node if it doesn't exist).
        # Stamp provenance/trust on the (possibly stub) Norma node with coalesce
        # so an existing seed/community node is never downgraded; the relation
        # itself also carries `provenance` (best-effort, task B.1).
        query = f"""
        MERGE (art:Norma {{URN: $article_urn}})
        ON CREATE SET
            art.created_at = $timestamp,
            art.numero_articolo = $numero_articolo,
            art.estremi = $estremi
        SET art.provenance = coalesce(art.provenance, $provenance),
            art.trust = coalesce(art.trust, $trust)
        WITH art
        MATCH (e:Entity {{id: $entity_id}})
        MERGE (art)-[r:{relation_type}]->(e)
        ON CREATE SET
            r.certezza = 1.0,
            r.fonte = 'community_validation',
            r.provenance = $provenance,
            r.created_at = $timestamp
        RETURN r
        """

        params = {
            "article_urn": entity.article_urn,
            "entity_id": node_id,
            "provenance": "community_validated",
            "trust": 1.0,
            "timestamp": self._timestamp,
            "numero_articolo": numero_articolo,
            "estremi": estremi,
        }

        await self.falkordb.query(query, params)
        log.debug("Created entity relation", relation=relation_type, article=entity.article_urn, entity=node_id)

    async def _link_provisional_source(self, pending_entity_id: str, entity_node_id: str) -> None:
        """
        Link an approved Entity to the provisional LiveSource it was born from.

        Loop β, Phase D (decision: keep the source node distinct, link via CITA):
        Phase D.1 `confirm-source` stamps `pending_entity_id` on the provisional
        ``LiveSource`` node (the live-retrieved document the user vouched for).
        When that pending entity later clears community consensus and is written
        here, we MERGE a ``(:Entity)-[:CITA]->(:LiveSource)`` edge so the
        provenance — "questo claim deriva da questa fonte recuperata live" —
        remains visible and navigable, and lift the source to
        ``community_validated`` / trust 1.0 (upgrade-only, never a downgrade).

        Entities NOT born of a confirmed source have no matching LiveSource, so
        the MATCH yields nothing and the call is a harmless no-op. Fully
        failure-isolated: an error here never fails the entity write — the link
        is provenance enrichment, not a correctness requirement.
        """
        query = """
        MATCH (ls:LiveSource {pending_entity_id: $eid})
        MATCH (e:Entity {id: $nid})
        MERGE (e)-[r:CITA]->(ls)
        ON CREATE SET
            r.fonte = 'community_validation',
            r.provenance = 'community_validated',
            r.created_at = $timestamp
        SET ls.provenance = 'community_validated',
            ls.trust = CASE WHEN coalesce(ls.trust, 0.0) >= 1.0 THEN ls.trust ELSE 1.0 END,
            ls.updated_at = $timestamp
        RETURN e.id AS id
        """
        try:
            result = await self.falkordb.query(
                query,
                {
                    "eid": pending_entity_id,
                    "nid": entity_node_id,
                    "timestamp": self._timestamp or datetime.now(timezone.utc).isoformat(),
                },
            )
            if result:
                log.info(
                    "Linked approved entity to its provisional live source",
                    pending_entity_id=pending_entity_id,
                    entity_node_id=entity_node_id,
                )
        except Exception as e:  # noqa: BLE001 - provenance link is best-effort
            log.warning(
                "Failed to link provisional source (non-fatal)",
                pending_entity_id=pending_entity_id,
                error=str(e),
            )


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
