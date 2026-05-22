"""
Citation Export API Models
==========================

Pydantic models for citation export endpoints.

Models:
- CitationFormat: Enum of supported formats
- CitationSource: Single source for citation
- CitationExportRequest: Request to export citations
- CitationExportResponse: Response with download info
- CitationFormatResponse: Inline formatted citations

Example:
    >>> from merlt.api.models.citation_models import CitationExportRequest, CitationFormat
    >>>
    >>> request = CitationExportRequest(
    ...     trace_id="trace_abc123",
    ...     format=CitationFormat.ITALIAN_LEGAL,
    ...     include_query_summary=True
    ... )
"""

from datetime import datetime
from enum import Enum
from typing import List, Optional, Dict, Any

from pydantic import BaseModel, Field


# =============================================================================
# ENUMS
# =============================================================================


class CitationFormat(str, Enum):
    """Supported citation export formats."""
    ITALIAN_LEGAL = "italian_legal"
    BIBTEX = "bibtex"
    PLAIN_TEXT = "plain_text"
    JSON = "json"


# =============================================================================
# SOURCE MODELS
# =============================================================================


class CitationSource(BaseModel):
    """
    A single source for citation export.

    Can be provided directly instead of fetching from a trace.

    Attributes:
        article_urn: URN of the legal source
        expert: Expert that retrieved this source
        relevance: Relevance score (0-1)
        title: Optional title or description
        source_type: Type of source (norme, giurisprudenza)
        chunk_id: Optional chunk ID from vector store

    Example:
        >>> source = CitationSource(
        ...     article_urn="urn:nir:stato:codice.civile:1942;art1453",
        ...     expert="literal",
        ...     relevance=0.95
        ... )
    """
    article_urn: str = Field(..., description="URN of the legal source")
    expert: Optional[str] = Field(None, description="Expert that retrieved this source")
    relevance: Optional[float] = Field(None, ge=0, le=1, description="Relevance score")
    title: Optional[str] = Field(None, description="Optional title or description")
    source_type: Optional[str] = Field(None, description="Type: norme, giurisprudenza")
    chunk_id: Optional[str] = Field(None, description="Chunk ID from vector store")


# =============================================================================
# REQUEST MODELS
# =============================================================================


class CitationExportRequest(BaseModel):
    """
    Request to export citations from a trace or provided sources.

    Either trace_id OR sources must be provided.

    Attributes:
        trace_id: ID of trace to export citations from
        sources: Direct list of sources to format
        format: Output format (default: italian_legal)
        include_query_summary: Include the query as context
        include_attribution: Include ALIS attribution

    Example:
        >>> # Export from trace
        >>> request = CitationExportRequest(
        ...     trace_id="trace_abc123",
        ...     format=CitationFormat.BIBTEX
        ... )
        >>>
        >>> # Export from direct sources
        >>> request = CitationExportRequest(
        ...     sources=[CitationSource(article_urn="...")],
        ...     format=CitationFormat.ITALIAN_LEGAL
        ... )
    """
    trace_id: Optional[str] = Field(
        None,
        description="ID of trace to export citations from"
    )
    sources: Optional[List[CitationSource]] = Field(
        None,
        description="Direct list of sources to format (alternative to trace_id)"
    )
    format: CitationFormat = Field(
        CitationFormat.ITALIAN_LEGAL,
        description="Output format"
    )
    include_query_summary: bool = Field(
        True,
        description="Include the query as context in the export"
    )
    include_attribution: bool = Field(
        True,
        description="Include ALIS attribution and version"
    )


class CitationFormatRequest(BaseModel):
    """
    Request to format citations inline (no file generation).

    Attributes:
        sources: List of sources to format
        format: Output format
        query_summary: Optional query context
        include_attribution: Include ALIS attribution

    Example:
        >>> request = CitationFormatRequest(
        ...     sources=[CitationSource(article_urn="...")],
        ...     format=CitationFormat.PLAIN_TEXT
        ... )
    """
    sources: List[CitationSource] = Field(
        ...,
        min_length=1,
        description="List of sources to format"
    )
    format: CitationFormat = Field(
        CitationFormat.ITALIAN_LEGAL,
        description="Output format"
    )
    query_summary: Optional[str] = Field(
        None,
        description="Optional query context"
    )
    include_attribution: bool = Field(
        True,
        description="Include ALIS attribution"
    )


# =============================================================================
# RESPONSE MODELS
# =============================================================================


class CitationExportResponse(BaseModel):
    """
    Response from citation export endpoint.

    Attributes:
        success: Whether export was successful
        format: Format used
        filename: Generated filename
        download_url: URL to download the file
        citations_count: Number of citations exported
        alis_version: ALIS version for traceability
        generated_at: Timestamp of generation
        message: Optional message

    Example:
        >>> response = CitationExportResponse(
        ...     success=True,
        ...     format=CitationFormat.ITALIAN_LEGAL,
        ...     filename="citations_risoluzione_20260205_abc12345.txt",
        ...     download_url="/api/v1/citations/download/citations_...",
        ...     citations_count=5,
        ...     alis_version="MERL-T v1.0",
        ...     generated_at=datetime.now()
        ... )
    """
    success: bool
    format: CitationFormat
    filename: str
    download_url: str
    citations_count: int
    alis_version: str
    generated_at: datetime
    message: Optional[str] = None


class CitationFormatResponse(BaseModel):
    """
    Response from inline format endpoint.

    Returns the formatted content directly (no file).

    Attributes:
        success: Whether formatting was successful
        format: Format used
        content: Formatted citation content
        citations_count: Number of citations
        alis_version: ALIS version

    Example:
        >>> response = CitationFormatResponse(
        ...     success=True,
        ...     format=CitationFormat.ITALIAN_LEGAL,
        ...     content="FONTI GIURIDICHE\\n...",
        ...     citations_count=3
        ... )
    """
    success: bool
    format: CitationFormat
    content: str
    citations_count: int
    alis_version: str = "MERL-T v1.0"


class CitationFormatInfo(BaseModel):
    """
    Information about a citation format.

    Attributes:
        name: Format name/identifier
        description: Human-readable description
        extension: File extension
        media_type: MIME type
    """
    name: str
    description: str
    extension: str
    media_type: str


class CitationFormatsListResponse(BaseModel):
    """
    Response listing available citation formats.

    Attributes:
        formats: List of available formats
        default_format: The default format name
    """
    formats: List[CitationFormatInfo]
    default_format: str = "italian_legal"


# =============================================================================
# ERROR MODELS
# =============================================================================


class CitationErrorResponse(BaseModel):
    """
    Error response for citation endpoints.

    Attributes:
        success: Always False for errors
        error: Error type
        message: Error description
        detail: Optional additional details
    """
    success: bool = False
    error: str
    message: str
    detail: Optional[str] = None


# =============================================================================
# EXPORTS
# =============================================================================


__all__ = [
    # Enums
    "CitationFormat",
    # Source models
    "CitationSource",
    # Request models
    "CitationExportRequest",
    "CitationFormatRequest",
    # Response models
    "CitationExportResponse",
    "CitationFormatResponse",
    "CitationFormatInfo",
    "CitationFormatsListResponse",
    # Error models
    "CitationErrorResponse",
]
