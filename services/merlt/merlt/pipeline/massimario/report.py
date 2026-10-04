# services/merlt/merlt/pipeline/massimario/report.py
"""What the graph already holds, added to a Massimario batch's report at staging time."""
from __future__ import annotations

from merlt.storage.graph.schema import Label

_NORMS = "MATCH (n:Norma) WHERE n.URN IN $ids RETURN count(n) AS c"
_DECISIONS = "MATCH (d:AttoGiudiziario) WHERE d.node_id IN $ids RETURN count(d) AS c"
_CHUNK = 1000


async def _count(falkordb, cypher: str, ids: list[str]) -> int:
    total = 0
    for i in range(0, len(ids), _CHUNK):
        rows = await falkordb.query(cypher, {"ids": ids[i:i + _CHUNK]})
        total += int(rows[0]["c"]) if rows else 0
    return total


async def add_graph_counts(falkordb, nodes: list[dict], report: dict) -> None:
    urns = [n["id"] for n in nodes if n["labels"][0] == Label.NORMA.value]
    keys = [n["id"] for n in nodes if n["labels"][0] == Label.ATTO_GIUDIZIARIO.value]
    norms = await _count(falkordb, _NORMS, urns)
    decisions = await _count(falkordb, _DECISIONS, keys)
    report["massimario"]["norme"]["gia_nel_grafo"] = norms
    report["massimario"]["pronunce"]["gia_nel_grafo"] = decisions
    stats = report["stats"]
    stats["nodes_update"] = norms + decisions
    stats["nodes_new"] = stats["nodes_total"] - stats["nodes_update"]
