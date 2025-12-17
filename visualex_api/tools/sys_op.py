import os
import structlog
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright, Browser, BrowserContext

from visualex_api.services.http_client import http_client
from visualex_api.tools.exceptions import NetworkError, ParsingError

log = structlog.get_logger()


class PlaywrightManager:
    """Manages Playwright browser instances for web scraping and PDF downloads."""

    def __init__(self):
        self._playwright = None
        self._browser: Browser | None = None
        log.info("PlaywrightManager initialized")

    async def get_browser(self) -> Browser:
        """Get or create a browser instance."""
        if self._browser is None or not self._browser.is_connected():
            self._playwright = await async_playwright().start()
            self._browser = await self._playwright.chromium.launch(
                headless=True,
                args=['--no-sandbox', '--disable-dev-shm-usage']
            )
            log.info("Playwright browser launched")
        return self._browser

    async def new_context(self, download_dir: str | None = None) -> BrowserContext:
        """Create a new browser context with optional download directory."""
        browser = await self.get_browser()

        context_options = {
            'viewport': {'width': 1920, 'height': 1080},
            'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }

        if download_dir:
            if not os.path.exists(download_dir):
                os.makedirs(download_dir)
            context_options['accept_downloads'] = True

        context = await browser.new_context(**context_options)
        log.debug("New browser context created")
        return context

    async def close(self):
        """Close the browser and playwright instance."""
        if self._browser:
            await self._browser.close()
            self._browser = None
            log.info("Browser closed")
        if self._playwright:
            await self._playwright.stop()
            self._playwright = None
            log.info("Playwright stopped")


# Global instance for reuse
_playwright_manager: PlaywrightManager | None = None


def get_playwright_manager() -> PlaywrightManager:
    """Get the global PlaywrightManager instance."""
    global _playwright_manager
    if _playwright_manager is None:
        _playwright_manager = PlaywrightManager()
    return _playwright_manager


# Legacy alias for backward compatibility
WebDriverManager = PlaywrightManager


class BaseScraper:
    async def request_document(self, url, *, source: str = "base_scraper"):
        log.info(f"Consulting source - URL: {url}")
        try:
            result = await http_client.request("GET", url, source=source)
            return result.text
        except Exception as e:
            log.error(f"Error during consultation: {e}")
            # Network errors are already handled by http_client, re-raise as-is
            raise NetworkError(f"Failed to fetch document: {e}")

    def parse_document(self, html_content):
        log.info("Parsing document content")
        try:
            return BeautifulSoup(html_content, 'html.parser')
        except Exception as e:
            log.error(f"Failed to parse HTML: {e}")
            raise ParsingError(f"Failed to parse HTML content: {e}", html_snippet=html_content)
