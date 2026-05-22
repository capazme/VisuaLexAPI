"""
Structural Chunker for Legal Documents
======================================

Creates chunks at the comma (paragraph) level for optimal retrieval.
Each chunk maintains legal context and generates unique URNs.

Design principles:
- Comma-level chunking (no token threshold - all articles split by comma)
- URN generation with -com{N} extension for internal granularity (NIR-like format)
- Preserves hierarchical context (libro, titolo, articolo)
- Zero-LLM approach for reproducibility

Chunk URN format:
    Internal: urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453-com1
    External: https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453

Usage:
    chunker = StructuralChunker()
    chunks = chunker.chunk_article(article_structure, base_urn, metadata)
"""

import structlog
import re
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from uuid import uuid4, UUID
from datetime import datetime, timezone

from merlt.pipeline.parsing import ArticleStructure, Comma, count_tokens

log = structlog.get_logger()


@dataclass
class ChunkMetadata:
    """
    Metadata for a chunk, providing context for retrieval and graph linking.

    Attributes:
        libro: Book identifier (e.g., "IV")
        titolo: Title identifier (e.g., "II")
        capo: Chapter identifier (optional)
        sezione: Section identifier (optional)
        articolo: Article number (e.g., "1453")
        rubrica: Article title
        comma_numero: Comma number within article
        position_in_code: Brocardi position string
        fonte: Data source (e.g., "VisualexAPI")
    """
    libro: Optional[str] = None
    titolo: Optional[str] = None
    capo: Optional[str] = None
    sezione: Optional[str] = None
    articolo: str = ""
    rubrica: Optional[str] = None
    comma_numero: int = 1
    position_in_code: Optional[str] = None
    fonte: str = "VisualexAPI"


@dataclass
class Chunk:
    """
    A single chunk representing a comma-level segment of legal text.

    Attributes:
        chunk_id: Unique UUID for this chunk (for Qdrant)
        urn: Internal URN with comma extension (e.g., ~art1453-com1)
        url: External URL for linking (no comma, article-level)
        text: The chunk text content
        token_count: Number of tokens in this chunk
        article_urn: URN of parent article (for Bridge Table PRIMARY mapping)
        metadata: Additional context for retrieval
        created_at: Timestamp of chunk creation
    """
    chunk_id: UUID
    urn: str  # Internal URN with comma: ~art1453-com1
    url: str  # External URL without comma: ~art1453
    text: str
    token_count: int
    article_urn: str  # Parent article URN for Bridge Table
    metadata: ChunkMetadata
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "chunk_id": str(self.chunk_id),
            "urn": self.urn,
            "url": self.url,
            "text": self.text,
            "token_count": self.token_count,
            "article_urn": self.article_urn,
            "metadata": {
                "libro": self.metadata.libro,
                "titolo": self.metadata.titolo,
                "capo": self.metadata.capo,
                "sezione": self.metadata.sezione,
                "articolo": self.metadata.articolo,
                "rubrica": self.metadata.rubrica,
                "comma_numero": self.metadata.comma_numero,
                "position_in_code": self.metadata.position_in_code,
                "fonte": self.metadata.fonte,
            },
            "created_at": self.created_at.isoformat(),
        }


class StructuralChunker:
    """
    Chunker that splits articles at comma (paragraph) boundaries.

    Features:
    - Comma-level chunking for all articles (no threshold)
    - URN generation with -com{N} extension
    - Metadata preservation for graph linking
    - Context enrichment from Brocardi position

    Usage:
        chunker = StructuralChunker()
        chunks = chunker.chunk_article(
            article_structure=parsed_article,
            article_urn="urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453",
            article_url="https://www.normattiva.it/uri-res/N2Ls?urn:...",
            brocardi_position="Libro IV - Delle obbligazioni, Titolo II - ..."
        )
    """

    # Patterns to extract structural info from Brocardi position
    # Codici: "Libro IV - Delle obbligazioni, Titolo II - Dei contratti in generale, Capo XIV - ..."
    # Codice Penale: "Libro primo - Dei reati..." (usa parole invece di romani)
    # Costituzione: "Parte II - Ordinamento della repubblica, Titolo V - Le regioni..."
    # Principi fondamentali: nessuna Parte/Titolo (Art. 1-12)
    #
    # Pattern supporta sia numeri romani (I, II, IV, XIV) che parole ordinali italiane (primo...cinquantesimo)
    # Importa il pattern completo da ordinals.py
    from merlt.utils.ordinals import ROMAN_OR_ORDINAL_PATTERN
    _ROMAN_OR_ORDINAL = f'({ROMAN_OR_ORDINAL_PATTERN})'
    LIBRO_PATTERN = re.compile(rf'Libro\s+{_ROMAN_OR_ORDINAL}', re.IGNORECASE)
    PARTE_PATTERN = re.compile(rf'Parte\s+{_ROMAN_OR_ORDINAL}', re.IGNORECASE)  # Costituzione usa "Parte" invece di "Libro"
    TITOLO_PATTERN = re.compile(rf'Titolo\s+{_ROMAN_OR_ORDINAL}', re.IGNORECASE)
    CAPO_PATTERN = re.compile(rf'Capo\s+{_ROMAN_OR_ORDINAL}', re.IGNORECASE)
    SEZIONE_PATTERN = re.compile(rf'Sezione\s+{_ROMAN_OR_ORDINAL}', re.IGNORECASE)

    def __init__(self):
        """Initialize the chunker."""
        pass

    def chunk_article(
        self,
        article_structure: ArticleStructure,
        article_urn: str,
        article_url: str,
        brocardi_position: Optional[str] = None,
    ) -> List[Chunk]:
        """
        Create chunks from a parsed article structure.

        Each comma becomes a separate chunk with:
        - Unique chunk_id (UUID for Qdrant)
        - Internal URN with -com{N} extension
        - External URL (article-level, for frontend linking)
        - Metadata for graph context

        Args:
            article_structure: Parsed article from CommaParser
            article_urn: Base URN for the article (e.g., urn:...~art1453)
            article_url: External URL for the article
            brocardi_position: Position string from Brocardi (optional)

        Returns:
            List of Chunk objects, one per comma
        """
        chunks = []

        # Extract structural metadata from Brocardi position
        libro, titolo, capo, sezione = self._parse_position(brocardi_position)

        for comma in article_structure.commas:
            # Generate URN with comma extension
            chunk_urn = self._generate_chunk_urn(article_urn, comma.numero)

            # Create metadata
            metadata = ChunkMetadata(
                libro=libro,
                titolo=titolo,
                capo=capo,
                sezione=sezione,
                articolo=article_structure.numero_articolo,
                rubrica=article_structure.rubrica,
                comma_numero=comma.numero,
                position_in_code=brocardi_position,
                fonte="VisualexAPI",
            )

            # Create chunk
            chunk = Chunk(
                chunk_id=uuid4(),
                urn=chunk_urn,
                url=article_url,  # Article-level URL for external linking
                text=comma.testo,
                token_count=comma.token_count,
                article_urn=article_urn,
                metadata=metadata,
            )

            chunks.append(chunk)

        log.info(
            f"Created {len(chunks)} chunks for article {article_structure.numero_articolo} "
            f"(total tokens: {sum(c.token_count for c in chunks)})"
        )

        return chunks

    def _generate_chunk_urn(self, article_urn: str, comma_numero: int) -> str:
        """
        Generate chunk URN by appending comma extension to article URN.

        Uses NIR-like format (-com{N}) consistent with multivigenza.py
        and other structural elements (-let{X}, -num{N}).

        Args:
            article_urn: Base article URN (e.g., urn:...~art1453)
            comma_numero: Comma number (1-indexed)

        Returns:
            Chunk URN with comma extension (e.g., urn:...~art1453-com1)
        """
        return f"{article_urn}-com{comma_numero}"

    def _parse_position(
        self, position: Optional[str]
    ) -> tuple[Optional[str], Optional[str], Optional[str], Optional[str]]:
        """
        Parse Brocardi position string to extract structural identifiers.

        Supporta sia Codici (Libro) che Costituzione (Parte).

        Args:
            position: Brocardi position string
                - Codici: "Libro IV - Delle obbligazioni, Titolo II - ..."
                - Costituzione: "Parte II - Ordinamento..., Titolo V - Le regioni..."

        Returns:
            Tuple of (libro_o_parte, titolo, capo, sezione) - each may be None
            Il primo elemento e' "Libro" per i Codici o "Parte" per la Costituzione.
        """
        if not position:
            return None, None, None, None

        # Extract each component separately for robustness
        # Libro (Codici) o Parte (Costituzione) - sono equivalenti nella gerarchia
        libro_match = self.LIBRO_PATTERN.search(position)
        parte_match = self.PARTE_PATTERN.search(position)
        titolo_match = self.TITOLO_PATTERN.search(position)
        capo_match = self.CAPO_PATTERN.search(position)
        sezione_match = self.SEZIONE_PATTERN.search(position)

        # Usa Libro se presente, altrimenti Parte (sono mutuamente esclusivi)
        libro_o_parte = libro_match.group(1) if libro_match else (parte_match.group(1) if parte_match else None)

        return (
            libro_o_parte,
            titolo_match.group(1) if titolo_match else None,
            capo_match.group(1) if capo_match else None,
            sezione_match.group(1) if sezione_match else None,
        )

    def chunk_batch(
        self,
        articles: List[Dict[str, Any]],
    ) -> List[Chunk]:
        """
        Process a batch of articles and return all chunks.

        Each article dict should contain:
        - article_structure: ArticleStructure
        - article_urn: str
        - article_url: str
        - brocardi_position: Optional[str]

        Args:
            articles: List of article dictionaries

        Returns:
            Flat list of all chunks from all articles
        """
        all_chunks = []

        for article_data in articles:
            chunks = self.chunk_article(
                article_structure=article_data["article_structure"],
                article_urn=article_data["article_urn"],
                article_url=article_data["article_url"],
                brocardi_position=article_data.get("brocardi_position"),
            )
            all_chunks.extend(chunks)

        log.info(
            f"Batch chunking complete: {len(articles)} articles -> {len(all_chunks)} chunks"
        )

        return all_chunks


def chunk_article(
    article_structure: ArticleStructure,
    article_urn: str,
    article_url: str,
    brocardi_position: Optional[str] = None,
) -> List[Chunk]:
    """
    Convenience function to chunk an article.

    Args:
        article_structure: Parsed article from CommaParser
        article_urn: Base URN for the article
        article_url: External URL for the article
        brocardi_position: Position string from Brocardi

    Returns:
        List of Chunk objects
    """
    chunker = StructuralChunker()
    return chunker.chunk_article(
        article_structure=article_structure,
        article_urn=article_urn,
        article_url=article_url,
        brocardi_position=brocardi_position,
    )


# Exports
__all__ = [
    'Chunk',
    'ChunkMetadata',
    'StructuralChunker',
    'chunk_article',
]
