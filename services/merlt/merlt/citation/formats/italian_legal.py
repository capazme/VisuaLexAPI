"""
Italian Legal Citation Format
=============================

Formats citations in standard Italian legal style.

Output format:
    FONTI GIURIDICHE
    ================
    Elaborazione a cura di ALIS basata su:

    Query: "Cos'è la risoluzione per inadempimento?"

    NORME
    -----
    - Art. 1453 c.c.
    - L. 7 agosto 1990, n. 241, art. 1

    GIURISPRUDENZA
    --------------
    - Cass. Civ., Sez. II, 15/03/2023, n. 1234

    ---
    Generato da ALIS MERL-T v1.0 il 2026-02-05

Citation conventions:
- Codici: "Art. 1453 c.c." (article + abbreviation)
- Leggi: "L. 7 agosto 1990, n. 241, art. 1" (type + date + number + article)
- Giurisprudenza: "Cass. Civ., Sez. II, 15/03/2023, n. 1234"
"""

from datetime import datetime
from typing import List, Dict, Any, Optional
from dataclasses import dataclass

from merlt.citation.formats.base import BaseFormat
from merlt.citation.urn_parser import (
    ParsedURN,
    parse_urn,
    format_italian_date,
    get_act_type_abbreviation,
    ITALIAN_MONTHS,
)


@dataclass
class FormattedSource:
    """A formatted source with category information."""
    text: str
    category: str  # "norme" or "giurisprudenza"
    original_urn: Optional[str] = None
    expert: Optional[str] = None
    relevance: Optional[float] = None


class ItalianLegalFormat(BaseFormat):
    """
    Formats citations in Italian legal style.

    This is the standard format used in Italian legal documents,
    following conventions for citing legislation and case law.
    """

    def format_source(self, source: Dict[str, Any]) -> FormattedSource:
        """
        Format a single source in Italian legal style.

        Args:
            source: Source dict with article_urn, expert, relevance, etc.

        Returns:
            FormattedSource with formatted text and category

        Example:
            >>> fmt = ItalianLegalFormat()
            >>> source = {"article_urn": "urn:nir:stato:codice.civile:1942;art1453"}
            >>> result = fmt.format_source(source)
            >>> print(result.text)
            "Art. 1453 c.c."
        """
        urn = source.get("article_urn", source.get("urn", ""))
        expert = source.get("expert")
        relevance = source.get("relevance")

        # Determine category based on expert or source type
        source_type = source.get("type", source.get("source_type", ""))
        if source_type in ["giurisprudenza", "case_law", "jurisprudence"]:
            category = "giurisprudenza"
        elif expert == "precedent":
            category = "giurisprudenza"
        else:
            category = "norme"

        # Parse and format the URN
        if urn:
            parsed = parse_urn(urn)
            text = self._format_parsed_urn(parsed)
        else:
            # Fallback: use title or raw text
            text = source.get("title", source.get("text", str(source)))
            if len(text) > 100:
                text = text[:97] + "..."

        return FormattedSource(
            text=text,
            category=category,
            original_urn=urn,
            expert=expert,
            relevance=relevance,
        )

    def format_source_text(self, source: Dict[str, Any]) -> str:
        """Format a single source as plain text string."""
        return self.format_source(source).text

    def _format_parsed_urn(self, parsed: ParsedURN) -> str:
        """
        Format a parsed URN in Italian legal style.

        Args:
            parsed: Parsed URN components

        Returns:
            Formatted citation string
        """
        if parsed.is_codice:
            return self._format_codice_citation(parsed)
        else:
            return self._format_act_citation(parsed)

    def _format_codice_citation(self, parsed: ParsedURN) -> str:
        """
        Format a code citation (c.c., c.p., etc.).

        Format: "Art. 1453 c.c." or "Art. 1453-bis c.c."

        Args:
            parsed: Parsed URN with codice info

        Returns:
            Formatted code citation
        """
        parts = []

        # Article
        if parsed.article:
            article_text = f"Art. {parsed.article}"
            if parsed.comma:
                article_text += f", comma {parsed.comma}"
            parts.append(article_text)

        # Code abbreviation
        if parsed.codice_abbrev:
            parts.append(parsed.codice_abbrev)
        elif parsed.codice_full_name:
            parts.append(parsed.codice_full_name)

        return " ".join(parts) if parts else parsed.raw_urn

    def _format_act_citation(self, parsed: ParsedURN) -> str:
        """
        Format a legislative act citation (law, decree, etc.).

        Format: "L. 7 agosto 1990, n. 241, art. 1"

        The abbreviation is joined to the date with a space (not comma),
        then remaining parts are comma-separated.

        Args:
            parsed: Parsed URN with act info

        Returns:
            Formatted act citation
        """
        # Build the prefix: "L. 7 agosto 1990" (abbreviation + date, space-separated)
        prefix = ""
        abbrev = get_act_type_abbreviation(parsed.act_type)
        if abbrev:
            prefix = abbrev
        else:
            prefix = parsed.act_type.replace(".", " ").title()

        # Date
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
        Format all sources in Italian legal style with headers.

        Args:
            sources: List of source dicts
            query_summary: Optional query context
            include_attribution: Whether to include ALIS attribution

        Returns:
            Complete formatted document

        Example output:
            FONTI GIURIDICHE
            ================
            Elaborazione a cura di ALIS basata su:

            Query: "Cos'è la risoluzione per inadempimento?"

            NORME
            -----
            - Art. 1453 c.c.
            - L. 7 agosto 1990, n. 241, art. 1

            ---
            Generato da ALIS MERL-T v1.0 il 2026-02-05
        """
        lines = []

        # Header
        lines.append("FONTI GIURIDICHE")
        lines.append("=" * 16)

        if include_attribution:
            lines.append("Elaborazione a cura di ALIS basata su:")
            lines.append("")

        # Query context
        if query_summary:
            lines.append(f'Query: "{query_summary}"')
            lines.append("")

        # Format and categorize sources
        formatted_sources = [self.format_source(s) for s in sources]

        # Group by category
        norme = [s for s in formatted_sources if s.category == "norme"]
        giurisprudenza = [s for s in formatted_sources if s.category == "giurisprudenza"]

        # Norme section
        if norme:
            lines.append("NORME")
            lines.append("-" * 5)
            # Deduplicate by text
            seen = set()
            for source in norme:
                if source.text not in seen:
                    seen.add(source.text)
                    lines.append(f"- {source.text}")
            lines.append("")

        # Giurisprudenza section
        if giurisprudenza:
            lines.append("GIURISPRUDENZA")
            lines.append("-" * 14)
            seen = set()
            for source in giurisprudenza:
                if source.text not in seen:
                    seen.add(source.text)
                    lines.append(f"- {source.text}")
            lines.append("")

        # Footer with attribution
        if include_attribution:
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


__all__ = ["ItalianLegalFormat", "FormattedSource"]
