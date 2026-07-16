"""
Provisional Node Promotion Engine (Loop β — Slice B, "il grafo impara")
=========================================================================

Reads the three implicit trust signals accumulated on a ``live_unconfirmed``
FalkorDB node (``usage_count``, ``positive_feedback_count``,
``has_confirmed_citation`` — written by ``pipeline/provisional_writer.py`` on
creation, then bumped by this module's writers) and promotes the node to
``provenance='confirmed'`` / ``trust=1.0`` once a weighted score clears an
admin-tunable threshold (``RuntimeConfig``).

Promotion is MONOTONIC: it only ever raises trust, never demotes (decay /
pruning of stale provisional nodes is a separate, explicit path — Slice C).
Every write here is best-effort and fully failure-isolated; callers (the
retriever hot path, the inline-feedback endpoint) fire these as background
tasks and swallow errors — a promotion-engine hiccup must never affect the
user-facing query/feedback response.

Identity gotcha (shared with ``provisional_writer``'s module docstring): a
provisional node's FalkorDB key is ``node_id`` (``live:<hash>``), but the
Qdrant chunk that surfaces it in retrieval carries ``article_urn =
source_url`` (the real article URL), NOT the node id. Every signal writer
below therefore matches by ``URN OR node_id OR source_url`` so a served
Qdrant hit or a stored ``QATrace.sources[*].article_urn`` entry (both keyed
by ``source_url``) actually resolves to the node.

Public API
----------
    await bump_usage(graph_client, article_urn) -> Optional[str]
    await bump_positive_feedback(graph_client, urns) -> List[str]
    await promote_if_ready(graph_client, node_id) -> bool
"""

import structlog
from datetime import datetime, timezone
from typing import List, Optional

from merlt.config.runtime_config import get_runtime_config
from merlt.pipeline.provisional_writer import PROVENANCE_LIVE_UNCONFIRMED, PROVISIONAL_TRUST

log = structlog.get_logger()

# Small caps (K, M in the design doc) on the raw counters before they're
# normalized into [0,1] score terms. Fallback module constants when the
# RuntimeConfig params (registered below) are somehow absent.
USAGE_CAP = 3
FEEDBACK_CAP = 3


async def bump_usage(graph_client, article_urn: str) -> Optional[str]:
    """Signal 2 (re-retrieval): a ``live_unconfirmed`` node was served to an
    expert as a retrieval result. Increments ``usage_count`` and refreshes
    ``last_used_at``.

    Best-effort: any failure returns None instead of raising, so the caller
    (retriever hot path) can fire this from a background task and never risk
    the query itself.

    Returns:
        The touched node's ``node_id``, or None if no matching
        ``live_unconfirmed`` node was found (e.g. the served source is a
        seed/confirmed node — not an error, just nothing to bump) or on any
        failure.
    """
    if not article_urn:
        return None
    try:
        timestamp = datetime.now(timezone.utc).isoformat()
        # Slice C: re-retrieval also RESTORES trust decayed by the hygiene sweep
        # back up to the provisional baseline (never lowers it — the CASE keeps a
        # higher value, and only live_unconfirmed nodes match, so a promoted node
        # at trust 1.0 is never touched). Keeps decay/re-use coherent: a node
        # that stays useful never gets pruned.
        cypher = """
        MATCH (n:LiveSource)
        WHERE (n.URN = $urn OR n.node_id = $urn OR n.source_url = $urn)
          AND n.provenance = $provenance
        SET n.usage_count = coalesce(n.usage_count, 0) + 1,
            n.last_used_at = $timestamp,
            n.trust = CASE
                WHEN coalesce(n.trust, 0.0) < $base THEN $base
                ELSE n.trust
            END
        RETURN n.node_id AS node_id
        """
        rows = await graph_client.query(cypher, {
            "urn": article_urn,
            "provenance": PROVENANCE_LIVE_UNCONFIRMED,
            "timestamp": timestamp,
            "base": PROVISIONAL_TRUST,
        })
        node_id = rows[0].get("node_id") if rows else None
        if node_id:
            log.debug("promotion.usage_bumped", node_id=node_id)
        return node_id
    except Exception as exc:  # noqa: BLE001 - fully failure-isolated
        log.debug("promotion.bump_usage_failed", article_urn=article_urn, error=str(exc))
        return None


async def bump_positive_feedback(graph_client, urns: List[str]) -> List[str]:
    """Signal 1 (positive answer feedback): a 👍 answer used these sources.

    Increments ``positive_feedback_count`` on every ``live_unconfirmed`` node
    matched by URN, node_id OR source_url (see module docstring). Dedupes the
    input; best-effort, never raises.

    Args:
        urns: the answer's cited source ids (e.g. ``QATrace.sources[*]
            .article_urn``); non-URN/empty entries are skipped, no-ops for
            them are silent.

    Returns:
        List of touched node ids (possibly empty).
    """
    clean_urns = sorted({u for u in (urns or []) if u})
    if not clean_urns:
        return []
    try:
        cypher = """
        UNWIND $urns AS urn
        MATCH (n:LiveSource)
        WHERE (n.URN = urn OR n.node_id = urn OR n.source_url = urn)
          AND n.provenance = $provenance
        SET n.positive_feedback_count = coalesce(n.positive_feedback_count, 0) + 1
        RETURN DISTINCT n.node_id AS node_id
        """
        rows = await graph_client.query(cypher, {
            "urns": clean_urns,
            "provenance": PROVENANCE_LIVE_UNCONFIRMED,
        })
        node_ids = [r.get("node_id") for r in (rows or []) if r.get("node_id")]
        if node_ids:
            log.info("promotion.positive_feedback_bumped", count=len(node_ids))
        return node_ids
    except Exception as exc:  # noqa: BLE001 - fully failure-isolated
        log.warning("promotion.bump_positive_feedback_failed", error=str(exc))
        return []


async def promote_if_ready(graph_client, node_id: str) -> bool:
    """Compute the promotion score for ONE ``live_unconfirmed`` node and, if
    it clears the admin-tunable threshold, monotonically promote it.

    score = w_usage   * min(usage_count, K) / K
          + w_feedback * min(positive_feedback_count, M) / M
          + w_citation * (1.0 if has_confirmed_citation else 0.0)

    Weights, threshold and the K/M caps are read from ``RuntimeConfig``
    (admin-editable, no container restart). Never demotes: a node whose
    ``provenance`` is not ``live_unconfirmed`` (already promoted, or not a
    provisional node at all) is left untouched and this returns False.

    Best-effort / failure-isolated: any error returns False.
    """
    if not node_id:
        return False
    try:
        rows = await graph_client.query(
            "MATCH (n:LiveSource {node_id: $node_id}) "
            "RETURN n.provenance AS provenance, n.usage_count AS usage_count, "
            "n.positive_feedback_count AS positive_feedback_count, "
            "n.has_confirmed_citation AS has_confirmed_citation "
            "LIMIT 1",
            {"node_id": node_id},
        )
        if not rows:
            return False
        row = rows[0]
        if row.get("provenance") != PROVENANCE_LIVE_UNCONFIRMED:
            return False  # already promoted (or not provisional) — monotonic no-op

        usage_count = int(row.get("usage_count") or 0)
        positive_feedback_count = int(row.get("positive_feedback_count") or 0)
        has_confirmed_citation = bool(row.get("has_confirmed_citation") or False)

        cfg = get_runtime_config()
        w_usage = cfg.get_float("promotion_usage_weight", 0.4)
        w_feedback = cfg.get_float("promotion_feedback_weight", 0.4)
        w_citation = cfg.get_float("promotion_citation_weight", 0.2)
        threshold = cfg.get_float("promotion_threshold", 0.6)
        usage_cap = cfg.get_int("promotion_usage_cap", USAGE_CAP)
        feedback_cap = cfg.get_int("promotion_feedback_cap", FEEDBACK_CAP)

        usage_term = (min(usage_count, usage_cap) / usage_cap) if usage_cap > 0 else 0.0
        feedback_term = (
            (min(positive_feedback_count, feedback_cap) / feedback_cap)
            if feedback_cap > 0 else 0.0
        )
        citation_term = 1.0 if has_confirmed_citation else 0.0

        score = (
            w_usage * usage_term
            + w_feedback * feedback_term
            + w_citation * citation_term
        )

        if score < threshold:
            return False

        await graph_client.query(
            "MATCH (n:LiveSource {node_id: $node_id}) "
            "SET n.provenance = 'confirmed', n.trust = 1.0, n.promoted_at = $timestamp",
            {"node_id": node_id, "timestamp": datetime.now(timezone.utc).isoformat()},
        )
        log.info(
            "promotion.promoted",
            node_id=node_id,
            score=round(score, 3),
            usage_count=usage_count,
            positive_feedback_count=positive_feedback_count,
            has_confirmed_citation=has_confirmed_citation,
        )
        return True
    except Exception as exc:  # noqa: BLE001 - fully failure-isolated
        log.warning("promotion.promote_if_ready_failed", node_id=node_id, error=str(exc))
        return False


__all__ = [
    "bump_usage",
    "bump_positive_feedback",
    "promote_if_ready",
    "USAGE_CAP",
    "FEEDBACK_CAP",
]
