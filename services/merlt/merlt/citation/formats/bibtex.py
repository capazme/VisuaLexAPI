"""
BibTeX Citation Format
======================

Formats citations in BibTeX format for use in academic papers.

Output format:
    % ALIS Citation Export
    % Query: "Cos'è la risoluzione per inadempimento?"
    % Generated: 2026-02-05

    @legislation{art1453cc,
      title = {Art. 1453 - Risolubilità del contratto per inadempimento},
      author = {{Codice Civile}},
      year = {1942},
      note = {Risoluzione del contratto per inadempimento}
    }

    @legislation{l241_1990,
      title = {Legge 7 agosto 1990, n. 241},
      author = {{Parlamento Italiano}},
      year = {1990},
      note = {Nuove norme in materia di procedimento amministrativo}
    }

Entry types:
- @legislation: For laws, decrees, codes
- @misc: For case law and other sources
"""

import re
from datetime import datetime
from typing import List, Dict, Any, Optional
from dataclasses import dataclass

from merlt.citation.formats.base import BaseFormat
from merlt.citation.urn_parser import (
    ParsedURN,
    parse_urn,
    get_act_type_abbreviation,
    get_codice_abbreviation,
    CODICE_FULL_NAMES,
)


@dataclass
class BibTeXEntry:
    """A BibTeX entry."""
    entry_type: str  # legislation, misc, etc.
    cite_key: str
    fields: Dict[str, str]


class BibTeXFormat(BaseFormat):
    """
    Formats citations in BibTeX format.

    BibTeX is the standard format for bibliographic references
    in LaTeX documents, commonly used in academic papers.
    """

    def __init__(self, alis_version: str = "MERL-T v1.0"):
        """
        Initialize the BibTeX formatter.

        Args:
            alis_version: ALIS version string for comments
        """
        super().__init__(alis_version)
        self._used_keys = set()

    def _sanitize_cite_key(self, key: str) -> str:
        """
        Sanitize a string for use as a BibTeX cite key.

        Rules:
        - Only alphanumeric and underscore
        - Must start with a letter
        - No spaces or special characters

        Args:
            key: Raw string

        Returns:
            Sanitized cite key
        """
        # Remove special characters, keep alphanumeric and underscore
        sanitized = re.sub(r'[^a-zA-Z0-9_]', '', key.replace(".", "_").replace("-", "_"))

        # Ensure it starts with a letter
        if sanitized and not sanitized[0].isalpha():
            sanitized = "ref_" + sanitized

        if not sanitized:
            sanitized = "ref"

        # Ensure uniqueness
        base_key = sanitized
        counter = 1
        while sanitized in self._used_keys:
            sanitized = f"{base_key}_{counter}"
            counter += 1

        self._used_keys.add(sanitized)
        return sanitized

    def _escape_bibtex(self, text: str) -> str:
        """
        Escape special characters for BibTeX.

        Args:
            text: Raw text

        Returns:
            Escaped text safe for BibTeX
        """
        # Escape special LaTeX characters
        replacements = [
            ("&", r"\&"),
            ("%", r"\%"),
            ("$", r"\$"),
            ("#", r"\#"),
            ("_", r"\_"),
            ("{", r"\{"),
            ("}", r"\}"),
            ("~", r"\textasciitilde{}"),
            ("^", r"\textasciicircum{}"),
        ]
        for old, new in replacements:
            text = text.replace(old, new)
        return text

    def format_source_text(self, source: Dict[str, Any]) -> str:
        """Format a single source as a BibTeX text string."""
        entry = self.format_source(source)
        return self._entry_to_string(entry)

    def format_source(self, source: Dict[str, Any]) -> BibTeXEntry:
        """
        Format a single source as a BibTeX entry.

        Args:
            source: Source dict with article_urn, expert, relevance, etc.

        Returns:
            BibTeXEntry with type, key, and fields

        Example:
            >>> fmt = BibTeXFormat()
            >>> source = {"article_urn": "urn:nir:stato:codice.civile:1942;art1453"}
            >>> entry = fmt.format_source(source)
            >>> print(entry.cite_key)
            "art1453_cc"
        """
        urn = source.get("article_urn", source.get("urn", ""))
        expert = source.get("expert")
        source_type = source.get("type", source.get("source_type", ""))

        # Determine entry type
        if source_type in ["giurisprudenza", "case_law", "jurisprudence"] or expert == "precedent":
            entry_type = "misc"
        else:
            entry_type = "legislation"

        # Parse URN
        if urn:
            parsed = parse_urn(urn)
            return self._format_parsed_entry(parsed, entry_type, source)
        else:
            # Fallback for non-URN sources
            title = source.get("title", source.get("text", "Unknown source"))
            cite_key = self._sanitize_cite_key(title[:20])
            return BibTeXEntry(
                entry_type="misc",
                cite_key=cite_key,
                fields={
                    "title": self._escape_bibtex(title),
                    "note": "Source from ALIS",
                }
            )

    def _format_parsed_entry(
        self,
        parsed: ParsedURN,
        entry_type: str,
        source: Dict[str, Any]
    ) -> BibTeXEntry:
        """
        Format a parsed URN as a BibTeX entry.

        Args:
            parsed: Parsed URN components
            entry_type: BibTeX entry type
            source: Original source dict

        Returns:
            BibTeXEntry
        """
        fields = {}

        if parsed.is_codice:
            # Code citation
            cite_key = self._generate_code_cite_key(parsed)
            fields["title"] = self._format_code_title(parsed)
            fields["author"] = f"{{{parsed.codice_full_name or parsed.act_type.replace('.', ' ').title()}}}"
            if parsed.year:
                fields["year"] = parsed.year
        else:
            # Legislative act citation
            cite_key = self._generate_act_cite_key(parsed)
            fields["title"] = self._format_act_title(parsed)
            fields["author"] = "{{Parlamento Italiano}}"
            if parsed.year:
                fields["year"] = parsed.year
            elif parsed.date:
                fields["year"] = parsed.date[:4]

        # Add note if available
        if source.get("title"):
            fields["note"] = self._escape_bibtex(source["title"])

        # Add howpublished for original URN
        if parsed.raw_urn:
            fields["howpublished"] = f"\\url{{{parsed.raw_urn}}}"

        return BibTeXEntry(
            entry_type=entry_type,
            cite_key=cite_key,
            fields=fields
        )

    def _generate_code_cite_key(self, parsed: ParsedURN) -> str:
        """Generate a cite key for a code citation."""
        parts = []

        if parsed.article:
            parts.append(f"art{parsed.article}")

        if parsed.codice_abbrev:
            # Convert "c.c." to "cc"
            abbrev = parsed.codice_abbrev.replace(".", "").lower()
            parts.append(abbrev)
        elif parsed.act_type:
            parts.append(parsed.act_type.replace(".", "_")[:10])

        key = "_".join(parts) if parts else "code"
        return self._sanitize_cite_key(key)

    def _generate_act_cite_key(self, parsed: ParsedURN) -> str:
        """Generate a cite key for a legislative act citation."""
        parts = []

        # Act type abbreviation
        abbrev = get_act_type_abbreviation(parsed.act_type)
        if abbrev:
            parts.append(abbrev.replace(".", "").lower())
        else:
            parts.append(parsed.act_type[:5])

        # Number
        if parsed.act_number:
            parts.append(parsed.act_number)

        # Year
        if parsed.year:
            parts.append(parsed.year)
        elif parsed.date:
            parts.append(parsed.date[:4])

        key = "_".join(parts) if parts else "act"
        return self._sanitize_cite_key(key)

    def _format_code_title(self, parsed: ParsedURN) -> str:
        """Format the title field for a code citation."""
        parts = []

        if parsed.article:
            parts.append(f"Art. {parsed.article}")
            if parsed.comma:
                parts.append(f"comma {parsed.comma}")

        if parsed.codice_full_name:
            parts.append(f"- {parsed.codice_full_name}")
        elif parsed.codice_abbrev:
            parts.append(f"({parsed.codice_abbrev})")

        return self._escape_bibtex(" ".join(parts) if parts else parsed.raw_urn)

    def _format_act_title(self, parsed: ParsedURN) -> str:
        """Format the title field for an act citation."""
        parts = []

        # Full act type name
        act_name = parsed.act_type.replace(".", " ").title()
        abbrev = get_act_type_abbreviation(parsed.act_type)
        if abbrev:
            parts.append(abbrev)
        else:
            parts.append(act_name)

        # Date
        if parsed.date:
            from merlt.citation.urn_parser import format_italian_date
            parts.append(format_italian_date(parsed.date))
        elif parsed.year:
            parts.append(parsed.year)

        # Number
        if parsed.act_number:
            parts.append(f"n. {parsed.act_number}")

        # Article
        if parsed.article:
            parts.append(f"art. {parsed.article}")

        return self._escape_bibtex(", ".join(parts) if parts else parsed.raw_urn)

    def _entry_to_string(self, entry: BibTeXEntry) -> str:
        """Convert a BibTeXEntry to string format."""
        lines = [f"@{entry.entry_type}{{{entry.cite_key},"]

        for key, value in entry.fields.items():
            # Don't add extra braces if already wrapped
            if value.startswith("{") and value.endswith("}"):
                lines.append(f"  {key} = {value},")
            else:
                lines.append(f"  {key} = {{{value}}},")

        lines.append("}")
        return "\n".join(lines)

    def format_all(
        self,
        sources: List[Dict[str, Any]],
        query_summary: Optional[str] = None,
        include_attribution: bool = True,
    ) -> str:
        """
        Format all sources in BibTeX format.

        Args:
            sources: List of source dicts
            query_summary: Optional query context
            include_attribution: Whether to include ALIS attribution

        Returns:
            Complete BibTeX file content
        """
        # Reset used keys for this export
        self._used_keys = set()

        lines = []

        # Header comments
        if include_attribution:
            lines.append(f"% ALIS Citation Export")
            lines.append(f"% Version: {self.alis_version}")

        if query_summary:
            # Escape % in query for BibTeX comment
            safe_query = query_summary.replace("\n", " ")[:100]
            lines.append(f'% Query: "{safe_query}"')

        today = datetime.now().strftime("%Y-%m-%d")
        lines.append(f"% Generated: {today}")
        lines.append("")

        # Format each source
        entries = []
        seen_keys = set()

        for source in sources:
            entry = self.format_source(source)
            if entry.cite_key not in seen_keys:
                seen_keys.add(entry.cite_key)
                entries.append(self._entry_to_string(entry))

        lines.extend(entries)

        return "\n\n".join(lines)

    def get_file_extension(self) -> str:
        """Return the file extension for this format."""
        return "bib"

    def get_media_type(self) -> str:
        """Return the media type for this format."""
        return "application/x-bibtex"


__all__ = ["BibTeXFormat", "BibTeXEntry"]
