"""Cross-check integrity of the legacy Libro IV seed.

Verifies:
  A. bridge_table.graph_node_urn  ->  must match a node in libro-iv-cc-graph.json
                                       (key: properties.URN | properties.node_id)
  B. bridge_table.chunk_id        ->  must exist as point in the Qdrant snapshot
                                       (running on localhost:6345, collection
                                        merl_t_dev_chunks)
  C. graph node URN/node_id       ->  is there a bridge mapping for it?
                                       (acceptable orphans: AttoGiudiziario,
                                        Dottrina, ConcettoGiuridico — bridge is
                                        chunk-anchored, not entity-anchored)

Reads bridge_table from the COPY block in bridge-table-data.sql, no DB needed.
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
GRAPH_JSON = ROOT / "data" / "seeds" / "libro-iv-cc-graph.json"
BRIDGE_SQL = ROOT / "data" / "seeds" / "postgres-dumps" / "bridge-table-data.sql"
QDRANT_URL = "http://localhost:6345"
QDRANT_COLLECTION = "merl_t_dev_chunks"
SCROLL_BATCH = 5000


def load_graph_urns() -> tuple[set[str], dict[str, set[str]]]:
    """Return (all_urns_or_node_ids, label_to_urns)."""
    data = json.loads(GRAPH_JSON.read_text())
    by_label: dict[str, set[str]] = defaultdict(set)
    all_keys: set[str] = set()
    for n in data["nodes"]:
        props = n.get("properties", {}) or {}
        key = props.get("URN") or props.get("node_id")
        if not key:
            continue
        all_keys.add(key)
        for lbl in n.get("labels", []):
            by_label[lbl].add(key)
    return all_keys, by_label


def parse_bridge_copy() -> list[tuple[str, str, str]]:
    """Yield (chunk_id, graph_node_urn, node_type) from the bridge dump.

    The file is a pg_dump COPY block:
      COPY public.bridge_table (id, chunk_id, chunk_text, graph_node_urn,
                                node_type, relation_type, ...) FROM stdin;
      <tab-separated rows>
      \\.
    """
    rows: list[tuple[str, str, str]] = []
    inside = False
    header_cols: list[str] = []
    with BRIDGE_SQL.open() as f:
        for line in f:
            if not inside:
                m = re.match(r"COPY public\.bridge_table \(([^)]+)\) FROM stdin", line)
                if m:
                    header_cols = [c.strip() for c in m.group(1).split(",")]
                    inside = True
                continue
            if line.startswith("\\."):
                break
            parts = line.rstrip("\n").split("\t")
            if len(parts) != len(header_cols):
                continue
            record = dict(zip(header_cols, parts))
            rows.append((record["chunk_id"], record["graph_node_urn"], record["node_type"]))
    return rows


def fetch_qdrant_chunk_ids() -> set[str]:
    ids: set[str] = set()
    offset = None
    while True:
        body = {
            "limit": SCROLL_BATCH,
            "with_payload": ["article_urn"],
            "with_vector": False,
        }
        if offset is not None:
            body["offset"] = offset
        r = requests.post(
            f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}/points/scroll",
            json=body,
            timeout=30,
        )
        r.raise_for_status()
        payload = r.json()["result"]
        for pt in payload["points"]:
            ids.add(str(pt["id"]))
        offset = payload.get("next_page_offset")
        if not offset:
            break
    return ids


def main() -> None:
    print("== Loading graph JSON …")
    graph_keys, by_label = load_graph_urns()
    print(f"   {len(graph_keys)} unique URN/node_id keys across {len(by_label)} labels")

    print("== Parsing bridge COPY block …")
    bridge_rows = parse_bridge_copy()
    print(f"   {len(bridge_rows)} bridge records")

    print("== Scrolling Qdrant point ids …")
    qdrant_ids = fetch_qdrant_chunk_ids()
    print(f"   {len(qdrant_ids)} points in Qdrant")

    # --- A. bridge.graph_node_urn → graph ---
    bridge_urns = {urn for _, urn, _ in bridge_rows}
    a_orphans = bridge_urns - graph_keys
    a_orphans_per_type: dict[str, int] = defaultdict(int)
    for _, urn, ntype in bridge_rows:
        if urn in a_orphans:
            a_orphans_per_type[ntype] += 1

    # --- B. bridge.chunk_id → qdrant ---
    bridge_chunks = {cid for cid, _, _ in bridge_rows}
    b_orphans = bridge_chunks - qdrant_ids
    qdrant_only = qdrant_ids - bridge_chunks

    # --- C. graph nodes without bridge mapping ---
    nodes_with_bridge = bridge_urns & graph_keys
    c_unmapped_per_label: dict[str, tuple[int, int]] = {}
    for lbl, keys in by_label.items():
        mapped = len(keys & nodes_with_bridge)
        c_unmapped_per_label[lbl] = (mapped, len(keys))

    print()
    print("== A. Bridge URN → Graph ==")
    print(f"   bridge has {len(bridge_urns)} distinct URNs")
    print(f"   matched in graph: {len(bridge_urns & graph_keys)}")
    print(f"   orphans (bridge points to non-existent graph node): {len(a_orphans)}")
    if a_orphans_per_type:
        print("   by node_type:")
        for nt, c in sorted(a_orphans_per_type.items(), key=lambda x: -x[1]):
            print(f"     {nt:30} {c}")

    print()
    print("== B. Bridge chunk_id → Qdrant ==")
    print(f"   bridge has {len(bridge_chunks)} distinct chunk_ids")
    print(f"   matched in qdrant: {len(bridge_chunks & qdrant_ids)}")
    print(f"   orphans (bridge points to non-existent qdrant point): {len(b_orphans)}")
    print(f"   qdrant-only (points without bridge mapping): {len(qdrant_only)}")

    print()
    print("== C. Graph nodes with bridge mapping ==")
    print("   (per label: mapped / total)")
    for lbl in sorted(c_unmapped_per_label.keys()):
        mapped, total = c_unmapped_per_label[lbl]
        pct = 100 * mapped / total if total else 0
        print(f"   {lbl:30} {mapped:>6}/{total:<6} ({pct:5.1f}%)")


if __name__ == "__main__":
    main()
