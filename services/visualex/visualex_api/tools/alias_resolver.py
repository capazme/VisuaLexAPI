"""
Smart preset alias resolver for common Italian and EU norms.

Resolves colloquial names like "gdpr", "statuto lavoratori", "testo unico edilizia"
into structured API parameters before the NL parser runs.
"""

import re
from datetime import date
from pathlib import Path
from typing import Optional

import yaml

from .act_resolver import resolve_atto
from .article_suffixes import ARTICLE_SUFFIX_ALTERNATION
from .regional_law import cites_regional_law

# One ordinal suffix, from the shared table: numbering goes far past "decies",
# and the \b keeps "bis" from matching the head of an ordinary word.
_ART_SUFFIX = r"(?:" + ARTICLE_SUFFIX_ALTERNATION + r")\b"


def _load_presets_from_yaml() -> dict[str, dict]:
    """Load and normalize preset aliases from the YAML file."""
    yaml_path = Path(__file__).parent / "preset_aliases.yaml"
    with open(yaml_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    if data and isinstance(data, dict):
        return {k.lower().strip(): v for k, v in data.items()}
    return {}


# Load once at import time — no race condition, no lazy init
_PRESET_ALIASES: dict[str, dict] = _load_presets_from_yaml()


def split_article(text: str) -> tuple[Optional[str], str]:
    """(article, the act's name) of «art. 4 bis codice privacy» → ("4-bis", "codice privacy");
    (None, the text lower-cased and trimmed) when no article leads it."""
    normalized = text.strip().lower()
    art_match = re.match(
        r"(artt?\.?|articol[oi])\s+(\d+(?:\s*[-]?\s*" + _ART_SUFFIX + r")?)"
        r"\s+(.+)",
        normalized,
        re.IGNORECASE,
    )
    if not art_match:
        return None, normalized
    # Normalize "2 bis" → "2-bis"
    article = re.sub(
        r"(\d+)\s+(" + _ART_SUFFIX + r")",
        r"\1-\2", art_match.group(2).strip(), flags=re.IGNORECASE,
    )
    return article, art_match.group(3).strip()


def resolve_alias(text: str, day: Optional[date] = None) -> Optional[dict]:
    """
    Resolve a text input against the preset alias library.

    Returns a dict with API parameters (act_type, act_number, date) if matched,
    or None if no alias matched. A dated name («tuir») is read at `day`, today in
    Rome when None (`dated_names`): its reading adds `annex` when the act's text
    is an annex, and `notice`. A regional law is never read (`regional_law`).

    The match is case-insensitive and strips surrounding whitespace.
    Supports both exact matches and "art. N <alias>" patterns.
    """
    if not text or not text.strip() or cites_regional_law(text):
        return None

    # Strip article prefix to isolate the alias part
    article, alias_part = split_article(text)

    # Try exact match on the alias part
    if alias_part in _PRESET_ALIASES:
        result = dict(_PRESET_ALIASES[alias_part])
        if article:
            result["article"] = article
        return result

    # The YAML is the override layer and is consulted first, so nothing that
    # resolves today can change meaning. Everything else goes to the act tables.
    resolved = resolve_atto(alias_part, day)
    if resolved is not None:
        result = {"act_type": resolved["tipo_atto"]}
        if resolved.get("numero_atto"):
            result["act_number"] = resolved["numero_atto"]
        if resolved.get("data"):
            result["date"] = resolved["data"]
        if article:
            result["article"] = article
        if resolved.get("allegato"):
            result["annex"] = resolved["allegato"]
        if resolved.get("notice"):
            result["notice"] = resolved["notice"]
        return result

    return None


def get_all_presets() -> dict[str, dict]:
    """Return all loaded preset aliases (for introspection/admin)."""
    return dict(_PRESET_ALIASES)
