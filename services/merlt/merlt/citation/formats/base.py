"""
Base Format Interface
=====================

Abstract base class for all citation format handlers.

All format generators must implement:
- format_source_text(): Format a single source as text
- format_all(): Format multiple sources with header/footer
- get_file_extension(): Return file extension (without dot)
- get_media_type(): Return MIME type string
"""

from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional


class BaseFormat(ABC):
    """
    Abstract base class for citation format handlers.

    All format generators must inherit from this class and implement
    the abstract methods.
    """

    def __init__(self, alis_version: str = "MERL-T v1.0"):
        """
        Initialize the format handler.

        Args:
            alis_version: ALIS version string for attribution
        """
        self.alis_version = alis_version

    @abstractmethod
    def format_source_text(self, source: Dict[str, Any]) -> str:
        """
        Format a single source as a plain text string.

        Args:
            source: Source dict with article_urn, expert, relevance, etc.

        Returns:
            Formatted citation as text string
        """
        ...

    @abstractmethod
    def format_all(
        self,
        sources: List[Dict[str, Any]],
        query_summary: Optional[str] = None,
        include_attribution: bool = True,
    ) -> str:
        """
        Format all sources as a complete document.

        Args:
            sources: List of source dicts
            query_summary: Optional query context
            include_attribution: Whether to include ALIS attribution

        Returns:
            Complete formatted document string
        """
        ...

    @abstractmethod
    def get_file_extension(self) -> str:
        """Return the file extension for this format (without dot)."""
        ...

    @abstractmethod
    def get_media_type(self) -> str:
        """Return the MIME type string for this format."""
        ...


__all__ = ["BaseFormat"]
