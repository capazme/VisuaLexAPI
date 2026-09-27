"""
Citation Formatter Service
==========================

Central service for formatting legal citations in various formats.

Coordinates between:
- URN parser (for structured extraction)
- Format generators (for output formatting)
- Source metadata (for enrichment)

Example:
    >>> from merlt.citation import CitationFormatter
    >>> from merlt.citation.formats import ItalianLegalFormat
    >>>
    >>> formatter = CitationFormatter()
    >>> sources = [{"article_urn": "urn:nir:stato:codice.civile:1942;art1453"}]
    >>>
    >>> # Format in Italian legal style
    >>> output = formatter.format_sources(sources, "italian_legal")
    >>> print(output)
    FONTI GIURIDICHE
    ================
    ...

    >>> # Get formatted as a dict
    >>> single = formatter.format_single(sources[0], "italian_legal")
    >>> print(single.text)
    "Art. 1453 c.c."
"""

import json
from dataclasses import dataclass
from datetime import datetime
from typing import List, Dict, Any, Optional, Union

from merlt.api.models.citation_models import CitationFormat
from merlt.citation.formats.italian_legal import ItalianLegalFormat
from merlt.citation.formats.bibtex import BibTeXFormat
from merlt.citation.formats.plain_text import PlainTextFormat
from merlt.citation.formats.json_format import JSONFormat


@dataclass
class FormattedCitation:
    """
    A single formatted citation with metadata.

    Attributes:
        text: Formatted citation text
        format: Format used
        original_urn: Original URN if available
        category: Citation category (norme/giurisprudenza)
        expert: Source expert if available
        relevance: Source relevance score if available
    """
    text: str
    format: CitationFormat
    original_urn: Optional[str] = None
    category: Optional[str] = None
    expert: Optional[str] = None
    relevance: Optional[float] = None


class CitationFormatter:
    """
    Service for formatting legal citations.

    Supports multiple output formats and provides a unified interface
    for citation export functionality.

    Attributes:
        alis_version: Version string for attribution

    Example:
        >>> formatter = CitationFormatter(alis_version="MERL-T v1.0")
        >>> output = formatter.format_sources(sources, CitationFormat.ITALIAN_LEGAL)
    """

    def __init__(self, alis_version: str = "MERL-T v1.0"):
        """
        Initialize the citation formatter.

        Args:
            alis_version: ALIS version string for attribution and traceability
        """
        self.alis_version = alis_version

        # Initialize format handlers
        self._handlers = {
            CitationFormat.ITALIAN_LEGAL: ItalianLegalFormat(alis_version),
            CitationFormat.BIBTEX: BibTeXFormat(alis_version),
            CitationFormat.PLAIN_TEXT: PlainTextFormat(alis_version),
            CitationFormat.JSON: JSONFormat(alis_version),
        }

    def _get_handler(self, format: Union[CitationFormat, str]):
        """
        Get the appropriate format handler.

        Args:
            format: Format enum or string

        Returns:
            Format handler instance

        Raises:
            ValueError: If format is not supported
        """
        if isinstance(format, str):
            try:
                format = CitationFormat(format)
            except ValueError:
                raise ValueError(
                    f"Unsupported format: {format}. "
                    f"Supported: {[f.value for f in CitationFormat]}"
                )
        return self._handlers[format]

    def format_sources(
        self,
        sources: List[Dict[str, Any]],
        format: Union[CitationFormat, str] = CitationFormat.ITALIAN_LEGAL,
        query_summary: Optional[str] = None,
        include_attribution: bool = True,
    ) -> str:
        """
        Format a list of sources in the specified format.

        Args:
            sources: List of source dicts with article_urn, expert, relevance, etc.
            format: Output format (CitationFormat enum or string)
            query_summary: Optional query context to include
            include_attribution: Whether to include ALIS attribution

        Returns:
            Formatted string in the specified format

        Example:
            >>> sources = [
            ...     {"article_urn": "urn:nir:stato:codice.civile:1942;art1453", "expert": "literal"},
            ...     {"article_urn": "urn:nir:stato:legge:1990-08-07;241~art1", "expert": "systemic"},
            ... ]
            >>> output = formatter.format_sources(sources, "italian_legal", "responsabilità contrattuale")
        """
        handler = self._get_handler(format)
        return handler.format_all(
            sources=sources,
            query_summary=query_summary,
            include_attribution=include_attribution,
        )

    def format_single(
        self,
        source: Dict[str, Any],
        format: Union[CitationFormat, str] = CitationFormat.ITALIAN_LEGAL,
    ) -> FormattedCitation:
        """
        Format a single source.

        Args:
            source: Source dict with article_urn, expert, relevance, etc.
            format: Output format

        Returns:
            FormattedCitation with text and metadata

        Example:
            >>> source = {"article_urn": "urn:nir:stato:codice.civile:1942;art1453"}
            >>> result = formatter.format_single(source, "italian_legal")
            >>> print(result.text)
            "Art. 1453 c.c."
        """
        if isinstance(format, str):
            format = CitationFormat(format)

        handler = self._get_handler(format)
        text = handler.format_source_text(source)

        return FormattedCitation(
            text=text,
            format=format,
            original_urn=source.get("article_urn", source.get("urn")),
            expert=source.get("expert"),
            relevance=source.get("relevance"),
        )

    def get_file_extension(self, format: Union[CitationFormat, str]) -> str:
        """
        Get the file extension for a format.

        Args:
            format: Output format

        Returns:
            File extension (without dot)

        Example:
            >>> formatter.get_file_extension("bibtex")
            "bib"
        """
        handler = self._get_handler(format)
        return handler.get_file_extension()

    def get_media_type(self, format: Union[CitationFormat, str]) -> str:
        """
        Get the media type (MIME type) for a format.

        Args:
            format: Output format

        Returns:
            Media type string

        Example:
            >>> formatter.get_media_type("json")
            "application/json; charset=utf-8"
        """
        handler = self._get_handler(format)
        return handler.get_media_type()

    @staticmethod
    def list_formats() -> List[Dict[str, str]]:
        """
        List all available citation formats.

        Returns:
            List of format info dicts with name, description, extension

        Example:
            >>> for fmt in CitationFormatter.list_formats():
            ...     print(f"{fmt['name']}: {fmt['description']}")
        """
        return [
            {
                "name": CitationFormat.ITALIAN_LEGAL.value,
                "description": "Standard Italian legal citation style (Art. 1453 c.c.)",
                "extension": "txt",
                "media_type": "text/plain; charset=utf-8",
            },
            {
                "name": CitationFormat.BIBTEX.value,
                "description": "BibTeX format for academic papers",
                "extension": "bib",
                "media_type": "application/x-bibtex",
            },
            {
                "name": CitationFormat.PLAIN_TEXT.value,
                "description": "Simple numbered list",
                "extension": "txt",
                "media_type": "text/plain; charset=utf-8",
            },
            {
                "name": CitationFormat.JSON.value,
                "description": "Structured JSON with full metadata",
                "extension": "json",
                "media_type": "application/json; charset=utf-8",
            },
        ]


__all__ = [
    "CitationFormat",
    "CitationFormatter",
    "FormattedCitation",
]
