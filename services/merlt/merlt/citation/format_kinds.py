"""The citation export formats, apart from the API models that also name them.

``merlt.citation.formatter`` used to import this enum from ``merlt.api.models``, which runs
``merlt.api``'s package, whose ``citation_router`` imports the formatter back: ``import
merlt.citation`` failed on its own (a circular import found by the source-convention PR).
"""
from enum import Enum


class CitationFormat(str, Enum):
    """Supported citation export formats."""
    ITALIAN_LEGAL = "italian_legal"
    BIBTEX = "bibtex"
    PLAIN_TEXT = "plain_text"
    JSON = "json"
