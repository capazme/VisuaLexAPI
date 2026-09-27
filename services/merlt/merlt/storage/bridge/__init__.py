"""
Bridge Table (v2)
=================

Maps vector chunks to graph nodes for hybrid retrieval.

The Bridge Table enables Graph-Aware Similarity Search by linking:
- chunk_id (Qdrant vectors)
- graph_node_urn (FalkorDB nodes)
- relation_type (contained_in, references, etc.)
- confidence (0-1 score)

See docs/03-architecture/04-storage-layer.md for design details.

Schema:
    bridge_table (
        chunk_id UUID,
        graph_node_urn VARCHAR(500),
        node_type VARCHAR(50),
        relation_type VARCHAR(50),
        confidence FLOAT,
        metadata JSONB
    )
"""

from .models import BridgeTableEntry, Base
from .bridge_table import BridgeTable, BridgeTableConfig
from .bridge_builder import BridgeBuilder, insert_ingestion_result

__all__ = [
    "BridgeTable",
    "BridgeTableConfig",
    "BridgeTableEntry",
    "Base",
    "BridgeBuilder",
    "insert_ingestion_result",
]
