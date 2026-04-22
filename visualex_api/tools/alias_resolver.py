"""
Smart preset alias resolver for common Italian and EU norms.

Resolves colloquial names like "gdpr", "statuto lavoratori", "testo unico edilizia"
into structured API parameters before the NL parser runs.
"""

import re
from pathlib import Path
from typing import Optional

import yaml


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


def resolve_alias(text: str) -> Optional[dict]:
    """
    Resolve a text input against the preset alias library.

    Returns a dict with API parameters (act_type, act_number, date) if matched,
    or None if no alias matched.

    The match is case-insensitive and strips surrounding whitespace.
    Supports both exact matches and "art. N <alias>" patterns.
    """
    if not text or not text.strip():
        return None

    normalized = text.strip().lower()

    # Strip article prefix to isolate the alias part
    article = None
    art_match = re.match(
        r"(artt?\.?|articol[oi])\s+(\d+(?:\s*[-]?\s*(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?)"
        r"\s+(.+)",
        normalized,
        re.IGNORECASE,
    )
    if art_match:
        article_num = art_match.group(2).strip()
        # Normalize "2 bis" → "2-bis"
        article_num = re.sub(
            r"(\d+)\s+(bis|ter|quater|quinquies|sexies|septies|octies|novies|decies)",
            r"\1-\2", article_num, flags=re.IGNORECASE,
        )
        alias_part = art_match.group(3).strip()
        article = article_num
    else:
        alias_part = normalized

    # Try exact match on the alias part
    if alias_part in _PRESET_ALIASES:
        result = dict(_PRESET_ALIASES[alias_part])
        if article:
            result["article"] = article
        return result

    return None


def get_all_presets() -> dict[str, dict]:
    """Return all loaded preset aliases (for introspection/admin)."""
    return dict(_PRESET_ALIASES)
