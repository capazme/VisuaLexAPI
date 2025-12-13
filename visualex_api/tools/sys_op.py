import os
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
import structlog
from bs4 import BeautifulSoup
import requests
from aiocache import Cache

from visualex_api.services.http_client import http_client
from visualex_api.tools.exceptions import NetworkError, ParsingError

log = structlog.get_logger()


class WebDriverManager:
    def __init__(self):
        self.drivers = []
        log.info("WebDriverManager initialized")

    def setup_driver(self, download_dir=None):
        """
        Creates a new WebDriver instance configured for handling downloads.

        Arguments:
        download_dir -- Directory to save downloads (default is 'download' folder in the current directory)

        Returns:
        WebDriver -- A configured WebDriver instance
        """
        if download_dir is None:
            download_dir = os.path.join(os.getcwd(), "download")
        log.info(f"Setting up WebDriver with download directory: {download_dir}")

        chrome_options = Options()
        chrome_options.add_argument("--headless")
        chrome_options.add_argument("--disable-gpu")
        chrome_options.add_argument("--window-size=1920x1080")

        prefs = {
            "download.default_directory": download_dir,
            "download.prompt_for_download": False,
            "download.directory_upgrade": True,
            "plugins.always_open_pdf_externally": True
        }
        chrome_options.add_experimental_option("prefs", prefs)
        
        try:
            new_driver = webdriver.Chrome(options=chrome_options)
            self.drivers.append(new_driver)
            log.info("WebDriver initialized successfully")
            return new_driver
        except Exception as e:
            log.error(f"Failed to initialize WebDriver: {e}")
            raise

    def close_drivers(self):
        """
        Closes all open WebDriver instances and clears the driver list.
        """
        log.info("Closing all WebDriver instances")
        for driver in self.drivers:
            try:
                driver.quit()
                log.info("WebDriver closed successfully")
            except Exception as e:
                log.warning(f"Failed to quit WebDriver: {e}")
        self.drivers.clear()
        log.info("All WebDriver instances closed and cleared")

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

    
# Usage example:
# driver_manager = WebDriverManager()
# driver = driver_manager.setup_driver()
# driver_manager.close_drivers()
