"""Provisional-node review adjudication (Loop β — Slice C wave 2).

The hygiene sweep (``pipeline/hygiene.quarantine_doubtful``) flags "doubtful"
provisional nodes — faded (old + stale + low-trust) yet carrying human signal
(feedback / re-use) — as ``review_status='pending_review'`` instead of pruning
them. This module is the human-adjudication surface for those nodes, reached via
``/merlt/valida``:

- ``list_pending_review`` — the flagged nodes + the signals that quarantined
  them, so a reviewer can decide.
- ``adjudicate_provisional`` — apply a decision to the EXISTING graph node:
  ``approve`` promotes it in place (``provenance='confirmed'``, ``trust=1.0``),
  ``reject`` deletes it (+ its Qdrant chunk).

Design note (why not reuse the ``pending_entities`` table / ``propose-entity``):
that pipeline creates a NEW FalkorDB entity on consensus-approval, which would
DUPLICATE a provisional node that is already in the graph. Adjudication instead
promotes/prunes the node that already exists — no new node, no duplicate.
"""

import structlog
from datetime import datetime, timezone
from typing import Any, Dict, List

from merlt.pipeline.provisional_writer import PROVENANCE_LIVE_UNCONFIRMED

log = structlog.get_logger()

PENDING_REVIEW = "pending_review"


async def list_pending_review(graph_client, *, limit: int = 100) -> List[Dict[str, Any]]:
    """Provisional nodes flagged for human review, newest first, with the
    signals that triggered quarantine."""
    rows = await graph_client.query(
        """
        MATCH (n:LiveSource)
        WHERE n.provenance = $prov AND n.review_status = $status
        RETURN n.node_id AS node_id, n.source_url AS source_url, n.text AS text,
               n.trust AS trust, n.usage_count AS usage_count,
               n.positive_feedback_count AS positive_feedback_count,
               n.has_confirmed_citation AS has_confirmed_citation,
               n.review_reason AS review_reason,
               n.review_flagged_at AS review_flagged_at,
               labels(n) AS labels
        ORDER BY n.review_flagged_at DESC
        LIMIT $limit
        """,
        {"prov": PROVENANCE_LIVE_UNCONFIRMED, "status": PENDING_REVIEW, "limit": int(limit)},
    )
    out: List[Dict[str, Any]] = []
    for r in (rows or []):
        d = dict(r)
        # trim the verbatim to a preview — the full text is not needed to decide
        # and keeps the list payload small.
        txt = d.get("text") or ""
        d["text_preview"] = (txt[:280] + "…") if len(txt) > 280 else txt
        d.pop("text", None)
        out.append(d)
    return out


async def adjudicate_provisional(
    graph_client, *, node_id: str, decision: str
) -> Dict[str, Any]:
    """Apply a human review decision to a flagged provisional node.

    ``approve`` -> promote in place (``provenance='confirmed'``, ``trust=1.0``,
    flag cleared). ``reject`` -> DETACH DELETE the node + drop its Qdrant chunk.
    A node not currently ``pending_review`` is a no-op (``applied=False``) — this
    guards against acting on an already-adjudicated / stale node id.
    """
    if decision not in ("approve", "reject"):
        raise ValueError(f"invalid decision: {decision!r}")

    guard = await graph_client.query(
        "MATCH (n:LiveSource {node_id: $id}) WHERE n.review_status = $status "
        "RETURN n.node_id AS node_id LIMIT 1",
        {"id": node_id, "status": PENDING_REVIEW},
    )
    if not guard:
        return {"applied": False, "reason": "not_pending", "node_id": node_id}

    ts = datetime.now(timezone.utc).isoformat()
    if decision == "approve":
        await graph_client.query(
            "MATCH (n:LiveSource {node_id: $id}) "
            "SET n.provenance = 'confirmed', n.trust = 1.0, n.promoted_at = $ts, "
            "n.review_status = 'approved', n.reviewed_at = $ts",
            {"id": node_id, "ts": ts},
        )
        log.info("review.approved", node_id=node_id)
        return {"applied": True, "decision": "approve", "node_id": node_id}

    # reject: remove the node and its chunk
    await graph_client.query(
        "MATCH (n:LiveSource {node_id: $id}) DETACH DELETE n",
        {"id": node_id},
    )
    try:
        from merlt.pipeline.provisional_writer import delete_provisional_chunk
        await delete_provisional_chunk(node_id)
    except Exception as exc:  # noqa: BLE001 - best-effort chunk cleanup
        log.debug("review.reject_chunk_delete_failed", node_id=node_id, error=str(exc))
    log.info("review.rejected", node_id=node_id)
    return {"applied": True, "decision": "reject", "node_id": node_id}


__all__ = ["list_pending_review", "adjudicate_provisional", "PENDING_REVIEW"]
