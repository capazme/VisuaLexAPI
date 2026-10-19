"""
Hybrid Semantic Chunking
========================

Combina intelligentemente Proposition + Semantic + Late Chunking
per massimizzare la qualita' del retrieval su testi giuridici.

Strategia:
1. Proposition Chunking (LLM) per estrarre unita' atomiche
2. Semantic Chunking (embeddings) come fallback per testi lunghi
3. Late Chunking (embeddings contestuali) per embedding finale

La scelta della strategia dipende da:
- Lunghezza del testo
- Disponibilita' LLM
- Budget computazionale

Esempio:
    chunker = HybridChunker(
        llm_service=llm,
        embedding_service=embedding,
        strategy=ChunkingStrategy.PROPOSITION_FIRST
    )
    chunks = await chunker.chunk(article_text, article_urn)
"""

import logging
from enum import Enum
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any, Union
from uuid import uuid4, UUID
from datetime import datetime, timezone

from merlt.pipeline.semantic_chunking.proposition import (
    PropositionChunker,
    LegalProposition,
)
from merlt.pipeline.semantic_chunking.semantic import (
    SemanticChunker,
    SemanticChunk,
)

logger = logging.getLogger(__name__)


class ChunkingStrategy(Enum):
    """Strategia di chunking da utilizzare."""

    PROPOSITION_ONLY = "proposition_only"
    """Solo estrazione proposizioni via LLM."""

    SEMANTIC_ONLY = "semantic_only"
    """Solo chunking per similarity embeddings."""

    PROPOSITION_FIRST = "proposition_first"
    """Proposizioni prima, semantic come fallback."""

    SEMANTIC_FIRST = "semantic_first"
    """Semantic prima, proposizioni per chunk grandi."""

    ADAPTIVE = "adaptive"
    """Sceglie automaticamente in base al testo."""


@dataclass
class HybridChunk:
    """
    Chunk prodotto dall'hybrid chunker.

    Unifica LegalProposition e SemanticChunk in un formato comune
    per l'indicizzazione in vector store.

    Attributes:
        id: UUID univoco
        text: Testo del chunk
        chunk_type: Origine (proposition/semantic/structural)
        source_urn: URN di origine
        metadata: Metadati aggiuntivi
        confidence: Score di qualita' [0-1]
        proposition_type: Tipo proposizione (se applicabile)
        entities: Entita' estratte (se applicabile)
    """
    id: UUID
    text: str
    chunk_type: str  # "proposition", "semantic", "structural"
    source_urn: str
    metadata: Dict[str, Any] = field(default_factory=dict)
    confidence: float = 1.0
    proposition_type: Optional[str] = None
    entities: List[str] = field(default_factory=list)
    embedding: Optional[List[float]] = None  # Embedding pre-calcolato
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def token_count(self) -> int:
        """Stima approssimativa token count."""
        return len(self.text.split()) * 1.3  # Fattore italiano

    def to_dict(self) -> Dict[str, Any]:
        """Serializza per storage."""
        return {
            "id": str(self.id),
            "text": self.text,
            "chunk_type": self.chunk_type,
            "source_urn": self.source_urn,
            "metadata": self.metadata,
            "confidence": self.confidence,
            "proposition_type": self.proposition_type,
            "entities": self.entities,
            "created_at": self.created_at.isoformat(),
        }

    @classmethod
    def from_proposition(cls, prop: LegalProposition) -> "HybridChunk":
        """Crea HybridChunk da LegalProposition."""
        return cls(
            id=prop.id,
            text=prop.text,
            chunk_type="proposition",
            source_urn=prop.source_urn,
            metadata={"source_comma": prop.source_comma},
            confidence=prop.confidence,
            proposition_type=prop.proposition_type,
            entities=prop.entities,
        )

    @classmethod
    def from_semantic(cls, chunk: SemanticChunk) -> "HybridChunk":
        """Crea HybridChunk da SemanticChunk."""
        return cls(
            id=chunk.id,
            text=chunk.text,
            chunk_type="semantic",
            source_urn=chunk.source_urn,
            metadata={
                "sentence_count": chunk.sentence_count,
                "start_sentence": chunk.start_sentence,
                "end_sentence": chunk.end_sentence,
            },
            confidence=chunk.avg_similarity,
        )


class HybridChunker:
    """
    Chunker ibrido che combina multiple strategie.

    Ottimizzato per testi giuridici italiani, bilancia:
    - Precisione (proposizioni atomiche)
    - Copertura (chunking semantico)
    - Performance (caching, batching)

    Attributes:
        llm: Servizio LLM per proposizioni
        embedding: Servizio embeddings
        strategy: Strategia di chunking
        proposition_chunker: Chunker proposizioni
        semantic_chunker: Chunker semantico

    Example:
        >>> chunker = HybridChunker(llm, embedding)
        >>> chunks = await chunker.chunk_article(
        ...     commas=[{"numero": 1, "testo": "..."}],
        ...     article_urn="urn:...",
        ...     article_context="Art. 1218 c.c."
        ... )
    """

    # Soglie per scelta strategia adattiva
    SHORT_TEXT_THRESHOLD = 200  # Sotto: solo proposizioni
    LONG_TEXT_THRESHOLD = 2000  # Sopra: semantic + proposizioni

    def __init__(
        self,
        llm_service=None,
        embedding_service=None,
        strategy: ChunkingStrategy = ChunkingStrategy.ADAPTIVE,
        proposition_config: Optional[Dict[str, Any]] = None,
        semantic_config: Optional[Dict[str, Any]] = None,
    ):
        """
        Inizializza l'hybrid chunker.

        Args:
            llm_service: Servizio LLM (opzionale se strategy=SEMANTIC_ONLY)
            embedding_service: Servizio embeddings
            strategy: Strategia di chunking
            proposition_config: Config per PropositionChunker
            semantic_config: Config per SemanticChunker
        """
        self.llm = llm_service
        self.embedding = embedding_service
        self.strategy = strategy

        # Inizializza sub-chunkers
        self.proposition_chunker = None
        self.semantic_chunker = None

        if llm_service:
            prop_config = proposition_config or {}
            self.proposition_chunker = PropositionChunker(
                llm_service=llm_service,
                **prop_config
            )

        if embedding_service:
            sem_config = semantic_config or {}
            self.semantic_chunker = SemanticChunker(
                embedding_service=embedding_service,
                **sem_config
            )

    async def chunk(
        self,
        text: str,
        source_urn: str,
        context: str = "",
        comma_number: int = 1,
    ) -> List[HybridChunk]:
        """
        Chunka un singolo testo usando la strategia configurata.

        Args:
            text: Testo da chunkare
            source_urn: URN di origine
            context: Contesto articolo (rubrica, ecc.)
            comma_number: Numero comma (per proposizioni)

        Returns:
            Lista di HybridChunk
        """
        if not text or len(text.strip()) < 20:
            return []

        # Determina strategia effettiva
        effective_strategy = self._determine_strategy(text)

        logger.debug(f"Chunking con strategia: {effective_strategy.value}")

        if effective_strategy == ChunkingStrategy.PROPOSITION_ONLY:
            return await self._chunk_proposition(text, source_urn, context, comma_number)

        elif effective_strategy == ChunkingStrategy.SEMANTIC_ONLY:
            return await self._chunk_semantic(text, source_urn)

        elif effective_strategy == ChunkingStrategy.PROPOSITION_FIRST:
            return await self._chunk_proposition_first(text, source_urn, context, comma_number)

        elif effective_strategy == ChunkingStrategy.SEMANTIC_FIRST:
            return await self._chunk_semantic_first(text, source_urn, context, comma_number)

        else:  # ADAPTIVE
            return await self._chunk_adaptive(text, source_urn, context, comma_number)

    async def chunk_article(
        self,
        commas: List[Dict[str, Any]],
        article_urn: str,
        article_context: str = "",
    ) -> List[HybridChunk]:
        """
        Chunka un intero articolo (tutti i commi).

        Args:
            commas: Lista di dict con 'numero' e 'testo'
            article_urn: URN base dell'articolo
            article_context: Contesto (rubrica, posizione)

        Returns:
            Lista aggregata di HybridChunk
        """
        all_chunks = []

        for comma in commas:
            comma_urn = f"{article_urn}-com{comma['numero']}"
            chunks = await self.chunk(
                text=comma.get("testo", ""),
                source_urn=comma_urn,
                context=article_context,
                comma_number=comma.get("numero", 1),
            )
            all_chunks.extend(chunks)

        logger.info(
            f"Hybrid chunking articolo: {len(commas)} commi -> {len(all_chunks)} chunks"
        )
        return all_chunks

    def _determine_strategy(self, text: str) -> ChunkingStrategy:
        """
        Determina strategia effettiva basata su testo e config.

        - Se strategia esplicita e chunker disponibile: usa quella
        - Se ADAPTIVE: scegli in base a lunghezza testo
        """
        if self.strategy != ChunkingStrategy.ADAPTIVE:
            # Verifica disponibilita' chunker richiesto
            if self.strategy in (
                ChunkingStrategy.PROPOSITION_ONLY,
                ChunkingStrategy.PROPOSITION_FIRST
            ) and not self.proposition_chunker:
                logger.warning("Proposition chunker non disponibile, fallback a semantic")
                return ChunkingStrategy.SEMANTIC_ONLY

            if self.strategy in (
                ChunkingStrategy.SEMANTIC_ONLY,
                ChunkingStrategy.SEMANTIC_FIRST
            ) and not self.semantic_chunker:
                logger.warning("Semantic chunker non disponibile, fallback a proposition")
                return ChunkingStrategy.PROPOSITION_ONLY

            return self.strategy

        # ADAPTIVE: scegli in base a caratteristiche testo
        text_len = len(text)

        if text_len < self.SHORT_TEXT_THRESHOLD:
            # Testi brevi: preferisci proposizioni (piu' precise)
            if self.proposition_chunker:
                return ChunkingStrategy.PROPOSITION_ONLY
            return ChunkingStrategy.SEMANTIC_ONLY

        elif text_len > self.LONG_TEXT_THRESHOLD:
            # Testi lunghi: semantic prima per efficienza
            if self.semantic_chunker and self.proposition_chunker:
                return ChunkingStrategy.SEMANTIC_FIRST
            elif self.semantic_chunker:
                return ChunkingStrategy.SEMANTIC_ONLY
            return ChunkingStrategy.PROPOSITION_ONLY

        else:
            # Testi medi: proposizioni first per qualita'
            if self.proposition_chunker:
                return ChunkingStrategy.PROPOSITION_FIRST
            return ChunkingStrategy.SEMANTIC_ONLY

    async def _chunk_proposition(
        self,
        text: str,
        source_urn: str,
        context: str,
        comma_number: int,
    ) -> List[HybridChunk]:
        """Chunking con solo proposizioni."""
        if not self.proposition_chunker:
            return []

        propositions = await self.proposition_chunker.extract(
            text=text,
            comma_number=comma_number,
            source_urn=source_urn,
            article_context=context,
        )

        return [HybridChunk.from_proposition(p) for p in propositions]

    async def _chunk_semantic(
        self,
        text: str,
        source_urn: str,
    ) -> List[HybridChunk]:
        """Chunking con solo similarity semantica."""
        if not self.semantic_chunker:
            return []

        chunks = await self.semantic_chunker.chunk(
            text=text,
            source_urn=source_urn,
        )

        return [HybridChunk.from_semantic(c) for c in chunks]

    async def _chunk_proposition_first(
        self,
        text: str,
        source_urn: str,
        context: str,
        comma_number: int,
    ) -> List[HybridChunk]:
        """Proposizioni prima, semantic come fallback."""
        # Prova proposizioni
        chunks = await self._chunk_proposition(text, source_urn, context, comma_number)

        if chunks:
            return chunks

        # Fallback a semantic
        logger.debug("Proposition fallback a semantic chunking")
        return await self._chunk_semantic(text, source_urn)

    async def _chunk_semantic_first(
        self,
        text: str,
        source_urn: str,
        context: str,
        comma_number: int,
    ) -> List[HybridChunk]:
        """Semantic prima, poi proposizioni per chunk grandi."""
        # Semantic chunking
        semantic_chunks = await self._chunk_semantic(text, source_urn)

        if not semantic_chunks:
            return await self._chunk_proposition(text, source_urn, context, comma_number)

        # Per chunk grandi: estrai proposizioni
        result_chunks = []
        for chunk in semantic_chunks:
            if len(chunk.text) > self.SHORT_TEXT_THRESHOLD and self.proposition_chunker:
                # Chunk grande: estrai proposizioni
                sub_props = await self._chunk_proposition(
                    chunk.text, chunk.source_urn, context, comma_number
                )
                if sub_props:
                    result_chunks.extend(sub_props)
                else:
                    result_chunks.append(chunk)
            else:
                result_chunks.append(chunk)

        return result_chunks

    async def _chunk_adaptive(
        self,
        text: str,
        source_urn: str,
        context: str,
        comma_number: int,
    ) -> List[HybridChunk]:
        """Chunking adattivo basato su euristica."""
        # Determina strategia ottimale
        strategy = self._determine_strategy(text)

        if strategy == ChunkingStrategy.PROPOSITION_ONLY:
            return await self._chunk_proposition(text, source_urn, context, comma_number)
        elif strategy == ChunkingStrategy.SEMANTIC_ONLY:
            return await self._chunk_semantic(text, source_urn)
        elif strategy == ChunkingStrategy.PROPOSITION_FIRST:
            return await self._chunk_proposition_first(text, source_urn, context, comma_number)
        else:
            return await self._chunk_semantic_first(text, source_urn, context, comma_number)


# Exports
__all__ = [
    "HybridChunker",
    "HybridChunk",
    "ChunkingStrategy",
]
