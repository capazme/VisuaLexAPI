"""
GraphAwareRetriever (v2)
========================

Hybrid retrieval combining vector similarity and graph structure.

Components:
- GraphAwareRetriever: Main retrieval class
- RetrievalResult: Result dataclass with hybrid scores
- RetrieverConfig: Configuration

See docs/03-architecture/04-storage-layer.md for design details.

Architecture:
    Query → Vector Search (Qdrant)
              ↓
         Chunk IDs
              ↓
    Bridge Table → Graph Nodes (FalkorDB)
              ↓
    Graph Score Calculation (shortest path, relation weights)
              ↓
    Hybrid Score = α * sim_score + (1-α) * graph_score
              ↓
    Re-ranked Results
"""

from .models import RetrievalResult, RetrieverConfig, VectorSearchResult, GraphPath
from .retriever import GraphAwareRetriever

__all__ = [
    "GraphAwareRetriever",
    "RetrievalResult",
    "RetrieverConfig",
    "VectorSearchResult",
    "GraphPath",
]
