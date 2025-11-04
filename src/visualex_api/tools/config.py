"""
Configuration management for the VisuaLex API.

This module provides configuration constants and a Settings class for
managing environment variables and application settings.
"""

import os
from typing import Any, List, Optional
from pathlib import Path


# Default configuration constants
MAX_CACHE_SIZE = 10000
HISTORY_LIMIT = 50
RATE_LIMIT = 1000  # Limit to 1000 requests per window
RATE_LIMIT_WINDOW = 600  # Window size in seconds (10 minutes)


class Settings:
    """
    Settings class for managing application configuration.

    This class provides a centralized way to access configuration values
    from environment variables with fallback to default values.
    """

    def __init__(self):
        """Initialize settings from environment variables."""
        self._load_env_file()

    def _load_env_file(self) -> None:
        """Load environment variables from .env file if it exists."""
        try:
            from dotenv import load_dotenv
            env_path = Path(__file__).parent.parent.parent.parent / ".env"
            if env_path.exists():
                load_dotenv(dotenv_path=env_path)
        except ImportError:
            # python-dotenv not installed, skip loading .env file
            pass

    def get(self, key: str, default: Any = None) -> Any:
        """
        Get a configuration value from environment variables.

        Args:
            key: Configuration key
            default: Default value if key is not found

        Returns:
            Configuration value or default
        """
        return os.environ.get(key, default)

    def get_int(self, key: str, default: int = 0) -> int:
        """
        Get an integer configuration value.

        Args:
            key: Configuration key
            default: Default value if key is not found

        Returns:
            Integer configuration value or default
        """
        value = os.environ.get(key)
        if value is None:
            return default
        try:
            return int(value)
        except ValueError:
            return default

    def get_bool(self, key: str, default: bool = False) -> bool:
        """
        Get a boolean configuration value.

        Args:
            key: Configuration key
            default: Default value if key is not found

        Returns:
            Boolean configuration value or default
        """
        value = os.environ.get(key)
        if value is None:
            return default
        return value.lower() in ("true", "1", "yes", "on")

    def get_list(self, key: str, default: Optional[List[str]] = None) -> List[str]:
        """
        Get a list configuration value (comma-separated).

        Args:
            key: Configuration key
            default: Default value if key is not found

        Returns:
            List of configuration values or default
        """
        if default is None:
            default = []
        value = os.environ.get(key)
        if value is None:
            return default
        return [item.strip() for item in value.split(",") if item.strip()]

    @property
    def secret_key(self) -> str:
        """Get the secret key for session management."""
        return self.get("SECRET_KEY", "development-key-change-in-production")

    @property
    def debug(self) -> bool:
        """Get debug mode setting."""
        return self.get_bool("DEBUG", False)

    @property
    def allowed_origins(self) -> List[str]:
        """Get list of allowed CORS origins."""
        return self.get_list("ALLOWED_ORIGINS", ["http://localhost:3000"])

    @property
    def log_level(self) -> str:
        """Get logging level."""
        return self.get("LOG_LEVEL", "INFO").upper()

    @property
    def log_file(self) -> Optional[str]:
        """Get log file path."""
        return self.get("LOG_FILE", "visualex_api.log")

    @property
    def max_cache_size(self) -> int:
        """Get maximum cache size."""
        return self.get_int("MAX_CACHE_SIZE", MAX_CACHE_SIZE)

    @property
    def history_limit(self) -> int:
        """Get history limit."""
        return self.get_int("HISTORY_LIMIT", HISTORY_LIMIT)

    @property
    def rate_limit(self) -> int:
        """Get rate limit."""
        return self.get_int("RATE_LIMIT", RATE_LIMIT)

    @property
    def rate_limit_window(self) -> int:
        """Get rate limit window in seconds."""
        return self.get_int("RATE_LIMIT_WINDOW", RATE_LIMIT_WINDOW)
