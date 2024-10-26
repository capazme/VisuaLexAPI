import os
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
import logging
from bs4 import BeautifulSoup
import requests

class WebDriverManager:
    def __init__(self):
        self.drivers = []
        logging.info("WebDriverManager initialized")

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
        logging.info(f"Setting up WebDriver with download directory: {download_dir}")

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
            logging.info("WebDriver initialized successfully")
            return new_driver
        except Exception as e:
            logging.error(f"Failed to initialize WebDriver: {e}")
            raise

    def close_drivers(self):
        """
        Closes all open WebDriver instances and clears the driver list.
        """
        logging.info("Closing all WebDriver instances")
        for driver in self.drivers:
            try:
                driver.quit()
                logging.info("WebDriver closed successfully")
            except Exception as e:
                logging.warning(f"Failed to quit WebDriver: {e}")
        self.drivers.clear()
        logging.info("All WebDriver instances closed and cleared")

class BaseScraper:
    def request_document(self, url):
        logging.info(f"Consulting source - URL: {url}")
        try:
            response = requests.get(url, timeout=30)
            response.raise_for_status()
        except requests.exceptions.RequestException as e:
            logging.error(f"Error during consultation: {e}")
            raise ValueError(f"Problem with download: {e}")
        return response.text

    def parse_document(self, html_content):
        logging.info("Parsing document content")
        return BeautifulSoup(html_content, 'html.parser')
    
# Usage example:
# driver_manager = WebDriverManager()
# driver = driver_manager.setup_driver()
# driver_manager.close_drivers()
