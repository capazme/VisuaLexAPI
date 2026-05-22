"""
MERL-T Sources - Local Module

This module re-exports scraping functionality and models from merlt.clients.
Utilities (URNGenerator, TreeExtractor, text_op) will be implemented locally.
"""

try:
    # Scrapers and models now use HTTP client to visualex-api
    from merlt.clients import (
        NormattivaScraper,
        BrocardiScraper,
        Norma,
        NormaVisitata,
    )

    # TODO: Copy or implement these utilities from visualex-api
    # from merlt.utils.urngenerator import generate_urn, URNGenerator
    # from merlt.utils.treextractor import TreeExtractor
    # from merlt.utils.text_op import normalize_text, clean_text

    __all__ = [
        "NormattivaScraper",
        "BrocardiScraper",
        # "EurlexScraper",  # TODO: Implement HTTP-based EurlexScraper
        "Norma",
        "NormaVisitata",
        # "generate_urn",  # TODO: Implement locally
        # "URNGenerator",  # TODO: Implement locally
        # "TreeExtractor",  # TODO: Implement locally
        # "normalize_text",  # TODO: Implement locally
        # "clean_text",  # TODO: Implement locally
    ]

except ImportError as e:
    import warnings
    warnings.warn(
        f"merlt.clients import error: {e}",
        ImportWarning
    )
    raise
