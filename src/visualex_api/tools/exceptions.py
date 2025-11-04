"""
Custom exceptions for the VisuaLex API.

This module defines custom exception classes used throughout the application
for better error handling and reporting.
"""


class VisuaLexError(Exception):
    """Base exception class for all VisuaLex API errors."""

    def __init__(self, message: str, status_code: int = 500):
        self.message = message
        self.status_code = status_code
        super().__init__(self.message)


class ValidationError(VisuaLexError):
    """Raised when request data validation fails."""

    def __init__(self, message: str):
        super().__init__(message, status_code=400)


class ResourceNotFoundError(VisuaLexError):
    """Raised when a requested resource cannot be found."""

    def __init__(self, message: str):
        super().__init__(message, status_code=404)


class RateLimitExceededError(VisuaLexError):
    """Raised when a client exceeds their rate limit."""

    def __init__(self, message: str):
        super().__init__(message, status_code=429)


class ExtractionError(VisuaLexError):
    """Raised when data extraction from a source fails."""

    def __init__(self, message: str):
        super().__init__(message, status_code=500)


class ScraperError(VisuaLexError):
    """Raised when a scraper encounters an error."""

    def __init__(self, message: str):
        super().__init__(message, status_code=502)


class ConfigurationError(VisuaLexError):
    """Raised when there's a configuration error."""

    def __init__(self, message: str):
        super().__init__(message, status_code=500)


def get_exception_for_status(status_code: int, message: str = None) -> VisuaLexError:
    """
    Get the appropriate exception class for a given HTTP status code.

    Args:
        status_code: HTTP status code
        message: Optional error message

    Returns:
        An instance of the appropriate exception class
    """
    if message is None:
        message = f"Request failed with status code {status_code}"

    if status_code == 400:
        return ValidationError(message)
    elif status_code == 404:
        return ResourceNotFoundError(message)
    elif status_code == 429:
        return RateLimitExceededError(message)
    elif status_code >= 500:
        return ScraperError(message)
    else:
        return VisuaLexError(message, status_code=status_code)
