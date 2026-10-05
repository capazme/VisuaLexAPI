"""Rewrite the graph's labels in the source convention (adoption plan, PR 4).

Spec: docs/superpowers/specs/2026-10-04-source-convention-design.md §5. Labels are derived
from a node's key and properties, so this recomputes them and changes nothing else:

- a norm article's ``estremi`` → its short label ("art. 2043 c.c.", "art. 2 l. 241/1990");
  an article's ``titolo`` that only repeated its extremes ("Art. 2043 c.c.") is removed;
- an act's ``titolo`` → its act heading ("Codice civile", "l. 7 agosto 1990, n. 241"), its
  ``estremi`` (when it has one) → its act citation, its ``autorita_emanante`` → the
  authority of its type ("Re", not "Regio Decreto");
- a decision's ``estremi`` → its short label ("Cass. civ., sez. un., n. 31310/2024").

Keys are never touched: re-keying the malformed and legacy nodes is graph phase 2 (§5.3).
A node whose key the convention cannot read keeps its labels. Idempotent: a second run finds
nothing to change.

Dry run by default (counts and examples, no write). Writing waits for a window the
orchestrator gives, after scripts/backup.sh:

    docker compose -f infra/compose.yml exec merlt-api python -m merlt.scripts.backfill_source_labels
    docker compose -f infra/compose.yml exec merlt-api python -m merlt.scripts.backfill_source_labels --apply
"""
from __future__ import annotations

import argparse
import asyncio
import os
import re
from typing import Any, Iterable, Optional

import structlog

from merlt.pipeline.ingestion import _brocardi_decision_short
from merlt.utils.sources import act_heading, authority, cite_act, decision_node_estremi, norm_from_urn, short_from_urn

log = structlog.get_logger()

# Structural nodes of a code (libro, titolo, capo, sezione, parte): their `titolo` is the
# heading of that part, never an act's.
_STRUCTURE = {"libro", "parte", "titolo", "capo", "sezione", "comma"}
_DECISION_KEY = re.compile(r"(cassazione):(civile|penale):(\d+):(\d{4})|(corte_costituzionale):(\d+):(\d{4})")
_OLD_EXTREMES = re.compile(r"^Art\.\s")
# The only properties the backfill may remove.
_REMOVABLE = ("titolo", "autorita_emanante")


def _authority(norm: Optional[dict[str, Any]], props: dict[str, Any], changes: dict[str, Any],
               add_missing: bool) -> None:
    """The authority of the node's type; removed where the convention infers none (an act of
    the Union, an unknown type: "Unione Europea" and "Stato" were the old tables' guesses).
    An article gets it corrected only where it has one (`add_missing` False)."""
    who = authority(norm) if norm else None
    if not add_missing and not props.get("autorita_emanante"):
        return
    if who and props.get("autorita_emanante") != who:
        changes["autorita_emanante"] = who
    elif who is None and props.get("autorita_emanante"):
        changes["autorita_emanante"] = None


def plan_norm(props: dict[str, Any]) -> dict[str, Any]:
    """The label properties to change on one Norma node (``None`` removes a property).

    A stub keeps the one stub shape (key, article number, `estremi`, the flag): only its
    `estremi` are rewritten. A partition (libro, titolo, capo…: any `~` other than an
    article's) is left alone, whatever its `tipo_documento` says."""
    urn = props.get("URN")
    changes: dict[str, Any] = {}
    if not urn or str(props.get("tipo_documento") or "").lower() in _STRUCTURE:
        return changes
    tail = urn.split("~", 1)[1] if "~" in urn else ""
    if tail and not tail.startswith("art"):
        return changes
    if tail:
        short = short_from_urn(urn)
        if short and props.get("estremi") != short:
            changes["estremi"] = short
        if props.get("is_stub"):
            return changes
        titolo = props.get("titolo")
        if isinstance(titolo, str) and (titolo == props.get("estremi") or _OLD_EXTREMES.match(titolo)):
            changes["titolo"] = None
        _authority(norm_from_urn(urn), props, changes, add_missing=False)
        return changes
    if props.get("is_stub"):
        return changes
    norm = norm_from_urn(urn)
    if norm is None:
        return changes
    heading = act_heading(norm)
    if props.get("titolo") != heading:
        changes["titolo"] = heading
    if props.get("estremi") and props.get("estremi") != cite_act(norm):
        changes["estremi"] = cite_act(norm)
    _authority(norm, props, changes, add_missing=True)
    return changes


def plan_decision(props: dict[str, Any]) -> dict[str, Any]:
    """The ``estremi`` to write on one AttoGiudiziario node, if it changes."""
    key = props.get("node_id") or ""
    match = _DECISION_KEY.fullmatch(key)
    short: Optional[str] = None
    if match and match.group(1):
        short = decision_node_estremi({"corte": "cassazione", "archivio": match.group(2), "numero": match.group(3),
                                       "anno": match.group(4), "sezioni": props.get("sezioni")})
    elif match:
        short = decision_node_estremi({"corte": "corte_costituzionale", "numero": match.group(6),
                                       "anno": match.group(7)})
    elif key.startswith("massima_"):
        short = _brocardi_decision_short(str(props.get("organo_emittente") or ""),
                                         str(props.get("numero_sentenza") or ""), str(props.get("anno") or ""))
    return {"estremi": short} if short and props.get("estremi") != short else {}


def _chunks(rows: list, size: int = 500) -> Iterable[list]:
    for start in range(0, len(rows), size):
        yield rows[start:start + size]


async def run(apply: bool) -> dict[str, int]:
    from merlt.storage.graph.client import FalkorDBClient
    from merlt.storage.graph.config import FalkorDBConfig

    graph_name = os.getenv("FALKORDB_GRAPH_NAME") or os.getenv("FALKORDB_GRAPH") or "merl_t_legal"
    client = FalkorDBClient(FalkorDBConfig(), graph_name=graph_name)
    await client.connect()
    counts = {"norms_scanned": 0, "norms_changed": 0, "decisions_scanned": 0, "decisions_changed": 0}
    try:
        norms = await client.ro_query(
            "MATCH (n:Norma) WHERE n.URN IS NOT NULL RETURN id(n) AS id, n.URN AS URN, "
            "n.tipo_documento AS tipo_documento, n.estremi AS estremi, n.titolo AS titolo, "
            "n.autorita_emanante AS autorita_emanante, n.is_stub AS is_stub")
        decisions = await client.ro_query(
            "MATCH (d:AttoGiudiziario) RETURN id(d) AS id, d.node_id AS node_id, d.estremi AS estremi, "
            "d.sezioni AS sezioni, d.organo_emittente AS organo_emittente, "
            "d.numero_sentenza AS numero_sentenza, d.anno AS anno")
        rows: list[dict[str, Any]] = []
        for row in norms:
            changes = plan_norm(row)
            if changes:
                rows.append({"id": row["id"], "key": row["URN"], "changes": changes})
        counts["norms_scanned"], counts["norms_changed"] = len(norms), len(rows)
        for row in decisions:
            changes = plan_decision(row)
            if changes:
                rows.append({"id": row["id"], "key": row["node_id"], "changes": changes})
        counts["decisions_scanned"] = len(decisions)
        counts["decisions_changed"] = len(rows) - counts["norms_changed"]
        log.info("backfill_source_labels.plan", apply=apply, **counts,
                 examples=[r["changes"] for r in rows[:5]])
        if apply:
            # The node is matched by its id AND its key (an id is reused once a node is deleted).
            # A value to remove goes through REMOVE, never through a null in a map; the names
            # come from this script's own whitelist, never from data.
            match = "UNWIND $rows AS row MATCH (n) WHERE id(n) = row.id AND (n.URN = row.key OR n.node_id = row.key) "
            sets = [{"id": r["id"], "key": r["key"], "changes": {k: v for k, v in r["changes"].items() if v is not None}}
                    for r in rows]
            for chunk in _chunks([r for r in sets if r["changes"]]):
                await client.query(match + "SET n += row.changes", {"rows": chunk})
            for name in _REMOVABLE:
                gone = [{"id": r["id"], "key": r["key"]} for r in rows if name in r["changes"] and r["changes"][name] is None]
                for chunk in _chunks(gone):
                    await client.query(match + f"REMOVE n.{name}", {"rows": chunk})
    finally:
        await client.close()
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description="Rewrite the graph's labels in the source convention.")
    parser.add_argument("--apply", action="store_true", help="write the changes (default: dry run)")
    args = parser.parse_args()
    print(asyncio.run(run(apply=args.apply)))


if __name__ == "__main__":
    main()
