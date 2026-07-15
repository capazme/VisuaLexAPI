"""
MERL-T Sources - Local Module

This module re-exports scraping functionality and models from merlt.clients,
plus the text/URN utilities now implemented locally in merlt.utils.
"""

try:
    # Scrapers and models now use HTTP client to visualex-api
    from merlt.clients import (
        NormattivaScraper,
        BrocardiScraper,
        Norma,
        NormaVisitata,
    )

    # Utilities now implemented locally in merlt.utils
    from merlt.utils.urngenerator import generate_urn
    from merlt.utils.text_op import nospazi, normalize_act_type

    # Not implemented locally: URNGenerator (class-based API; only the
    # generate_urn() function was ported) and TreeExtractor (no local
    # equivalent exists in merlt.utils — tree extraction still requires
    # the visualex-api HTTP client). There is also no function named
    # normalize_text/clean_text in merlt.utils; nospazi() and
    # normalize_act_type() above are the closest real equivalents.

    __all__ = [
        "NormattivaScraper",
        "BrocardiScraper",
        # "EurlexScraper",  # TODO: Implement HTTP-based EurlexScraper
        "Norma",
        "NormaVisitata",
        "generate_urn",
        "nospazi",
        "normalize_act_type",
        # "URNGenerator",  # Not implemented locally (class-based API absent from merlt.utils)
        # "TreeExtractor",  # Not implemented locally (no equivalent in merlt.utils)
    ]

except ImportError as e:
    import warnings
    warnings.warn(
        f"merlt.clients import error: {e}",
        ImportWarning
    )
    raise
