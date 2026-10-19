"""
Mapping Models
==============

Dataclasses per i mapping tra chunk e nodi del grafo.
"""

from dataclasses import dataclass
from typing import Dict, Any, Optional
from uuid import UUID


@dataclass
class BridgeMapping:
    """
    Mapping preparato per l'inserimento nella Bridge Table.

    Rappresenta il collegamento tra un chunk vettoriale (Qdrant)
    e un nodo del grafo (FalkorDB).

    Attributes:
        chunk_id: UUID del chunk (per Qdrant)
        graph_node_urn: URN del nodo grafo collegato
        mapping_type: Tipo di mapping (PRIMARY, HIERARCHIC, CONCEPT, REFERENCE)
        confidence: Score di confidenza [0-1]
        chunk_text: Testo del chunk (per debug e RAG)
        metadata: Contesto aggiuntivo
    """
    chunk_id: UUID
    graph_node_urn: str
    mapping_type: str  # PRIMARY, HIERARCHIC, CONCEPT, REFERENCE
    confidence: float
    chunk_text: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
