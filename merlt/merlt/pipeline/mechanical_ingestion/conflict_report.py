"""Read-only conflict report for a staged mechanical-ingestion batch.

Computed BEFORE the batch is written anywhere durable (design doc §5) and
re-computed at promote time (the graph may have moved during the review
window). Every FalkorDB access here is a read (`MATCH`) — the graph is never
touched by this module.
"""

from __future__ import annotations

from collections import Counter
from typing import Any, Optional

import structlog

from merlt.pipeline.ingestion import _canonical_urn

log = structlog.get_logger()


async def fetch_existing_norma_props(falkordb, urns: set[str]) -> dict[str, dict[str, Any]]:
    """Return `{urn: {estremi, tipo_documento}}` for every URN already in the
    graph as a `Norma` node. URNs absent from the graph are absent from the
    returned dict — presence of the key IS the existence signal.
    """
    urns = {u for u in urns if u}
    if not urns:
        return {}
    rows = await falkordb.query(
        "MATCH (n:Norma) WHERE n.URN IN $urns "
        "RETURN n.URN AS urn, n.estremi AS estremi, n.tipo_documento AS tipo_documento",
        {"urns": list(urns)},
    )
    out: dict[str, dict[str, Any]] = {}
    for row in rows or []:
        urn = row.get("urn")
        if not urn:
            continue
        out[urn] = {"estremi": row.get("estremi"), "tipo_documento": row.get("tipo_documento")}
    return out


async def build_conflict_report(
    falkordb,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    *,
    expected_count: Optional[int] = None,
) -> dict[str, Any]:
    """Build the §5 conflict report for a batch's `{nodes, edges}`.

    Returns a dict with keys `urn_conflicts`, `node_updates`, `node_new`,
    `orphan_edges`, `duplicates`, `coverage` — see design doc §5.

    URNs are canonicalized (`_canonical_urn` — strips only the NIR `!vig=`/
    `!orig=` version marker, keeps the `:N` annex) before every graph lookup
    and set-membership check, on BOTH the batch side and the edge-endpoint
    side. Without this, a batch URN carrying `!vig=` (or any future adapter
    that emits one) would never match the graph's marker-less key, and the
    join would silently misreport a live node as `node_new` instead of
    `node_updates`/`urn_conflicts`.
    """
    batch_urns_list = [
        _canonical_urn(n.get("properties", {}).get("URN"))
        for n in nodes
        if n.get("properties", {}).get("URN")
    ]
    urn_counts = Counter(batch_urns_list)
    duplicates = sorted(urn for urn, count in urn_counts.items() if count > 1)
    batch_urns = set(batch_urns_list)

    existing = await fetch_existing_norma_props(falkordb, batch_urns)

    urn_conflicts: list[dict[str, Any]] = []
    node_updates: list[str] = []
    node_new: list[str] = []
    for n in nodes:
        props = n.get("properties", {})
        raw_urn = props.get("URN")
        if not raw_urn:
            continue
        urn = _canonical_urn(raw_urn)
        live = existing.get(urn)
        if live is None:
            node_new.append(urn)
            continue
        node_updates.append(urn)
        batch_estremi = props.get("estremi")
        batch_tipo = props.get("tipo_documento")
        estremi_conflict = bool(
            batch_estremi and live.get("estremi") and batch_estremi != live.get("estremi")
        )
        tipo_conflict = bool(
            batch_tipo and live.get("tipo_documento") and batch_tipo != live.get("tipo_documento")
        )
        if estremi_conflict or tipo_conflict:
            urn_conflicts.append(
                {
                    "urn": urn,
                    "batch": {"estremi": batch_estremi, "tipo_documento": batch_tipo},
                    "graph": {
                        "estremi": live.get("estremi"),
                        "tipo_documento": live.get("tipo_documento"),
                    },
                }
            )

    # Orphan edges: endpoint neither in the batch nor already in the graph.
    # Comparisons run on canonicalized URNs (same reasoning as above); the
    # report itself still surfaces the RAW endpoint strings so the admin
    # sees exactly what the batch produced.
    external_endpoints = {
        _canonical_urn(e.get(side))
        for e in edges
        for side in ("start", "end")
        if _canonical_urn(e.get(side)) not in batch_urns
    }
    external_endpoints.discard(None)
    existing_external = await fetch_existing_norma_props(falkordb, external_endpoints)

    orphan_edges: list[dict[str, Any]] = []
    for e in edges:
        start, end = _canonical_urn(e.get("start")), _canonical_urn(e.get("end"))
        start_ok = start in batch_urns or start in existing_external
        end_ok = end in batch_urns or end in existing_external
        if not start_ok or not end_ok:
            orphan_edges.append(
                {"start": e.get("start"), "end": e.get("end"), "type": e.get("type")}
            )

    coverage: Optional[dict[str, Any]] = None
    if expected_count:
        extracted = len(nodes)
        coverage = {
            "expected": expected_count,
            "extracted": extracted,
            "coverage_pct": round(extracted / expected_count * 100, 2),
        }

    stats = {
        "nodes_total": len(nodes),
        "nodes_new": len(node_new),
        "nodes_update": len(node_updates),
        "edges_total": len(edges),
        "edges_new": len(edges) - len(orphan_edges),
        "edges_orphan": len(orphan_edges),
        "duplicates": len(duplicates),
        "coverage_pct": coverage["coverage_pct"] if coverage else None,
    }

    report = {
        "urn_conflicts": urn_conflicts,
        "node_updates": node_updates,
        "node_new": node_new,
        "orphan_edges": orphan_edges,
        "duplicates": duplicates,
        "coverage": coverage,
        "stats": stats,
    }
    log.info(
        "conflict_report.built",
        urn_conflicts=len(urn_conflicts),
        node_new=len(node_new),
        node_updates=len(node_updates),
        orphan_edges=len(orphan_edges),
        duplicates=len(duplicates),
    )
    return report


__all__ = ["build_conflict_report", "fetch_existing_norma_props"]
