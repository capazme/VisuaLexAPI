import os
from pathlib import Path
from typing import Any, List, Optional

BASE_PATH = Path(__file__).resolve().parents[2]

MAX_CACHE_SIZE = 10000
HISTORY_LIMIT = 50
HISTORY_FILE = BASE_PATH / "data" / "history.json"
DOSSIER_FILE = BASE_PATH / "data" / "dossiers.json"
DOSSIER_LIMIT = 100  # Max number of dossiers
RATE_LIMIT = 1000  # Limit to 100 requests per minute
RATE_LIMIT_WINDOW = 600  # Window size in seconds

PERSISTENT_CACHE_DIR = BASE_PATH / "download" / "cache"
PERSISTENT_CACHE_TTL = int(os.getenv("PERSISTENT_CACHE_TTL", 86400))

HTTP_MAX_CONCURRENCY = int(os.getenv("HTTP_MAX_CONCURRENCY", 3))
HTTP_MIN_INTERVAL = float(os.getenv("HTTP_MIN_INTERVAL", 0.5))
HTTP_MAX_RETRIES = int(os.getenv("HTTP_MAX_RETRIES", 4))
HTTP_BACKOFF_FACTOR = float(os.getenv("HTTP_BACKOFF_FACTOR", 2.0))
HTTP_INITIAL_BACKOFF = float(os.getenv("HTTP_INITIAL_BACKOFF", 0.5))
HTTP_JITTER = float(os.getenv("HTTP_JITTER", 0.3))
HTTP_TIMEOUT = int(os.getenv("HTTP_TIMEOUT", 30))

FETCH_QUEUE_WORKERS = int(os.getenv("FETCH_QUEUE_WORKERS", 2))
FETCH_QUEUE_DELAY = float(os.getenv("FETCH_QUEUE_DELAY", 0.3))


class Settings:
    """
    Configuration settings manager.
    
    Provides access to configuration values via environment variables
    with sensible defaults.
    """
    
    def __init__(self) -> None:
        self._cache: dict = {}
    
    def get(self, key: str, default: Any = None) -> Any:
        """
        Get a configuration value.
        
        Args:
            key: The configuration key (will be uppercased for env var lookup)
            default: Default value if not found
            
        Returns:
            The configuration value
        """
        if key in self._cache:
            return self._cache[key]
        
        env_key = key.upper().replace(".", "_")
        value = os.getenv(env_key, default)
        self._cache[key] = value
        return value
    
    def get_list(self, key: str, default: Optional[List[str]] = None) -> List[str]:
        """
        Get a configuration value as a list.
        
        Args:
            key: The configuration key
            default: Default list if not found
            
        Returns:
            List of configuration values
        """
        if default is None:
            default = []
        
        value = self.get(key)
        if value is None:
            return default
        
        if isinstance(value, list):
            return value
        
        # Parse comma-separated string
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        
        return default
