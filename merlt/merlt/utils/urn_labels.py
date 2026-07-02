"""
URN → human label / estremi derivation (data-quality plan A1 + A2).

Single source of truth for turning a Normattiva/NIR URN into a display label
("Art. N") and the ``numero_articolo`` / ``estremi`` pair used to backfill
Norma stub nodes. Shared by:

- ``api/graph_router.py`` (A1 — node serializer label chain)
- ``storage/graph/entity_writer.py`` (A2 — ON CREATE stub enrichment)
- ``pipeline/multivigenza.py`` (A2 — version-node ON CREATE enrichment)
- ``scripts/backfill_data_quality.py`` (one-time repopulation)

Pure, dependency-free (regex only) so every write path and the backfill can
import it without pulling FalkorDB / DB clients.

URN article segment form (verified live against the seed graph):
    ...~art467          -> numero_articolo "467"
    ...~art30bis        -> numero_articolo "30-bis"   (suffix concatenated)
    ...~art1980-com3    -> numero_articolo "1980"     (comma suffix ignored)
    ...!vig=2024-01-15  -> version marker stripped before parsing
"""

import re
from typing import Any, Dict, Optional, Tuple

# Recognised ordinal extensions for article suffixes (-bis, -ter, ...).
# Kept explicit so a stray token after the digits (e.g. "-com3") is not
# mistaken for a suffix.
_ARTICLE_SUFFIXES = (
    "bis", "ter", "quater", "quinquies", "sexies", "septies", "octies",
    "novies", "decies", "undecies", "duodecies", "terdecies", "quaterdecies",
    "quindecies", "sexdecies", "septiesdecies", "duodevicies", "undevicies",
    "vicies",
)

# ~art<digits><optional-suffix>, anchored so trailing "-com3" / "!vig=" don't
# bleed into the capture. Suffix is matched only against the known list.
_ART_URN_RE = re.compile(
    r"~art(\d+)(" + "|".join(_ARTICLE_SUFFIXES) + r")?",
    re.IGNORECASE,
)

# Max label length before truncation for free-text fallbacks (testo, etc.).
_LABEL_MAX_LEN = 55


def article_number_from_urn(urn: Optional[str]) -> Optional[str]:
    """
    Extract the article number (incl. -bis/-ter) from a URN.

    Args:
        urn: Full URN or URL carrying a ``~art<n>`` segment.

    Returns:
        Canonical article number ("467", "30-bis") or ``None`` when the URN
        has no article segment (act/document-level URN, concept id, etc.).

    Examples:
        >>> article_number_from_urn("urn:nir:...:262:2~art467")
        '467'
        >>> article_number_from_urn("urn:nir:...:262:2~art30bis")
        '30-bis'
        >>> article_number_from_urn("urn:nir:...:262:2~art1980-com3")
        '1980'
        >>> article_number_from_urn("urn:nir:...:262") is None
        True
    """
    if not urn:
        return None
    match = _ART_URN_RE.search(urn)
    if not match:
        return None
    base = match.group(1)
    suffix = match.group(2)
    if suffix:
        return f"{base}-{suffix.lower()}"
    return base


def article_label_from_urn(urn: Optional[str]) -> Optional[str]:
    """
    Build an "Art. N" label from a URN's article segment.

    Args:
        urn: Full URN or URL.

    Returns:
        "Art. 467" / "Art. 30-bis" or ``None`` when no article segment exists.
    """
    numero = article_number_from_urn(urn)
    if numero is None:
        return None
    return f"Art. {numero}"


def derive_article_fields_from_urn(urn: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """
    Derive ``(numero_articolo, estremi)`` from a URN for stub enrichment (A2).

    Used on the ON CREATE branch of Norma MERGEs and by the backfill to give
    empty Norma stubs a minimal, correct identity when the article was never
    fully ingested.

    Args:
        urn: Full URN or URL carrying a ``~art<n>`` segment.

    Returns:
        ``(numero_articolo, estremi)`` — both ``None`` when the URN has no
        article segment (so the caller can skip the SET without inventing
        bogus data). ``estremi`` mirrors the seed convention ("Art. N").

    Examples:
        >>> derive_article_fields_from_urn("urn:nir:...~art467")
        ('467', 'Art. 467')
        >>> derive_article_fields_from_urn("urn:nir:...~art30bis")
        ('30-bis', 'Art. 30-bis')
        >>> derive_article_fields_from_urn("urn:nir:...:262")
        (None, None)
    """
    numero = article_number_from_urn(urn)
    if numero is None:
        return None, None
    return numero, f"Art. {numero}"


def _truncate(text: str, max_len: int = _LABEL_MAX_LEN) -> str:
    """Trim and truncate free text, appending an ellipsis when cut."""
    text = " ".join(text.split())  # collapse internal whitespace/newlines
    if len(text) <= max_len:
        return text
    return text[: max_len - 1].rstrip() + "…"


def build_node_label(props: Dict[str, Any], node_id: str) -> str:
    """
    Build a human display label for a graph node (A1).

    Priority chain (first non-empty wins):
        1. nome / estremi / rubrica / titolo  (existing rich fields)
        2. Norma synth: "Art. {numero_articolo} — {rubrica}" when BOTH exist
        3. numero_articolo alone  → "Art. {numero_articolo}"
        4. testo (truncated ~55 chars)         → e.g. Comma nodes
        5. URN-derived "Art. N" (regex ~art(\\d+))
        6. node_id truncated (last resort, never the raw URL for an article)

    The synth in (2) and the URN fallback in (5) guarantee we never dump the
    raw Normattiva URL as the label for an article node.

    Args:
        props: Node property dict (FalkorDB ``properties`` payload).
        node_id: Resolved node id (URN/urn/node_id/...).

    Returns:
        A non-empty display label.
    """
    def _clean(value: Any) -> Optional[str]:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    numero_articolo = _clean(props.get("numero_articolo"))
    rubrica = _clean(props.get("rubrica"))

    # 1a. An explicit human name always wins (entities carry `nome`; Norma
    # nodes do not, so this never shadows the synth below in practice).
    nome = _clean(props.get("nome"))
    if nome:
        return nome

    # 2. Norma synthesis: "Art. N — rubrica" when both present.
    if numero_articolo and rubrica:
        return f"Art. {numero_articolo} — {rubrica}"

    # 1b. Remaining rich fields.
    for key in ("estremi", "rubrica", "titolo"):
        value = _clean(props.get(key))
        if value:
            return value

    # 3. numero_articolo alone.
    if numero_articolo:
        return f"Art. {numero_articolo}"

    # 4. Free text (Comma nodes carry only `testo`).
    testo = _clean(props.get("testo"))
    if testo:
        return _truncate(testo)

    # 5. URN-derived "Art. N".
    art_label = article_label_from_urn(node_id) or article_label_from_urn(
        _clean(props.get("URN")) or _clean(props.get("urn"))
    )
    if art_label:
        return art_label

    # 6. Last resort — truncated id (never the full raw URL).
    return _truncate(node_id, 50) if node_id else "(senza etichetta)"


__all__ = [
    "article_number_from_urn",
    "article_label_from_urn",
    "derive_article_fields_from_urn",
    "build_node_label",
]
