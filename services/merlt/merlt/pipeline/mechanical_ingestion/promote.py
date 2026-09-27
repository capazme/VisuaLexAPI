"""Promotion of a staged mechanical-ingestion batch into FalkorDB.

The only place in this package that writes to the graph — and only after an
admin has approved the batch. See design doc §5-6 and
`merlt.pipeline.mechanical_ingestion.conflict_report` for the read-only gate.
"""

from __future__ import annotations

from typing import Any

import structlog

from merlt.pipeline.mechanical_ingestion.conflict_report import (
    build_conflict_report,
    fetch_existing_norma_props,
)

log = structlog.get_logger()


class PromotionBlockedError(Exception):
    """Raised when a batch has unresolved `urn_conflicts` and `force` was not passed."""

    def __init__(self, conflict_report: dict[str, Any]):
        self.conflict_report = conflict_report
        super().__init__(
            f"promotion blocked: {len(conflict_report.get('urn_conflicts', []))} urn_conflicts "
            "(pass force=True to override)"
        )


def _sanitize_batch_nodes(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Strip `None`-valued properties before merge.

    `_merge_nodes` runs `SET x += $props`, and Cypher's `+=` operator treats
    a property value of `null` as "remove this property" — a sparse batch
    node (e.g. a parser that never filled `rubrica`) would otherwise NULL OUT
    an already-populated live property instead of leaving it untouched.
    Applied only at promote time on a copy; never mutates the staged
    `batch.nodes` blob (`_build_id_to_key` still runs against the original
    nodes, which is safe since a missing key field just drops the node).
    """
    sanitized: list[dict[str, Any]] = []
    for n in nodes:
        props = n.get("properties") or {}
        clean_props = {k: v for k, v in props.items() if v is not None}
        sanitized.append({**n, "properties": clean_props})
    return sanitized


async def promote_batch(
    falkordb,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    *,
    force: bool = False,
) -> dict[str, Any]:
    """MERGE a staged batch into FalkorDB.

    Re-computes the conflict report against the CURRENT graph state (a batch
    may sit in `pending_review` for up to 14 days, so the report computed at
    staging time can be stale) and refuses to promote if `urn_conflicts` is
    non-empty and `force` is not set — raises `PromotionBlockedError`.

    Reuses the seed loader's idempotent MERGE helpers
    (`_build_id_to_key` / `_merge_nodes` / `_merge_edges`) unmodified.
    """
    from merlt.scripts.load_seed_libro_iv import _build_id_to_key, _merge_nodes, _merge_edges

    conflict_report = await build_conflict_report(falkordb, nodes, edges)
    if conflict_report["urn_conflicts"] and not force:
        raise PromotionBlockedError(conflict_report)

    id_to_key = _build_id_to_key(nodes)

    # RINVIA edges may target an article outside this batch (e.g. a citation
    # to another act already in the graph). `_build_id_to_key` only knows
    # this batch's own nodes, so an external-but-already-in-graph target
    # would otherwise be dropped by `_merge_edges` as if it were an orphan.
    # Resolve those endpoints read-only and register them as extra
    # id_to_key entries WITHOUT creating a stub node: `_merge_edges`'s Cypher
    # MATCHes the existing node by key, it never creates one.
    batch_ids = set(id_to_key.keys())
    external_endpoints = {
        e.get(side) for e in edges for side in ("start", "end") if e.get(side) not in batch_ids
    }
    external_endpoints.discard(None)
    existing_external = await fetch_existing_norma_props(falkordb, external_endpoints)
    for urn in existing_external:
        id_to_key[urn] = {"key": urn, "label": "Norma", "key_field": "URN"}

    nodes_merged = await _merge_nodes(falkordb, _sanitize_batch_nodes(nodes), id_to_key)
    edges_merged, edges_skipped = await _merge_edges(falkordb, edges, id_to_key)

    log.info(
        "mechanical_ingestion.promoted",
        nodes_merged=nodes_merged,
        edges_merged=edges_merged,
        edges_skipped=edges_skipped,
        forced=force,
    )
    return {
        "nodes_merged": nodes_merged,
        "edges_merged": edges_merged,
        "edges_skipped": edges_skipped,
        "conflict_report": conflict_report,
    }


__all__ = ["PromotionBlockedError", "promote_batch"]
