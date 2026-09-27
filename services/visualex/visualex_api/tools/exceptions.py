"""
Exception hierarchy for VisuaLex API.

Provides structured error handling with specific exception types
for different failure scenarios in web scraping and document retrieval.

Example:
    from visualex_api.tools.exceptions import DocumentNotFoundError

    if response.status == 404:
        raise DocumentNotFoundError(
            "Article not found",
            urn="urn:nir:stato:legge:1990-08-07;241~art2"
        )
"""

from typing import Optional


class VisuaLexError(Exception):
    """
    Base exception for all VisuaLex API errors.
    
    Provides a common base class with a message attribute.
    """
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class ScraperError(VisuaLexError):
    """
    Base exception for all scraper errors.

    All custom exceptions in VisuaLex should inherit from this class
    to allow catching all scraper-related errors with a single except block.
    """
    pass


class ValidationError(VisuaLexError):
    """
    Validation error for invalid input data.
    
    Should return 400 to client.
    """
    pass


class ResourceNotFoundError(VisuaLexError):
    """
    Resource not found error.
    
    Should return 404 to client.
    """
    pass


class RateLimitExceededError(VisuaLexError):
    """
    Rate limit exceeded error.
    
    Should return 429 to client.
    """
    pass


class ExtractionError(VisuaLexError):
    """
    Error during data extraction (e.g., PDF extraction).
    
    Should return 500 to client.
    """
    pass


class NetworkError(ScraperError):
    """
    Network-related errors (timeout, connection refused, DNS failures).

    These errors are typically transient and should trigger retry logic.

    Attributes:
        status_code: HTTP status code if available (e.g., 500, 503)

    Example:
        raise NetworkError(
            "Connection timeout after 30s",
            status_code=504
        )
    """
    def __init__(self, message: str, status_code: int = None):
        super().__init__(message)
        self.status_code = status_code


class DocumentNotFoundError(ScraperError):
    """
    Document not found (404, article doesn't exist, act not published).

    These errors are NOT transient - retry won't help.
    Should return 404 to client.

    Attributes:
        urn: The URN that was not found

    Example:
        raise DocumentNotFoundError(
            "Article 999 does not exist in Codice Civile",
            urn="urn:nir:stato:codice.civile:1942-03-16~art999"
        )
    """
    def __init__(self, message: str, urn: str = None):
        super().__init__(message)
        self.urn = urn


class ParsingError(ScraperError):
    """
    Error parsing document structure (malformed HTML, unexpected format).

    Indicates that the HTML structure changed on the external site
    and the scraper needs to be updated.

    Attributes:
        html_snippet: First 200 chars of HTML that failed to parse

    Example:
        raise ParsingError(
            "Missing expected div.bodyTesto in Normattiva response",
            html_snippet=html_content[:200]
        )
    """
    def __init__(self, message: str, html_snippet: str = None):
        super().__init__(message)
        self.html_snippet = html_snippet[:200] if html_snippet else None


def get_exception_for_status(status_code: int, message: str = None) -> VisuaLexError:
    """
    Get the appropriate exception for an HTTP status code.
    
    Args:
        status_code: HTTP status code
        message: Optional error message
        
    Returns:
        Appropriate VisuaLexError subclass instance
    """
    default_message = message or f"HTTP error {status_code}"
    
    if status_code == 400:
        return ValidationError(default_message)
    elif status_code == 404:
        return ResourceNotFoundError(default_message)
    elif status_code == 429:
        return RateLimitExceededError(default_message)
    elif status_code >= 500:
        return NetworkError(default_message, status_code=status_code)
    else:
        return VisuaLexError(default_message)

