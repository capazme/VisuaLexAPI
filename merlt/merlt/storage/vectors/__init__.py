"""
MERL-T Vector Storage
=====================

Embeddings con E5-large e storage su Qdrant.

Componenti:
- EmbeddingService: Generazione embeddings con E5-large multilingual

Esempio:
    from merlt.storage.vectors import EmbeddingService

    service = EmbeddingService.get_instance()
    query_vector = service.encode_query("Cos'è la legittima difesa?")
    doc_vector = service.encode_document(article_text)
"""

from merlt.storage.vectors.embeddings import EmbeddingService

__all__ = [
    "EmbeddingService",
]
