import os
import asyncio
import structlog
from playwright.async_api import async_playwright, Page, Download

log = structlog.get_logger()


class PDFExtractor:
    """Async PDF extraction using Playwright."""

    def __init__(self):
        log.info("PDFExtractor initialized with Playwright")

    async def extract_pdf(self, urn: str, timeout: int = 30000) -> str:
        """
        Extracts a PDF from a given URN using Playwright.

        Arguments:
        urn -- URN of the legal document (Normattiva URL)
        timeout -- Maximum time to wait for operations in ms (default: 30000)

        Returns:
        str -- Path to the downloaded PDF file
        """
        log.info(f"Extracting PDF for URN: {urn} with timeout: {timeout}ms")

        download_dir = os.path.join(os.getcwd(), "download")
        if not os.path.exists(download_dir):
            os.makedirs(download_dir)
            log.info(f"Created download directory: {download_dir}")

        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=True,
                args=['--no-sandbox', '--disable-dev-shm-usage']
            )
            try:
                context = await browser.new_context(
                    viewport={'width': 1920, 'height': 1080},
                    accept_downloads=True
                )
                page = await context.new_page()

                # Navigate to the URN
                await page.goto(urn, wait_until='networkidle', timeout=timeout)
                log.info(f"Accessed URN: {urn}")

                # Selectors for the export button and the PDF download button
                export_button_selector = "#mySidebarRight > div > div:nth-child(2) > div > div > ul > li:nth-child(2) > a"
                export_pdf_selector = "input[name='downloadPdf']"

                # Click the export button
                await page.wait_for_selector(export_button_selector, timeout=timeout)
                await page.click(export_button_selector)
                log.info("Clicked on export button")

                # Wait for new page/popup to open
                async with context.expect_page() as new_page_info:
                    pass  # The click above should trigger the popup

                new_page = await new_page_info.value
                await new_page.wait_for_load_state('networkidle')
                log.info("Switched to the export window")

                # Setup download handler before clicking
                async with new_page.expect_download(timeout=timeout) as download_info:
                    # Click the download PDF button
                    await new_page.wait_for_selector(export_pdf_selector, timeout=timeout)
                    await new_page.click(export_pdf_selector)
                    log.info("Clicked on download PDF button")

                download: Download = await download_info.value

                # Save the download to our directory
                pdf_filename = download.suggested_filename or f"document_{urn.split('/')[-1]}.pdf"
                pdf_file_path = os.path.join(download_dir, pdf_filename)
                await download.save_as(pdf_file_path)

                log.info(f"PDF downloaded successfully: {pdf_file_path}")
                await context.close()
                return pdf_file_path

            except Exception as e:
                log.error(f"Error extracting PDF: {e}", exc_info=True)
                raise
            finally:
                await browser.close()
                log.info("Browser closed")


# Legacy function for backward compatibility
async def extract_pdf(urn: str, timeout: int = 30000) -> str:
    """
    Async function to extract PDF using Playwright.

    Arguments:
    urn -- URN of the legal document
    timeout -- Maximum time to wait for operations in ms (default: 30000)

    Returns:
    str -- Path to the downloaded PDF file
    """
    extractor = PDFExtractor()
    return await extractor.extract_pdf(urn, timeout)
