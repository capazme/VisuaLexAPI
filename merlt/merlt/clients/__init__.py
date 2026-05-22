"""
VisuaLex HTTP Client

This module provides HTTP clients to communicate with visualex-api service.
Instead of importing visualex directly, merlt uses these clients to call
the visualex REST API, enabling true microservices separation.

Usage:
    # Use scrapers (HTTP-based)
    from merlt.clients import NormattivaScraper, BrocardiScraper

    scraper = NormattivaScraper()
    text, url = await scraper.get_document(norma_visitata)

    # Use models
    from merlt.clients import Norma, NormaVisitata

    norma = Norma(tipo_atto="codice civile")
"""

from .models import (
    Norma,
    NormaVisitata,
    Modifica,
    TipoModifica,
    StoriaArticolo,
)
from .visualex_client import (
    VisuaLexClient,
    get_visualex_client,
    NormattivaScraper,
    BrocardiScraper,
    ArticleResult,
    BrocardiResult,
    TreeResult,
    # TreeExtractor types
    TreeExtractor,
    NormTree,
    NormNode,
    NormLevel,
    # Module-level functions for treextractor compatibility
    get_hierarchical_tree,
    get_all_articles_with_positions,
    get_article_position,
)

__all__ = [
    # Models
    "Norma",
    "NormaVisitata",
    "Modifica",
    "TipoModifica",
    "StoriaArticolo",
    # Client
    "VisuaLexClient",
    "get_visualex_client",
    # Scrapers (HTTP-based)
    "NormattivaScraper",
    "BrocardiScraper",
    # Result types
    "ArticleResult",
    "BrocardiResult",
    "TreeResult",
    # TreeExtractor
    "TreeExtractor",
    "NormTree",
    "NormNode",
    "NormLevel",
    "get_hierarchical_tree",
    "get_all_articles_with_positions",
    "get_article_position",
]
