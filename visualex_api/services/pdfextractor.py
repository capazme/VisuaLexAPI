import os
import asyncio
import structlog
from playwright.async_api import async_playwright, Browser, BrowserContext, Page, Download
from typing import Optional

log = structlog.get_logger()


class BrowserPool:
    """Singleton browser pool to reuse browser instances across requests."""

    _instance: Optional['BrowserPool'] = None
    _lock = asyncio.Lock()

    def __init__(self):
        self.browser: Optional[Browser] = None
        self.playwright = None
        self._context_semaphore = asyncio.Semaphore(5)  # Max 5 concurrent contexts
        log.info("BrowserPool initialized")

    @classmethod
    async def get_instance(cls) -> 'BrowserPool':
        """Get or create the singleton instance."""
        if cls._instance is None:
            async with cls._lock:
                if cls._instance is None:
                    cls._instance = BrowserPool()
                    await cls._instance._ensure_browser()
        return cls._instance

    async def _ensure_browser(self):
        """Ensure browser is running."""
        if self.browser is None or not self.browser.is_connected():
            if self.playwright is None:
                self.playwright = await async_playwright().start()

            self.browser = await self.playwright.chromium.launch(
                headless=True,
                args=[
                    '--no-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-blink-features=AutomationControlled',
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--disable-gpu',
                    '--disable-software-rasterizer'
                ]
            )
            log.info("Browser launched in pool")

    async def get_context(self) -> BrowserContext:
        """Get a new browser context (isolated session)."""
        await self._ensure_browser()
        async with self._context_semaphore:
            context = await self.browser.new_context(
                viewport={'width': 1920, 'height': 1080},
                accept_downloads=True,
                java_script_enabled=True
            )
            return context

    async def close(self):
        """Close the browser and playwright."""
        if self.browser:
            await self.browser.close()
            self.browser = None
            log.info("Browser closed from pool")

        if self.playwright:
            await self.playwright.stop()
            self.playwright = None
            log.info("Playwright stopped")


class PDFExtractor:
    """Async PDF extraction using Playwright."""

    def __init__(self):
        log.info("PDFExtractor initialized with Playwright")

    async def extract_pdf(self, urn: str, timeout: int = 60000, use_pool: bool = True) -> str:
        """
        Extracts a PDF from a given URN using Playwright (optimized for speed).

        Arguments:
        urn -- URN of the legal document (Normattiva URL)
        timeout -- Maximum time to wait for operations in ms (default: 60000)
        use_pool -- Use persistent browser pool for better performance (default: True)

        Returns:
        str -- Path to the downloaded PDF file
        """
        log.info(f"Extracting PDF for URN: {urn} with timeout: {timeout}ms (pool: {use_pool})")

        download_dir = os.path.join(os.getcwd(), "download")
        if not os.path.exists(download_dir):
            os.makedirs(download_dir)
            log.info(f"Created download directory: {download_dir}")

        if use_pool:
            # Use persistent browser pool (faster for multiple requests)
            pool = await BrowserPool.get_instance()
            context = await pool.get_context()
            try:
                return await self._extract_with_context(context, urn, timeout, download_dir)
            finally:
                await context.close()
        else:
            # One-off browser (slower but isolated)
            async with async_playwright() as p:
                browser = await p.chromium.launch(
                    headless=True,
                    args=[
                        '--no-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-blink-features=AutomationControlled',
                        '--disable-features=IsolateOrigins,site-per-process',
                        '--disable-gpu',
                        '--disable-software-rasterizer'
                    ]
                )
                try:
                    context = await browser.new_context(
                        viewport={'width': 1920, 'height': 1080},
                        accept_downloads=True,
                        java_script_enabled=True
                    )
                    return await self._extract_with_context(context, urn, timeout, download_dir)
                finally:
                    await browser.close()

    async def _extract_with_context(self, context: BrowserContext, urn: str, timeout: int, download_dir: str) -> str:
        """Internal method to perform extraction with a given context."""
        page = await context.new_page()
        new_page = None

        try:
            # Navigate to the URN - use 'load' instead of 'networkidle' for 2-3x speed improvement
            await page.goto(urn, wait_until='load', timeout=timeout)
            log.info(f"Accessed URN: {urn}")

            # Selectors for the export button and the PDF download button
            export_button_selector = "#mySidebarRight > div > div:nth-child(2) > div > div > ul > li:nth-child(2) > a"
            export_pdf_selector = "input[name='downloadPdf']"

            # Click the export button - wait for it to be visible and enabled
            await page.wait_for_selector(export_button_selector, state='visible', timeout=timeout)
            await page.click(export_button_selector)
            log.info("Clicked on export button")

            # Wait for popup and get the new page
            new_page = await context.wait_for_event('page', timeout=timeout)

            # Wait only for DOM to be ready, not for all network requests
            await new_page.wait_for_load_state('domcontentloaded', timeout=timeout)
            log.info("Export window loaded")

            # Setup download handler before clicking - use longer timeout for large PDFs
            download_timeout = timeout * 4  # 4x longer for download (e.g., 240s for large docs)
            async with new_page.expect_download(timeout=download_timeout) as download_info:
                # Wait for download button to be visible and click
                await new_page.wait_for_selector(export_pdf_selector, state='visible', timeout=timeout)
                await new_page.click(export_pdf_selector)
                log.info("Clicked on download PDF button, waiting for download...")

            download: Download = await download_info.value
            log.info("Download started, saving file...")

            # Save the download to our directory
            pdf_filename = download.suggested_filename or f"document_{urn.split('/')[-1]}.pdf"
            pdf_file_path = os.path.join(download_dir, pdf_filename)

            # Save with progress logging
            await download.save_as(pdf_file_path)

            # Get file size for logging
            import os as os_module
            file_size = os_module.path.getsize(pdf_file_path) / 1024 / 1024  # MB
            log.info(f"PDF downloaded successfully: {pdf_file_path} ({file_size:.2f} MB)")
            return pdf_file_path

        except Exception as e:
            log.error(f"Error extracting PDF: {e}", exc_info=True)
            raise
        finally:
            await page.close()
            if new_page and not new_page.is_closed():
                await new_page.close()


# Legacy function for backward compatibility
async def extract_pdf(urn: str, timeout: int = 60000, use_pool: bool = True) -> str:
    """
    Async function to extract PDF using Playwright (optimized with browser pool).

    Arguments:
    urn -- URN of the legal document
    timeout -- Maximum time to wait for operations in ms (default: 60000)
    use_pool -- Use persistent browser pool for better performance (default: True)

    Returns:
    str -- Path to the downloaded PDF file
    """
    extractor = PDFExtractor()
    return await extractor.extract_pdf(urn, timeout, use_pool)


# Cleanup function to close browser pool on shutdown
async def cleanup_browser_pool():
    """Close the browser pool. Call this on application shutdown."""
    if BrowserPool._instance:
        await BrowserPool._instance.close()
        BrowserPool._instance = None
        log.info("Browser pool cleaned up")
