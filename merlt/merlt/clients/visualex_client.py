"""
VisuaLex HTTP Client

This module provides an HTTP client to communicate with visualex-api service.
It replaces direct imports from visualex package with REST API calls,
enabling true microservices separation.

Usage:
    from merlt.clients import VisuaLexClient, get_visualex_client

    # Get singleton client
    client = get_visualex_client()

    # Fetch article text (like NormattivaScraper.get_document)
    result = await client.fetch_article_text(
        act_type="codice civile",
        article="1453"
    )

    # Fetch Brocardi info (like BrocardiScraper.get_info)
    brocardi = await client.fetch_brocardi_info(
        act_type="codice civile",
        article="1453"
    )

Environment Variables:
    VISUALEX_API_URL: Base URL of visualex-api (default: http://localhost:5100)
    VISUALEX_API_TIMEOUT: Request timeout in seconds (default: 30)
"""

import os
import asyncio
from typing import Optional, Dict, Any, List, Tuple
from dataclasses import dataclass, field
import httpx
import structlog

from .models import Norma, NormaVisitata

log = structlog.get_logger()

# Configuration from environment
VISUALEX_API_URL = os.getenv("VISUALEX_API_URL", "http://localhost:5100")
VISUALEX_API_TIMEOUT = int(os.getenv("VISUALEX_API_TIMEOUT", "30"))

# Singleton client instance
_client_instance: Optional["VisuaLexClient"] = None


def get_visualex_client() -> "VisuaLexClient":
    """
    Get the singleton VisuaLexClient instance.

    Returns:
        VisuaLexClient: Configured HTTP client for visualex-api
    """
    global _client_instance
    if _client_instance is None:
        _client_instance = VisuaLexClient(base_url=VISUALEX_API_URL)
    return _client_instance


@dataclass
class ArticleResult:
    """Result of fetching an article."""
    text: str
    url: str
    norma_data: Dict[str, Any]
    error: Optional[str] = None


@dataclass
class BrocardiResult:
    """Result of fetching Brocardi info."""
    position: Optional[str]
    link: Optional[str]
    brocardi: Optional[str]
    ratio: Optional[str]
    spiegazione: Optional[str]
    massime: Optional[List[str]]
    relazioni: Optional[Dict[str, Any]]
    error: Optional[str] = None


@dataclass
class TreeResult:
    """Result of fetching article tree."""
    articles: List[Dict[str, Any]]
    count: int
    metadata: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


class VisuaLexClient:
    """
    HTTP client for visualex-api.

    This client provides methods that mirror the functionality of
    NormattivaScraper, BrocardiScraper, and other visualex utilities.
    """

    def __init__(
        self,
        base_url: str = VISUALEX_API_URL,
        timeout: int = VISUALEX_API_TIMEOUT,
    ):
        """
        Initialize the VisuaLex client.

        Args:
            base_url: Base URL of visualex-api service
            timeout: Request timeout in seconds
        """
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None
        log.info("VisuaLexClient initialized", base_url=self.base_url)

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create the HTTP client."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=httpx.Timeout(self.timeout),
                headers={"Content-Type": "application/json"},
            )
        return self._client

    async def close(self):
        """Close the HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    async def health_check(self) -> Dict[str, Any]:
        """
        Check if visualex-api is healthy.

        Returns:
            Health status dictionary
        """
        client = await self._get_client()
        try:
            response = await client.get("/health")
            response.raise_for_status()
            return response.json()
        except Exception as e:
            log.error("Health check failed", error=str(e))
            return {"status": "error", "error": str(e)}

    async def parse_query(self, query: str) -> Optional[Dict[str, Any]]:
        """Parse a natural-language legal query into structured params + URN.

        Calls VisuaLex's shared ``/parse_query`` endpoint (the same NL parser
        the graph ingestion and the contribution picker rely on). Returns the
        payload ``{recognized, parsed, urn, display, source}`` when a reference
        is recognized, or ``None`` when nothing is recognized or VisuaLex is
        unreachable. Fail-soft by design: the caller falls back to the in-process
        regex NER, so a VisuaLex outage degrades extraction quality but never
        breaks the query.
        """
        if not query or not query.strip():
            return None
        client = await self._get_client()
        try:
            response = await client.post("/parse_query", json={"query": query})
            response.raise_for_status()
            data = response.json()
            if not data or not data.get("recognized"):
                return None
            return data
        except Exception as e:
            log.warning("parse_query failed", error=str(e), query=query[:80])
            return None

    async def fetch_norma_data(
        self,
        act_type: str,
        article: str,
        act_number: Optional[str] = None,
        date: Optional[str] = None,
        version: Optional[str] = None,
        version_date: Optional[str] = None,
        annex: Optional[str] = None,
    ) -> List[NormaVisitata]:
        """
        Fetch norm metadata (equivalent to creating NormaVisitata locally).

        Args:
            act_type: Type of legal act (e.g., "codice civile", "legge")
            article: Article number(s)
            act_number: Act number (for laws with numbers)
            date: Date of the act
            version: Version type ("vigente", "originale")
            version_date: Specific version date
            annex: Annex number if applicable

        Returns:
            List of NormaVisitata objects
        """
        client = await self._get_client()

        payload = {
            "act_type": act_type,
            "article": article,
        }
        if act_number:
            payload["act_number"] = act_number
        if date:
            payload["date"] = date
        if version:
            payload["version"] = version
        if version_date:
            payload["version_date"] = version_date
        if annex is not None:
            payload["annex"] = annex

        try:
            response = await client.post("/fetch_norma_data", json=payload)
            response.raise_for_status()
            data = response.json()

            results = []
            for nv_data in data.get("norma_data", []):
                results.append(NormaVisitata.from_dict(nv_data))
            return results

        except Exception as e:
            log.error("fetch_norma_data failed", error=str(e), payload=payload)
            raise

    async def fetch_article_text(
        self,
        act_type: str,
        article: str,
        act_number: Optional[str] = None,
        date: Optional[str] = None,
        version: Optional[str] = None,
        version_date: Optional[str] = None,
        annex: Optional[str] = None,
    ) -> List[ArticleResult]:
        """
        Fetch article text from Normattiva.

        This is equivalent to NormattivaScraper.get_document().

        Args:
            act_type: Type of legal act
            article: Article number(s)
            act_number: Act number
            date: Date of the act
            version: Version type
            version_date: Specific version date
            annex: Annex number

        Returns:
            List of ArticleResult with text and metadata
        """
        client = await self._get_client()

        payload = {
            "act_type": act_type,
            "article": article,
        }
        if act_number:
            payload["act_number"] = act_number
        if date:
            payload["date"] = date
        if version:
            payload["version"] = version
        if version_date:
            payload["version_date"] = version_date
        if annex is not None:
            payload["annex"] = annex

        try:
            response = await client.post("/fetch_article_text", json=payload)
            response.raise_for_status()
            data = response.json()

            results = []
            for item in data:
                if "error" in item:
                    results.append(ArticleResult(
                        text="",
                        url="",
                        norma_data=item.get("norma_data", {}),
                        error=item["error"]
                    ))
                else:
                    results.append(ArticleResult(
                        text=item.get("article_text", ""),
                        url=item.get("url", ""),
                        norma_data=item.get("norma_data", {}),
                    ))
            return results

        except Exception as e:
            log.error("fetch_article_text failed", error=str(e), payload=payload)
            raise

    async def fetch_brocardi_info(
        self,
        act_type: str,
        article: str,
        act_number: Optional[str] = None,
        date: Optional[str] = None,
    ) -> List[BrocardiResult]:
        """
        Fetch Brocardi enrichment info.

        This is equivalent to BrocardiScraper.get_info().

        Args:
            act_type: Type of legal act
            article: Article number
            act_number: Act number
            date: Date of the act

        Returns:
            List of BrocardiResult with enrichment data
        """
        client = await self._get_client()

        payload = {
            "act_type": act_type,
            "article": article,
        }
        if act_number:
            payload["act_number"] = act_number
        if date:
            payload["date"] = date

        try:
            response = await client.post("/fetch_brocardi_info", json=payload)
            response.raise_for_status()
            data = response.json()

            results = []
            for item in data:
                if "error" in item:
                    results.append(BrocardiResult(
                        position=None,
                        link=None,
                        brocardi=None,
                        ratio=None,
                        spiegazione=None,
                        massime=None,
                        relazioni=None,
                        error=item["error"]
                    ))
                else:
                    bi = item.get("brocardi_info", {}) or {}
                    results.append(BrocardiResult(
                        position=bi.get("position"),
                        link=bi.get("link"),
                        brocardi=bi.get("Brocardi"),
                        ratio=bi.get("Ratio"),
                        spiegazione=bi.get("Spiegazione"),
                        massime=bi.get("Massime"),
                        relazioni=bi.get("Relazioni"),
                    ))
            return results

        except Exception as e:
            log.error("fetch_brocardi_info failed", error=str(e), payload=payload)
            raise

    async def fetch_all_data(
        self,
        act_type: str,
        article: str,
        act_number: Optional[str] = None,
        date: Optional[str] = None,
        version: Optional[str] = None,
        version_date: Optional[str] = None,
        annex: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Fetch both article text and Brocardi info in one call.

        Args:
            act_type: Type of legal act
            article: Article number(s)
            act_number: Act number
            date: Date of the act
            version: Version type
            version_date: Specific version date
            annex: Annex number

        Returns:
            List of combined results with article_text, norma_data, and brocardi_info
        """
        client = await self._get_client()

        payload = {
            "act_type": act_type,
            "article": article,
        }
        if act_number:
            payload["act_number"] = act_number
        if date:
            payload["date"] = date
        if version:
            payload["version"] = version
        if version_date:
            payload["version_date"] = version_date
        if annex is not None:
            payload["annex"] = annex

        try:
            response = await client.post("/fetch_all_data", json=payload)
            response.raise_for_status()
            return response.json()

        except Exception as e:
            log.error("fetch_all_data failed", error=str(e), payload=payload)
            raise

    async def fetch_tree(
        self,
        urn: str,
        link: bool = False,
        details: bool = False,
        return_metadata: bool = True,
    ) -> TreeResult:
        """
        Fetch the article tree structure for a norm.

        Args:
            urn: URN of the norm
            link: Include links in response
            details: Include detailed info
            return_metadata: Include annex metadata

        Returns:
            TreeResult with articles list and metadata
        """
        client = await self._get_client()

        payload = {
            "urn": urn,
            "link": link,
            "details": details,
            "return_metadata": return_metadata,
        }

        try:
            response = await client.post("/fetch_tree", json=payload)
            response.raise_for_status()
            data = response.json()

            if "error" in data:
                return TreeResult(
                    articles=[],
                    count=0,
                    error=data["error"]
                )

            return TreeResult(
                articles=data.get("articles", []),
                count=data.get("count", 0),
                metadata=data.get("metadata"),
            )

        except Exception as e:
            log.error("fetch_tree failed", error=str(e), payload=payload)
            raise

    # ========================================
    # Compatibility methods for scraper interface
    # ========================================

    async def get_document(
        self,
        norma_visitata: NormaVisitata
    ) -> Tuple[str, str]:
        """
        Get document text for a NormaVisitata.

        This provides the same interface as NormattivaScraper.get_document().

        Args:
            norma_visitata: The norm to fetch

        Returns:
            Tuple of (article_text, url)
        """
        results = await self.fetch_article_text(
            act_type=norma_visitata.norma.tipo_atto,
            article=norma_visitata.numero_articolo or "",
            act_number=norma_visitata.norma.numero_atto,
            date=norma_visitata.norma.data,
            version=norma_visitata.versione,
            version_date=norma_visitata.data_versione,
            annex=norma_visitata.allegato,
        )

        if results and not results[0].error:
            return results[0].text, results[0].url
        elif results and results[0].error:
            raise Exception(results[0].error)
        else:
            raise Exception("No results returned from visualex-api")

    async def get_info(
        self,
        norma_visitata: NormaVisitata
    ) -> Tuple[Optional[str], Dict[str, Any], Optional[str]]:
        """
        Get Brocardi info for a NormaVisitata.

        This provides the same interface as BrocardiScraper.get_info().

        Args:
            norma_visitata: The norm to fetch

        Returns:
            Tuple of (position, info_dict, link)
        """
        results = await self.fetch_brocardi_info(
            act_type=norma_visitata.norma.tipo_atto,
            article=norma_visitata.numero_articolo or "",
            act_number=norma_visitata.norma.numero_atto,
            date=norma_visitata.norma.data,
        )

        if results and not results[0].error:
            r = results[0]
            info_dict = {}
            if r.brocardi:
                info_dict["Brocardi"] = r.brocardi
            if r.ratio:
                info_dict["Ratio"] = r.ratio
            if r.spiegazione:
                info_dict["Spiegazione"] = r.spiegazione
            if r.massime:
                info_dict["Massime"] = r.massime
            if r.relazioni:
                info_dict["Relazioni"] = r.relazioni
            return r.position, info_dict, r.link
        elif results and results[0].error:
            raise Exception(results[0].error)
        else:
            return None, {}, None


# Convenience classes that wrap the client with scraper-like interfaces


class NormattivaScraper:
    """
    HTTP-based Normattiva scraper.

    Drop-in replacement for visualex.scrapers.normattiva.NormattivaScraper
    that uses HTTP API instead of direct imports.
    """

    def __init__(self, client: Optional[VisuaLexClient] = None):
        self._client = client or get_visualex_client()

    async def get_document(
        self,
        norma_visitata: NormaVisitata
    ) -> Tuple[str, str]:
        """
        Get document text for a NormaVisitata.

        Args:
            norma_visitata: The norm to fetch

        Returns:
            Tuple of (article_text, url)
        """
        return await self._client.get_document(norma_visitata)

    async def get_amendment_history(
        self,
        norma_visitata: NormaVisitata,
        filter_article: bool = True,
    ) -> List[Any]:
        """
        Get amendment history for an article.

        Args:
            norma_visitata: The norm to fetch history for
            filter_article: Filter to modifications of this specific article

        Returns:
            List of Modifica objects
        """
        from .models import Modifica

        client = await self._client._get_client()

        payload = {
            "act_type": norma_visitata.norma.tipo_atto,
            "article": norma_visitata.numero_articolo or "",
            "filter_article": filter_article,
        }
        if norma_visitata.norma.numero_atto:
            payload["act_number"] = norma_visitata.norma.numero_atto
        if norma_visitata.norma.data:
            payload["date"] = norma_visitata.norma.data

        try:
            response = await client.post("/fetch_amendment_history", json=payload)
            response.raise_for_status()
            data = response.json()

            modifiche = []
            for item in data.get("modifiche", []):
                modifiche.append(Modifica.from_dict(item))
            return modifiche

        except Exception as e:
            log.error("get_amendment_history failed", error=str(e), payload=payload)
            raise


class BrocardiScraper:
    """
    HTTP-based Brocardi scraper.

    Drop-in replacement for visualex.scrapers.brocardi.BrocardiScraper
    that uses HTTP API instead of direct imports.
    """

    def __init__(self, client: Optional[VisuaLexClient] = None):
        self._client = client or get_visualex_client()

    async def get_info(
        self,
        norma_visitata: NormaVisitata
    ) -> Tuple[Optional[str], Dict[str, Any], Optional[str]]:
        """
        Get Brocardi info for a NormaVisitata.

        Args:
            norma_visitata: The norm to fetch

        Returns:
            Tuple of (position, info_dict, link)
        """
        return await self._client.get_info(norma_visitata)

    async def do_know(
        self,
        norma_visitata: NormaVisitata
    ) -> Optional[Tuple[str, str]]:
        """
        Check if Brocardi knows about this article.

        Args:
            norma_visitata: The norm to check

        Returns:
            Tuple of (text, link) if found, None otherwise
        """
        try:
            pos, info, link = await self.get_info(norma_visitata)
            if link:
                text = info.get("Brocardi", "") or info.get("spiegazione", "")
                return text, link
            return None
        except Exception as e:
            log.warning("extract_failed", error=str(e))
            return None


# ========================================
# TreeExtractor HTTP Adapter
# ========================================

@dataclass
class NormNode:
    """A node in the hierarchical norm tree."""
    level: str  # libro, titolo, capo, sezione, articolo
    number: str
    title: Optional[str] = None
    position: Optional[str] = None
    children: List["NormNode"] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "level": self.level,
            "number": self.number,
            "title": self.title,
            "position": self.position,
            "children": [c.to_dict() for c in self.children],
        }

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> "NormNode":
        children = [NormNode.from_dict(c) for c in data.get("children", [])]
        return NormNode(
            level=data.get("level", ""),
            number=data.get("number", ""),
            title=data.get("title"),
            position=data.get("position"),
            children=children,
        )


@dataclass
class NormTree:
    """Hierarchical tree structure of a norm."""
    urn: str
    title: Optional[str] = None
    children: List[NormNode] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "urn": self.urn,
            "title": self.title,
            "children": [c.to_dict() for c in self.children],
        }

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> "NormTree":
        children = [NormNode.from_dict(c) for c in data.get("children", [])]
        return NormTree(
            urn=data.get("urn", ""),
            title=data.get("title"),
            children=children,
        )


class NormLevel:
    """Enum-like class for norm hierarchy levels."""
    LIBRO = "libro"
    TITOLO = "titolo"
    CAPO = "capo"
    SEZIONE = "sezione"
    ARTICOLO = "articolo"


class TreeExtractor:
    """
    HTTP-based TreeExtractor.

    Drop-in replacement for visualex.utils.treextractor functions
    that uses HTTP API instead of direct scraping.
    """

    def __init__(self, client: Optional[VisuaLexClient] = None):
        self._client = client or get_visualex_client()

    async def get_hierarchical_tree(
        self,
        url: str,
    ) -> Tuple[NormTree, int]:
        """
        Get the hierarchical tree structure for a norm.

        Args:
            url: Normattiva URL or URN

        Returns:
            Tuple of (NormTree, article_count)
        """
        result = await self._client.fetch_tree(
            urn=url,
            link=True,
            details=True,
            return_metadata=True,
        )

        if result.error:
            return result.error, 0

        # Build tree from flat articles list
        tree = NormTree(urn=url)
        articles = result.articles

        for art in articles:
            node = NormNode(
                level=NormLevel.ARTICOLO,
                number=art.get("number", ""),
                title=art.get("title"),
                position=art.get("position"),
            )
            tree.children.append(node)

        return tree, result.count

    def get_all_articles_with_positions(
        self,
        tree: NormTree,
    ) -> List[Dict[str, Any]]:
        """
        Extract all articles with their positions from a tree.

        Args:
            tree: The NormTree to extract from

        Returns:
            List of article dicts with number and position
        """
        articles = []

        def traverse(nodes: List[NormNode]):
            for node in nodes:
                if node.level == NormLevel.ARTICOLO:
                    articles.append({
                        "number": node.number,
                        "title": node.title,
                        "position": node.position,
                    })
                traverse(node.children)

        traverse(tree.children)
        return articles

    def get_article_position(
        self,
        tree: NormTree,
        article_number: str,
    ) -> Optional[str]:
        """
        Get the hierarchical position of a specific article.

        Args:
            tree: The NormTree to search
            article_number: Article number to find

        Returns:
            Position string or None
        """
        articles = self.get_all_articles_with_positions(tree)
        for art in articles:
            if art["number"] == article_number:
                return art.get("position")
        return None


# Module-level functions for compatibility with visualex.utils.treextractor

_tree_extractor: Optional[TreeExtractor] = None


def _get_tree_extractor() -> TreeExtractor:
    """Get singleton TreeExtractor instance."""
    global _tree_extractor
    if _tree_extractor is None:
        _tree_extractor = TreeExtractor()
    return _tree_extractor


async def get_hierarchical_tree(url: str) -> Tuple[NormTree, int]:
    """
    Get the hierarchical tree structure for a norm.

    This is a module-level function for compatibility with
    visualex.utils.treextractor.get_hierarchical_tree.
    """
    return await _get_tree_extractor().get_hierarchical_tree(url)


def get_all_articles_with_positions(tree: NormTree) -> List[Dict[str, Any]]:
    """
    Extract all articles with their positions from a tree.

    This is a module-level function for compatibility with
    visualex.utils.treextractor.get_all_articles_with_positions.
    """
    return _get_tree_extractor().get_all_articles_with_positions(tree)


def get_article_position(tree: NormTree, article_number: str) -> Optional[str]:
    """
    Get the hierarchical position of a specific article.

    This is a module-level function for compatibility with
    visualex.utils.treextractor.get_article_position.
    """
    return _get_tree_extractor().get_article_position(tree, article_number)
