"""
Late Chunking with Contextual Embeddings
========================================

Late Chunking e' una tecnica che genera embeddings per chunk
DOPO aver processato l'intero documento, cosi' ogni chunk
"vede" il contesto globale.

Differenza da chunking tradizionale:
- Tradizionale: split -> embed (ogni chunk isolato)
- Late: embed documento -> mean pool per span (ogni chunk contestuale)

Vantaggi:
- Chunk mantengono awareness del contesto globale
- Migliore retrieval per chunk piccoli
- Ideale per documenti lunghi con riferimenti interni

Implementazione:
- Usa modelli long-context (es. Jina, BGE-M3)
- Genera token embeddings per documento intero
- Mean pool su span predefiniti per creare chunk embeddings

Reference:
- Jina AI Late Chunking (2024)
- Long-Context Embedding Models

Esempio:
    late_chunker = LateChunker(embedding_service)
    chunks = await late_chunker.chunk_with_context(
        text=full_article,
        chunk_boundaries=[(0, 100), (100, 200), ...],
        source_urn="urn:..."
    )
"""

import logging
from dataclasses import dataclass, field
from typing import List, Optional, Tuple, Dict, Any
from uuid import uuid4, UUID
from datetime import datetime, timezone
import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class LateChunk:
    """
    Chunk con embedding context-aware da Late Chunking.

    L'embedding di questo chunk e' stato generato considerando
    l'intero documento di origine, non solo il testo del chunk.

    Attributes:
        id: UUID univoco
        text: Testo del chunk
        embedding: Embedding context-aware
        span: Tuple (start_char, end_char) nel documento originale
        source_urn: URN di origine
        context_window: Dimensione contesto usato
    """
    id: UUID
    text: str
    embedding: List[float]
    span: Tuple[int, int]  # (start, end) caratteri
    source_urn: str
    context_window: int = 0  # Caratteri di contesto visti
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def char_count(self) -> int:
        return len(self.text)

    def to_dict(self) -> Dict[str, Any]:
        """Serializza per storage."""
        return {
            "id": str(self.id),
            "text": self.text,
            "embedding": self.embedding,
            "span": self.span,
            "source_urn": self.source_urn,
            "context_window": self.context_window,
            "created_at": self.created_at.isoformat(),
        }


class LateChunker:
    """
    Late Chunker che genera embeddings context-aware.

    Processa l'intero documento prima di creare chunk,
    permettendo ad ogni chunk di "vedere" il contesto globale.

    Supporta due modalita':
    1. Token-level: richiede accesso a token embeddings del modello
    2. Sliding window: approssimazione con overlap

    Attributes:
        embedding_service: Servizio embeddings
        chunk_size: Dimensione target chunk (caratteri)
        overlap: Overlap tra chunk (caratteri)
        use_token_level: Se True, usa token embeddings (richiede supporto)

    Example:
        >>> chunker = LateChunker(embedding_service, chunk_size=500)
        >>> chunks = await chunker.chunk(full_text, source_urn="urn:...")
    """

    def __init__(
        self,
        embedding_service,
        chunk_size: int = 500,
        overlap: int = 50,
        use_token_level: bool = False,
    ):
        """
        Inizializza il late chunker.

        Args:
            embedding_service: Servizio embeddings (EmbeddingService o compatibile)
            chunk_size: Dimensione target per chunk in caratteri
            overlap: Overlap tra chunk consecutivi
            use_token_level: Se True, prova ad usare token-level embeddings
        """
        self.embedding = embedding_service
        self.chunk_size = chunk_size
        self.overlap = overlap
        self.use_token_level = use_token_level

    async def chunk(
        self,
        text: str,
        source_urn: str = "",
        boundaries: Optional[List[Tuple[int, int]]] = None,
    ) -> List[LateChunk]:
        """
        Crea chunk con embeddings context-aware.

        Args:
            text: Testo completo del documento
            source_urn: URN di origine
            boundaries: Confini predefiniti [(start, end), ...] opzionale

        Returns:
            Lista di LateChunk con embeddings contestuali
        """
        if not text or len(text.strip()) < 50:
            return []

        # Determina boundaries
        if boundaries is None:
            boundaries = self._compute_boundaries(text)

        # Scegli strategia di embedding
        if self.use_token_level and hasattr(self.embedding, 'embed_with_tokens'):
            return await self._chunk_token_level(text, boundaries, source_urn)
        else:
            return await self._chunk_sliding_window(text, boundaries, source_urn)

    async def chunk_with_structural_boundaries(
        self,
        text: str,
        source_urn: str,
        comma_positions: List[Tuple[int, int]],
    ) -> List[LateChunk]:
        """
        Late chunking usando confini strutturali (commi).

        Combina i vantaggi del chunking strutturale (confini logici)
        con late chunking (embeddings contestuali).

        Args:
            text: Testo completo articolo
            source_urn: URN articolo
            comma_positions: Lista (start, end) per ogni comma

        Returns:
            Lista di LateChunk con boundaries strutturali
        """
        return await self.chunk(
            text=text,
            source_urn=source_urn,
            boundaries=comma_positions,
        )

    def _compute_boundaries(self, text: str) -> List[Tuple[int, int]]:
        """
        Calcola boundaries per chunk con overlap.

        Cerca di rispettare confini di frase quando possibile.
        """
        boundaries = []
        text_len = len(text)
        pos = 0

        while pos < text_len:
            # Calcola end position
            end = min(pos + self.chunk_size, text_len)

            # Cerca fine frase vicina (entro 20% del chunk_size)
            if end < text_len:
                search_window = int(self.chunk_size * 0.2)
                best_end = end

                # Cerca punto, punto e virgola, o newline
                for sep in ['. ', '.\n', '; ', ':\n']:
                    sep_pos = text.rfind(sep, end - search_window, end + search_window)
                    if sep_pos > pos:
                        best_end = sep_pos + len(sep)
                        break

                end = best_end

            boundaries.append((pos, end))

            # Avanza con overlap
            pos = end - self.overlap if end < text_len else text_len

        return boundaries

    async def _chunk_sliding_window(
        self,
        text: str,
        boundaries: List[Tuple[int, int]],
        source_urn: str,
    ) -> List[LateChunk]:
        """
        Late chunking con sliding window approssimato.

        Per ogni chunk, genera embedding con contesto esteso:
        - Prende chunk + contesto precedente + contesto successivo
        - Genera embedding del testo esteso
        - Usa solo la porzione centrale per il chunk

        Questa e' un'approssimazione del vero late chunking
        che non richiede accesso ai token embeddings.
        """
        chunks = []
        context_chars = self.chunk_size  # Contesto extra

        for i, (start, end) in enumerate(boundaries):
            chunk_text = text[start:end].strip()
            if not chunk_text:
                continue

            # Costruisci testo con contesto
            context_start = max(0, start - context_chars)
            context_end = min(len(text), end + context_chars)
            context_text = text[context_start:context_end]

            # Genera embedding del testo con contesto
            # L'embedding cattura informazioni dal contesto
            embedding = await self.embedding.embed(context_text)

            # Crea chunk
            chunk = LateChunk(
                id=uuid4(),
                text=chunk_text,
                embedding=embedding,
                span=(start, end),
                source_urn=f"{source_urn}-late{i+1}",
                context_window=len(context_text),
            )
            chunks.append(chunk)

        logger.info(
            f"Late chunking (sliding): {len(boundaries)} boundaries -> {len(chunks)} chunks"
        )
        return chunks

    async def _chunk_token_level(
        self,
        text: str,
        boundaries: List[Tuple[int, int]],
        source_urn: str,
    ) -> List[LateChunk]:
        """
        True late chunking con token-level embeddings.

        Richiede un embedding service che espone embed_with_tokens()
        per ottenere embeddings a livello di token.
        """
        # Ottieni token embeddings per intero documento
        token_data = await self.embedding.embed_with_tokens(text)

        # token_data dovrebbe contenere:
        # - token_embeddings: [n_tokens, dim]
        # - token_offsets: [(char_start, char_end), ...] per ogni token

        token_embeddings = np.array(token_data["token_embeddings"])
        token_offsets = token_data["token_offsets"]

        chunks = []

        for i, (start, end) in enumerate(boundaries):
            chunk_text = text[start:end].strip()
            if not chunk_text:
                continue

            # Trova token che coprono questo span
            span_tokens = []
            for tok_idx, (tok_start, tok_end) in enumerate(token_offsets):
                # Token overlap con chunk span
                if tok_end > start and tok_start < end:
                    span_tokens.append(tok_idx)

            if not span_tokens:
                # Fallback: embedding normale
                embedding = await self.embedding.embed(chunk_text)
            else:
                # Mean pool dei token embeddings per questo span
                span_embs = token_embeddings[span_tokens]
                embedding = span_embs.mean(axis=0).tolist()

            chunk = LateChunk(
                id=uuid4(),
                text=chunk_text,
                embedding=embedding,
                span=(start, end),
                source_urn=f"{source_urn}-late{i+1}",
                context_window=len(text),  # Contesto = intero documento
            )
            chunks.append(chunk)

        logger.info(
            f"Late chunking (token-level): {len(boundaries)} boundaries -> {len(chunks)} chunks"
        )
        return chunks


class StructuralLateChunker(LateChunker):
    """
    Combina chunking strutturale (comma-level) con late embeddings.

    Usa i confini strutturali del testo giuridico (commi)
    ma genera embeddings context-aware per ogni comma.
    """

    def __init__(self, embedding_service, **kwargs):
        # Disabilita overlap per chunking strutturale
        super().__init__(embedding_service, overlap=0, **kwargs)

    async def chunk_article(
        self,
        commas: List[Dict[str, Any]],
        full_text: str,
        article_urn: str,
    ) -> List[LateChunk]:
        """
        Chunka articolo usando confini comma con late embeddings.

        Args:
            commas: Lista di dict con 'numero', 'testo', 'start', 'end'
            full_text: Testo completo articolo
            article_urn: URN articolo

        Returns:
            Lista di LateChunk per ogni comma
        """
        # Estrai boundaries dai commi
        boundaries = []
        for comma in commas:
            if "start" in comma and "end" in comma:
                boundaries.append((comma["start"], comma["end"]))
            else:
                # Trova posizione nel testo
                comma_text = comma.get("testo", "")
                start = full_text.find(comma_text)
                if start >= 0:
                    boundaries.append((start, start + len(comma_text)))

        return await self.chunk(
            text=full_text,
            source_urn=article_urn,
            boundaries=boundaries,
        )


# Exports
__all__ = [
    "LateChunker",
    "LateChunk",
    "StructuralLateChunker",
]
