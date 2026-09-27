"""
Citation Format Generators
==========================

Format generators for exporting legal citations.

Available formats:
- italian_legal: Standard Italian legal citation style
- bibtex: BibTeX format for academic papers
- plain_text: Simple numbered list
- json_format: Structured JSON with metadata

Each generator implements the BaseFormat interface:
- format_source(): Format a single citation
- format_all(): Format multiple citations with header/footer
"""

from merlt.citation.formats.base import BaseFormat
from merlt.citation.formats.italian_legal import ItalianLegalFormat
from merlt.citation.formats.bibtex import BibTeXFormat
from merlt.citation.formats.plain_text import PlainTextFormat
from merlt.citation.formats.json_format import JSONFormat

__all__ = [
    "BaseFormat",
    "ItalianLegalFormat",
    "BibTeXFormat",
    "PlainTextFormat",
    "JSONFormat",
]
