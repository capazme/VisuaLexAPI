"""Graph hygiene sweep (Loop β — Slice C, "il grafo si autocorregge").

Periodic self-correction of the PROVISIONAL layer of the knowledge graph. Three
best-effort, fully failure-isolated phases, each scoped STRICTLY to
``live_unconfirmed`` nodes — seed/confirmed nodes are NEVER touched:

1. ``reconcile_duplicates`` — delete provisional twins of an already
   confirmed/seed node (same canonical URN). Complements the write-time dedup
   guard in ``provisional_writer._confirmed_twin_exists`` for any pre-existing
   duplicates (e.g. nodes sedimented before the guard existed).
2. ``decay_stale`` — multiply the ``trust`` of provisional nodes not re-retrieved
   within the decay window by the decay factor, so abandoned noise fades over
   successive sweeps. Re-retrieval restores trust (see ``promotion.bump_usage``).
3. ``prune_faded`` — DETACH DELETE provisional nodes that are OLD (past the TTL),
   STALE (past the decay window) AND low-trust (decayed below the prune floor),
   plus their Qdrant chunks. The staleness guard means a recently re-used node is
   never pruned even if its trust decayed earlier.

Thresholds are admin-editable via ``RuntimeConfig``. This module + the explicit
promotion path are the ONLY writers that lower trust or remove provisional
nodes; both exclude confirmed/seed, preserving the "promotion is monotonic,
demotion is a separate explicit path" invariant from the design.
"""

import asyncio
import structlog
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from merlt.config.runtime_config import get_runtime_config
from merlt.pipeline.provisional_writer import PROVENANCE_LIVE_UNCONFIRMED, PROVISIONAL_TRUST

log = structlog.get_logger()

# Serialize sweeps: the periodic lifespan loop and an on-demand admin run must
# not overlap, else decay_stale (the one non-idempotent phase) could apply the
# factor twice in one window. reconcile/prune are idempotent (DETACH DELETE by id).
_hygiene_lock = asyncio.Lock()


async def reconcile_duplicates(graph_client) -> List[str]:
    """Delete provisional nodes whose article (``source_url``) is already a
    NON-live confirmed/seed node. Returns the deleted node ids.

    The provisional node's ``URN`` property is its opaque ``live:<hash>`` id;
    the real article URL lives in ``source_url`` (== a confirmed node's ``URN``),
    so the twin match is ``live.source_url = c.URN``.
    """
    rows = await graph_client.query(
        """
        MATCH (live:LiveSource)
        WHERE live.provenance = $prov AND coalesce(live.source_url, '') <> ''
        MATCH (c) WHERE c.URN = live.source_url AND NOT c:LiveSource
        RETURN collect(DISTINCT live.node_id) AS ids
        """,
        {"prov": PROVENANCE_LIVE_UNCONFIRMED},
    )
    ids = [i for i in ((rows[0].get("ids") if rows else []) or []) if i]
    if ids:
        await graph_client.query(
            "MATCH (n:LiveSource) WHERE n.node_id IN $ids DETACH DELETE n",
            {"ids": ids},
        )
        log.info("hygiene.reconciled_duplicates", count=len(ids))
    return ids


async def decay_stale(graph_client, *, decay_cutoff_iso: str, factor: float) -> int:
    """Multiply the ``trust`` of provisional nodes idle since before
    ``decay_cutoff_iso`` by ``factor``. Returns the number of nodes decayed.

    Idle = ``coalesce(last_used_at, created_at) < cutoff``. ISO-8601 UTC strings
    compare lexicographically, so the string ``<`` is a correct time comparison.
    """
    if factor >= 1.0:
        return 0
    rows = await graph_client.query(
        """
        MATCH (n:LiveSource)
        WHERE n.provenance = $prov
          AND coalesce(n.review_status, '') <> 'pending_review'
          AND coalesce(n.last_used_at, n.created_at, '') < $cutoff
        SET n.trust = coalesce(n.trust, $base) * $factor
        RETURN count(n) AS decayed
        """,
        {
            "prov": PROVENANCE_LIVE_UNCONFIRMED,
            "cutoff": decay_cutoff_iso,
            "factor": factor,
            "base": PROVISIONAL_TRUST,
        },
    )
    decayed = int((rows[0].get("decayed") if rows else 0) or 0)
    if decayed:
        log.info("hygiene.decayed_stale", count=decayed)
    return decayed


async def quarantine_doubtful(
    graph_client, *, ttl_cutoff_iso: str, decay_cutoff_iso: str, min_trust: float, timestamp: str
) -> int:
    """Slice C wave 2: flag prune-eligible provisional nodes that carry POSITIVE
    signals (some feedback or re-use) as ``review_status='pending_review'``
    instead of letting ``prune_faded`` delete them.

    These are the "conflicting signal" cases from the design: a node that was
    useful to someone (``positive_feedback_count`` or ``usage_count`` > 0) yet
    never crossed the promotion threshold and has now faded (old + stale + low
    trust). Rather than silently discard human signal, it is frozen (decay/prune
    skip ``pending_review`` nodes) and surfaced for human adjudication in
    ``/merlt/valida`` (approve -> promote, reject -> prune). Returns the count
    newly flagged.
    """
    rows = await graph_client.query(
        """
        MATCH (n:LiveSource)
        WHERE n.provenance = $prov
          AND coalesce(n.review_status, '') <> 'pending_review'
          AND coalesce(n.created_at, n.first_seen_at, '') < $ttl_cutoff
          AND coalesce(n.last_used_at, n.created_at, '') < $decay_cutoff
          AND coalesce(n.trust, 0.0) < $min_trust
          AND (coalesce(n.positive_feedback_count, 0) > 0 OR coalesce(n.usage_count, 0) > 0)
        SET n.review_status = 'pending_review',
            n.review_reason = 'faded_with_positive_signal',
            n.review_flagged_at = $timestamp
        RETURN count(n) AS flagged
        """,
        {
            "prov": PROVENANCE_LIVE_UNCONFIRMED,
            "ttl_cutoff": ttl_cutoff_iso,
            "decay_cutoff": decay_cutoff_iso,
            "min_trust": min_trust,
            "timestamp": timestamp,
        },
    )
    flagged = int((rows[0].get("flagged") if rows else 0) or 0)
    if flagged:
        log.info("hygiene.quarantined_doubtful", count=flagged)
    return flagged


async def prune_faded(
    graph_client, *, ttl_cutoff_iso: str, decay_cutoff_iso: str, min_trust: float
) -> List[str]:
    """DETACH DELETE provisional nodes that are OLD, STALE, low-trust and PURE
    NOISE (no accumulated human signal).

    A node is pruned iff it is ``live_unconfirmed`` AND older than the TTL
    (``created_at < ttl_cutoff``) AND idle since before the decay window
    (``last_used_at < decay_cutoff`` — so a recently re-used node is spared even
    if its trust decayed earlier) AND its (decayed) ``trust`` is below the floor
    AND it carries NO positive signal (``positive_feedback_count`` and
    ``usage_count`` both 0 — nodes with signal are routed to human review by
    ``quarantine_doubtful`` instead) AND it is not already flagged for review.
    Returns the deleted node ids (caller drops their Qdrant chunks).
    """
    rows = await graph_client.query(
        """
        MATCH (n:LiveSource)
        WHERE n.provenance = $prov
          AND coalesce(n.review_status, '') <> 'pending_review'
          AND coalesce(n.created_at, n.first_seen_at, '') < $ttl_cutoff
          AND coalesce(n.last_used_at, n.created_at, '') < $decay_cutoff
          AND coalesce(n.trust, 0.0) < $min_trust
          AND coalesce(n.positive_feedback_count, 0) = 0
          AND coalesce(n.usage_count, 0) = 0
        RETURN collect(n.node_id) AS ids
        """,
        {
            "prov": PROVENANCE_LIVE_UNCONFIRMED,
            "ttl_cutoff": ttl_cutoff_iso,
            "decay_cutoff": decay_cutoff_iso,
            "min_trust": min_trust,
        },
    )
    ids = [i for i in ((rows[0].get("ids") if rows else []) or []) if i]
    if ids:
        await graph_client.query(
            "MATCH (n:LiveSource) WHERE n.node_id IN $ids DETACH DELETE n",
            {"ids": ids},
        )
        log.info("hygiene.pruned_faded", count=len(ids))
    return ids


async def run_graph_hygiene(graph_client=None) -> Dict[str, Any]:
    """Run one full hygiene sweep (reconcile -> decay -> prune) and return stats.

    Best-effort and failure-isolated PER PHASE: a failure in one phase logs and
    the others still run. Safe to call periodically (lifespan loop) or on demand
    (admin ops endpoint). Only ever touches ``live_unconfirmed`` nodes.
    """
    async with _hygiene_lock:
        return await _run_graph_hygiene_locked(graph_client)


async def _run_graph_hygiene_locked(graph_client) -> Dict[str, Any]:
    from merlt.pipeline.provisional_writer import _get_graph_client, delete_provisional_chunk

    gc = await _get_graph_client(graph_client)
    cfg = get_runtime_config()
    decay_window = cfg.get_int("hygiene_decay_window_hours", 168)
    factor = cfg.get_float("hygiene_decay_factor", 0.9)
    ttl = cfg.get_int("hygiene_prune_ttl_hours", 720)
    min_trust = cfg.get_float("hygiene_prune_min_trust", 0.3)

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    decay_cutoff = (now - timedelta(hours=decay_window)).isoformat()
    ttl_cutoff = (now - timedelta(hours=ttl)).isoformat()

    stats: Dict[str, Any] = {"reconciled": 0, "decayed": 0, "quarantined": 0, "pruned": 0}

    try:
        rec_ids = await reconcile_duplicates(gc)
        stats["reconciled"] = len(rec_ids)
        for nid in rec_ids:
            await delete_provisional_chunk(nid)
    except Exception as exc:  # noqa: BLE001 - failure-isolated per phase
        log.warning("hygiene.reconcile_failed", error=str(exc))

    try:
        stats["decayed"] = await decay_stale(gc, decay_cutoff_iso=decay_cutoff, factor=factor)
    except Exception as exc:  # noqa: BLE001
        log.warning("hygiene.decay_failed", error=str(exc))

    # Quarantine BEFORE prune: doubtful nodes (faded but with human signal) are
    # flagged for review so the subsequent prune skips them (both filter on
    # review_status). Pure noise falls through to prune.
    try:
        stats["quarantined"] = await quarantine_doubtful(
            gc, ttl_cutoff_iso=ttl_cutoff, decay_cutoff_iso=decay_cutoff,
            min_trust=min_trust, timestamp=now_iso,
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("hygiene.quarantine_failed", error=str(exc))

    try:
        pruned_ids = await prune_faded(
            gc, ttl_cutoff_iso=ttl_cutoff, decay_cutoff_iso=decay_cutoff, min_trust=min_trust
        )
        stats["pruned"] = len(pruned_ids)
        for nid in pruned_ids:
            await delete_provisional_chunk(nid)
    except Exception as exc:  # noqa: BLE001
        log.warning("hygiene.prune_failed", error=str(exc))

    log.info("hygiene.sweep_done", **stats)
    return stats


__all__ = [
    "reconcile_duplicates",
    "decay_stale",
    "quarantine_doubtful",
    "prune_faded",
    "run_graph_hygiene",
]
