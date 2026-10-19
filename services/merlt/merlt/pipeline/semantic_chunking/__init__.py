"""
Semantic Chunking Module
========================

Tecniche avanzate di chunking semantico per testi giuridici.

Moduli:
- proposition: Estrazione proposizioni atomiche via LLM
- semantic: Chunking basato su similarity embeddings
- late: Late Chunking con embeddings context-aware
- hybrid: Combinazione intelligente delle tecniche

Esempio:
    from merlt.pipeline.semantic_chunking import HybridChunker

    chunker = HybridChunker(llm_service, embedding_service)
    chunks = await chunker.chunk(text, article_urn)
"""

from merlt.pipeline.semantic_chunking.proposition import (
    PropositionChunker,
    LegalProposition,
)
from merlt.pipeline.semantic_chunking.semantic import (
    SemanticChunker,
    SemanticChunk,
    PercentileSemanticChunker,
)
from merlt.pipeline.semantic_chunking.late import (
    LateChunker,
    LateChunk,
    StructuralLateChunker,
)
from merlt.pipeline.semantic_chunking.hybrid import (
    HybridChunker,
    HybridChunk,
    ChunkingStrategy,
)

__all__ = [
    # Proposition-based
    "PropositionChunker",
    "LegalProposition",
    # Semantic similarity
    "SemanticChunker",
    "SemanticChunk",
    "PercentileSemanticChunker",
    # Late chunking
    "LateChunker",
    "LateChunk",
    "StructuralLateChunker",
    # Hybrid
    "HybridChunker",
    "HybridChunk",
    "ChunkingStrategy",
]
