# services/merlt/merlt/pipeline/massimario/promote.py
"""Graph writes for a Massimario batch (spec §5.2–5.4).

Decisions: MERGE by `node_id`; their lists (`sezioni`, `rv`, `anni_rassegna`)
become unions with what the graph holds, and facts already present (rapporteur,
hearing date, source, provenance) are kept. Norm stubs: created only if missing
(`ON CREATE`), never written over a complete article. Co-citation edges: one per
(decision, norm) across every volume (spec 5.4), keyed by `_mass_key`; their years
and volumes are unions and their paragraphs are counted per volume, so a re-run of
a volume rewrites its own share. None values never reach FalkorDB:
`SET x += {k: null}` deletes `k`.
"""
from __future__ import annotations

from typing import Optional

from merlt.storage.graph.schema import Label

_ROWS = 500
_EXISTING = (
    "MATCH (d:AttoGiudiziario) WHERE d.node_id IN $keys "
    "RETURN d.node_id AS k, d.sezioni AS sezioni, d.rv AS rv, d.anni_rassegna AS anni_rassegna, "
    "d.relatore AS relatore, d.data_udienza AS data_udienza, d.fonte AS fonte, d.provenance AS provenance"
)
_EXISTING_EDGES = (
    "UNWIND $rows AS row "
    "MATCH (:AttoGiudiziario {node_id: row.s})-[r:INTERPRETA {_mass_key: row.k}]->(:Norma {URN: row.t}) "
    "RETURN row.k AS k, r.anni_rassegna AS anni_rassegna, r.volumi AS volumi, "
    "r.paragrafi_per_volume AS paragrafi_per_volume"
)
_MERGE_DECISIONS = "UNWIND $rows AS row MERGE (d:AttoGiudiziario {node_id: row.k}) SET d += row.props"
_MERGE_STUBS = "UNWIND $rows AS row MERGE (n:Norma {URN: row.k}) ON CREATE SET n += row.props"
_MERGE_EDGES = (
    "UNWIND $rows AS row "
    "MATCH (d:AttoGiudiziario {node_id: row.s}) MATCH (n:Norma {URN: row.t}) "
    "MERGE (d)-[r:INTERPRETA {_mass_key: row.k}]->(n) SET r += row.props"
)
_LISTS = ("sezioni", "rv", "anni_rassegna")
_KEEP = ("relatore", "data_udienza", "fonte", "provenance")


def _clean(props: dict) -> dict:
    return {k: v for k, v in props.items() if v is not None}


def merge_decision_props(existing: Optional[dict], new: dict) -> dict:
    props = dict(new)
    if existing:
        for name in _LISTS:
            merged = list(existing.get(name) or [])
            merged += [v for v in new.get(name) or [] if v not in merged]
            props[name] = sorted(merged) if name == "anni_rassegna" else merged
        for name in _KEEP:
            if existing.get(name):
                props[name] = existing[name]
    return _clean(props)


def merge_edge_props(existing: Optional[dict], new: dict) -> dict:
    """A co-citation edge's properties with what an earlier volume wrote: years and
    volumes as unions, the paragraph count of each volume replaced by this batch's."""
    props = dict(new)
    if existing:
        props["anni_rassegna"] = sorted(set(existing.get("anni_rassegna") or []) | set(new.get("anni_rassegna") or []))
        props["volumi"] = sorted(set(existing.get("volumi") or []) | set(new.get("volumi") or []))
        shares = dict(entry.split(":", 1) for entry in existing.get("paragrafi_per_volume") or [])
        shares.update(entry.split(":", 1) for entry in new.get("paragrafi_per_volume") or [])
        props["paragrafi_per_volume"] = [f"{volume}:{count}" for volume, count in sorted(shares.items(), key=lambda s: int(s[0]))]
        props["paragrafi"] = sum(int(count) for count in shares.values())
    return _clean(props)


def _chunks(rows: list) -> list[list]:
    return [rows[i:i + _ROWS] for i in range(0, len(rows), _ROWS)]


async def promote_massimario_graph(falkordb, nodes: list[dict], edges: list[dict]) -> dict:
    decisions = [n for n in nodes if n["labels"][0] == Label.ATTO_GIUDIZIARIO.value]
    stubs = [n for n in nodes if n["labels"][0] == Label.NORMA.value]
    existing: dict[str, dict] = {}
    for keys in _chunks([d["id"] for d in decisions]):
        for row in await falkordb.query(_EXISTING, {"keys": keys}):
            existing[row["k"]] = row
    keyed_edges = [{"s": e["start"], "t": e["end"], "k": e["properties"]["_mass_key"]} for e in edges]
    existing_edges: dict[str, dict] = {}
    for rows in _chunks(keyed_edges):
        for row in await falkordb.query(_EXISTING_EDGES, {"rows": rows}):
            existing_edges[row["k"]] = row
    decision_rows = [{"k": d["id"], "props": merge_decision_props(existing.get(d["id"]), d["properties"])}
                     for d in decisions]
    stub_rows = [{"k": s["id"], "props": _clean(s["properties"])} for s in stubs]
    edge_rows = [{**keyed, "props": merge_edge_props(existing_edges.get(keyed["k"]), e["properties"])}
                 for keyed, e in zip(keyed_edges, edges)]
    for query, rows in ((_MERGE_DECISIONS, decision_rows), (_MERGE_STUBS, stub_rows), (_MERGE_EDGES, edge_rows)):
        for chunk in _chunks(rows):
            await falkordb.query(query, {"rows": chunk})
    return {"nodes_merged": len(decision_rows) + len(stub_rows), "edges_merged": len(edge_rows), "edges_skipped": 0}
