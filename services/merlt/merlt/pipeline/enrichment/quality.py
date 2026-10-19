"""
Entity-name quality gate (shared)
==================================

Single source of truth for "is this entity name real, or junk?".

Historically three write paths pushed ``pending_entities.entity_text`` with no
quality gate at all, and a fourth (``base.py:_validate_entity``) only checked
length + an explicit excluded-terms list. Meanwhile ``experts/base.py``
``_is_unusable_live_result`` already knew how to spot tool-error / empty-result
bodies. This module generalizes both into one reusable predicate so the
extractors, the enrichment router write sites, the read-side ``get_pending``
filter AND the one-time backfill script all agree on what "junk" means.

Public API (import from ``merlt.pipeline.enrichment.quality``):
    - ``JUNK_SIGNATURES(name) -> bool``: True if the name matches a junk
      signature (case-insensitive, trimmed; substring / regex, NOT exact match).
      Length and per-type limits are NOT checked here — that is ``is_valid_entity_name``'s job.
    - ``is_valid_entity_name(name, entity_type=None) -> bool``: full gate;
      False means "do not write / drop from queue". Combines the junk
      signatures with min/max length (per-type max when ``entity_type`` given).

The predicate is intentionally conservative: it rejects obvious machine junk
(leaked node ids, tool error/empty strings, markdown control noise, test
artifacts) while letting real legal concepts, principles and massime through.
"""

import re
from typing import Optional, Union


# Absolute minimum name length (chars, after trim). "IP", "SA" etc. are too
# short to be a meaningful legal entity name.
MIN_NAME_LENGTH = 3

# Default upper bound on an entity name. Names are labels, not sentences.
DEFAULT_MAX_NAME_LENGTH = 120

# Per-type overrides. Brocardi are full latin maxims and massima-derived
# judicial-act names ("Cass. civ. Sez. II n. 12345/2022 — ...") can run long,
# so they get a wider ceiling; everything else uses the default.
MAX_NAME_LENGTH_BY_TYPE = {
    "brocardo": 200,
    "atto_giudiziario": 200,
    "precedente": 200,
    "caso": 200,
    "dottrina": 200,
}

# Test / placeholder markers. ``test`` uses a word boundary so that legitimate
# Italian words that merely contain the substring "test" (attestazione,
# contestazione, protesta, testamento, testimone, ...) are NOT rejected.
_TEST_MARKER_RE = re.compile(
    r"(\btest\b|example|esempio|lorem|placeholder|xxx|\btbd\b)",
    re.IGNORECASE,
)

# Raw machine identifiers that leaked into a name field.
_RAW_IDENTIFIER_PREFIXES = ("live:", "pending:", "urn:", "http")

# Markdown / control noise that should never open a real entity name.
_MARKDOWN_NOISE_PREFIXES = ("**", "#", "hint:")


def JUNK_SIGNATURES(name: object) -> bool:
    """True if ``name`` matches a junk signature (length-independent).

    Case-insensitive and trimmed. Uses substring / regex checks (NOT exact
    match) so e.g. ``"live:abc123"`` and ``"  **Errore**: ..."`` are caught.

    This is the reusable signature predicate imported by the extractors, the
    router write sites, ``get_pending`` and the backfill. Length / per-type
    ceilings live in :func:`is_valid_entity_name`, not here.
    """
    if name is None:
        return True
    text = str(name).strip()
    if not text:
        return True

    lowered = text.lower()

    # (1) leaked node id: starts with "live:"
    if lowered.startswith("live:"):
        return True

    # (2) tool-error body: starts "**errore**" OR contains "non riconosciuto"
    if lowered.startswith("**errore**") or "non riconosciuto" in lowered:
        return True

    # (3) empty-result body: starts "nessun(a)" AND contains "trovat"
    if lowered.startswith("nessun") and "trovat" in lowered:
        return True

    # (4) tool "Formato:" scaffolding leaked into the name
    if "formato:" in lowered:
        return True

    # (5) test / placeholder markers (\btest\b word-boundary — see regex above)
    if _TEST_MARKER_RE.search(text):
        return True

    # (7) raw identifier prefixes
    if lowered.startswith(_RAW_IDENTIFIER_PREFIXES):
        return True

    # (8) markdown / control-noise prefixes
    if lowered.startswith(_MARKDOWN_NOISE_PREFIXES):
        return True

    return False


def _max_length_for_type(entity_type: Optional[Union[str, object]]) -> int:
    """Resolve the per-type max name length (falls back to the default)."""
    if entity_type is None:
        return DEFAULT_MAX_NAME_LENGTH
    # Accept either an EntityType enum (has ``.value``) or a raw string.
    type_str = getattr(entity_type, "value", entity_type)
    if not isinstance(type_str, str):
        return DEFAULT_MAX_NAME_LENGTH
    return MAX_NAME_LENGTH_BY_TYPE.get(type_str.lower().strip(), DEFAULT_MAX_NAME_LENGTH)


def is_valid_entity_name(
    name: object,
    entity_type: Optional[Union[str, object]] = None,
) -> bool:
    """Full quality gate for an entity name.

    Returns ``True`` only if the name is worth writing to (or keeping in)
    ``pending_entities``. Combines:
      - length bounds: reject len < ``MIN_NAME_LENGTH`` or > per-type max
      - junk signatures: :func:`JUNK_SIGNATURES`

    Args:
        name: candidate entity name (any type; coerced to ``str``).
        entity_type: optional ``EntityType`` enum or its string value, used to
            pick the per-type max length.

    Returns:
        ``True`` if the name passes the gate, ``False`` if it is junk.
    """
    if name is None:
        return False
    text = str(name).strip()

    # (6) length bounds
    if len(text) < MIN_NAME_LENGTH:
        return False
    if len(text) > _max_length_for_type(entity_type):
        return False

    # (1)-(5), (7)-(8) junk signatures
    if JUNK_SIGNATURES(text):
        return False

    return True
