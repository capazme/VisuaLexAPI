"""
JSON Citation Format
====================

Formats citations as structured JSON with full metadata.

Output format:
    {
      "metadata": {
        "generator": "ALIS MERL-T",
        "version": "v1.0",
        "generated_at": "2026-02-05T14:30:00",
        "query_summary": "Cos'è la risoluzione per inadempimento?"
      },
      "citations": [
        {
          "raw_urn": "urn:nir:stato:codice.civile:1942;art1453",
          "formatted": "Art. 1453 c.c.",
          "components": {
            "authority": "stato",
            "act_type": "codice.civile",
            "year": "1942",
            "article": "1453",
            "is_codice": true,
            "codice_abbrev": "c.c."
          },
          "source_metadata": {
            "expert": "literal",
            "relevance": 0.95
          }
        }
      ],
      "summary": {
        "total_citations": 5,
        "by_category": {
          "norme": 3,
          "giurisprudenza": 2
        },
        "by_expert": {
          "literal": 2,
          "systemic": 1,
          "precedent": 2
        }
      }
    }

This format is useful for:
- Programmatic processing
- Integration with other systems
- Data analysis
"""

import json
from datetime import datetime
from typing import List, Dict, Any, Optional
from collections import Counter

from merlt.citation.formats.base import BaseFormat
from merlt.citation.urn_parser import (
    ParsedURN,
    parse_urn,
    format_italian_date,
    get_act_type_abbreviation,
)


class JSONFormat(BaseFormat):
    """
    Formats citations as structured JSON.

    This format provides full metadata and is suitable
    for programmatic processing and integration.
    """

    def format_source_text(self, source: Dict[str, Any]) -> str:
        """Format a single source as a JSON text string."""
        result = self.format_source(source)
        return json.dumps(result, ensure_ascii=False, indent=2)

    def format_source(self, source: Dict[str, Any]) -> Dict[str, Any]:
        """
        Format a single source as a JSON-serializable dict.

        Args:
            source: Source dict with article_urn, expert, relevance, etc.

        Returns:
            Structured dict with parsed components
        """
        urn = source.get("article_urn", source.get("urn", ""))
        expert = source.get("expert")
        relevance = source.get("relevance")
        source_type = source.get("type", source.get("source_type", ""))

        # Determine category
        if source_type in ["giurisprudenza", "case_law", "jurisprudence"] or expert == "precedent":
            category = "giurisprudenza"
        else:
            category = "norme"

        result = {
            "raw_urn": urn,
            "category": category,
        }

        # Parse URN if available
        if urn:
            parsed = parse_urn(urn)
            result["formatted"] = self._format_citation_text(parsed)
            result["components"] = self._parsed_to_dict(parsed)
        else:
            title = source.get("title", source.get("text", ""))
            result["formatted"] = title
            result["components"] = {}

        # Add source metadata
        result["source_metadata"] = {}
        if expert:
            result["source_metadata"]["expert"] = expert
        if relevance is not None:
            result["source_metadata"]["relevance"] = relevance
        if source.get("title"):
            result["source_metadata"]["title"] = source["title"]
        if source.get("chunk_id"):
            result["source_metadata"]["chunk_id"] = source["chunk_id"]

        return result

    def _parsed_to_dict(self, parsed: ParsedURN) -> Dict[str, Any]:
        """Convert ParsedURN to a JSON-serializable dict."""
        return {
            "authority": parsed.authority,
            "act_type": parsed.act_type,
            "date": parsed.date,
            "year": parsed.year,
            "act_number": parsed.act_number,
            "article": parsed.article,
            "comma": parsed.comma,
            "is_codice": parsed.is_codice,
            "codice_abbrev": parsed.codice_abbrev,
            "codice_full_name": parsed.codice_full_name,
            "parsed_successfully": parsed.parsed_successfully,
        }

    def _format_citation_text(self, parsed: ParsedURN) -> str:
        """Format a parsed URN as display text."""
        if parsed.is_codice:
            return self._format_codice_text(parsed)
        else:
            return self._format_act_text(parsed)

    def _format_codice_text(self, parsed: ParsedURN) -> str:
        """Format a code citation as text."""
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

    def _format_act_text(self, parsed: ParsedURN) -> str:
        """Format an act citation as text."""
        parts = []

        abbrev = get_act_type_abbreviation(parsed.act_type)
        if abbrev:
            parts.append(abbrev)
        else:
            parts.append(parsed.act_type.replace(".", " ").title())

        if parsed.date:
            parts.append(format_italian_date(parsed.date))
        elif parsed.year:
            parts.append(parsed.year)

        if parsed.act_number:
            parts.append(f"n. {parsed.act_number}")

        if parsed.article:
            article_text = f"art. {parsed.article}"
            if parsed.comma:
                article_text += f", comma {parsed.comma}"
            parts.append(article_text)

        return ", ".join(parts) if parts else parsed.raw_urn

    def format_all(
        self,
        sources: List[Dict[str, Any]],
        query_summary: Optional[str] = None,
        include_attribution: bool = True,
    ) -> str:
        """
        Format all sources as a JSON document.

        Args:
            sources: List of source dicts
            query_summary: Optional query context
            include_attribution: Whether to include ALIS attribution

        Returns:
            JSON string with full structure
        """
        # Format all citations
        citations = []
        seen_urns = set()

        for source in sources:
            formatted = self.format_source(source)
            # Deduplicate by URN
            urn = formatted.get("raw_urn", "")
            if urn and urn in seen_urns:
                continue
            if urn:
                seen_urns.add(urn)
            citations.append(formatted)

        # Compute summary statistics
        category_counts = Counter(c["category"] for c in citations)
        expert_counts = Counter(
            c["source_metadata"].get("expert")
            for c in citations
            if c["source_metadata"].get("expert")
        )

        # Build output structure
        output = {}

        # Metadata section
        if include_attribution:
            output["metadata"] = {
                "generator": "ALIS MERL-T",
                "version": self.alis_version,
                "generated_at": datetime.now().isoformat(),
            }
            if query_summary:
                output["metadata"]["query_summary"] = query_summary

        # Citations
        output["citations"] = citations

        # Summary
        output["summary"] = {
            "total_citations": len(citations),
            "by_category": dict(category_counts),
            "by_expert": dict(expert_counts),
        }

        return json.dumps(output, ensure_ascii=False, indent=2)

    def format_all_dict(
        self,
        sources: List[Dict[str, Any]],
        query_summary: Optional[str] = None,
        include_attribution: bool = True,
    ) -> Dict[str, Any]:
        """
        Format all sources as a Python dict (not JSON string).

        Useful when the caller wants to further process the data.

        Args:
            sources: List of source dicts
            query_summary: Optional query context
            include_attribution: Whether to include ALIS attribution

        Returns:
            Dict with full structure
        """
        json_str = self.format_all(sources, query_summary, include_attribution)
        return json.loads(json_str)

    def get_file_extension(self) -> str:
        """Return the file extension for this format."""
        return "json"

    def get_media_type(self) -> str:
        """Return the media type for this format."""
        return "application/json; charset=utf-8"


__all__ = ["JSONFormat"]
