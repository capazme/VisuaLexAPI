"""
MERL-T Sources Utils
====================

Utilità per gli scrapers: parsing URN, estrazione struttura, operazioni testo.

Componenti:
- norma: NormaVisitata, Modifica, TipoModifica, StoriaArticolo
- urn: generate_urn, parse_urn
- tree: NormTree, get_article_position, get_hierarchical_tree
- text: normalize_act_type, clean_text
- http: HTTP client utilities
- map: Mappature codici (BROCARDI_CODICI, etc.)
"""

from merlt.sources.utils.norma import (
    NormaVisitata,
    Modifica,
    TipoModifica,
    StoriaArticolo,
)
from merlt.sources.utils.urn import generate_urn
from merlt.sources.utils.tree import (
    NormTree,
    get_article_position,
    get_hierarchical_tree,
)
from merlt.sources.utils.text import normalize_act_type
from merlt.sources.utils.map import BROCARDI_CODICI

__all__ = [
    # Norma models
    "NormaVisitata",
    "Modifica",
    "TipoModifica",
    "StoriaArticolo",
    # URN
    "generate_urn",
    # Tree
    "NormTree",
    "get_article_position",
    "get_hierarchical_tree",
    # Text
    "normalize_act_type",
    # Map
    "BROCARDI_CODICI",
]
