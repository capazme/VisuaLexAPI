"""
Tests for custom exceptions.
"""

import pytest
from visualex_api.tools.exceptions import (
    VisuaLexError,
    ValidationError,
    ResourceNotFoundError,
    RateLimitExceededError,
    ExtractionError,
    ScraperError,
    ConfigurationError,
    get_exception_for_status
)


class TestCustomExceptions:
    """Test custom exception classes."""

    def test_visualex_error_base(self):
        """Test base VisuaLexError exception."""
        error = VisuaLexError("Test error")
        assert str(error) == "Test error"
        assert error.status_code == 500

    def test_validation_error(self):
        """Test ValidationError with 400 status code."""
        error = ValidationError("Invalid input")
        assert str(error) == "Invalid input"
        assert error.status_code == 400

    def test_resource_not_found_error(self):
        """Test ResourceNotFoundError with 404 status code."""
        error = ResourceNotFoundError("Resource not found")
        assert str(error) == "Resource not found"
        assert error.status_code == 404

    def test_rate_limit_exceeded_error(self):
        """Test RateLimitExceededError with 429 status code."""
        error = RateLimitExceededError("Rate limit exceeded")
        assert str(error) == "Rate limit exceeded"
        assert error.status_code == 429

    def test_extraction_error(self):
        """Test ExtractionError with 500 status code."""
        error = ExtractionError("Extraction failed")
        assert str(error) == "Extraction failed"
        assert error.status_code == 500

    def test_scraper_error(self):
        """Test ScraperError with 502 status code."""
        error = ScraperError("Scraper failed")
        assert str(error) == "Scraper failed"
        assert error.status_code == 502

    def test_configuration_error(self):
        """Test ConfigurationError with 500 status code."""
        error = ConfigurationError("Configuration error")
        assert str(error) == "Configuration error"
        assert error.status_code == 500


class TestGetExceptionForStatus:
    """Test get_exception_for_status function."""

    def test_400_returns_validation_error(self):
        """Test that 400 returns ValidationError."""
        error = get_exception_for_status(400, "Bad request")
        assert isinstance(error, ValidationError)
        assert error.status_code == 400

    def test_404_returns_resource_not_found_error(self):
        """Test that 404 returns ResourceNotFoundError."""
        error = get_exception_for_status(404, "Not found")
        assert isinstance(error, ResourceNotFoundError)
        assert error.status_code == 404

    def test_429_returns_rate_limit_exceeded_error(self):
        """Test that 429 returns RateLimitExceededError."""
        error = get_exception_for_status(429, "Too many requests")
        assert isinstance(error, RateLimitExceededError)
        assert error.status_code == 429

    def test_500_returns_scraper_error(self):
        """Test that 500+ returns ScraperError."""
        error = get_exception_for_status(500, "Server error")
        assert isinstance(error, ScraperError)
        assert error.status_code == 502

    def test_other_status_returns_base_error(self):
        """Test that other status codes return base VisuaLexError."""
        error = get_exception_for_status(403, "Forbidden")
        assert isinstance(error, VisuaLexError)
        assert error.status_code == 403

    def test_default_message(self):
        """Test default message when none provided."""
        error = get_exception_for_status(400)
        assert "400" in str(error)
