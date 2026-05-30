"""
Provisional Source Writer (Loop β — Reasoning→Enrichment bridge, task C.1)
==========================================================================

Sediments a LIVE retrieval — a source the experts pulled from ``mcp-legal-it``
during reasoning (jurisprudence, Brocardi dottrina, or a norm article not yet
in the seed) — into FalkorDB as a PROVISIONAL ``live_unconfirmed`` node and
embeds it into Qdrant. The next time the same question is asked, semantic
retrieval hits the graph chunk instead of re-scraping the live source.

This is a NET-NEW low-trust write path. It deliberately does NOT reuse
``EntityGraphWriter.write_entity`` (B8 gotcha): that path HARD-REQUIRES
``consensus_reached AND consensus_type=='approved'`` and hardcodes
``community_validated=true``. Provisional nodes have cleared no consensus, so
they carry ``provenance='live_unconfirmed'``, ``trust=0.6`` and
``community_validated=false``. The provenance-aware traversal (task B.3,
``GraphAwareRetriever._compute_trust_factor``) reads ``trust`` and ranks these
strictly below an equivalent ``seed`` / ``community_validated`` (trust=1.0)
node, without ever zeroing them out.

Promotion to ``pending_*`` (Phase D) is a separate concern; the verbatim live
text NEVER auto-enters ``pending_*`` (copyright gate, Slice 2c). It lives here
as a flagged, navigable graph node until a user confirms it.

Input contract (produced by ``experts/base.py::_retrieve_live_legal_sources``,
task A.3):

    {
        "text": "<markdown of the live source>",
        "source_id": "mcp-legal-it:<tool_name>",
        "source": "mcp-legal-it",
        "tool_name": "<tool_name>",
        "provenance": "live_unconfirmed",
        "expert_type": "<literal|systemic|principles|precedent>",
        # optional, if the caller could resolve a structured URL/URN:
        "url": "https://www.normattiva.it/...~art2043",
        "urn": "...",
    }

URN canonicalization gotcha (preserved): the FalkorDB graph key is the FULL
Normattiva URL form; only the NIR version/annex marker after the first ``!`` is
stripped (see ``pipeline/ingestion.py::_canonical_urn``). The URL wrapper is
NEVER stripped to the bare ``urn:nir:...`` form, or seeded nodes become
unreachable and re-trigger the infinite lazy-ingest loop.

Public API
----------
    await write_provisional_source(source, *, graph_client=None, embeddings=None)
        -> Optional[str]   # node id, or None on any failure
    await write_provisional_sources(sources, **kw) -> list[str]   # node ids written
"""

import hashlib
import os
import re
import uuid
import structlog
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

log = structlog.get_logger()

# Provisional-node constants (B8: distinct, low-trust write path).
PROVENANCE_LIVE_UNCONFIRMED = "live_unconfirmed"
PROVISIONAL_TRUST = 0.6
PROVISIONAL_LABEL = "LiveSource"

# Deterministic namespace for Qdrant point ids (so a re-run upserts the SAME
# point instead of creating a duplicate vector).
_QDRANT_POINT_NAMESPACE = uuid.UUID("6f9619ff-8b86-d011-b42d-00c04fc964ff")

# Same NIR version/annex marker stripped by pipeline/ingestion.py::_canonical_urn.
# Preserve the URL wrapper — strip ONLY from the first "!".
_NIR_VERSION_MARKER = "!"

# Best-effort extraction of a Normattiva/EUR-Lex/ECLI URL embedded in the
# markdown text, used ONLY to populate `article_urn` for back-linkage. We never
# parse the markdown for structure (B6) — this is a single resolvable link.
_URL_RE = re.compile(r"https?://[^\s)>\]\"']+", re.IGNORECASE)

# tool_name → secondary graph label + Qdrant source_type. The seed loader's
# `_infer_source_type` maps Norma→"norma", AttoGiudiziario→"massima",
# Dottrina→"dottrina"; we mirror that so provisional chunks filter alongside
# their seed equivalents under the experts' `source_types` filter.
_CASE_LAW_TOOL_HINTS = (
    "giurisprudenza",
    "sentenz",
    "cassazione",
    "cgue",
    "pronunce",
    "delibere",
    "provvediment",
    "tributari",
    "amministrativ",
)
_DOTTRINA_TOOL_HINTS = ("brocardi", "annotation", "massim")
_NORM_TOOL_HINTS = ("cite_law", "law_article", "full_act", "act_index", "norma")


def _canonical_url(url: str) -> str:
    """Strip only the NIR version/annex marker, preserving the URL wrapper.

    Mirrors ``pipeline/ingestion.py::_canonical_urn`` so a provisional norm node
    keyed by URL matches the seed/lazy-ingest key on exact equality. NEVER
    reduces the value to the bare ``urn:nir:...`` form.
    """
    if not url:
        return url
    bang = url.find(_NIR_VERSION_MARKER)
    return url[:bang] if bang != -1 else url


def _extract_source_url(source: Dict[str, Any]) -> str:
    """Resolve a single canonical URL for the source, if any.

    Prefers an explicit ``url``/``urn`` field on the source dict; otherwise
    best-effort extracts the first URL found in the markdown text. Returns ""
    when no URL can be resolved (e.g. a calculator-style tool result) — the node
    id then falls back to the ``source_id`` + text digest.
    """
    explicit = source.get("url") or source.get("urn")
    if explicit:
        return _canonical_url(str(explicit).strip())
    text = source.get("text") or ""
    match = _URL_RE.search(text)
    if match:
        return _canonical_url(match.group(0).rstrip(".,;"))
    return ""


def _derive_node_id(source: Dict[str, Any], source_url: str) -> Optional[str]:
    """Deterministic node id: ``live:<sha256(source_id|url|text-digest)[:24]>``.

    Idempotent by construction — re-running with the same source produces the
    same id, so the MERGE updates in place instead of duplicating. We include a
    short text digest in the key so two different live results from the SAME
    tool with NO resolvable URL (e.g. two distinct case-law searches) do not
    collide onto one node. When a URL IS present it dominates the key, so the
    same article retrieved by different experts/tools converges on one node.
    """
    source_id = (source.get("source_id") or source.get("tool_name") or "").strip()
    text = (source.get("text") or "").strip()
    if not source_id and not source_url and not text:
        return None
    if source_url:
        # URL-keyed: same article ⇒ same node regardless of which tool fetched it.
        key = f"url|{source_url}"
    else:
        # No URL ⇒ fall back to (source_id + text digest) so distinct results
        # from the same tool stay distinct.
        text_digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
        key = f"sid|{source_id}|{text_digest}"
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:24]
    return f"live:{digest}"


def _infer_labels_and_source_type(source: Dict[str, Any]) -> "tuple[str, str]":
    """Infer a secondary graph label + Qdrant source_type from the tool name.

    Returns ``(secondary_label, source_type)``. The node always carries the
    ``LiveSource`` label (provisional flag); the secondary label makes it
    navigable like its seed equivalents (Norma / AttoGiudiziario / Dottrina).
    """
    tool = (source.get("tool_name") or "").lower()
    if any(h in tool for h in _CASE_LAW_TOOL_HINTS):
        return "AttoGiudiziario", "massima"
    if any(h in tool for h in _DOTTRINA_TOOL_HINTS):
        return "Dottrina", "dottrina"
    if any(h in tool for h in _NORM_TOOL_HINTS):
        return "Norma", "norma"
    return "LiveSource", "text"


def _resolve_collection() -> str:
    """Qdrant collection name, matching the seed/app resolution.

    ``QDRANT_COLLECTION`` env wins; else ``<FALKORDB_GRAPH_NAME>_chunks``
    (default graph ``merl_t_legal`` → ``merl_t_legal_chunks``). Confirmed
    against ``app.py:180-182`` and ``scripts/load_seed_libro_iv.py``.
    """
    return os.getenv("QDRANT_COLLECTION") or (
        os.getenv("FALKORDB_GRAPH_NAME", "merl_t_legal") + "_chunks"
    )


async def _get_graph_client(graph_client):
    """Return a connected FalkorDBClient, building a default one if needed."""
    if graph_client is not None:
        return graph_client
    from merlt.storage.graph import FalkorDBClient

    client = FalkorDBClient()
    await client.connect()
    return client


def _get_embeddings(embeddings):
    """Return an EmbeddingService instance (singleton if not provided)."""
    if embeddings is not None:
        return embeddings
    from merlt.storage.vectors.embeddings import EmbeddingService

    return EmbeddingService.get_instance()


def _build_qdrant_client():
    """Build a default Qdrant client, mirroring app.py / backfill_embeddings.

    ``QDRANT_URL`` wins; else host/port. Returns None if qdrant-client is
    unavailable so the caller can skip the embed step without failing the
    graph write.
    """
    try:
        from qdrant_client import QdrantClient
    except Exception as exc:  # noqa: BLE001
        log.warning("provisional_writer.qdrant_import_failed", error=str(exc))
        return None
    qdrant_url = os.getenv("QDRANT_URL")
    if qdrant_url:
        return QdrantClient(url=qdrant_url)
    return QdrantClient(
        host=os.getenv("QDRANT_HOST", "localhost"),
        port=int(os.getenv("QDRANT_PORT", "6333")),
    )


async def _merge_provisional_node(
    graph_client,
    *,
    node_id: str,
    source: Dict[str, Any],
    source_url: str,
    secondary_label: str,
    timestamp: str,
) -> bool:
    """MERGE the provisional FalkorDB node (idempotent).

    ON CREATE stamps the full provenance/trust set; ON MATCH refreshes
    ``updated_at``/``retrieved_at`` and re-asserts the provisional provenance
    ONLY while the node has not been promoted to a higher trust (coalesce-guard,
    same non-downgrade pattern as EntityGraphWriter._enrich_existing_entity):
    a node already lifted to trust>=PROVISIONAL_TRUST by a later promotion is
    never pulled back down to live_unconfirmed.

    The node carries BOTH labels (``LiveSource`` + a domain label). FalkorDB
    cannot parameterize labels, so the secondary label is interpolated from the
    fixed allow-list in ``_infer_labels_and_source_type`` (never user input).
    """
    if secondary_label and secondary_label != PROVISIONAL_LABEL:
        label_clause = f"{PROVISIONAL_LABEL}:{secondary_label}"
    else:
        label_clause = PROVISIONAL_LABEL

    cypher = f"""
    MERGE (n:{label_clause} {{node_id: $node_id}})
    ON CREATE SET
        n.URN = $node_id,
        n.provenance = $provenance,
        n.trust = $trust,
        n.community_validated = false,
        n.source = $source,
        n.source_tool = $source_tool,
        n.source_url = $source_url,
        n.expert_type = $expert_type,
        n.text = $text,
        n.retrieved_at = $timestamp,
        n.created_at = $timestamp,
        n.updated_at = $timestamp
    ON MATCH SET
        n.source_url = CASE WHEN $source_url <> '' THEN $source_url ELSE n.source_url END,
        n.text = $text,
        n.retrieved_at = $timestamp,
        n.updated_at = $timestamp,
        n.provenance = CASE
            WHEN coalesce(n.trust, 0.0) > $trust THEN n.provenance
            ELSE $provenance
        END,
        n.trust = CASE
            WHEN coalesce(n.trust, 0.0) > $trust THEN n.trust
            ELSE $trust
        END
    RETURN n.node_id AS node_id
    """

    params = {
        "node_id": node_id,
        "provenance": PROVENANCE_LIVE_UNCONFIRMED,
        "trust": PROVISIONAL_TRUST,
        "source": source.get("source") or "mcp-legal-it",
        "source_tool": source.get("tool_name") or "",
        "source_url": source_url or "",
        "expert_type": source.get("expert_type") or "",
        "text": source.get("text") or "",
        "timestamp": timestamp,
    }

    result = await graph_client.query(cypher, params)
    if not result:
        raise RuntimeError(f"MERGE returned no row for provisional node {node_id}")
    return True


def _upsert_chunk_sync(
    qdrant_client,
    *,
    collection: str,
    point_id: str,
    vector: List[float],
    article_urn: str,
    source_type: str,
    text: str,
    node_label: str,
) -> None:
    """Ensure the collection exists, then upsert ONE chunk point.

    Payload schema matches the seed loader EXACTLY (confirmed against
    ``scripts/load_seed_libro_iv.py::_generate_and_upsert_embeddings`` lines
    367-372): ``{article_urn, source_type, text, node_label}``. Vector is
    1024-dim Cosine (e5-large). Synchronous (qdrant-client is sync); the async
    wrapper runs it in a thread.
    """
    from qdrant_client import models as qm

    try:
        if not qdrant_client.collection_exists(collection):
            qdrant_client.create_collection(
                collection_name=collection,
                vectors_config=qm.VectorParams(size=1024, distance=qm.Distance.COSINE),
            )
            log.info("provisional_writer.qdrant_collection_created", name=collection)
    except Exception as exc:  # noqa: BLE001
        log.warning("provisional_writer.qdrant_collection_check_failed", error=str(exc))

    qdrant_client.upsert(
        collection_name=collection,
        points=[
            qm.PointStruct(
                id=point_id,
                vector=vector,
                payload={
                    "article_urn": article_urn,
                    "source_type": source_type,
                    "text": text,
                    "node_label": node_label,
                },
            )
        ],
    )


async def _embed_and_upsert_chunk(
    *,
    embeddings,
    node_id: str,
    source_url: str,
    source_type: str,
    secondary_label: str,
    text: str,
) -> bool:
    """Embed the source text and upsert ONE chunk into the legal-chunks collection.

    Idempotent on a deterministic point id (UUID5 of the node id), so a re-run
    overwrites the SAME vector instead of duplicating. ``article_urn`` links the
    chunk back to the graph: the resolvable source URL when present, else the
    node id (so ``GraphAwareRetriever._vector_search`` → graph enrichment can
    still anchor on it). Best-effort: returns False on any failure without
    raising — the graph node alone already makes the source navigable.
    """
    text = (text or "").strip()
    if not text:
        return False

    qdrant_client = _build_qdrant_client()
    if qdrant_client is None:
        return False

    try:
        vector = await embeddings.encode_document_async(text)
    except Exception as exc:  # noqa: BLE001
        log.warning("provisional_writer.embed_failed", node_id=node_id, error=str(exc))
        return False

    point_id = str(uuid.uuid5(_QDRANT_POINT_NAMESPACE, node_id))
    article_urn = source_url or node_id
    # The Qdrant node_label payload reflects the chunk's domain label, matching
    # what the seed loader stored (e.g. "Norma"/"AttoGiudiziario"/"Dottrina"),
    # falling back to the provisional label.
    node_label = secondary_label or PROVISIONAL_LABEL

    collection = _resolve_collection()
    try:
        import asyncio

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: _upsert_chunk_sync(
                qdrant_client,
                collection=collection,
                point_id=point_id,
                vector=vector,
                article_urn=article_urn,
                source_type=source_type,
                text=text,
                node_label=node_label,
            ),
        )
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "provisional_writer.qdrant_upsert_failed",
            node_id=node_id,
            collection=collection,
            error=str(exc),
        )
        return False

    log.info(
        "provisional_writer.chunk_embedded",
        node_id=node_id,
        collection=collection,
        article_urn=article_urn,
        source_type=source_type,
    )
    return True


async def write_provisional_source(
    source: Dict[str, Any],
    *,
    graph_client=None,
    embeddings=None,
) -> Optional[str]:
    """Sediment ONE live retrieval into FalkorDB + Qdrant as a provisional node.

    Steps:
        1. Derive a deterministic node id; extract text / url / tool from the
           source dict.
        2. MERGE a low-trust FalkorDB node (``provenance='live_unconfirmed'``,
           ``trust=0.6``, ``source_tool``, ``source_url``, ``retrieved_at``) —
           idempotent.
        3. Embed the text and upsert ONE chunk into ``merl_t_legal_chunks`` with
           the seed payload schema (``article_urn`` = url or node id) —
           idempotent on a deterministic point id. Best-effort: a failed embed
           does NOT undo the graph write.

    Args:
        source: live-source dict (see module docstring for the contract).
        graph_client: optional connected ``FalkorDBClient``; a default one is
            built+connected when omitted.
        embeddings: optional ``EmbeddingService``; the singleton is used when
            omitted.

    Returns:
        The provisional node id on success, or ``None`` on any failure. Fully
        failure-isolated internally — the caller (orchestrator hook C.2) adds
        its own isolation too.
    """
    try:
        if not isinstance(source, dict):
            log.warning("provisional_writer.invalid_source", type=type(source).__name__)
            return None

        text = (source.get("text") or "").strip()
        if not text:
            log.debug("provisional_writer.skip_empty_text", source_id=source.get("source_id"))
            return None

        source_url = _extract_source_url(source)
        node_id = _derive_node_id(source, source_url)
        if not node_id:
            log.warning("provisional_writer.no_node_id", source_id=source.get("source_id"))
            return None

        secondary_label, source_type = _infer_labels_and_source_type(source)
        timestamp = datetime.now(timezone.utc).isoformat()

        gc = await _get_graph_client(graph_client)
        await _merge_provisional_node(
            gc,
            node_id=node_id,
            source=source,
            source_url=source_url,
            secondary_label=secondary_label,
            timestamp=timestamp,
        )
        log.info(
            "provisional_writer.node_merged",
            node_id=node_id,
            tool=source.get("tool_name"),
            has_url=bool(source_url),
            label=secondary_label,
        )

        # Best-effort embed — never undoes the graph write on failure.
        emb = _get_embeddings(embeddings)
        await _embed_and_upsert_chunk(
            embeddings=emb,
            node_id=node_id,
            source_url=source_url,
            source_type=source_type,
            secondary_label=secondary_label,
            text=text,
        )

        return node_id

    except Exception as exc:  # noqa: BLE001 - fully failure-isolated
        log.warning(
            "provisional_writer.write_failed",
            source_id=source.get("source_id") if isinstance(source, dict) else None,
            error=str(exc),
        )
        return None


async def write_provisional_sources(
    sources: List[Dict[str, Any]],
    *,
    graph_client=None,
    embeddings=None,
) -> List[str]:
    """Batch helper: sediment many live sources, sharing the clients.

    Builds/connects ONE FalkorDB client and resolves ONE EmbeddingService for
    the whole batch (avoids reconnecting per source). Each source is written
    independently and failure-isolated; a failure on one does not abort the
    rest. Returns the list of node ids successfully written (deduplicated,
    preserving first-seen order).

    Args:
        sources: list of live-source dicts.
        graph_client: optional shared connected ``FalkorDBClient``.
        embeddings: optional shared ``EmbeddingService``.

    Returns:
        List of provisional node ids that were written.
    """
    if not sources:
        return []

    try:
        gc = await _get_graph_client(graph_client)
    except Exception as exc:  # noqa: BLE001
        log.warning("provisional_writer.batch_graph_client_failed", error=str(exc))
        return []

    emb = _get_embeddings(embeddings)

    written: List[str] = []
    seen: set = set()
    for source in sources:
        node_id = await write_provisional_source(
            source, graph_client=gc, embeddings=emb
        )
        if node_id and node_id not in seen:
            seen.add(node_id)
            written.append(node_id)

    log.info(
        "provisional_writer.batch_done",
        total=len(sources),
        written=len(written),
    )
    return written


__all__ = [
    "write_provisional_source",
    "write_provisional_sources",
    "PROVENANCE_LIVE_UNCONFIRMED",
    "PROVISIONAL_TRUST",
    "PROVISIONAL_LABEL",
]
