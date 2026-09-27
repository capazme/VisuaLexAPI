"""
Embedding Service for E5-large Multilingual Model

This service provides a singleton instance for loading and using the
sentence-transformers/multilingual-e5-large model for legal document embedding.

Key Features:
- Singleton pattern (model loaded once and reused)
- Lazy loading (model loaded on first use, not on import)
- E5 prefix handling ("query: " for queries, "passage: " for documents)
- Batch encoding for efficiency
- Configurable device (CPU/CUDA)
- Thread-safe initialization

E5 Model Requirements:
The E5 models require specific prefixes for queries and passages:
- Query: "query: <text>"
- Document: "passage: <text>"

Reference: https://huggingface.co/intfloat/multilingual-e5-large
"""

import structlog
import os
from typing import List, Optional, Union
import asyncio
from threading import Lock

try:
    from sentence_transformers import SentenceTransformer
    import torch
except ImportError:
    raise ImportError(
        "sentence-transformers and torch are required for EmbeddingService. "
        "Install with: pip install sentence-transformers torch"
    )

log = structlog.get_logger()


class EmbeddingService:
    """
    Singleton service for E5-large multilingual embeddings.

    Usage:
        # Get singleton instance
        service = EmbeddingService.get_instance()

        # Encode a query
        query_vector = service.encode_query("Cos'è il contratto?")

        # Encode a document
        doc_vector = service.encode_document("Art. 1321 c.c. - Il contratto è...")

        # Batch encoding
        vectors = service.encode_batch(["text1", "text2"], is_query=False)
    """

    _instance: Optional['EmbeddingService'] = None
    _lock: Lock = Lock()
    _model: Optional[SentenceTransformer] = None
    _initialized: bool = False

    def __init__(
        self,
        model_name: Optional[str] = None,
        device: Optional[str] = None,
        batch_size: int = 32,
        normalize_embeddings: bool = True
    ):
        """
        Initialize EmbeddingService.

        Args:
            model_name: Sentence-transformers model name
                       (default: from EMBEDDING_MODEL env var or multilingual-e5-large)
            device: Device to use ('cpu', 'cuda', or None for auto-detect)
            batch_size: Batch size for encoding
            normalize_embeddings: Whether to normalize embeddings (for cosine similarity)
        """
        # Configuration from environment variables or defaults
        self.model_name = (
            model_name or
            os.getenv("EMBEDDING_MODEL", "intfloat/multilingual-e5-large")
        )
        self.device = (
            device or
            os.getenv("EMBEDDING_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
        )
        self.batch_size = int(os.getenv("EMBEDDING_BATCH_SIZE", str(batch_size)))
        self.normalize_embeddings = (
            os.getenv("EMBEDDING_NORMALIZE", str(normalize_embeddings)).lower() == "true"
        )

        # Model will be loaded lazily on first use
        self._model = None

        log.info(
            f"EmbeddingService configured",
            extra={
                "model": self.model_name,
                "device": self.device,
                "batch_size": self.batch_size,
                "normalize": self.normalize_embeddings
            }
        )

    @classmethod
    def get_instance(cls, **kwargs) -> 'EmbeddingService':
        """
        Get singleton instance of EmbeddingService.

        Thread-safe singleton implementation using double-checked locking.

        Args:
            **kwargs: Arguments passed to __init__ on first instantiation

        Returns:
            EmbeddingService singleton instance
        """
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls(**kwargs)
        return cls._instance

    def _load_model(self) -> SentenceTransformer:
        """
        Lazy load the sentence-transformers model.

        This method loads the model on first use, not on instantiation.
        Downloads the model if not cached (~1.2GB for E5-large).

        Returns:
            SentenceTransformer model instance
        """
        if self._model is None:
            with self._lock:
                if self._model is None:
                    log.info(f"Loading embedding model: {self.model_name} on device: {self.device}")
                    log.info("First-time download may take 2-3 minutes (~1.2GB for E5-large)")

                    try:
                        self._model = SentenceTransformer(
                            self.model_name,
                            device=self.device
                        )
                        self._initialized = True
                        log.info(f"Model loaded successfully. Embedding dimension: {self._model.get_sentence_embedding_dimension()}")
                    except Exception as e:
                        log.error(f"Failed to load model: {e}", exc_info=True)
                        raise RuntimeError(f"Failed to load embedding model: {e}")

        return self._model

    @property
    def is_loaded(self) -> bool:
        """Check if model is loaded."""
        return self._model is not None and self._initialized

    @property
    def embedding_dimension(self) -> int:
        """Get embedding dimension (1024 for E5-large)."""
        model = self._load_model()
        return model.get_sentence_embedding_dimension()

    def encode_query(self, text: str) -> List[float]:
        """
        Encode a query text with E5 "query: " prefix.

        E5 models require the "query: " prefix for query encoding.

        Args:
            text: Query text (e.g., "Cos'è il contratto?")

        Returns:
            List of floats representing the embedding vector (1024 dimensions)
        """
        model = self._load_model()

        # E5 models require "query: " prefix
        prefixed_text = f"query: {text}"

        log.debug(f"Encoding query: {text[:100]}...")

        embedding = model.encode(
            prefixed_text,
            normalize_embeddings=self.normalize_embeddings,
            convert_to_numpy=True
        )

        return embedding.tolist()

    def encode_document(self, text: str) -> List[float]:
        """
        Encode a document text with E5 "passage: " prefix.

        E5 models require the "passage: " prefix for document encoding.

        Args:
            text: Document text (e.g., "Art. 1321 c.c. - Il contratto è...")

        Returns:
            List of floats representing the embedding vector (1024 dimensions)
        """
        model = self._load_model()

        # E5 models require "passage: " prefix
        prefixed_text = f"passage: {text}"

        log.debug(f"Encoding document: {text[:100]}...")

        embedding = model.encode(
            prefixed_text,
            normalize_embeddings=self.normalize_embeddings,
            convert_to_numpy=True
        )

        return embedding.tolist()

    def encode_batch(
        self,
        texts: List[str],
        is_query: bool = False,
        show_progress_bar: bool = False
    ) -> List[List[float]]:
        """
        Encode a batch of texts with appropriate E5 prefixes.

        More efficient than encoding one by one.

        Args:
            texts: List of texts to encode
            is_query: If True, use "query: " prefix; if False, use "passage: " prefix
            show_progress_bar: Whether to show progress bar (useful for large batches)

        Returns:
            List of embedding vectors, one per input text
        """
        if not texts:
            return []

        model = self._load_model()

        # Add appropriate prefix
        prefix = "query: " if is_query else "passage: "
        prefixed_texts = [f"{prefix}{text}" for text in texts]

        log.info(f"Batch encoding {len(texts)} {'queries' if is_query else 'documents'}")

        embeddings = model.encode(
            prefixed_texts,
            batch_size=self.batch_size,
            normalize_embeddings=self.normalize_embeddings,
            show_progress_bar=show_progress_bar,
            convert_to_numpy=True
        )

        return embeddings.tolist()

    async def encode_query_async(self, text: str) -> List[float]:
        """
        Async wrapper for encode_query.

        Runs encoding in thread pool to avoid blocking event loop.

        Args:
            text: Query text

        Returns:
            Embedding vector
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.encode_query, text)

    async def encode_document_async(self, text: str) -> List[float]:
        """
        Async wrapper for encode_document.

        Runs encoding in thread pool to avoid blocking event loop.

        Args:
            text: Document text

        Returns:
            Embedding vector
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.encode_document, text)

    async def encode_batch_async(
        self,
        texts: List[str],
        is_query: bool = False,
        show_progress_bar: bool = False
    ) -> List[List[float]]:
        """
        Async wrapper for encode_batch.

        Runs encoding in thread pool to avoid blocking event loop.

        Args:
            texts: List of texts to encode
            is_query: If True, use "query: " prefix
            show_progress_bar: Whether to show progress bar

        Returns:
            List of embedding vectors
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            lambda: self.encode_batch(texts, is_query, show_progress_bar)
        )

    def __repr__(self) -> str:
        """String representation."""
        return (
            f"EmbeddingService("
            f"model={self.model_name}, "
            f"device={self.device}, "
            f"loaded={self.is_loaded})"
        )
