"""
MERL-T Graph Storage
====================

Storage grafo con FalkorDB (Cypher-compatible, 496x faster than Neo4j).

Componenti:
- FalkorDBClient: Client async per FalkorDB
- FalkorDBConfig: Configurazione connessione

Esempio:
    from merlt.storage.graph import FalkorDBClient, FalkorDBConfig

    config = FalkorDBConfig(host="localhost", port=6380, graph_name="merl_t")
    client = FalkorDBClient(config)
    await client.connect()
"""

from merlt.storage.graph.client import FalkorDBClient
from merlt.storage.graph.config import FalkorDBConfig

__all__ = [
    "FalkorDBClient",
    "FalkorDBConfig",
]
