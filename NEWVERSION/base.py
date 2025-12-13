"""
Base Scraper Interface
======================

Interfaccia base per tutti gli scrapers di fonti giuridiche.

Features:
- Retry automatico con exponential backoff
- Rate limiting con semaforo
- Configurazione centralizzata
"""

import asyncio
import structlog
import aiohttp
from bs4 import BeautifulSoup
from abc import ABC
from dataclasses import dataclass, field
from typing import Optional

from merlt.sources.utils.http import http_client
from merlt.sources.utils.retry import RetryConfig, with_retry

log = structlog.get_logger()


@dataclass
class ScraperConfig:
    """
    Configurazione per scrapers.

    Attributes:
        timeout: Timeout per richieste HTTP in secondi
        retry_config: Configurazione retry
        max_concurrent: Numero massimo di richieste concorrenti
        cache_ttl: Time-to-live cache in secondi

    Example:
        >>> config = ScraperConfig(timeout=60, max_concurrent=3)
        >>> scraper = NormattivaScraper(config=config)
    """
    timeout: int = 30
    retry_config: RetryConfig = field(default_factory=RetryConfig)
    max_concurrent: int = 5
    cache_ttl: int = 86400  # 24 ore


class ScraperError(Exception):
    """Errore base per scrapers."""
    pass


class NetworkError(ScraperError):
    """Errore di rete (timeout, connection refused, etc.)."""
    pass


class DocumentNotFoundError(ScraperError):
    """Documento non trovato (404, articolo inesistente)."""
    pass


class ParsingError(ScraperError):
    """Errore durante il parsing del documento."""
    pass


class BaseScraper(ABC):
    """
    Interfaccia base per scrapers di fonti giuridiche.

    Fornisce:
    - Retry automatico con exponential backoff
    - Rate limiting con semaforo
    - Error handling strutturato
    - Parsing HTML

    Tutti gli scrapers (NormattivaScraper, BrocardiScraper, etc.)
    devono ereditare da questa classe.

    Example:
        >>> class MyCustomScraper(BaseScraper):
        ...     async def fetch_document(self, norma):
        ...         html = await self.request_document(url)
        ...         return self.parse_document(html)
    """

    def __init__(self, config: Optional[ScraperConfig] = None):
        """
        Inizializza lo scraper con configurazione opzionale.

        Args:
            config: Configurazione scraper (default: ScraperConfig())
        """
        self.config = config or ScraperConfig()
        self._semaphore = asyncio.Semaphore(self.config.max_concurrent)

    async def request_document(self, url: str) -> str:
        """
        Richiede un documento da una URL con retry automatico.

        Args:
            url: URL del documento da scaricare

        Returns:
            Contenuto HTML del documento

        Raises:
            NetworkError: Se il download fallisce dopo tutti i retry
            DocumentNotFoundError: Se il documento non esiste (404)
        """
        async with self._semaphore:
            return await self._request_with_retry(url)

    @with_retry()
    async def _request_with_retry(self, url: str) -> str:
        """
        Implementazione interna della richiesta con retry.

        Il decorator @with_retry usa la configurazione di default.
        """
        log.info("Consulting source", url=url[:100])
        session = await http_client.get_session()

        try:
            async with session.get(url, timeout=self.config.timeout) as response:
                if response.status == 404:
                    raise DocumentNotFoundError(f"Document not found: {url}")
                response.raise_for_status()
                return await response.text()

        except aiohttp.ClientResponseError as e:
            if e.status == 404:
                raise DocumentNotFoundError(f"Document not found: {url}")
            log.error("HTTP error", status=e.status, url=url[:100])
            raise NetworkError(f"HTTP {e.status}: {e.message}")

        except aiohttp.ClientError as e:
            log.error("Network error", error=str(e), url=url[:100])
            raise NetworkError(f"Network error: {e}")

        except asyncio.TimeoutError:
            log.error("Timeout", url=url[:100], timeout=self.config.timeout)
            raise NetworkError(f"Timeout after {self.config.timeout}s")

    def parse_document(self, html_content: str) -> BeautifulSoup:
        """
        Parsa contenuto HTML in BeautifulSoup.

        Args:
            html_content: Stringa HTML da parsare

        Returns:
            Oggetto BeautifulSoup per navigazione DOM

        Raises:
            ParsingError: Se il parsing fallisce
        """
        try:
            log.debug("Parsing document content")
            return BeautifulSoup(html_content, 'html.parser')
        except Exception as e:
            log.error("Parsing error", error=str(e))
            raise ParsingError(f"Failed to parse HTML: {e}")
