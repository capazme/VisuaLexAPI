"""Export the legacy MERL-T Libro IV graph (`merl_t_dev`) from the temporary
recovery FalkorDB on port 6383 into a portable JSON file.

Output schema:
  {
    "meta": { graph_name, exported_at, source, counts: { nodes, edges, labels: {..}, rel_types: {..} } },
    "nodes": [ { "id": <int>, "labels": [..], "properties": {..} }, ... ],
    "edges": [ { "id": <int>, "type": str, "start": <int>, "end": <int>, "properties": {..} }, ... ],
  }

Uses FalkorDB verbose query format (no --compact) which returns each
entity as a list of [name, value] pairs that are trivial to parse.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import redis

HOST = "localhost"
PORT = 6383
GRAPH = "merl_t_dev"
BATCH = 2000
OUT_PATH = Path(__file__).resolve().parents[1] / "data" / "seeds" / "libro-iv-cc-graph.json"


def query_rows(client: redis.Redis, cypher: str) -> list[list]:
    raw = client.execute_command("GRAPH.QUERY", GRAPH, cypher)
    if len(raw) < 2:
        return []
    return raw[1]


def entity_to_dict(entity_pairs: list) -> dict:
    """Convert FalkorDB verbose entity (list of [name, value] pairs) to dict."""
    out: dict = {}
    for pair in entity_pairs:
        if len(pair) != 2:
            continue
        key, value = pair[0], pair[1]
        if key == "properties" and isinstance(value, list):
            value = {p[0]: p[1] for p in value if len(p) == 2}
        out[key] = value
    return out


def main() -> None:
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    client = redis.Redis(host=HOST, port=PORT, decode_responses=True)

    nodes: list[dict] = []
    skip = 0
    while True:
        rows = query_rows(client, f"MATCH (n) RETURN n SKIP {skip} LIMIT {BATCH}")
        if not rows:
            break
        for row in rows:
            entity = entity_to_dict(row[0])
            nodes.append({
                "id": entity.get("id"),
                "labels": entity.get("labels", []),
                "properties": entity.get("properties", {}),
            })
        if len(rows) < BATCH:
            break
        skip += BATCH
        if skip % 10000 == 0:
            print(f"  nodes: {skip}...")

    print(f"nodes done: {len(nodes)}")

    edges: list[dict] = []
    skip = 0
    while True:
        rows = query_rows(client, f"MATCH (a)-[r]->(b) RETURN r SKIP {skip} LIMIT {BATCH}")
        if not rows:
            break
        for row in rows:
            entity = entity_to_dict(row[0])
            edges.append({
                "id": entity.get("id"),
                "type": entity.get("type"),
                "start": entity.get("src_node"),
                "end": entity.get("dest_node"),
                "properties": entity.get("properties", {}),
            })
        if len(rows) < BATCH:
            break
        skip += BATCH
        if skip % 10000 == 0:
            print(f"  edges: {skip}...")

    print(f"edges done: {len(edges)}")

    label_counts: dict[str, int] = {}
    for n in nodes:
        for lbl in n["labels"]:
            label_counts[lbl] = label_counts.get(lbl, 0) + 1
    rel_counts: dict[str, int] = {}
    for e in edges:
        rel_counts[e["type"]] = rel_counts.get(e["type"], 0) + 1

    payload = {
        "meta": {
            "graph_name": GRAPH,
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "source": "ALIS_CORE/merlt/data/falkordb (EXP-014 + post-experiment edits up to Mar 2026)",
            "scope": "Codice Civile, Libro IV (artt. 1173-2059)",
            "counts": {
                "nodes": len(nodes),
                "edges": len(edges),
                "labels": dict(sorted(label_counts.items(), key=lambda x: -x[1])),
                "rel_types": dict(sorted(rel_counts.items(), key=lambda x: -x[1])),
            },
        },
        "nodes": nodes,
        "edges": edges,
    }

    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"wrote {OUT_PATH} ({OUT_PATH.stat().st_size / 1024 / 1024:.1f} MB)")


if __name__ == "__main__":
    main()
