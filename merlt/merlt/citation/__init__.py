"""
Citation Export Module
======================

Module for exporting legal citations from Q&A traces in various formats.

Features:
- URN parsing for Italian legal references
- Multiple export formats: Italian legal, BibTeX, plain text, JSON
- ALIS attribution and versioning
- UTF-8 support for Italian characters

Formats:
- italian_legal: Standard Italian legal citation style
- bibtex: BibTeX format for academic papers
- plain_text: Simple numbered list
- json: Structured JSON with metadata

Example:
    >>> from merlt.citation import CitationFormatter, CitationFormat
    >>> from merlt.citation.urn_parser import parse_urn
    >>>
    >>> # Parse a URN
    >>> parsed = parse_urn("urn:nir:stato:codice.civile:1942;art1453")
    >>> print(parsed.codice_abbrev)  # "c.c."
    >>>
    >>> # Format citations
    >>> formatter = CitationFormatter()
    >>> output = formatter.format_sources(sources, CitationFormat.ITALIAN_LEGAL)
"""

from merlt.citation.urn_parser import (
    ParsedURN,
    parse_urn,
    get_codice_abbreviation,
    get_act_type_abbreviation,
)
from merlt.citation.formatter import CitationFormatter, FormattedCitation

__all__ = [
    # URN Parser
    "ParsedURN",
    "parse_urn",
    "get_codice_abbreviation",
    "get_act_type_abbreviation",
    # Formatter
    "CitationFormatter",
    "FormattedCitation",
]
