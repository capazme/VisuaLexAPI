"""
GraphAwareRetriever Models
===========================

Dataclasses for retrieval results and configuration.
"""

from dataclasses import dataclass, field
from typing import List, Dict, Any
from uuid import UUID


from merlt.storage.graph.schema import EXPERT_SOURCE_TYPES as _BY_EXPERT
from merlt.storage.vectors.collection import default_chunks_collection as _default_collection


@dataclass
class RetrievalResult:
    """
    Result from hybrid retrieval combining vector similarity and graph structure.

    Attributes:
        chunk_id: UUID of the text chunk
        text: Chunk text content
        similarity_score: Cosine similarity from vector search [0-1]
        graph_score: Score based on graph structure [0-1]
        final_score: Hybrid score = � * sim + (1-�) * graph [0-1]
        linked_nodes: Graph nodes linked to this chunk
        metadata: Additional metadata from Qdrant/Bridge
    """
    chunk_id: UUID
    text: str
    similarity_score: float
    graph_score: float
    final_score: float
    linked_nodes: List[Dict[str, Any]] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def __repr__(self) -> str:
        return (
            f"<RetrievalResult(chunk_id={str(self.chunk_id)[:8]}..., "
            f"final={self.final_score:.3f}, sim={self.similarity_score:.3f}, "
            f"graph={self.graph_score:.3f}, nodes={len(self.linked_nodes)})>"
        )


@dataclass
class VectorSearchResult:
    """
    Raw result from vector database (Qdrant).

    Intermediate result before graph enrichment.
    """
    chunk_id: UUID
    text: str
    similarity_score: float
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class GraphPath:
    """
    Path in the knowledge graph.

    Used for computing graph scores based on shortest paths.
    """
    source_node: str
    target_node: str
    edges: List[Dict[str, Any]]  # Each edge: {"type": str, "properties": dict}
    length: int

    def __repr__(self) -> str:
        return f"<GraphPath({self.source_node} � {self.target_node}, length={self.length})>"


@dataclass
class RetrieverConfig:
    """
    Configuration for GraphAwareRetriever.

    Attributes:
        alpha: Weight for vector similarity vs graph score [0-1]
               Higher alpha = more semantic, lower alpha = more structural
               Default: 0.7 (70% semantic, 30% graph)
        over_retrieve_factor: Multiplier for initial vector search
                              Default: 3 (retrieve 3x more for re-ranking)
        max_graph_hops: Maximum path length to consider in graph
                        Default: 3 hops
        default_graph_score: Score when no graph path found
                             Default: 0.5 (neutral)
        enable_graph_enrichment: Enable/disable graph scoring (for A/B testing)
                                 Default: True
        collection_name: Qdrant collection name
                         Default: QDRANT_COLLECTION or <graph>_chunks (merl_t_legal_chunks)
    """
    alpha: float = 0.7
    over_retrieve_factor: int = 3
    max_graph_hops: int = 3
    default_graph_score: float = 0.5
    enable_graph_enrichment: bool = True
    # Resolved at construction (env-aware) so every consumer reads the populated
    # collection; see storage/vectors/collection.py.
    collection_name: str = field(default_factory=_default_collection)

    def __post_init__(self):
        """Validate configuration values."""
        if not 0 <= self.alpha <= 1:
            raise ValueError(f"alpha must be in [0, 1], got {self.alpha}")
        if self.over_retrieve_factor < 1:
            raise ValueError(f"over_retrieve_factor must be >= 1, got {self.over_retrieve_factor}")
        if self.max_graph_hops < 1:
            raise ValueError(f"max_graph_hops must be >= 1, got {self.max_graph_hops}")
        if not 0 <= self.default_graph_score <= 1:
            raise ValueError(f"default_graph_score must be in [0, 1], got {self.default_graph_score}")


# Load expert traversal weights from config file
def _load_expert_weights() -> Dict[str, Dict[str, float]]:
    """
    Load expert traversal weights from YAML config file.

    Falls back to default weights if config file not found.
    """
    import yaml
    from pathlib import Path

    config_path = Path(__file__).parent.parent.parent / "config" / "retriever_weights.yaml"

    try:
        with open(config_path, "r") as f:
            config = yaml.safe_load(f)
            return config.get("expert_traversal_weights", _get_default_weights())
    except FileNotFoundError:
        # Expected: this YAML is not in the repository (nor in any deployment), so the
        # defaults below are the normal case. Not a warning: it would print on every
        # interpreter start. The standard library's logger, not structlog's: this runs
        # at import, before any script configures structlog, whose default prints every
        # level to stdout, where the scripts print their JSON.
        import logging
        logging.getLogger(__name__).debug("Config file not found: %s, using default weights", config_path)
        return _get_default_weights()
    except Exception as e:
        import structlog
        structlog.get_logger().error(f"Error loading config: {e}, using default weights")
        return _get_default_weights()


def _get_default_weights() -> Dict[str, Dict[str, float]]:
    """
    Default expert traversal weights (fallback).

    These are used if the config file cannot be loaded.

    The keys are the schema's relations in lower case (`_compute_static_relation_bonus`
    lower-cases an edge's type to look it up). Weights a canon once gave to names the
    schema does not have (gerarchia_kelseniana, relazione_concettuale, conferma,
    overrules, distinguishes) never matched an edge and are gone.
    """
    return {
        "LiteralExpert": {
            "contiene": 1.0,
            "disciplina": 0.95,
            "definisce": 0.95,
            "modifica": 0.85,
            "abroga": 0.80,
            "rinvia": 0.75,
            "default": 0.50
        },
        "SystemicExpert": {
            "attua": 0.95,
            "modifica": 0.90,
            "deroga_a": 0.90,
            "disciplina": 0.85,
            "contiene": 0.85,
            "default": 0.50
        },
        "PrinciplesExpert": {
            "attua": 0.95,
            "deroga_a": 0.95,
            "bilancia_con": 0.95,
            "disciplina": 0.90,
            "default": 0.50
        },
        "PrecedentExpert": {
            "interpreta": 1.0,
            "applica_a": 1.0,
            "rinvia": 0.85,
            "default": 0.50
        }
    }


# Expert-specific traversal weights loaded from config
EXPERT_TRAVERSAL_WEIGHTS = _load_expert_weights()


# Each expert searches only the chunks of its canon (art. 12 preleggi). The
# schema holds the one list; here it is keyed by both the short and the class name.
EXPERT_SOURCE_TYPES: Dict[str, List[str]] = {
    **_BY_EXPERT,
    **{f"{name.capitalize()}Expert": types for name, types in _BY_EXPERT.items()},
}


def get_source_types_for_expert(expert_type: str) -> List[str]:
    """
    Ritorna i source_types appropriati per un expert.

    Args:
        expert_type: Nome dell'expert (es: "LiteralExpert", "literal")

    Returns:
        Lista di source_types (es: ["norma", "comma"], ["massima"])
    """
    return EXPERT_SOURCE_TYPES.get(expert_type, [])
