"""
VisualexAPI Metadata
=====================

Shared VisualexAPI data models used by the mechanical ingestion pipeline
(`pipeline/ingestion.py`, `pipeline/batch_ingestion.py`,
`knowledge_graph/legal_knowledge_graph.py`).

VisualexAPI Schema:
- act_type: tipo_atto (codice civile, legge, decreto, etc.)
- date: data dell'atto
- act_number: numero_atto
- article: numero_articolo
- brocardi_info: Ratio, Spiegazione, Massime

Note:
    The LLM-free graph-writing pipeline and HTTP client that used to live in
    this module (`VisualexIngestionPipeline`, `ingest_codice_civile_articles`,
    `VisualexClient`) were removed as dead code (0 consumers) — the mechanical
    ingestion path (`api/ingestion_mechanical_router.py` +
    `worker/mechanical_ingest_tasks.py`) is the live equivalent.
"""

from typing import Dict, Optional, Any
from dataclasses import dataclass


@dataclass
class NormaMetadata:
    """Metadata for a legal norm from VisualexAPI."""
    tipo_atto: str
    data: str
    numero_atto: str
    numero_articolo: str
    versione: Optional[str] = None
    data_versione: Optional[str] = None
    allegato: Optional[str] = None

    def to_urn(self) -> str:
        """
        Generate URN Normattiva usando VisualexAPI urngenerator.

        Format: https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:{tipo}:{data};{numero}~art{articolo}
        Example: https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:codice.civile:1942-03-16;262~art1453

        Uses VisualexAPI urngenerator which:
        - Has hardcoded dates for major codes (CC, CP, etc.) - instant
        - Uses LRU cache for repeated queries - fast
        - Falls back to Selenium scraping only when needed - slow but accurate
        """
        from merlt.utils import urngenerator

        # For sync function in async context
        return urngenerator.generate_urn(
            act_type=self.tipo_atto,
            date=self.data,
            act_number=self.numero_atto,
            article=self.numero_articolo,
            version=self.versione,
            version_date=self.data_versione,
            urn_flag=True  # Include full URL
        )

    def to_codice_urn(self) -> str:
        """
        Generate URN for the codice (root norm) without article.

        Example: https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:codice.civile:1942-03-16;262
        """
        from merlt.utils import urngenerator

        return urngenerator.generate_urn(
            act_type=self.tipo_atto,
            date=self.data,
            act_number=self.numero_atto,
            article=None,  # No article for codice root
            version=self.versione,
            version_date=self.data_versione,
            urn_flag=True
        )

    def to_estremi(self) -> str:
        """`Art. 1453 c.c.`, `Art. 1 Cost.`: the schema's one formatter."""
        from merlt.storage.graph.schema import format_estremi

        return format_estremi(str(self.numero_articolo), self.tipo_atto)


@dataclass
class VisualexArticle:
    """Complete article data from VisualexAPI."""
    metadata: NormaMetadata
    article_text: str
    url: str
    brocardi_info: Optional[Dict[str, Any]] = None
