"""
GraphAwareRetriever
====================

Hybrid retrieval combining Qdrant vector search with FalkorDB graph structure.

Core algorithm:
1. Vector search in Qdrant (semantic similarity)
2. For each result, find linked graph nodes via Bridge Table
3. Compute graph score based on shortest path to context nodes
4. Combine: final_score = α * similarity_score + (1-α) * graph_score
5. Re-rank and return top-k

See docs/03-architecture/04-storage-layer.md for design details.
"""

import structlog
from typing import List, Optional, Dict, Any
from uuid import UUID

from merlt.storage.retriever.models import (
    RetrievalResult,
    VectorSearchResult,
    GraphPath,
    RetrieverConfig,
    EXPERT_TRAVERSAL_WEIGHTS
)
from merlt.storage.bridge import BridgeTable
from merlt.storage.graph import FalkorDBClient

from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from merlt.rlcf.policy_manager import PolicyManager
    from merlt.rlcf.execution_trace import ExecutionTrace

log = structlog.get_logger()


def _edge_type(edge: Any) -> str:
    """Relation-type name of a path edge. ``graph_db.shortest_path`` returns a
    path's edges as plain relation-type STRINGS (client.py); other/legacy
    producers may return edge dicts with a ``type`` field. Handle both shapes —
    treating a string edge as a dict (``edge.get(...)``) was crashing
    ``_score_path`` with "'str' object has no attribute 'get'" whenever a graph
    path actually existed between a chunk node and a context node."""
    if isinstance(edge, str):
        return edge
    if isinstance(edge, dict):
        return edge.get("type", "") or ""
    return ""


class GraphAwareRetriever:
    """
    Hybrid retriever combining vector similarity and graph structure.

    Flow:
        Query → Vector Search (Qdrant)
                       ↓
                 Chunk IDs
                       ↓
        Bridge Table → Graph Nodes (FalkorDB)
                       ↓
        Graph Score Calculation (shortest path)
                       ↓
        Hybrid Score = α * sim + (1-α) * graph
                       ↓
                Re-ranked Results

    Example:
        >>> retriever = GraphAwareRetriever(
        ...     vector_db=qdrant_client,
        ...     graph_db=falkordb_client,
        ...     bridge_table=bridge_table
        ... )
        >>> results = await retriever.retrieve(
        ...     query_embedding=embedding,
        ...     context_nodes=["urn:norma:cc:art1453"],
        ...     expert_type="LiteralExpert"
        ... )
    """

    def __init__(
        self,
        vector_db: Any,  # Qdrant client (not typed to avoid dependency)
        graph_db: FalkorDBClient,
        bridge_table: BridgeTable,
        config: Optional[RetrieverConfig] = None,
        policy_manager: Optional["PolicyManager"] = None
    ):
        """
        Initialize GraphAwareRetriever.

        Args:
            vector_db: Qdrant client for vector search
            graph_db: FalkorDB client for graph traversal
            bridge_table: Bridge table for chunk→node mapping
            config: Retriever configuration (default: alpha=0.7)
            policy_manager: PolicyManager per pesi neurali del traversal
        """
        self.vector_db = vector_db
        self.graph_db = graph_db
        self.bridge = bridge_table
        self.config = config or RetrieverConfig()
        self.policy_manager = policy_manager

        log.info(
            f"GraphAwareRetriever initialized - "
            f"alpha={self.config.alpha}, "
            f"over_retrieve={self.config.over_retrieve_factor}x, "
            f"max_hops={self.config.max_graph_hops}, "
            f"policy_manager={'enabled' if policy_manager else 'disabled'}"
        )

    async def retrieve(
        self,
        query_embedding: List[float],
        context_nodes: Optional[List[str]] = None,
        expert_type: Optional[str] = None,
        top_k: Optional[int] = None,
        source_types: Optional[List[str]] = None,
        trace: Optional["ExecutionTrace"] = None
    ) -> List[RetrievalResult]:
        """
        Perform hybrid retrieval combining vector similarity and graph structure.

        Args:
            query_embedding: Query vector from embedding model (e.g., E5-large)
            context_nodes: Graph node URNs extracted from query via NER
                           Example: ["urn:norma:cc:art1453", "urn:concetto:contratto"]
            expert_type: Expert type for traversal weights (LiteralExpert, SystemicExpert, etc.)
            top_k: Number of results to return (default from config)
            source_types: Filter by source type(s) for expert specialization.
                          Example: ["norma"] for LiteralExpert,
                                   ["massima"] for PrecedentExpert,
                                   ["ratio", "spiegazione"] for PrinciplesExpert
            trace: ExecutionTrace per registrare azioni per RLCF training

        Returns:
            List of RetrievalResult sorted by final_score (descending)

        Example:
            >>> context_nodes = ["urn:norma:cc:art1453"]  # Art. 1453 c.c.
            >>> results = await retriever.retrieve(
            ...     query_embedding=embed("termini risoluzione contratto"),
            ...     context_nodes=context_nodes,
            ...     expert_type="LiteralExpert",
            ...     source_types=["norma"],  # Solo norme per LiteralExpert
            ...     top_k=10
            ... )
        """
        if top_k is None:
            top_k = 20

        log.debug(
            f"retrieve() - context_nodes={len(context_nodes or [])}, "
            f"expert={expert_type}, source_types={source_types}, top_k={top_k}"
        )

        # STEP 1: Vector search (over-retrieve for re-ranking)
        vector_results = await self._vector_search(
            query_embedding,
            limit=top_k * self.config.over_retrieve_factor,
            source_types=source_types
        )

        log.debug(f"Vector search returned {len(vector_results)} candidates")

        # STEP 2: Graph enrichment
        enriched_results = []

        for vr in vector_results:
            # Get article_urn from payload metadata (more reliable than chunk_id)
            article_urn = vr.metadata.get("article_urn", "")

            # Find graph nodes linked to this article via FalkorDB
            # This is more reliable than bridge table since it queries the graph directly
            if article_urn and hasattr(self.graph_db, 'get_related_nodes_for_article'):
                linked_nodes = await self.graph_db.get_related_nodes_for_article(
                    article_urn,
                    max_results=10
                )
                # Convert to expected format for graph_score calculation
                linked_nodes = [
                    {
                        "graph_node_urn": node.get("node_urn") or node.get("node_nome", ""),
                        "node_type": node.get("node_label", ""),
                        "relation_type": node.get("rel_type", ""),
                        "direction": node.get("direction", ""),
                        "metadata": node
                    }
                    for node in linked_nodes
                ]
            else:
                # Fallback to bridge table (may not work if chunk_id mismatch)
                linked_nodes = await self.bridge.get_nodes_for_chunk(vr.chunk_id)

            # Compute graph score (con PolicyManager se disponibile)
            graph_score = await self._compute_graph_score(
                chunk_nodes=[node["graph_node_urn"] for node in linked_nodes if node.get("graph_node_urn")],
                context_nodes=context_nodes or [],
                expert_type=expert_type,
                query_embedding=query_embedding,
                trace=trace
            )

            # Combine scores
            final_score = self._combine_scores(vr.similarity_score, graph_score)

            enriched_results.append(RetrievalResult(
                chunk_id=vr.chunk_id,
                text=vr.text,
                similarity_score=vr.similarity_score,
                graph_score=graph_score,
                final_score=final_score,
                linked_nodes=linked_nodes,
                metadata=vr.metadata
            ))

        # STEP 3: Re-rank by final_score
        enriched_results.sort(key=lambda x: x.final_score, reverse=True)

        top_results = enriched_results[:top_k]

        # Slice B (graph co-evolution) signal 2 (re-retrieval) is credited by the
        # ORCHESTRATOR at question granularity (see Orchestrator._schedule_usage_credit),
        # NOT here per served result — retrieve() runs many times per question
        # (per tool-call × expert × ReAct iteration) and per-result crediting
        # saturated usage_cap within a single question, promoting nodes with zero
        # human feedback. The retriever stays read-only w.r.t. usage signals.

        if top_results:
            avg_score = sum(r.final_score for r in top_results) / len(top_results)
            log.info(
                f"retrieve() - returned {len(top_results)} results "
                f"(avg final_score={avg_score:.3f})"
            )
        else:
            log.info("retrieve() - returned 0 results")

        return top_results

    async def _vector_search(
        self,
        query_embedding: List[float],
        limit: int,
        source_types: Optional[List[str]] = None
    ) -> List[VectorSearchResult]:
        """
        Step 1: Vector similarity search in Qdrant.

        Args:
            query_embedding: Query vector
            limit: Number of results to retrieve
            source_types: Filter by source_type metadata (e.g., ["norma", "massima"])

        Returns:
            List of VectorSearchResult with chunk_id, text, similarity_score
        """
        if self.vector_db is None:
            log.warning("vector_db not configured, returning empty results")
            return []

        # Qdrant query_points API (qdrant-client >= 1.16)
        try:
            from qdrant_client.models import Filter, FieldCondition, MatchAny

            # Use collection name from config
            collection_name = self.config.collection_name

            # Build filter for source_type if specified
            query_filter = None
            if source_types:
                query_filter = Filter(
                    must=[
                        FieldCondition(
                            key="source_type",
                            match=MatchAny(any=source_types)
                        )
                    ]
                )
                log.debug(f"Applying source_type filter: {source_types}")

            # query_points() is the correct API for qdrant-client 1.16+
            response = self.vector_db.query_points(
                collection_name=collection_name,
                query=query_embedding,
                limit=limit,
                query_filter=query_filter
            )

            results = []
            for r in response.points:
                # Handle both UUID and integer IDs from Qdrant
                if isinstance(r.id, int):
                    # For integer IDs, create a deterministic UUID from the int
                    import hashlib
                    id_hash = hashlib.md5(str(r.id).encode(), usedforsecurity=False).hexdigest()
                    chunk_id = UUID(id_hash[:8] + '-' + id_hash[8:12] + '-' + id_hash[12:16] + '-' + id_hash[16:20] + '-' + id_hash[20:32])
                elif isinstance(r.id, UUID):
                    chunk_id = r.id
                else:
                    try:
                        chunk_id = UUID(str(r.id))
                    except ValueError:
                        # Fallback: create UUID from string hash
                        id_hash = hashlib.md5(str(r.id).encode(), usedforsecurity=False).hexdigest()
                        chunk_id = UUID(id_hash[:8] + '-' + id_hash[8:12] + '-' + id_hash[12:16] + '-' + id_hash[16:20] + '-' + id_hash[20:32])

                results.append(VectorSearchResult(
                    chunk_id=chunk_id,
                    text=r.payload.get("text", "") if r.payload else "",
                    similarity_score=r.score,
                    metadata=r.payload or {}
                ))
            return results

        except Exception as e:
            log.error(f"Vector search failed: {e}")
            return []

    async def _compute_graph_score(
        self,
        chunk_nodes: List[str],
        context_nodes: List[str],
        expert_type: Optional[str] = None,
        query_embedding: Optional[List[float]] = None,
        trace: Optional["ExecutionTrace"] = None
    ) -> float:
        """
        Step 2: Compute graph-based relevance score.

        Algorithm:
            1. For each (chunk_node, context_node) pair:
               - Find shortest path in graph (max_hops)
               - Score path based on length + relation weights (neural se PolicyManager)
            2. Return max score across all pairs

        Args:
            chunk_nodes: Graph node URNs linked to the chunk
            context_nodes: Graph node URNs from query context
            expert_type: Expert type for relation weights
            query_embedding: Query embedding per pesi neurali
            trace: ExecutionTrace per registrare azioni

        Returns:
            Graph score in [0, 1]
        """
        if not self.config.enable_graph_enrichment:
            return self.config.default_graph_score

        if not context_nodes or not chunk_nodes:
            # Genuinely isolated: no chunk or context node to anchor on.
            # Trust-neutral — there is no graph evidence to scale.
            return self.config.default_graph_score

        max_score = 0.0

        for chunk_node in chunk_nodes:
            for context_node in context_nodes:
                # Find shortest path
                path = await self._find_shortest_path(
                    chunk_node,
                    context_node,
                    max_hops=self.config.max_graph_hops
                )

                if path:
                    path_score = await self._score_path(
                        path=path,
                        expert_type=expert_type,
                        query_embedding=query_embedding,
                        trace=trace
                    )
                    max_score = max(max_score, path_score)

        # Provenance-aware trust (M1, Loop β B.3): scale the graph-score term
        # by the trust of the chunk nodes that produced it. The semantic
        # similarity term is NEVER touched here — this keeps the additive
        # combination `final_score = α·sim + (1-α)·graph_score` intact while
        # ensuring a `live_unconfirmed` (low-trust) node ranks strictly below
        # an equivalent `seed`/`community_validated` (trust=1.0) node.
        # Default trust is 1.0 when the property is absent, so seed/legacy
        # nodes are unaffected until the provenance backfill (B.2) runs.
        trust_factor = await self._compute_trust_factor(chunk_nodes)

        if max_score > 0:
            return max_score * trust_factor

        # Isolated node (no path) but it DOES exist in the graph: apply trust
        # to the default so a low-trust isolated node still ranks below a
        # high-trust isolated one.
        return self.config.default_graph_score * trust_factor

    async def _compute_trust_factor(self, chunk_nodes: List[str]) -> float:
        """
        Compute a provenance-aware trust factor for a set of chunk nodes (M1).

        Trust ∈ [0, 1] is read from the FalkorDB node `trust` property
        (added on the write surfaces by B.1; backfilled to 1.0 for seed nodes
        by B.2). When the property is absent — legacy/seed nodes before the
        backfill — trust defaults to 1.0 so scoring is unchanged.

        The factor is folded into the GRAPH-SCORE term only via:

            trust_factor = 0.5 + 0.5 * trust

        which maps trust ∈ [0, 1] onto a [0.5, 1.0] multiplier. A
        `live_unconfirmed` node (trust ≈ 0.6 → factor 0.8) therefore scores
        strictly below an equivalent `seed`/`community_validated` node
        (trust = 1.0 → factor 1.0), without ever zeroing out a provisional
        node (a flagged-but-still-returned source — B.3 acceptance).

        We use the MAX trust across the chunk nodes: a chunk linked to at
        least one high-trust node should not be penalised for also touching a
        provisional one. Best-effort — any read error defaults to 1.0 so the
        hot path never fails on a missing/unavailable property.
        """
        max_trust = 0.0
        found_any = False

        for node_urn in chunk_nodes:
            if not node_urn:
                continue
            trust = await self._get_node_trust(node_urn)
            if trust is not None:
                found_any = True
                max_trust = max(max_trust, trust)

        # No readable trust on any node → neutral (treat as fully trusted).
        if not found_any:
            return 1.0

        # Clamp into [0, 1] defensively, then map to the [0.5, 1.0] multiplier.
        max_trust = max(0.0, min(1.0, max_trust))
        return 0.5 + 0.5 * max_trust

    async def _get_node_trust(self, node_urn: str) -> Optional[float]:
        """
        Read the `trust` property of a graph node by its URN/node_id.

        Returns the trust as a float, 1.0 when the node exists but carries no
        `trust` property (seed/legacy nodes pre-backfill), or None when the
        node cannot be read at all (so the caller can distinguish "no signal"
        from "trusted"). Best-effort: never raises on the hot path.
        """
        try:
            cypher = (
                "MATCH (n) WHERE n.URN = $urn OR n.node_id = $urn "
                "RETURN n.trust AS trust LIMIT 1"
            )
            results = await self.graph_db.query(cypher, {"urn": node_urn})

            if not results:
                return None

            trust = results[0].get("trust")
            if trust is None:
                # Node exists but has no trust property → seed/legacy default.
                return 1.0

            return float(trust)

        except Exception as e:  # noqa: BLE001 - best-effort, must not break retrieval
            log.debug(f"Could not read trust for node {node_urn}: {e}")
            return None

    async def _find_shortest_path(
        self,
        source: str,
        target: str,
        max_hops: int
    ) -> Optional[GraphPath]:
        """
        Find shortest path between two nodes in FalkorDB.

        Args:
            source: Source node URN
            target: Target node URN
            max_hops: Maximum path length

        Returns:
            GraphPath or None if no path exists
        """
        try:
            result = await self.graph_db.shortest_path(
                start_node=source,
                end_node=target,
                max_hops=max_hops
            )

            if result and result.get("path"):
                path_data = result["path"]
                return GraphPath(
                    source_node=source,
                    target_node=target,
                    edges=path_data.get("edges", []),
                    length=path_data.get("length", 0)
                )

            return None

        except Exception as e:
            log.debug(f"No path found {source} → {target}: {e}")
            return None

    async def _score_path(
        self,
        path: GraphPath,
        expert_type: Optional[str] = None,
        query_embedding: Optional[List[float]] = None,
        trace: Optional["ExecutionTrace"] = None
    ) -> float:
        """
        Score a graph path based on length and relation weights.

        Formula:
            score = (1 / (length + 1)) * relation_bonus

        Where relation_bonus is the product of expert-specific weights
        for each edge type in the path.

        Se PolicyManager è disponibile e query_embedding presente, usa pesi neurali
        invece che statici. Registra le azioni nel trace per RLCF training.

        Args:
            path: GraphPath to score
            expert_type: Expert type for traversal weights
            query_embedding: Query embedding per pesi neurali
            trace: ExecutionTrace per registrare azioni

        Returns:
            Path score in [0, 1]
        """
        # Base score: shorter path = higher score
        distance_score = 1.0 / (path.length + 1)

        # Relation bonus: weighted by expert preferences
        relation_bonus = 1.0

        # Estrai tipi di edge dal path
        edge_types = [t for t in (_edge_type(edge) for edge in path.edges) if t]

        # Se PolicyManager disponibile e abbiamo embedding, usa pesi neurali
        if self.policy_manager and query_embedding and edge_types:
            try:
                # Compute batch weights per tutti gli edge types
                weights_dict = await self.policy_manager.compute_batch_weights(
                    query_embedding=query_embedding,
                    relation_types=edge_types,
                    expert_type=expert_type or "literal",
                    trace=trace
                )

                # Applica pesi neurali
                for edge in path.edges:
                    edge_type = _edge_type(edge)
                    if edge_type in weights_dict:
                        weight, _ = weights_dict[edge_type]
                        relation_bonus *= weight
                    else:
                        # Fallback a peso statico per edge non nel dict
                        relation_bonus *= 0.5

            except Exception as e:
                log.warning(f"PolicyManager error, using static weights: {e}")
                # Fallback a pesi statici
                relation_bonus = self._compute_static_relation_bonus(
                    path.edges, expert_type
                )
        else:
            # Usa pesi statici (comportamento originale)
            relation_bonus = self._compute_static_relation_bonus(
                path.edges, expert_type
            )

        return distance_score * relation_bonus

    def _compute_static_relation_bonus(
        self,
        edges: List[Dict[str, Any]],
        expert_type: Optional[str] = None
    ) -> float:
        """
        Calcola relation bonus con pesi statici.

        Args:
            edges: Lista di edge dal path
            expert_type: Expert type per pesi

        Returns:
            Relation bonus [0, 1]
        """
        relation_bonus = 1.0

        if expert_type and expert_type in EXPERT_TRAVERSAL_WEIGHTS:
            weights = EXPERT_TRAVERSAL_WEIGHTS[expert_type]

            for edge in edges:
                edge_type = _edge_type(edge)
                weight = weights.get(edge_type, weights.get("default", 0.5))
                relation_bonus *= weight

        return relation_bonus

    def _combine_scores(
        self,
        similarity_score: float,
        graph_score: float
    ) -> float:
        """
        Step 3: Combine similarity and graph scores.

        Formula:
            final_score = α * similarity_score + (1-α) * graph_score

        Args:
            similarity_score: Cosine similarity from vector search [0-1]
            graph_score: Path-based score from graph [0-1]

        Returns:
            Combined score [0-1]
        """
        return (
            self.config.alpha * similarity_score +
            (1 - self.config.alpha) * graph_score
        )

    def update_alpha(self, feedback_correlation: float, authority: float):
        """
        Update alpha parameter based on RLCF feedback.

        Learnable parameter adjustment:
            - If graph_score correlates with relevance → decrease alpha (more graph weight)
            - If similarity_score correlates with relevance → increase alpha (more vector weight)

        Args:
            feedback_correlation: Correlation between graph_score and user feedback [-1, 1]
            authority: Authority score of feedback provider [0, 1]
        """
        if feedback_correlation > 0.5:
            # Graph score is useful, increase its weight
            delta = -0.01 * authority
        else:
            # Similarity score is more useful
            delta = 0.01 * authority

        # Update with bounds [0.3, 0.9]
        self.config.alpha = max(0.3, min(0.9, self.config.alpha + delta))

        log.info(
            f"update_alpha() - new alpha={self.config.alpha:.3f} "
            f"(correlation={feedback_correlation:.3f}, authority={authority:.3f})"
        )
