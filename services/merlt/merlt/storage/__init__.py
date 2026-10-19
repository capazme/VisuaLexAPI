"""
Storage Layer (v2)
==================

Integrated storage with FalkorDB, Qdrant, and Bridge Table.

Components:
- falkordb/: Graph database (replaces Neo4j, 496x faster)
- bridge/: Bridge Table for vector-graph integration
- retriever/: GraphAwareRetriever for hybrid search

See docs/03-architecture/04-storage-layer.md for design details.

v2 Architecture:
    Query -> NER -> Context Nodes
                        |
        +---------------+---------------+
        |               |               |
        v               v               v
    [Qdrant]    [Bridge Table]    [FalkorDB]
    vectors     chunk <-> node      graph
        |               |               |
        +-------+-------+-------+-------+
                |               |
                v               v
        similarity_score    graph_score
                |               |
                +-------+-------+
                        |
                        v
            final_score = alpha * sim + (1-alpha) * graph
"""

from merlt.storage.graph import FalkorDBClient, FalkorDBConfig
from merlt.storage.bridge import BridgeTable, BridgeTableConfig, BridgeTableEntry
from merlt.storage.retriever import GraphAwareRetriever, RetrievalResult, RetrieverConfig
from merlt.storage.vectors.embeddings import EmbeddingService
from merlt.storage.trace import TraceStorageService, TraceStorageConfig
from merlt.storage.temporal import TemporalValidityService, ValidityResult, ValiditySummary

__all__ = [
    # FalkorDB
    "FalkorDBClient",
    "FalkorDBConfig",
    # Bridge Table
    "BridgeTable",
    "BridgeTableConfig",
    "BridgeTableEntry",
    # Retriever
    "GraphAwareRetriever",
    "RetrievalResult",
    "RetrieverConfig",
    # Vectors
    "EmbeddingService",
    # Trace Storage
    "TraceStorageService",
    "TraceStorageConfig",
    # Temporal Validity
    "TemporalValidityService",
    "ValidityResult",
    "ValiditySummary",
]
