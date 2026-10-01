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
      (written for a duplicate too: the article that proposed it is linked)
    - (Entity)-[:SPECIES|IMPLICA|...]->(Entity)  # If applicable
    - (Entity)-[:DERIVA_DA]->(LiveSource)  # If born of a confirmed live source

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
import unicodedata
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from dataclasses import dataclass

from merlt.storage.graph.client import FalkorDBClient
from merlt.storage.graph.relation_endpoints import wrapped_norm_key
from merlt.storage.graph.schema import Provenance, Rel, SEED_TWIN, canonical_urn, stub_properties
from merlt.storage.enrichment.models import PendingEntity, PendingRelation
from merlt.pipeline.enrichment.models import EntityType, RelationType

log = structlog.get_logger()

# article → entity relation, by the entity's type: the seed's names.
RELATION_BY_ENTITY_TYPE: dict[str, Rel] = {
    "principio": Rel.ESPRIME_PRINCIPIO,
    "definizione": Rel.DEFINISCE,
    "definizione_legale": Rel.DEFINISCE,
    "concetto": Rel.DISCIPLINA,
    "diritto_soggettivo": Rel.CONFERISCE,
    "interesse_legittimo": Rel.DISCIPLINA,
    "soggetto_giuridico": Rel.APPLICA_A,
    "ruolo_giuridico": Rel.APPLICA_A,
    "organo": Rel.APPLICA_A,
    "fatto_giuridico": Rel.PREVEDE,
    "procedura": Rel.PREVEDE,
    "termine": Rel.STABILISCE_TERMINE,
    "sanzione": Rel.PREVEDE_SANZIONE,
    "responsabilita": Rel.ATTRIBUISCE_RESPONSABILITA,
    "modalita_giuridica": Rel.IMPONE,
    "brocardo": Rel.ESPRIME,
}


@dataclass
class WriteResult:
    """Result of writing an entity to the graph."""

    success: bool
    node_id: Optional[str] = None  # Created or matched node ID
    action: Optional[str] = None  # 'created' | 'enriched_existing' | 'duplicate_merged'
    duplicate_of: Optional[str] = None  # If duplicate, ID of existing node
    error: Optional[str] = None


# `pending_entities.article_urn` is NOT NULL, so a note-derived entity that is
# not bound to a norm carries the `user_document` placeholder (document_parser
# staging + BFF promote fallback). The placeholder must never reach the graph:
# MERGE (art:Norma {URN: 'user_document'}) created one fake hub every
# stand-alone concept hung off, visible on /grafo.
PLACEHOLDER_ARTICLE_URNS = frozenset({"", "user_document"})


def is_real_article_urn(urn: object) -> bool:
    """True when `urn` names an actual norm (not blank, not the placeholder)."""
    return isinstance(urn, str) and urn.strip() not in PLACEHOLDER_ARTICLE_URNS


def normalize_entity_name(nome: str) -> str:
    """
    Normalize an entity name into the slug of its graph node id.

    Rules:
    - Lowercase
    - Strip whitespace
    - Remove a leading Italian article (il, lo, la, i, gli, le, l', un, uno, una)
    - Replace hyphens and spaces with underscores
    - Remove special chars

    Examples:
        "La Legittima difesa" -> "legittima_difesa"
        "Il Contratto di compravendita" -> "contratto_di_compravendita"
    """
    normalized = (nome or "").lower().strip()

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


def seed_twin_slug(nome: str) -> str:
    """The slug of the seed's node id for a concept: the seed's own rule.

    The seed keys a concept `<prefix>:<slug>` (`SEED_TWIN`) and builds the slug
    from its name: lowercase, each accented letter folded to its base
    ("trasferibilità" -> "trasferibilita"), only letters, digits and spaces kept
    (an apostrophe, a hyphen or a stop is dropped, not turned into a space:
    "quasi-usufrutto" -> "quasiusufrutto"), each run of spaces one underscore. A
    leading article stays ("La reticenza" -> "la_reticenza").

    This is not `normalize_entity_name`, which makes the community id and is
    shared by the document parser and the router: that one deletes an accented
    letter ("trasferibilit"), turns a hyphen into a space and strips a leading
    article. The slug exists only to meet the seed's keys, so a twin is looked up
    by this one while the id it takes stays the community's. Checked on the Libro
    IV seed: this rule reproduces the `node_id` of all 3909 of its concept-like
    nodes; folding the accents and then applying `normalize_entity_name`
    reproduced 3865.

    The name is taken as it is spelt: a proposal that adds an article the seed's
    name does not have ("Il conduttore" for `conduttore`) does not meet it.
    """
    decomposed = unicodedata.normalize("NFD", nome or "")
    folded = "".join(ch for ch in decomposed if not unicodedata.combining(ch)).lower().strip()
    return re.sub(r"\s+", "_", re.sub(r"[^a-z0-9\s]", "", folded)).strip("_")


def entity_node_id(entity_type: str, nome: str) -> str:
    """The id of the :Entity node an approved entity is written as.

    ``{tipo}:{normalized_nome}`` — the same id whether the writer creates the
    node or enriches the mechanical duplicate it matched, so it is also the
    forward reference a relation can hold before the entity reaches the graph.
    """
    return f"{entity_type}:{normalize_entity_name(nome)}"


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
                # The community's validated link from this article is a graph edge, not
                # only a `sources` entry: written for a duplicate too (an existing entity,
                # or a seed twin that has just become one). It is a MERGE, so it is written
                # once however often it is proposed, and it goes first: the enrichment adds
                # to `votes_count`, which a retry after a failure here must not count twice.
                if is_real_article_urn(entity.article_urn):
                    await self._create_entity_relation(entity, duplicate_id)
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

        # Create relation to article (a stand-alone note entity has none)
        if is_real_article_urn(entity.article_urn):
            await self._create_entity_relation(entity, node_id)
        else:
            log.info("Entity has no source norm, written stand-alone", node_id=node_id)

        # Loop β D.2: if this approved entity originated from a confirmed live
        # source (Phase D.1 confirm-source stamped `pending_entity_id` on the
        # provisional LiveSource node), link the two with a DERIVA_DA edge so the
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
            - A concept the seed already has (its twin, `SEED_TWIN`) becomes the
              community entity: the seed node gains `:Entity` and the id
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

        twin = SEED_TWIN.get(entity_type)
        if twin:
            label, prefix = twin
            # The seed already has this concept: it becomes the community entity
            # (one node, one key) instead of a twin next to it. It is found by the
            # seed's own key (`seed_twin_slug`), and keeps an id it already has:
            # `definizione` and `definizione_legale` share one seed node, and the
            # second alias must not re-key what the first one adopted.
            rows = await self.falkordb.query(
                f"MATCH (c:{label.value} {{node_id: $nid}}) "
                "SET c:Entity, c.id = coalesce(c.id, $eid) RETURN c.id AS id",
                {"nid": f"{prefix}:{seed_twin_slug(entity_text)}", "eid": expected_id},
            )
            if rows:
                return rows[0]["id"]
        return None

    def _normalize_nome(self, nome: str) -> str:
        """Normalize entity name for deduplication (see normalize_entity_name)."""
        return normalize_entity_name(nome)

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
            "source": entity.article_urn if is_real_article_urn(entity.article_urn) else "user_note",
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
        # `sources`, `approval_score` and `votes_count` are coalesced: a seed twin
        # that became this entity (`_check_duplicate_mechanical`) never had them,
        # and a null there would drop the contribution without a trace.
        query = """
        MATCH (e:Entity {id: $id})
        SET e.sources = CASE
                WHEN $source IN coalesce(e.sources, []) THEN coalesce(e.sources, [])
                ELSE coalesce(e.sources, []) + [$source]
            END,
            e.approval_score = CASE
                WHEN $new_score > coalesce(e.approval_score, 0.0) THEN $new_score
                ELSE coalesce(e.approval_score, 0.0)
            END,
            e.votes_count = coalesce(e.votes_count, 0) + $new_votes,
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
            "source": entity.article_urn if is_real_article_urn(entity.article_urn) else "user_note",
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

        The relation type comes from `RELATION_BY_ENTITY_TYPE` (the seed's
        names); an entity type the table does not know gets DISCIPLINA.

        Examples:
            (Art. 52 CP)-[:ESPRIME_PRINCIPIO]->(Principio:Legittima difesa)
            (Art. 1453 CC)-[:DISCIPLINA]->(Concetto:Inadempimento)
            (Art. 575 CP)-[:PREVEDE_SANZIONE]->(Sanzione:Reclusione)
        """
        relation_type = RELATION_BY_ENTITY_TYPE.get(entity.entity_type, Rel.DISCIPLINA).value

        # Belt and braces for any other caller: the placeholder never becomes a node.
        if not is_real_article_urn(entity.article_urn):
            return

        # Create relation (create Norma node if it doesn't exist). A Norma this
        # writer creates is the schema's one stub shape (`stub_properties`),
        # set ON CREATE only: an existing (seed/ingested) node is never touched.
        # The graph keys a norm by its full Normattiva URL, so a bare `urn:nir:`
        # URN is keyed so too, or its stub would sit next to the article the seed
        # has. The relation itself carries the community's provenance.
        article_key = canonical_urn(wrapped_norm_key(entity.article_urn))
        query = f"""
        MERGE (art:Norma {{URN: $article_urn}})
        ON CREATE SET art += $stub, art.created_at = $timestamp
        WITH art
        MATCH (e:Entity {{id: $entity_id}})
        MERGE (art)-[r:{relation_type}]->(e)
        ON CREATE SET
            r.certezza = 1.0,
            r.fonte = 'community',
            r.provenance = $provenance,
            r.created_at = $timestamp
        RETURN r
        """

        params = {
            "article_urn": article_key,
            "stub": stub_properties(article_key),
            "entity_id": node_id,
            "provenance": Provenance.COMMUNITY_VALIDATED.value,
            "timestamp": self._timestamp,
        }

        await self.falkordb.query(query, params)
        log.debug("Created entity relation", relation=relation_type, article=entity.article_urn, entity=node_id)

    async def _link_provisional_source(self, pending_entity_id: str, entity_node_id: str) -> None:
        """
        Link an approved Entity to the provisional LiveSource it was born from.

        Loop β, Phase D (decision: keep the source node distinct, link via DERIVA_DA):
        Phase D.1 `confirm-source` stamps `pending_entity_id` on the provisional
        ``LiveSource`` node (the live-retrieved document the user vouched for).
        When that pending entity later clears community consensus and is written
        here, we MERGE a ``(:Entity)-[:DERIVA_DA]->(:LiveSource)`` edge so the
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
        MERGE (e)-[r:DERIVA_DA]->(ls)
        ON CREATE SET
            r.fonte = 'community',
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
    "entity_node_id",
    "normalize_entity_name",
    "write_approved_entities_batch",
]
