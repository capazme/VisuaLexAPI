"""
Relation endpoint vocabulary (B1: note-derived relations)
=========================================================

A relation endpoint (``source_node_urn`` / ``target_entity_id`` on
``extraction_candidates`` and ``pending_relations``) is one of:

(a) a norm: a Normattiva URN or the Normattiva URL wrapping it;
(b) a graph node id, e.g. the Entity id ``concetto:risoluzione_del_contratto``
    (see ``entity_writer.entity_node_id``);
(c) a pending entity id (``pending_entities.entity_id``, ``tipo:<8 hex>``);
(d) a raw concept name as the LLM wrote it ("risoluzione del contratto") —
    unresolved. It must never become a graph node: the consensus writer used to
    ``MERGE (:Norma {URN: <concept name>})`` and polluted the shared graph.

Pure helpers (regex only), shared by the staging parser and the consensus
writer so both sides classify an endpoint the same way.
"""

from __future__ import annotations

import re
from typing import List, Optional

NORMATTIVA_URL_PREFIX = "https://www.normattiva.it/uri-res/N2Ls?"

# `tipo:slug` with no whitespace: Entity node ids and pending entity ids.
_ENTITY_ID_RE = re.compile(r"^[a-z][a-z0-9_]*:\S+$")


def canonical_norm_key(value: str) -> str:
    """Strip only the NIR version/annex marker (``!vig=``), keeping any wrapper.

    Same rule as ``pipeline/ingestion.py::_canonical_urn``: the graph keys
    norms without the marker.
    """
    value = (value or "").strip()
    bang = value.find("!")
    return value[:bang] if bang != -1 else value


def is_norm_reference(value: Optional[str]) -> bool:
    """True for a URN or for a URL that wraps a NIR URN."""
    v = (value or "").strip().lower()
    if not v:
        return False
    if v.startswith("urn:"):
        return True
    return v.startswith(("http://", "https://")) and "urn:nir:" in v


def is_nir_reference(value: Optional[str]) -> bool:
    """True when the value carries a Normattiva NIR URN (bare or wrapped)."""
    return "urn:nir:" in (value or "").lower()


def norm_key_candidates(value: str) -> List[str]:
    """The keys a norm may be stored under: the canonical form plus its
    bare/wrapped counterpart (the seed keys the URL form, callers may send
    the bare URN)."""
    key = canonical_norm_key(value)
    candidates = [key]
    if key.lower().startswith("urn:nir:"):
        candidates.append(NORMATTIVA_URL_PREFIX + key)
    elif key.startswith(NORMATTIVA_URL_PREFIX):
        candidates.append(key[len(NORMATTIVA_URL_PREFIX):])
    return candidates


def looks_like_entity_id(value: Optional[str]) -> bool:
    """True for a `tipo:slug` identifier (graph Entity id or pending entity id)."""
    v = (value or "").strip()
    return bool(v) and not is_norm_reference(v) and bool(_ENTITY_ID_RE.match(v))


def endpoint_is_resolved(value: Optional[str], raw_text: Optional[str] = None) -> bool:
    """Whether a staged relation endpoint holds an identifier, not a name.

    The staging parser stores the resolved identifier in the endpoint column
    and the LLM's name in ``source_text`` / ``target_text``; when resolution
    fails the column keeps the name. Rows staged before those columns existed
    (``raw_text`` None) are judged by shape alone.
    """
    v = (value or "").strip()
    if not v:
        return False
    if is_norm_reference(v):
        return True
    if not looks_like_entity_id(v):
        return False
    return raw_text is None or v != raw_text.strip()


__all__ = [
    "NORMATTIVA_URL_PREFIX",
    "canonical_norm_key",
    "endpoint_is_resolved",
    "is_nir_reference",
    "is_norm_reference",
    "looks_like_entity_id",
    "norm_key_candidates",
]
