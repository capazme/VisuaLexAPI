"""
MERL-T Utilities
================

Utility functions for legal text processing.

Mapping data:
- NORMATTIVA_URN_CODICI: Italian legal codes to URN mapping
- NORMATTIVA, NORMATTIVA_SEARCH: Act type normalization
- BROCARDI_CODICI, BROCARDI_SEARCH: Brocardi.it integration
- EURLEX, FONTI_PRINCIPALI: European and principal sources

Text operations:
- parse_date: Parse Italian dates
- normalize_act_type: Normalize act type names
- nospazi: Clean whitespace
- estrai_numero_da_estensione: Parse article extensions (bis, ter, etc.)
"""

from .map import (
    extract_codice_details,
    NORMATTIVA_URN_CODICI,
    BROCARDI_CODICI,
    NORMATTIVA_SEARCH,
    NORMATTIVA,
    BROCARDI_SEARCH,
    EURLEX,
    FONTI_PRINCIPALI,
)

from .text_op import (
    nospazi,
    parse_date,
    format_date_to_extended,
    normalize_act_type,
    estrai_data_da_denominazione,
    estrai_numero_da_estensione,
    get_annex_from_urn,
    parse_article_number,
    normalize_article_format,
)

from .ordinals import (
    to_arabic,
    roman_to_arabic,
    ordinal_to_arabic,
    arabic_to_roman,
    ROMAN_OR_ORDINAL_PATTERN,
    ROMAN_PATTERN,
    ORDINAL_WORDS,
)

from .urngenerator import (
    generate_urn,
    urn_to_filename,
)


__all__ = [
    # Map constants
    "extract_codice_details",
    "NORMATTIVA_URN_CODICI",
    "BROCARDI_CODICI",
    "NORMATTIVA_SEARCH",
    "NORMATTIVA",
    "BROCARDI_SEARCH",
    "EURLEX",
    "FONTI_PRINCIPALI",
    # Text operations
    "nospazi",
    "parse_date",
    "format_date_to_extended",
    "normalize_act_type",
    "estrai_data_da_denominazione",
    "estrai_numero_da_estensione",
    "get_annex_from_urn",
    "parse_article_number",
    "normalize_article_format",
    # Ordinals
    "to_arabic",
    "roman_to_arabic",
    "ordinal_to_arabic",
    "arabic_to_roman",
    "ROMAN_OR_ORDINAL_PATTERN",
    "ROMAN_PATTERN",
    "ORDINAL_WORDS",
    # URN Generator
    "generate_urn",
    "urn_to_filename",
]
