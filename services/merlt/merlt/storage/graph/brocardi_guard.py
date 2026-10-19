"""
Brocardi text never reaches a user (D-078).

Brocardi is no longer a source, but what it supplied stays in the graph and in
Qdrant: massime (`AttoGiudiziario`), ratio, spiegazione and relazioni
(`Dottrina`), and their vectors. They may still rank a retrieval and link an
article to the decisions a massima cites. Their TEXT must not reach a user:
not in a response body, not in a stored trace served back, and not in an LLM
prompt, because the experts are told to quote their sources verbatim.

This module is the one place that recognises Brocardi content and takes its
text out. It is applied where content crosses towards a user:

- every tool result, in `BaseTool.__call__`, before the expert reads it, puts
  it in a prompt or in a trace;
- every graph node a graph route returns (`graph_router._parse_graph_node_v2`)
  and the provisional-review rows;
- the assistant's stored turns read back by `/experts/history` and
  `/experts/trace`.

A massima keeps its decision's `estremi` ("Cass. civ. n. 1/2020"): the bridge
to the decision, never its text. Doctrine keeps nothing but its identity.
"""

from __future__ import annotations

from typing import Any, Mapping, Optional

# How Brocardi content is recognised (inventory of 19 October 2026). Every
# writer that stored it left one of these marks.
BROCARDI_FONTI: frozenset[str] = frozenset({"brocardi.it", "brocardi", "brocardi_massime"})
BROCARDI_ID_PREFIXES: tuple[str, ...] = (
    "massima_",
    "dottrina_brocardi_",
    "dottrina_relazione_",
    "dottrina:",
)
# The mcp-legal-it tools that read Brocardi whatever their arguments: the first
# three in vendor/mcp-legal-it, `mappa_orientamento` (its «Ancoraggio Brocardi»
# block) in the release the stack runs. No expert may be granted one.
BROCARDI_TOOLS: frozenset[str] = frozenset({
    "cerca_brocardi", "fetch_law_annotations", "giurisprudenza_articolo", "mappa_orientamento",
})
BROCARDI_HOST = "brocardi.it"
# Only Brocardi ever wrote these Qdrant source types: the Brocardi ingestion,
# the Libro IV seed (its Dottrina nodes) and live sources from the Brocardi
# tools (provisional_writer). A `massima` is Brocardi too unless it is a live
# point (`live:…`), which `cerca_giurisprudenza` writes.
BROCARDI_SOURCE_TYPES: frozenset[str] = frozenset({"ratio", "spiegazione", "dottrina"})

_ID_KEYS = ("node_id", "URN", "urn", "article_urn", "id", "source_id", "chunk_urn")
_URL_KEYS = ("source_url", "url", "link")
# Every property under which a writer stored a passage of text.
TEXT_KEYS: frozenset[str] = frozenset({
    "text", "testo", "testo_vigente", "massima", "descrizione", "ratio",
    "spiegazione", "content", "contenuto", "snippet", "excerpt", "context",
    "definition_text", "text_preview", "preview", "summary", "abstract",
    # A traced call of a Brocardi tool: what it returned.
    "result_summary",
    # The scraper's own keys (`brocardi_info`), read lower-cased.
    "brocardi", "massime", "relazioni", "relazionecostituzione", "footnotes",
})
# The text a redacted item carries in place of its own, so a consumer that
# reads `text` still gets a string.
_TEXT_SLOT = "text"


def _lower(value: Any) -> str:
    return value.strip().lower() if isinstance(value, str) else ""


def is_brocardi(item: Any) -> bool:
    """True when a node's properties, a vector payload or a retrieved item
    carries one of Brocardi's marks (looking one level into `metadata` and
    `properties`, where retrieved items keep their payload)."""
    if not isinstance(item, Mapping):
        return False
    if _marked(item):
        return True
    for nested in ("metadata", "properties", "payload"):
        inner = item.get(nested)
        if isinstance(inner, Mapping) and _marked(inner):
            return True
    return False


def _marked(m: Mapping[str, Any]) -> bool:
    fonte = _lower(m.get("fonte"))
    if fonte in BROCARDI_FONTI or _lower(m.get("source")) in BROCARDI_FONTI:
        return True
    if _lower(m.get("source_tool")) in BROCARDI_TOOLS or _lower(m.get("tool_name")) in BROCARDI_TOOLS:
        return True
    for key in _ID_KEYS + _URL_KEYS:
        if BROCARDI_HOST in _lower(m.get(key)):
            return True
    if fonte:
        # Another source named itself: a community `dottrina:<slug>` entity
        # shares the seed's id prefix, and is not Brocardi.
        return False
    for key in _ID_KEYS:
        if _lower(m.get(key)).startswith(BROCARDI_ID_PREFIXES):
            return True
    source_type = _lower(m.get("source_type"))
    if source_type in BROCARDI_SOURCE_TYPES:
        return True
    article_urn = _lower(m.get("article_urn"))
    if source_type == "massima" and article_urn and not article_urn.startswith("live:"):
        return True
    return False


def _is_decision(item: Mapping[str, Any]) -> bool:
    for m in (item, item.get("metadata"), item.get("properties")):
        if not isinstance(m, Mapping):
            continue
        if _lower(m.get("source_type")) == "massima" or "massima" in m or "numero_sentenza" in m:
            return True
        if m.get("type") == "AttoGiudiziario" or "AttoGiudiziario" in (m.get("labels") or ()):
            return True
        if any(_lower(m.get(k)).startswith("massima_") for k in _ID_KEYS):
            return True
    return False


def decision_bridge(item: Mapping[str, Any]) -> str:
    """The decision a massima cites, by its `estremi`, or "" when the item is
    not a massima or names no decision. Never any of the massima's own words."""
    if not _is_decision(item):
        return ""
    for m in (item, item.get("metadata"), item.get("properties")):
        if isinstance(m, Mapping):
            estremi = m.get("estremi")
            if isinstance(estremi, str) and estremi.strip():
                return estremi.strip()
    for node in item.get("linked_nodes") or ():
        meta = node.get("metadata") if isinstance(node, Mapping) else None
        if isinstance(meta, Mapping) and isinstance(meta.get("estremi"), str) and meta["estremi"].strip():
            return meta["estremi"].strip()
    return ""


def redact(value: Any, _bridge: Optional[str] = None) -> Any:
    """A copy of `value` in which every Brocardi item has lost its text.

    Walks dicts and lists; the input is never modified (tool results are cached
    and shared). A Brocardi item keeps its identity (ids, URNs, `estremi`,
    scores, links to other nodes) and, under `text`, only its decision's
    `estremi` or an empty string."""
    if isinstance(value, Mapping):
        if is_brocardi(value):
            bridge = decision_bridge(value) if _bridge is None else _bridge
            return _strip(value, bridge)
        return {k: redact(v) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(v) for v in value]
    if isinstance(value, tuple):
        return tuple(redact(v) for v in value)
    return value


def _strip(m: Mapping[str, Any], bridge: str) -> dict:
    out: dict = {}
    removed = False
    for key, value in m.items():
        if isinstance(key, str) and key.lower() in TEXT_KEYS:
            removed = True
            continue
        if isinstance(value, Mapping):
            # The payload of a Brocardi item is Brocardi too, marked or not.
            out[key] = _strip(value, bridge)
        elif isinstance(value, list):
            out[key] = [redact(v, bridge) for v in value]
        else:
            out[key] = value
    if _TEXT_SLOT in m or (removed and bridge):
        out[_TEXT_SLOT] = bridge
    return out


def redact_tool_result(result: Any) -> Any:
    """The same `ToolResult` with Brocardi text taken out of its data and its
    metadata. A result with nothing to redact is returned as it is."""
    data = redact(result.data)
    metadata = redact(result.metadata)
    if data == result.data and metadata == result.metadata:
        return result
    return type(result)(
        success=result.success,
        data=data,
        error=result.error,
        metadata=metadata,
        tool_name=result.tool_name,
    )


def brocardi_label(item: Mapping[str, Any]) -> str:
    """What a user may read as the name of a Brocardi item: its decision's
    `estremi`, else the kind of content."""
    bridge = decision_bridge(item)
    if bridge:
        return bridge
    source_type = ""
    for m in (item, item.get("metadata"), item.get("properties")):
        if isinstance(m, Mapping) and m.get("source_type"):
            source_type = _lower(m.get("source_type"))
            break
    return "Massima" if source_type == "massima" else "Dottrina"


# --- The assistant's turns stored before the guard ---------------------------
#
# A turn answered after the guard was in place is clean at the source and is
# marked so in its `full_trace`. An older one may hold Brocardi text in places
# whose origin can no longer be told: a 200-character raw summary of a search
# result, a label made of a snippet, an excerpt the LLM copied from a source
# known only by a vector id. Those are emptied when such a turn is read back.

TRACE_GUARD_KEY = "brocardi_guard"
# The retrieval tools whose raw result summary may begin with Brocardi text.
_RETRIEVAL_TOOLS = frozenset({"semantic_search", "graph_search", "definition_lookup"})
_LABEL_MAPS = frozenset({"top_source_labels", "source_labels"})
_MASSIMA_LABEL = "Massima — "
# An excerpt whose source is one of these is the norm's own text.
_NORM_SOURCE_MARKS = ("urn:nir:", "normattiva.it", "eur-lex.europa.eu", "celex:")


def mark_trace_guarded(full_trace: dict) -> dict:
    """Record on a trace being stored that its content passed the guard."""
    full_trace[TRACE_GUARD_KEY] = 1
    return full_trace


def is_trace_guarded(full_trace: Any) -> bool:
    return isinstance(full_trace, Mapping) and bool(full_trace.get(TRACE_GUARD_KEY))


def redact_stored_trace(full_trace: Any) -> Any:
    """A stored pipeline trace as a user may read it."""
    if is_trace_guarded(full_trace):
        return redact(full_trace)
    return _legacy_trace(redact(full_trace))


def _legacy_trace(value: Any, key: str = "") -> Any:
    if isinstance(value, Mapping):
        out = {}
        tool = _lower(value.get("tool_name"))
        for k, v in value.items():
            if k in _LABEL_MAPS and isinstance(v, Mapping):
                out[k] = {
                    urn: _legacy_label(urn, label) for urn, label in v.items()
                }
            elif k == "result_summary" and tool in _RETRIEVAL_TOOLS:
                out[k] = ""
            else:
                out[k] = _legacy_trace(v, k)
        return out
    if isinstance(value, list):
        return [_legacy_trace(v, key) for v in value]
    return value


def _legacy_label(urn: Any, label: Any) -> Any:
    if not isinstance(label, str):
        return label
    marked = _marked({"node_id": urn}) if isinstance(urn, str) else False
    if marked or label.startswith(_MASSIMA_LABEL):
        return "Massima" if label.startswith(_MASSIMA_LABEL) or _lower(urn).startswith("massima_") else "Dottrina"
    return label


def redact_stored_sources(sources: Any, guarded: bool) -> Any:
    """The cited sources of a stored turn. In a turn from before the guard, an
    excerpt is kept only when its source is a norm (the norm's own text)."""
    if not isinstance(sources, list):
        return sources
    out = []
    for s in sources:
        if not isinstance(s, Mapping):
            out.append(s)
            continue
        s = redact(s)
        if not guarded and s.get("excerpt"):
            source_id = _lower(s.get("article_urn") or s.get("source_id"))
            if not any(mark in source_id for mark in _NORM_SOURCE_MARKS):
                s = {**s, "excerpt": ""}
        out.append(s)
    return out
