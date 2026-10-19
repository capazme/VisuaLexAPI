"""
Semantic Similarity Chunking
============================

Chunking basato su similarity tra embeddings di frasi consecutive.

Algoritmo:
1. Segmenta il testo in frasi
2. Genera embedding per ogni frase
3. Calcola cosine similarity tra frasi adiacenti
4. Crea nuovo chunk quando similarity < threshold

Vantaggi:
- Preserva coerenza semantica nei chunk
- Adattivo alla struttura del documento
- Non richiede LLM (solo embedding model)

Reference:
- Greg Kamradt's Semantic Chunking
- LangChain SemanticChunker

Esempio:
    chunker = SemanticChunker(embedding_service)
    chunks = await chunker.chunk(text, threshold=0.5)
"""

import logging
import re
import numpy as np
from dataclasses import dataclass, field
from typing import List, Optional, Tuple
from uuid import uuid4, UUID
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


@dataclass
class SemanticChunk:
    """
    Chunk creato da semantic similarity chunking.

    Attributes:
        id: UUID univoco
        text: Testo del chunk
        sentences: Frasi incluse nel chunk
        start_sentence: Indice prima frase
        end_sentence: Indice ultima frase
        avg_similarity: Similarity media interna
        source_urn: URN di origine
    """
    id: UUID
    text: str
    sentences: List[str]
    start_sentence: int
    end_sentence: int
    avg_similarity: float
    source_urn: str
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def sentence_count(self) -> int:
        return len(self.sentences)


class SemanticChunker:
    """
    Chunker basato su similarity tra embeddings di frasi.

    Segmenta il testo in punti di bassa similarity semantica,
    creando chunk che preservano coerenza interna.

    Attributes:
        embedding_service: Servizio per generare embeddings
        threshold: Soglia similarity per split (default: 0.5)
        min_chunk_sentences: Minimo frasi per chunk
        max_chunk_sentences: Massimo frasi per chunk
        buffer_size: Frasi di contesto per smoothing

    Example:
        >>> chunker = SemanticChunker(embedding_service, threshold=0.5)
        >>> chunks = await chunker.chunk(text, source_urn="urn:...")
    """

    # Pattern per segmentazione frasi italiano
    # Splitta su punto/punto esclamativo/punto interrogativo seguiti da spazio
    SENTENCE_SPLIT_PATTERN = re.compile(r'(?<=[.!?])\s+')

    def __init__(
        self,
        embedding_service,
        threshold: float = 0.5,
        min_chunk_sentences: int = 1,
        max_chunk_sentences: int = 10,
        buffer_size: int = 1,
    ):
        """
        Inizializza il chunker.

        Args:
            embedding_service: Servizio embeddings (EmbeddingService o compatibile)
            threshold: Soglia similarity sotto cui splittare (0-1)
            min_chunk_sentences: Minimo frasi per chunk
            max_chunk_sentences: Massimo frasi prima di split forzato
            buffer_size: Frasi adiacenti per smoothing similarity
        """
        self.embedding = embedding_service
        self.threshold = threshold
        self.min_sentences = min_chunk_sentences
        self.max_sentences = max_chunk_sentences
        self.buffer_size = buffer_size

    async def chunk(
        self,
        text: str,
        source_urn: str = "",
    ) -> List[SemanticChunk]:
        """
        Segmenta il testo in chunk semanticamente coerenti.

        Args:
            text: Testo da segmentare
            source_urn: URN di origine per tracciabilita'

        Returns:
            Lista di SemanticChunk
        """
        if not text or len(text.strip()) < 50:
            logger.debug("Testo troppo breve per chunking semantico")
            return []

        # 1. Segmenta in frasi
        sentences = self._segment_sentences(text)
        if len(sentences) <= 1:
            # Testo breve: un solo chunk
            return [self._create_chunk(sentences, 0, 0, 1.0, source_urn)]

        # 2. Genera embeddings per tutte le frasi
        embeddings = await self._get_embeddings(sentences)

        # 3. Calcola similarity tra frasi adiacenti (con buffer)
        similarities = self._compute_similarities(embeddings)

        # 4. Trova punti di split
        split_points = self._find_split_points(similarities)

        # 5. Crea chunks
        chunks = self._create_chunks(sentences, split_points, similarities, source_urn)

        logger.info(
            f"Semantic chunking: {len(sentences)} frasi -> {len(chunks)} chunks"
        )
        return chunks

    def _segment_sentences(self, text: str) -> List[str]:
        """
        Segmenta il testo in frasi.

        Gestisce casi speciali italiani:
        - Abbreviazioni (art., comma, ecc.)
        - Numeri con punto (1.)
        - Virgolette e citazioni
        """
        # Split su fine frase
        parts = self.SENTENCE_SPLIT_PATTERN.split(text)

        # Pulizia e merge frasi troppo corte
        sentences = []
        current = ""

        for part in parts:
            part = part.strip()
            if not part:
                continue

            # Unisci frasi molto corte alla precedente
            if len(part) < 30 and current:
                current += " " + part
            elif current and len(current) < 30:
                current += " " + part
            else:
                if current:
                    sentences.append(current)
                current = part

        if current:
            sentences.append(current)

        return sentences

    async def _get_embeddings(self, sentences: List[str]) -> np.ndarray:
        """
        Genera embeddings per lista di frasi.

        Args:
            sentences: Lista di frasi

        Returns:
            Array numpy [n_sentences, embedding_dim]
        """
        # Usa batch embedding se disponibile
        if hasattr(self.embedding, 'embed_batch'):
            embeddings = await self.embedding.embed_batch(sentences)
        else:
            embeddings = []
            for sent in sentences:
                emb = await self.embedding.embed(sent)
                embeddings.append(emb)

        return np.array(embeddings)

    def _compute_similarities(self, embeddings: np.ndarray) -> List[float]:
        """
        Calcola cosine similarity tra frasi adiacenti.

        Con buffer: combina N frasi adiacenti per smoothing.

        Args:
            embeddings: Array [n_sentences, dim]

        Returns:
            Lista di similarity scores (length = n_sentences - 1)
        """
        n = len(embeddings)
        similarities = []

        for i in range(n - 1):
            # Embedding con buffer (media di frasi adiacenti)
            start_a = max(0, i - self.buffer_size)
            end_a = i + 1
            start_b = i + 1
            end_b = min(n, i + 2 + self.buffer_size)

            emb_a = embeddings[start_a:end_a].mean(axis=0)
            emb_b = embeddings[start_b:end_b].mean(axis=0)

            # Cosine similarity
            sim = self._cosine_similarity(emb_a, emb_b)
            similarities.append(sim)

        return similarities

    def _cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        """Calcola cosine similarity tra due vettori."""
        norm_a = np.linalg.norm(a)
        norm_b = np.linalg.norm(b)
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return float(np.dot(a, b) / (norm_a * norm_b))

    def _find_split_points(self, similarities: List[float]) -> List[int]:
        """
        Trova indici dove splittare basandosi su threshold.

        Args:
            similarities: Lista similarity tra frasi consecutive

        Returns:
            Lista di indici (0-based) dove splittare
        """
        split_points = []
        current_chunk_size = 1

        for i, sim in enumerate(similarities):
            current_chunk_size += 1

            # Split se:
            # 1. Similarity sotto threshold E chunk >= min size
            # 2. O chunk ha raggiunto max size
            should_split = (
                (sim < self.threshold and current_chunk_size >= self.min_sentences)
                or current_chunk_size >= self.max_sentences
            )

            if should_split:
                split_points.append(i + 1)  # Split dopo frase i+1
                current_chunk_size = 0

        return split_points

    def _create_chunks(
        self,
        sentences: List[str],
        split_points: List[int],
        similarities: List[float],
        source_urn: str,
    ) -> List[SemanticChunk]:
        """
        Crea chunk objects dai punti di split.

        Args:
            sentences: Lista frasi originali
            split_points: Indici di split
            similarities: Similarity scores
            source_urn: URN origine

        Returns:
            Lista di SemanticChunk
        """
        chunks = []
        prev_split = 0

        # Aggiungi end come ultimo split point
        all_splits = split_points + [len(sentences)]

        for i, split in enumerate(all_splits):
            chunk_sentences = sentences[prev_split:split]
            if not chunk_sentences:
                continue

            # Calcola similarity media interna
            if len(chunk_sentences) > 1:
                internal_sims = similarities[prev_split:split-1]
                avg_sim = sum(internal_sims) / len(internal_sims) if internal_sims else 1.0
            else:
                avg_sim = 1.0

            chunk = self._create_chunk(
                sentences=chunk_sentences,
                start=prev_split,
                end=split - 1,
                avg_similarity=avg_sim,
                source_urn=source_urn,
            )
            chunks.append(chunk)

            prev_split = split

        return chunks

    def _create_chunk(
        self,
        sentences: List[str],
        start: int,
        end: int,
        avg_similarity: float,
        source_urn: str,
    ) -> SemanticChunk:
        """Crea un singolo SemanticChunk."""
        return SemanticChunk(
            id=uuid4(),
            text=" ".join(sentences),
            sentences=sentences,
            start_sentence=start,
            end_sentence=end,
            avg_similarity=avg_similarity,
            source_urn=source_urn,
        )


class PercentileSemanticChunker(SemanticChunker):
    """
    Variante che usa percentile invece di threshold fisso.

    Adatta automaticamente la soglia alla distribuzione
    delle similarity nel documento specifico.
    """

    def __init__(
        self,
        embedding_service,
        percentile: float = 25.0,  # Split al 25° percentile
        **kwargs
    ):
        super().__init__(embedding_service, threshold=0.0, **kwargs)
        self.percentile = percentile

    def _find_split_points(self, similarities: List[float]) -> List[int]:
        """Usa percentile dinamico invece di threshold fisso."""
        if not similarities:
            return []

        # Calcola threshold come percentile delle similarity
        threshold = np.percentile(similarities, self.percentile)
        self.threshold = threshold

        logger.debug(f"Percentile threshold ({self.percentile}%): {threshold:.3f}")

        return super()._find_split_points(similarities)


# Exports
__all__ = [
    "SemanticChunker",
    "SemanticChunk",
    "PercentileSemanticChunker",
]
