"""
Plain Text Citation Format
==========================

Formats citations as a simple numbered list.

Output format:
    Fonti giuridiche consultate
    ===========================
    Query: "Cos'è la risoluzione per inadempimento?"

    1. Art. 1453 c.c.
    2. L. 7 agosto 1990, n. 241, art. 1
    3. Cass. Civ., Sez. II, 15/03/2023, n. 1234

    ---
    Generato da ALIS MERL-T v1.0 il 2026-02-05

This is the simplest format, suitable for quick reference
or copy-paste into documents.
"""

from datetime import datetime
from typing import List, Dict, Any, Optional

from merlt.citation.formats.base import BaseFormat
from merlt.citation.urn_parser import (
    ParsedURN,
    parse_urn,
    format_italian_date,
    get_act_type_abbreviation,
)


class PlainTextFormat(BaseFormat):
    """
    Formats citations as a simple numbered list.

    This is the simplest format, suitable for quick reference
    or copy-paste into other documents.
    """

    def format_source_text(self, source: Dict[str, Any]) -> str:
        """Format a single source as plain text string."""
        return self.format_source(source)

    def format_source(self, source: Dict[str, Any]) -> str:
        """
        Format a single source as plain text.

        Args:
            source: Source dict with article_urn, expert, relevance, etc.

        Returns:
            Formatted citation string

        Example:
            >>> fmt = PlainTextFormat()
            >>> source = {"article_urn": "urn:nir:stato:codice.civile:1942;art1453"}
            >>> print(fmt.format_source(source))
            "Art. 1453 c.c."
        """
        urn = source.get("article_urn", source.get("urn", ""))

        if urn:
            parsed = parse_urn(urn)
            return self._format_parsed_urn(parsed)
        else:
            # Fallback: use title or raw text
            title = source.get("title", source.get("text", str(source)))
            if len(title) > 100:
                title = title[:97] + "..."
            return title

    def _format_parsed_urn(self, parsed: ParsedURN) -> str:
        """
        Format a parsed URN as plain text.

        Args:
            parsed: Parsed URN components

        Returns:
            Formatted citation string
        """
        if parsed.is_codice:
            return self._format_codice(parsed)
        else:
            return self._format_act(parsed)

    def _format_codice(self, parsed: ParsedURN) -> str:
        """Format a code citation."""
        parts = []

        if parsed.article:
            article_text = f"Art. {parsed.article}"
            if parsed.comma:
                article_text += f", comma {parsed.comma}"
            parts.append(article_text)

        if parsed.codice_abbrev:
            parts.append(parsed.codice_abbrev)
        elif parsed.codice_full_name:
            parts.append(parsed.codice_full_name)

        return " ".join(parts) if parts else parsed.raw_urn

    def _format_act(self, parsed: ParsedURN) -> str:
        """Format a legislative act citation."""
        # Prefix: abbreviation + date (space-separated)
        prefix = ""
        abbrev = get_act_type_abbreviation(parsed.act_type)
        if abbrev:
            prefix = abbrev
        else:
            prefix = parsed.act_type.replace(".", " ").title()

        if parsed.date:
            prefix += f" {format_italian_date(parsed.date)}"
        elif parsed.year:
            prefix += f" {parsed.year}"

        # Remaining comma-separated parts
        suffix_parts = []

        if parsed.act_number:
            suffix_parts.append(f"n. {parsed.act_number}")

        if parsed.article:
            article_text = f"art. {parsed.article}"
            if parsed.comma:
                article_text += f", comma {parsed.comma}"
            suffix_parts.append(article_text)

        if suffix_parts:
            return prefix + ", " + ", ".join(suffix_parts)
        return prefix if prefix else parsed.raw_urn

    def format_all(
        self,
        sources: List[Dict[str, Any]],
        query_summary: Optional[str] = None,
        include_attribution: bool = True,
    ) -> str:
        """
        Format all sources as a numbered list.

        Args:
            sources: List of source dicts
            query_summary: Optional query context
            include_attribution: Whether to include ALIS attribution

        Returns:
            Complete formatted document
        """
        lines = []

        # Header
        lines.append("Fonti giuridiche consultate")
        lines.append("=" * 27)

        # Query context
        if query_summary:
            lines.append(f'Query: "{query_summary}"')
        lines.append("")

        # Numbered list of citations
        seen = set()
        number = 1

        for source in sources:
            text = self.format_source(source)
            if text not in seen:
                seen.add(text)
                lines.append(f"{number}. {text}")
                number += 1

        # Footer
        if include_attribution:
            lines.append("")
            lines.append("---")
            today = datetime.now().strftime("%Y-%m-%d")
            lines.append(f"Generato da ALIS {self.alis_version} il {today}")

        return "\n".join(lines)

    def get_file_extension(self) -> str:
        """Return the file extension for this format."""
        return "txt"

    def get_media_type(self) -> str:
        """Return the media type for this format."""
        return "text/plain; charset=utf-8"


__all__ = ["PlainTextFormat"]
