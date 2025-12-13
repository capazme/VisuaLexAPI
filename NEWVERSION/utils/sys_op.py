"""
WebDriver Manager per Selenium.

Gestisce istanze Chrome WebDriver per scraping di pagine che richiedono JavaScript.
Usato principalmente per Normattiva quando serve rendering dinamico.

Note:
    - Singleton pattern per riutilizzo driver
    - Headless mode di default
    - Chiusura graceful con close_drivers()
"""

import os
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
import structlog

log = structlog.get_logger()


class WebDriverManager:
    """
    Manager singleton per WebDriver Chrome.

    Gestisce il ciclo di vita del driver Selenium per scraping
    di pagine con contenuto dinamico.

    Example:
        >>> manager = WebDriverManager()
        >>> driver = manager.get_driver()
        >>> driver.get("https://example.com")
        >>> manager.close_drivers()
    """
    _driver = None

    def __init__(self):
        self.drivers = []
        log.info("WebDriverManager initialized")

    def get_driver(self, download_dir=None):
        """
        Ottiene un'istanza WebDriver Chrome (crea se non esiste).

        Args:
            download_dir: Directory per i download (default: ./download)

        Returns:
            webdriver.Chrome: Istanza driver configurata
        """
        if self._driver is None:
            if download_dir is None:
                download_dir = os.path.join(os.getcwd(), "download")
            log.info(f"Setting up WebDriver with download directory: {download_dir}")

            chrome_options = Options()
            chrome_options.add_argument("--headless")
            chrome_options.add_argument("--disable-gpu")
            chrome_options.add_argument("--window-size=1920x1080")
            chrome_options.add_argument("--no-sandbox")
            chrome_options.add_argument("--disable-dev-shm-usage")

            prefs = {
                "download.default_directory": download_dir,
                "download.prompt_for_download": False,
                "download.directory_upgrade": True,
                "plugins.always_open_pdf_externally": True
            }
            chrome_options.add_experimental_option("prefs", prefs)

            try:
                self._driver = webdriver.Chrome(options=chrome_options)
                log.info("WebDriver initialized successfully")
            except Exception as e:
                log.error(f"Failed to initialize WebDriver: {e}")
                raise
        return self._driver

    def close_drivers(self):
        """
        Chiude tutte le istanze WebDriver aperte.
        """
        log.info("Closing all WebDriver instances")
        if self._driver:
            try:
                self._driver.quit()
                log.info("WebDriver closed successfully")
            except Exception as e:
                log.warning(f"Failed to quit WebDriver: {e}")
            self._driver = None
        log.info("All WebDriver instances closed and cleared")


# Singleton instance
web_driver_manager = WebDriverManager()
