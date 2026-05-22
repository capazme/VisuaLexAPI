"""
MERL-T Core
===========

Core orchestration layer for the MERL-T Legal Knowledge Graph.

This module provides the high-level API for:
- Unified ingestion (graph + embeddings + bridge table + multivigenza)
- Legal knowledge search
- Data export for training

Vision:
    from merlt import LegalKnowledgeGraph

    kg = LegalKnowledgeGraph(config)
    await kg.connect()

    result = await kg.ingest_norm(
        tipo_atto="codice penale",
        articolo="1",
        include_brocardi=True,
        include_multivigenza=True,
    )
"""

from .legal_knowledge_graph import LegalKnowledgeGraph, MerltConfig

__all__ = [
    "LegalKnowledgeGraph",
    "MerltConfig",
]
