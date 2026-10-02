"""Migrate the MERL-T graph and its vectors to the schema's vocabulary.

Dry run by default: it reads and reports. `--apply` writes. Idempotent: a second
run changes nothing; what it only reports (twins, a key two nodes would share, the
integrity checks) it reports again. It creates the schema's indexes, in FalkorDB
and Qdrant, before it migrates. Run `scripts/backup.sh` first, and
`merlt.scripts.retrieval_gate` before and after `--apply`.
Design: docs/superpowers/specs/2026-09-30-merlt-graph-structure-design.md, §4.4.

    python -m merlt.scripts.migrate_graph_vocabulary            # report
    python -m merlt.scripts.migrate_graph_vocabulary --apply    # write

Every label, relation and indexed property name in the Cypher text below comes from
the code's own sets (`Label`, `Rel`, `LEGACY_REL`, `LEGACY_ENTITY_LABELS`,
`GRAPH_INDEXES`), never from the data;
every value read from the graph goes back in as a parameter; the one number in the
text, the batch size, is an integer checked against `MAX_BATCH`.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import structlog

from merlt.pipeline.enrichment.models import EntityType
from merlt.storage.graph import FalkorDBClient
from merlt.storage.graph.entity_writer import normalize_entity_name, seed_twin_slugs
from merlt.storage.graph.relation_endpoints import wrapped_norm_key
from merlt.storage.graph.schema import (
    BOOLEAN_PROPERTIES,
    GRAPH_INDEXES,
    LEGACY_REL,
    LEGACY_SOURCE_TYPE,
    QDRANT_PAYLOAD_INDEXES,
    SEED_TWIN,
    Label,
    Provenance,
    Rel,
    act_name_from_urn,
    boolean_flag,
    canonical_urn,
    certezza_number,
    entity_label,
    estremi_from_urn,
    normalize_fonte,
    point_id,
    stub_properties,
    text_fingerprint,
    version_urn,
)

log = structlog.get_logger()

# The batch size is written into Cypher (`LIMIT n`): an integer in this range, or refused.
MAX_BATCH = 10_000

# Every label that carries content; community entities and live sources stamp their own provenance.
PROVENANCE_LABELS = [label for label in Label if label not in (Label.ENTITY, Label.LIVE_SOURCE)]
# The stub flag as the writers left it: the Libro IV seed writes it as the string 'true'
# (469 stubs), on which a boolean test is a type error and `= true` is false.
_STUB_FLAG = "coalesce(n.is_stub IN [true, 'true'], false)"
_PLACEHOLDER = "(n.tipo_documento IS NULL AND n.testo IS NULL AND n.testo_vigente IS NULL)"
_STUB_WHERE = f"({_STUB_FLAG} OR {_PLACEHOLDER})"
# A stub among nodes of any label: a Norma that is no community entity and passes the test.
_STUB_NODE = f"(n:Norma AND NOT n:Entity AND {_STUB_WHERE})"
# What a stub candidate may carry that its shape would drop and nothing can rebuild: such
# a node is reported, never reshaped (`url` follows from the URN, so it may go).
_STUB_CONTENT = ("testo", "testo_vigente", "text", "titolo", "rubrica")

# Every label the writer before Task 4 could give a community entity: `tipo.capitalize()`.
# A fixed set from the code; a label name is never read from a node.
LEGACY_ENTITY_LABELS: tuple[str, ...] = tuple(sorted({t.value.capitalize() for t in EntityType}))

# Provenance values written before this round, and the schema value each one means.
LEGACY_PROVENANCE: dict[str, Provenance] = {"lazy_ingest": Provenance.INGESTION}


def _batch_size(batch: Any) -> int:
    if isinstance(batch, bool) or not isinstance(batch, int) or not 1 <= batch <= MAX_BATCH:
        raise ValueError(f"batch must be an integer from 1 to {MAX_BATCH}, got {batch!r}")
    return batch


def _chunks(items: list, size: int) -> Iterable[list]:
    for start in range(0, len(items), size):
        yield items[start:start + size]


async def _count(client, cypher: str, params: dict | None = None) -> int:
    rows = await client.query(cypher, params or {})
    return int(rows[0]["n"]) if rows else 0


async def _norma_holds(client, key: str) -> bool:
    return bool(await _count(client, "MATCH (m:Norma {URN: $u}) RETURN count(m) AS n", {"u": key}))


# A community entity's link to its live source was written CITA; it is DERIVA_DA.
_LIVE_SOURCE_LINK = "a:Entity AND b:LiveSource"


async def collapsed_relations(client) -> dict[str, dict[str, int]]:
    """Pairs of nodes where the rename leaves one edge for several: two legacy edges
    of one name, or of two names that end in one canonical type (`cita` and `richiama`
    are both RINVIA), or a legacy edge next to one already written under the canonical
    name. MERGE keeps the properties of the first edge only. Read before the rename,
    in a dry run as on --apply, and never merged here: the controller reads the
    count and decides. A pair counts only while it still has a legacy edge, so a
    second run reports nothing."""
    groups: dict[Rel, list[str]] = {}
    for old, new in LEGACY_REL.items():
        groups.setdefault(new, []).append(old)
    plans = [(Rel.DERIVA_DA, ["CITA"], f"WHERE {_LIVE_SOURCE_LINK}")]
    plans += [
        (new, olds, f"WHERE NOT ({_LIVE_SOURCE_LINK} AND type(r) = 'CITA')" if "CITA" in olds else "WHERE true")
        for new, olds in groups.items()
    ]
    report: dict[str, dict[str, int]] = {}
    for new, olds, where in plans:
        rows = await client.query(
            f"MATCH (a)-[r]->(b) {where} AND type(r) IN $names "
            "WITH a, b, count(r) AS n, sum(CASE WHEN type(r) IN $legacy THEN 1 ELSE 0 END) AS old "
            "WHERE n > 1 AND old > 0 RETURN count(*) AS pairs, sum(n) AS edges",
            {"names": [new.value, *olds], "legacy": olds},
        )
        pairs = int(rows[0]["pairs"] or 0) if rows else 0
        if pairs:
            report[new.value] = {"pairs": pairs, "edges": int(rows[0]["edges"])}
    return report


async def rename_relations(client, apply: bool, batch: int) -> dict[str, int]:
    """FalkorDB cannot rename a relation type: each legacy edge is merged into its
    canonical type, then deleted — in batches, one statement each (atomic per batch).

    MERGE, not CREATE: between the merge of pull requests A and B and `--apply`,
    the new writers may already have linked the same two nodes under the new name.
    That edge stays as it is, with its own properties; a new edge takes the legacy
    edge's properties; the legacy edge goes in every case. Two legacy edges of one
    type between the same two nodes leave one: the second meets the edge the first
    merged (`collapsed_relations` counts those pairs first)."""
    plans = [("CITA", Rel.DERIVA_DA, f"WHERE {_LIVE_SOURCE_LINK}", "CITA→DERIVA_DA")]
    plans += [
        (old, new, f"WHERE NOT ({_LIVE_SOURCE_LINK})" if old == "CITA" else "", old)
        for old, new in LEGACY_REL.items()
    ]
    report: dict[str, int] = {}
    for old, new, where, key in plans:
        match = f"MATCH (a)-[r:`{old}`]->(b) {where}"
        count = await _count(client, f"{match} RETURN count(r) AS n")
        if not count:
            continue
        report[key] = count
        while apply:
            moved = await _count(
                client,
                f"{match} WITH a, r, b LIMIT {batch} "
                f"MERGE (a)-[nr:`{new.value}`]->(b) ON CREATE SET nr = properties(r) "
                "DELETE r RETURN count(*) AS n",
            )
            if not moved:
                break
    return report


async def drop_legacy_entity_labels(client, apply: bool) -> dict[str, int]:
    """A community entity loses the `tipo.capitalize()` label the old writer gave it,
    unless that is the schema label of its kind (`Sanzione`, `Caso`, `Dottrina`...).
    Runs before every step that matches `Norma`: a community `norma` entity written
    `:Entity:Norma` is no norm."""
    report: dict[str, int] = {}
    for row in await client.query("MATCH (e:Entity) WHERE e.tipo IS NOT NULL RETURN DISTINCT e.tipo AS tipo"):
        tipo = row["tipo"]
        if not isinstance(tipo, str):
            continue
        keep = entity_label(tipo)
        for legacy in LEGACY_ENTITY_LABELS:
            if keep is not None and legacy == keep.value:
                continue
            match = f"MATCH (e:Entity:`{legacy}`) WHERE e.tipo = $tipo"
            count = await _count(client, f"{match} RETURN count(e) AS n", {"tipo": tipo})
            if not count:
                continue
            report[legacy] = report.get(legacy, 0) + count
            if apply:
                await client.query(f"{match} REMOVE e:`{legacy}`", {"tipo": tipo})
    return report


async def wrap_bare_keys(client, apply: bool, renames: dict[int, tuple[str, str]] | None = None) -> dict[str, Any]:
    """A Norma keyed by a bare `urn:nir:` URN is unreachable: the graph keys a norm by
    its full Normattiva URL (the seed does). The key becomes that URL when no node
    holds it; when one does, the bare key is reported (two nodes for one norm:
    merging them is a decision, and FalkorDB has no APOC). So is a bare key with a
    version marker: cut, it would take the article's key, and the node is no article.
    Two bare keys that wrap to one URL: the first takes it, the second is reported,
    in a dry run as on --apply. Versions are `rekey_versions`' job. Each key it gives
    is recorded in `renames` (node id -> (old, new)), for `unify_stubs` to see in a dry
    run the key --apply will have written."""
    rows = await client.query(
        "MATCH (n:Norma) WHERE n.URN STARTS WITH 'urn:nir:' "
        "AND coalesce(n.tipo_documento, '') <> 'versione_storica' RETURN id(n) AS id, n.URN AS urn ORDER BY id"
    )
    wrapped, reported = 0, []
    taken: set[str] = set()
    for row in rows:
        url = wrapped_norm_key(row["urn"])
        new = canonical_urn(url)
        if new != url or new in taken or await _norma_holds(client, new):
            reported.append(row["urn"])
            continue
        taken.add(new)
        wrapped += 1
        if renames is not None:
            renames[row["id"]] = (row["urn"], new)
        if apply:
            await client.query(
                "MATCH (n) WHERE id(n) = $id SET n.URN = $new, "
                "n.node_id = CASE WHEN n.node_id IS NULL OR n.node_id = $old THEN $new ELSE n.node_id END",
                {"id": row["id"], "old": row["urn"], "new": new},
            )
    return {"wrapped": wrapped, "reported": sorted(reported)}


async def rekey_versions(client, apply: bool) -> dict[str, Any]:
    """Past versions (multivigenza). Before Task 1b the writer keyed one
    `<URN>!vig=!vig=<date>` and linked it to an article keyed `<URN>!vig=`, which no
    node has. Each such version gets `version_urn`'s key (reported instead when it
    has no date or a node holds that key already), and every version without its
    VERSIONE_DI edge is linked to its article when the article is in the graph."""
    rekeyed, linked, reported = 0, 0, []
    for row in await client.query("MATCH (v:Norma) WHERE v.URN CONTAINS '!vig=!vig=' RETURN id(v) AS id, v.URN AS urn"):
        old = row["urn"]
        date = old.rsplit("!vig=", 1)[1]
        new = version_urn(old, date) if date else None  # version_urn refuses a version without a date
        if new is None or await _norma_holds(client, new):
            reported.append(old)
            continue
        rekeyed += 1
        if apply:
            await client.query(
                "MATCH (v) WHERE id(v) = $id SET v.URN = $new, "
                "v.node_id = CASE WHEN v.node_id IS NULL OR v.node_id = $old THEN $new ELSE v.node_id END",
                {"id": row["id"], "old": old, "new": new},
            )
    # Linked under the canonical name or a legacy one: a dry run has not renamed the legacy
    # edges yet (on --apply none is left), and must not count those versions as unlinked.
    version_of = "|".join([Rel.VERSIONE_DI.value, *(old for old, new in LEGACY_REL.items() if new is Rel.VERSIONE_DI)])
    for row in await client.query(
        "MATCH (v:Norma {tipo_documento: 'versione_storica'}) "
        f"WHERE NOT (v)-[:{version_of}]->() RETURN v.URN AS urn"
    ):
        article = canonical_urn(row["urn"])
        if not article or article == row["urn"] or not await _norma_holds(client, article):
            continue
        linked += 1
        if apply:
            await client.query(
                "MATCH (v:Norma {URN: $ver_urn}) MATCH (a:Norma {URN: $art_urn}) "
                "MERGE (v)-[r:VERSIONE_DI]->(a) ON CREATE SET r.certezza = 1.0",
                {"ver_urn": row["urn"], "art_urn": article},
            )
    return {"rekeyed": rekeyed, "linked": linked, "reported": sorted(reported)}


async def unify_stubs(
    client, apply: bool, batch: int, renames: dict[int, tuple[str, str]] | None = None,
    shaped: set[int] | None = None,
) -> dict[str, Any]:
    """Every stub ends with exactly the properties `schema.stub_properties` gives it:
    the one definition of the shape (spec 4.1). The missing ones are set
    (`numero_articolo`, `estremi`, `node_id`, a Boolean `is_stub`), the others removed
    (`stub_source`, `created_at`, `fonte`, `trust`...). Its provenance is always
    `ingestion`: a stub carries no seed content, and a `seed` stamp would survive the
    ingestion that completes it (the old seed backfill stamped every node).

    The estremi are the shape's, except for an act the URN table does not know: there
    the stored estremi ("Art. 5 LEGGE 8 marzo 1975, n. 39") say more than the URN, and
    stay, as `plan_estremi` keeps them for an article.

    Reported, never reshaped: a stub without a URN; a stub still keyed by a bare
    `urn:nir:` URN (`wrap_bare_keys` reported it: shaped, it would lose its marker and
    the next run would wrap it); a candidate carrying content the shape would drop
    (`_STUB_CONTENT`: a flagged stub with text, a placeholder with a rubrica); a stub
    whose canonical key another node holds. A reported stub goes through the later
    steps like any other node; the ids of the stubs this step owns go into `shaped`,
    for those steps to leave them alone.

    A community entity still carrying a legacy `Norma` label is no stub: on --apply
    `drop_legacy_entity_labels` has removed it already. A dry run reads a bare key
    `wrap_bare_keys` would have wrapped (`renames`) as wrapped."""
    rows = await client.query(
        f"MATCH (n) WHERE {_STUB_NODE} RETURN id(n) AS id, properties(n) AS props ORDER BY id"
    )
    report: dict[str, Any] = {"reshaped": 0, "set": {}, "removed": {}, "reported": []}
    writes: list[dict[str, Any]] = []
    taken: set[str] = set()
    for row in rows:
        props = dict(row["props"] or {})
        if not apply and row["id"] in (renames or {}) and props.get("URN") == renames[row["id"]][0]:
            old, new = renames[row["id"]]
            props["URN"] = new
            if props.get("node_id") is None or props.get("node_id") == old:
                props["node_id"] = new
        urn = props.get("URN")
        if not isinstance(urn, str) or not urn.strip() or urn.strip().lower().startswith("urn:nir:") \
                or any(props.get(key) is not None for key in _STUB_CONTENT):
            report["reported"].append(str(urn or props.get("node_id") or f"id:{row['id']}"))
            continue
        shape = stub_properties(urn, Provenance.INGESTION)
        if act_name_from_urn(urn) is None and isinstance(props.get("estremi"), str) and props["estremi"].strip():
            shape["estremi"] = props["estremi"]
        if shape["URN"] != urn and (shape["URN"] in taken or await _norma_holds(client, shape["URN"])):
            report["reported"].append(urn)
            continue
        taken.add(shape["URN"])
        if shaped is not None:
            shaped.add(row["id"])
        if props == shape:
            continue
        report["reshaped"] += 1
        for key, value in shape.items():
            if props.get(key) != value or type(props.get(key)) is not type(value):
                report["set"][key] = report["set"].get(key, 0) + 1
        for key in props.keys() - shape.keys():
            report["removed"][key] = report["removed"].get(key, 0) + 1
        writes.append({"id": row["id"], "props": shape})
    if apply:
        for chunk in _chunks(writes, batch):
            await client.query("UNWIND $rows AS row MATCH (n) WHERE id(n) = row.id SET n = row.props", {"rows": chunk})
    report["reported"].sort()
    return report


def _stamp_value(row: dict[str, Any], seed_keys: set[str]) -> str:
    """`seed` for what the Libro IV seed brought, `ingestion` for the rest, and always
    `ingestion` for a stub: a stub carries no seed content (controller's ruling)."""
    if row.get("stub") or row["key"] not in seed_keys:
        return Provenance.INGESTION.value
    return Provenance.SEED.value


async def reset_entity_writer_stamps(
    client, apply: bool, batch: int, seed_keys: set[str], shaped: set[int],
) -> dict[str, int]:
    """Before Task 4 the entity writer stamped the article it linked an entity to:
    `provenance = coalesce(provenance, 'community_validated')`, `trust = coalesce(trust,
    1.0)`. The community validated the link, which carries its own provenance, not the
    article. The stubs unify_stubs shaped (`shaped`) are its job; an article or an act
    gets what stamp_provenance would give it (`seed` or `ingestion`) and no trust, a
    stub it reported `ingestion`. Written here, not left to stamp_provenance, so that a
    dry run reports what --apply does."""
    rows = await client.query(
        "MATCH (n:Norma) WHERE n.provenance = 'community_validated' AND NOT n:Entity AND NOT id(n) IN $shaped "
        f"RETURN id(n) AS id, coalesce(n.URN, n.node_id) AS key, {_STUB_WHERE} AS stub",
        {"shaped": sorted(shaped)},
    )
    by_value: dict[str, list[int]] = {}
    for row in rows:
        by_value.setdefault(_stamp_value(row, seed_keys), []).append(row["id"])
    if apply:
        for value, ids in by_value.items():
            for chunk in _chunks(ids, batch):
                await client.query(
                    "UNWIND $ids AS i MATCH (n) WHERE id(n) = i SET n.provenance = $p, n.trust = NULL",
                    {"ids": chunk, "p": value},
                )
    return {value: len(ids) for value, ids in by_value.items()}


async def reset_seed_outside_seed(
    client, apply: bool, batch: int, seed_keys: set[str], shaped: set[int],
    renames: dict[int, tuple[str, str]] | None = None,
) -> int:
    """`seed` on a node the Libro IV seed never brought becomes `ingestion`, without trust.
    The old seed backfill stamped `seed`, trust 1.0, on every node without a provenance:
    run after a lazy ingestion, it stamped ingested articles, commi, lettere, doctrine and
    rulings too, which would then read as seed and never be re-embedded (Task 7).

    The nodes `stamp_provenance` stamps, so neither a community entity nor a live source,
    whose provenance is their own; nor a stub `unify_stubs` shaped (`shaped`), which has its
    shape's. A node keeps `seed` when its key is the seed's, or was before `wrap_bare_keys`
    gave it a new one (`renames`: a dry run has not written the new key, --apply has)."""
    renamed_from = {node: old for node, (old, _) in (renames or {}).items()}
    ids: list[int] = []
    seen: set[int] = set()
    for label in PROVENANCE_LABELS:
        rows = await client.query(
            f"MATCH (n:{label.value}) WHERE n.provenance = $seed AND NOT n:Entity AND NOT id(n) IN $shaped "
            "RETURN id(n) AS id, coalesce(n.URN, n.node_id) AS key",
            {"seed": Provenance.SEED.value, "shaped": sorted(shaped)},
        )
        for row in rows:
            if row["id"] in seen:
                continue
            seen.add(row["id"])
            if row["key"] in seed_keys or renamed_from.get(row["id"]) in seed_keys:
                continue
            ids.append(row["id"])
    if apply:
        for chunk in _chunks(ids, batch):
            await client.query(
                "UNWIND $ids AS i MATCH (n) WHERE id(n) = i SET n.provenance = $p, n.trust = NULL",
                {"ids": chunk, "p": Provenance.INGESTION.value},
            )
    return len(ids)


def plan_estremi(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The articles whose estremi the formatter writes differently. Only codes
    the URN table knows: for any other act the stored estremi ("Art. 11 L.
    154/1992") says more than the URN can."""
    changes = []
    for row in rows:
        urn = row.get("urn")
        if not urn or act_name_from_urn(urn) is None:
            continue
        _, estremi = estremi_from_urn(urn)
        if estremi and estremi != row.get("estremi"):
            changes.append({"id": row["id"], "estremi": estremi})
    return changes


async def rewrite_estremi(client, apply: bool, batch: int, shaped: set[int]) -> int:
    """The estremi of the articles. A stub `unify_stubs` shaped (`shaped`) has its
    shape's: counted here too, a dry run, which has not reshaped it, would count it twice."""
    rows = await client.query(
        "MATCH (n:Norma) WHERE n.numero_articolo IS NOT NULL AND NOT id(n) IN $shaped "
        "RETURN id(n) AS id, n.URN AS urn, n.estremi AS estremi",
        {"shaped": sorted(shaped)},
    )
    changes = plan_estremi(rows)
    if apply:
        for chunk in _chunks(changes, batch):
            await client.query("UNWIND $rows AS row MATCH (n) WHERE id(n) = row.id SET n.estremi = row.estremi", {"rows": chunk})
    return len(changes)


async def remap_provenance(client, apply: bool, shaped: set[int]) -> dict[str, dict[str, int]]:
    """A provenance written before this round becomes the schema value it means
    (`LEGACY_PROVENANCE`); any other value outside `Provenance` is reported, unchanged.
    A stub `unify_stubs` shaped has its shape's (always `ingestion`); a reported one
    is remapped like any node."""
    known = {p.value for p in Provenance}
    report: dict[str, dict[str, int]] = {"remapped": {}, "unknown": {}}
    not_stub = "NOT id(n) IN $shaped"
    ids = sorted(shaped)
    for row in await client.query(
        f"MATCH (n) WHERE n.provenance IS NOT NULL AND {not_stub} RETURN DISTINCT n.provenance AS p", {"shaped": ids}
    ):
        value = row["p"]
        if value in known:
            continue
        count = await _count(
            client, f"MATCH (n) WHERE n.provenance = $p AND {not_stub} RETURN count(n) AS n", {"p": value, "shaped": ids}
        )
        if value in LEGACY_PROVENANCE:
            report["remapped"][value] = count
            if apply:
                await client.query(
                    f"MATCH (n) WHERE n.provenance = $p AND {not_stub} SET n.provenance = $new",
                    {"p": value, "new": LEGACY_PROVENANCE[value].value, "shaped": ids},
                )
        else:
            report["unknown"][str(value)] = count
    return report


async def stamp_provenance(
    client, apply: bool, batch: int, seed_keys: set[str], shaped: set[int],
) -> dict[str, int]:
    """`seed` for what the Libro IV seed brought, `ingestion` for the rest, and
    `ingestion` for every stub, even one keyed in the seed (spec 4.1: every node has a
    provenance). A community entity is never stamped here, whatever label it carries:
    its provenance is its own. Nor is a stub `unify_stubs` shaped (`shaped`): it gives
    it `ingestion`, and on a dry run, which has not written that, this step must not
    count it; a stub it reported is stamped here. A node with two content labels is
    counted once, in a dry run as on --apply."""
    report: dict[str, int] = {}
    seen: set[int] = set()
    shaped_ids = {"shaped": sorted(shaped)}
    for label in PROVENANCE_LABELS:
        is_stub = _STUB_WHERE if label is Label.NORMA else "false"
        rows = await client.query(
            f"MATCH (n:{label.value}) WHERE n.provenance IS NULL AND NOT n:Entity AND NOT id(n) IN $shaped "
            f"RETURN id(n) AS id, coalesce(n.URN, n.node_id) AS key, {is_stub} AS stub",
            shaped_ids,
        )
        by_value: dict[str, list[int]] = {}
        for row in rows:
            if row["id"] in seen:
                continue
            seen.add(row["id"])
            by_value.setdefault(_stamp_value(row, seed_keys), []).append(row["id"])
        for value, ids in by_value.items():
            report[value] = report.get(value, 0) + len(ids)
            if apply:
                for chunk in _chunks(ids, batch):
                    await client.query("UNWIND $ids AS i MATCH (n) WHERE id(n) = i SET n.provenance = $p", {"ids": chunk, "p": value})
    return report


async def normalize_fonti(client, apply: bool, shaped: set[int]) -> dict[str, int]:
    """The canonical `fonte` on nodes and edges. A stub `unify_stubs` shaped has none;
    a reported one is normalised like any node."""
    report: dict[str, int] = {}
    ids = {"shaped": sorted(shaped)}
    for pattern, where in (("(n)", "n.fonte IS NOT NULL AND NOT id(n) IN $shaped"), ("()-[n]->()", "n.fonte IS NOT NULL")):
        rows = await client.query(f"MATCH {pattern} WHERE {where} RETURN DISTINCT n.fonte AS fonte", ids)
        for row in rows:
            old = row["fonte"]
            new = normalize_fonte(old) if isinstance(old, str) else old
            if new == old:
                continue
            match = f"MATCH {pattern} WHERE {where} AND n.fonte = $old"
            report[old] = report.get(old, 0) + await _count(client, f"{match} RETURN count(n) AS n", {"old": old, **ids})
            if apply:
                await client.query(f"{match} SET n.fonte = $new", {"old": old, "new": new, **ids})
    return report


def _value_order(value: Any) -> tuple[str, str]:
    return (type(value).__name__, str(value))


async def number_certezza(client, apply: bool, batch: int) -> dict[str, Any]:
    """`certezza` as a number on every edge. The seed wrote it as a string ("0.9", "1"),
    and the graph router orders edges by it: a string never compares with a number.
    A value that is no number is reported and left as it is.

    Grouped by value, so each SET matches its edges by the value (a parameter) and
    writes the number parsed in Python (`schema.certezza_number`)."""
    rows = await client.query(
        "MATCH ()-[r]->() WHERE r.certezza IS NOT NULL AND NOT typeOf(r.certezza) IN ['Float', 'Integer'] "
        "RETURN r.certezza AS value, count(r) AS n"
    )
    converted, reported = 0, []
    for row in sorted(rows, key=lambda row: _value_order(row["value"])):
        number = certezza_number(row["value"])
        if number is None:
            reported.append({"value": row["value"], "count": int(row["n"])})
            continue
        converted += int(row["n"])
        while apply:
            done = await _count(
                client,
                f"MATCH ()-[r]->() WHERE r.certezza = $old WITH r LIMIT {batch} SET r.certezza = $new RETURN count(r) AS n",
                {"old": row["value"], "new": number},
            )
            if not done:
                break
    return {"converted": converted, "reported": reported}


async def boolean_flags(client, apply: bool, batch: int, shaped: set[int]) -> dict[str, Any]:
    """The flags the seed wrote as 'true'/'false' (`schema.BOOLEAN_PROPERTIES`) become
    booleans: in Python the string 'false' is truthy, so art. 1284 c.c. read as abrogated.
    A string that is no flag is reported and left as it is. A stub `unify_stubs` shaped has
    its shape's properties only, so it is left alone, as by the other steps. The property
    names come from the schema's set; the values go in as parameters."""
    converted: dict[str, int] = {}
    reported: list[dict[str, Any]] = []
    ids = sorted(shaped)
    for prop in BOOLEAN_PROPERTIES:
        rows = await client.query(
            f"MATCH (n) WHERE typeOf(n.{prop}) = 'String' AND NOT id(n) IN $shaped "
            f"RETURN n.{prop} AS value, count(n) AS n",
            {"shaped": ids},
        )
        for row in sorted(rows, key=lambda row: str(row["value"])):
            flag = boolean_flag(row["value"])
            if flag is None:
                reported.append({"property": prop, "value": row["value"], "count": int(row["n"])})
                continue
            converted[prop] = converted.get(prop, 0) + int(row["n"])
            while apply:
                done = await _count(
                    client,
                    f"MATCH (n) WHERE n.{prop} = $old AND NOT id(n) IN $shaped "
                    f"WITH n LIMIT {batch} SET n.{prop} = $new RETURN count(n) AS n",
                    {"old": row["value"], "new": flag, "shaped": ids},
                )
                if not done:
                    break
    return {"converted": converted, "reported": reported}


async def copy_text(client, apply: bool, batch: int) -> int:
    """`testo` on every article (spec §4.1); a live source's `text` moves to `testo`."""
    total = 0
    for where, assign in (
        ("MATCH (n:Norma) WHERE n.testo IS NULL AND n.testo_vigente IS NOT NULL", "SET n.testo = n.testo_vigente"),
        ("MATCH (n:LiveSource) WHERE n.testo IS NULL AND n.text IS NOT NULL", "SET n.testo = n.text, n.text = NULL"),
    ):
        count = await _count(client, f"{where} RETURN count(n) AS n")
        total += count
        while apply and count:
            if not await _count(client, f"{where} WITH n LIMIT {batch} {assign} RETURN count(n) AS n"):
                break
    return total


async def drop_stale_text(client, apply: bool) -> int:
    """A live source the provisional writer refreshed after Task 4 has `testo` and still
    its old `text`. `node_text` reads `testo` first, so the old one is never read, only
    stale: it goes."""
    match = "MATCH (n:LiveSource) WHERE n.testo IS NOT NULL AND n.text IS NOT NULL"
    count = await _count(client, f"{match} RETURN count(n) AS n")
    if apply and count:
        await client.query(f"{match} SET n.text = NULL")
    return count


async def stamp_fingerprints(client, apply: bool, batch: int) -> int:
    """`testo_sha256` on every article with a text. An empty text gets none, as the writers
    give it none: sha256("") would be a fingerprint of nothing."""
    rows = await client.query(
        "MATCH (n:Norma) WHERE n.testo_sha256 IS NULL AND coalesce(n.testo, n.testo_vigente) IS NOT NULL "
        "RETURN id(n) AS id, coalesce(n.testo, n.testo_vigente) AS testo"
    )
    rows = [row for row in rows if row["testo"]]
    if apply:
        values = [{"id": row["id"], "sha": text_fingerprint(row["testo"])} for row in rows]
        for chunk in _chunks(values, batch):
            await client.query("UNWIND $rows AS row MATCH (n) WHERE id(n) = row.id SET n.testo_sha256 = row.sha", {"rows": chunk})
    return len(rows)


async def label_entities(client, apply: bool) -> dict[str, int]:
    """Community entities written before Task 4 (`:Entity:Concetto`, from
    `tipo.capitalize()`) gain the schema label of their kind, as a new one gets it
    (`entity_label`, `schema.ENTITY_LABEL_BY_TYPE`). The label is the map's, never the
    node's: `tipo` only picks the entry, and a type the map does not name gets none.
    The old label is removed first, by `drop_legacy_entity_labels`."""
    report: dict[str, int] = {}
    for row in await client.query("MATCH (e:Entity) WHERE e.tipo IS NOT NULL RETURN DISTINCT e.tipo AS tipo"):
        label = entity_label(row["tipo"]) if isinstance(row["tipo"], str) else None
        if label is None:
            continue
        match = f"MATCH (e:Entity) WHERE e.tipo = $tipo AND NOT e:{label.value}"
        count = await _count(client, f"{match} RETURN count(e) AS n", {"tipo": row["tipo"]})
        if not count:
            continue
        report[label.value] = report.get(label.value, 0) + count
        if apply:
            await client.query(f"{match} SET e:{label.value}", {"tipo": row["tipo"]})
    return report


async def key_entities(client, apply: bool) -> int:
    """Every community entity carries `node_id` next to its `id`, the same value, so
    the readers that return a node's key, `coalesce(URN, node_id)`, name it. An adopted
    seed twin keeps the seed's `node_id`."""
    match = "MATCH (e:Entity) WHERE e.node_id IS NULL AND e.id IS NOT NULL"
    count = await _count(client, f"{match} RETURN count(e) AS n")
    if apply and count:
        await client.query(f"{match} SET e.node_id = coalesce(e.node_id, e.id)")
    return count


async def report_twins(client) -> dict[str, list]:
    """Community entities that have a seed twin, and seed concepts that are twins of
    each other. Reported, never merged here: the entity writer merges new ones (Task 4);
    an existing pair needs a decision.

    The seed key comes from the name by the writer's rule (`seed_twin_slugs`: as spelt,
    then without a leading article), never from the community id, which drops accents
    and hyphens. It is looked up both ways: a seed name may keep an article the proposal
    drops ("La convalida"), so each seed name is indexed under both its keys too. Seed
    nodes whose names give one community id ("La reticenza", "reticenza") are
    near-duplicates: the writer adopts only the first it meets."""
    index: dict[Label, dict[str, list[str]]] = {}
    near: list[list[str]] = []
    for label in dict.fromkeys(label for label, _ in SEED_TWIN.values()):
        by_slug: dict[str, list[str]] = {}
        by_community_id: dict[str, list[str]] = {}
        rows = await client.query(
            f"MATCH (c:{label.value}) WHERE NOT c:Entity AND c.node_id IS NOT NULL AND c.nome IS NOT NULL "
            "RETURN c.node_id AS nid, c.nome AS nome"
        )
        for row in rows:
            for slug in seed_twin_slugs(row["nome"]):
                by_slug.setdefault(slug, []).append(row["nid"])
            by_community_id.setdefault(normalize_entity_name(row["nome"]), []).append(row["nid"])
        index[label] = by_slug
        near += [sorted(nids) for nids in by_community_id.values() if len(nids) > 1]
    twins = []
    for row in await client.query(
        "MATCH (e:Entity) WHERE e.id IS NOT NULL AND e.nome IS NOT NULL RETURN e.id AS id, e.tipo AS tipo, e.nome AS nome"
    ):
        twin = SEED_TWIN.get(row.get("tipo") or "")
        if not twin:
            continue
        for slug in seed_twin_slugs(row["nome"]):
            seeds = index[twin[0]].get(slug)
            if seeds:
                twins.append({"id": row["id"], "seed": sorted(seeds)})
                break
    return {"community": sorted(twins, key=lambda t: t["id"]), "seed_near_duplicates": sorted(near)}


# Only a node range index answers a `MERGE` or `MATCH` on the key: a full-text index on
# the same property, or a relationship index whose type is spelt like the label, does not.
_LIST_INDEXES = "CALL db.indexes() YIELD label, properties, types, entitytype RETURN label, properties, types, entitytype"


async def ensure_graph_indexes(client, apply: bool) -> int:
    """Create the schema's FalkorDB range indexes that are missing; return how many
    were missing before the call. FalkorDB refuses to index an attribute twice
    ("already indexed"), so the existing indexes are listed first."""
    present = set()
    for row in await client.query(_LIST_INDEXES):
        if row["entitytype"] != "NODE":
            continue
        types = row["types"] or {}
        present.update((row["label"], prop) for prop in row["properties"] or [] if "RANGE" in (types.get(prop) or []))
    missing = [(label.value, prop) for label, prop in GRAPH_INDEXES if (label.value, prop) not in present]
    if apply:
        for label, prop in missing:
            await client.query(f"CREATE INDEX FOR (n:{label}) ON (n.{prop})")
            log.info("graph index created", label=label, property=prop)
    return len(missing)


# Reported, never fixed: the numbers go into the pull request (spec 4.4). A stub is an
# article without text by design, so it is not counted as one.
INTEGRITY_CHECKS: dict[str, str] = {
    "duplicate_urn": (
        "MATCH (n:Norma) WHERE n.URN IS NOT NULL WITH n.URN AS urn, count(*) AS c WHERE c > 1 RETURN count(urn) AS n"
    ),
    "norma_without_urn": "MATCH (n:Norma) WHERE n.URN IS NULL RETURN count(n) AS n",
    "article_without_text": (
        f"MATCH (n:Norma) WHERE n.tipo_documento = $article AND NOT {_STUB_FLAG} "
        "AND n.testo IS NULL AND n.testo_vigente IS NULL RETURN count(n) AS n"
    ),
    "isolated_nodes": "MATCH (n) WHERE NOT (n)--() RETURN count(n) AS n",
    # A string never compares with a number: the value is converted first, and one that is
    # no number counts as out of range.
    "certezza_out_of_range": (
        "MATCH ()-[r]->() WHERE r.certezza IS NOT NULL WITH r, toFloatOrNull(r.certezza) AS c "
        "WHERE c IS NULL OR c < 0 OR c > 1 RETURN count(r) AS n"
    ),
}


_INTEGRITY_PARAMS = {"article": "articolo"}


async def integrity_report(client) -> dict[str, int]:
    """The counts of INTEGRITY_CHECKS, read with GRAPH.RO_QUERY: the server refuses a write."""
    report = {}
    for name, cypher in INTEGRITY_CHECKS.items():
        rows = await client.ro_query(cypher, _INTEGRITY_PARAMS)
        report[name] = int(rows[0]["n"]) if rows else 0
    return report


async def migrate_graph(client, *, apply: bool, batch: int = 500, seed_keys: set[str]) -> dict[str, Any]:
    # The old entity labels first (no community entity may answer a `Norma` step), then
    # the keys (the steps after them read URN and node_id), then shapes and stamps, then
    # the community entities, whose provenance is their own, then the report.
    batch = _batch_size(batch)
    renames: dict[int, tuple[str, str]] = {}
    shaped: set[int] = set()  # the stubs unify_stubs owns: the later steps leave them alone
    return {
        "relations_collapsed": await collapsed_relations(client),
        "relations": await rename_relations(client, apply, batch),
        "legacy_entity_labels": await drop_legacy_entity_labels(client, apply),
        "bare_keys": await wrap_bare_keys(client, apply, renames),
        "versions": await rekey_versions(client, apply),
        "stubs": await unify_stubs(client, apply, batch, renames, shaped),
        "provenance_reset": await reset_entity_writer_stamps(client, apply, batch, seed_keys, shaped),
        "provenance_seed_outside_seed": await reset_seed_outside_seed(client, apply, batch, seed_keys, shaped, renames),
        "estremi": await rewrite_estremi(client, apply, batch, shaped),
        "provenance_legacy": await remap_provenance(client, apply, shaped),
        "provenance": await stamp_provenance(client, apply, batch, seed_keys, shaped),
        "fonte": await normalize_fonti(client, apply, shaped),
        "certezza": await number_certezza(client, apply, batch),
        "booleans": await boolean_flags(client, apply, batch, shaped),
        "testo": await copy_text(client, apply, batch),
        "stale_text": await drop_stale_text(client, apply),
        "fingerprint": await stamp_fingerprints(client, apply, batch),
        "entity_labels": await label_entities(client, apply),
        "entity_node_id": await key_entities(client, apply),
        "twins": await report_twins(client),
    }


def plan_qdrant(points: list[tuple[Any, dict]]) -> dict[str, Any]:
    """What the vector migration changes, from (id, payload) pairs. Pure."""
    existing = {pid for pid, _ in points if not isinstance(pid, int)}
    rekey, drop, urn_fixes, unkeyed = [], [], [], []
    retype: dict[str, int] = {}
    for pid, payload in points:
        source_type = payload.get("source_type") or ""
        if source_type in LEGACY_SOURCE_TYPE:
            retype[source_type] = retype.get(source_type, 0) + 1
            source_type = LEGACY_SOURCE_TYPE[source_type].value
        urn = payload.get("article_urn") or ""
        # keyed as the graph keys it: a bare `urn:nir:` URN is wrapped, as `wrap_bare_keys` does
        canonical = canonical_urn(wrapped_norm_key(urn)) or ""
        if isinstance(pid, int) and not canonical:
            unkeyed.append(pid)  # point_id("", ...) is one id for all of them: reported, never re-keyed
        elif isinstance(pid, int):  # keyed by Python's per-process hash(): lazy ingestion before this round
            key = payload.get("massima_index", 0) if source_type == "massima" else 0
            new_id = point_id(canonical, source_type, key)
            if new_id in existing:
                drop.append(pid)
            else:
                existing.add(new_id)
                rekey.append((pid, new_id, {**payload, "source_type": source_type, "article_urn": canonical}))
        elif canonical != urn:
            urn_fixes.append((pid, canonical))
    return {"rekey": rekey, "drop": drop, "urn_fixes": urn_fixes, "retype": retype, "unkeyed": unkeyed}


def ensure_payload_indexes(client, collection: str, apply: bool) -> list[str]:
    """Create the schema's Qdrant payload indexes that are missing; return the
    fields that were missing before the call."""
    from qdrant_client import models

    present = set((client.get_collection(collection).payload_schema or {}).keys())
    missing = [field for field in QDRANT_PAYLOAD_INDEXES if field not in present]
    if apply:
        for field in missing:
            client.create_payload_index(
                collection_name=collection,
                field_name=field,
                field_schema=models.PayloadSchemaType(QDRANT_PAYLOAD_INDEXES[field]),
            )
    return missing


def migrate_qdrant(client, collection: str, *, apply: bool, batch: int = 256) -> dict[str, Any]:
    """Re-key the lazy points to the schema's ids. Until this runs with --apply,
    `POST /api/v1/graph/search` answers empty: since A it skips the points keyed by
    an integer, which are the lazy ones.

    Crash-safe in its order: a re-keyed point is written before its old one is
    deleted, so a run stopped in between leaves both, and the next run drops the
    old one as a duplicate of the new."""
    from qdrant_client import models

    batch = _batch_size(batch)
    points, offset = [], None
    while True:
        page, offset = client.scroll(collection_name=collection, limit=batch, offset=offset, with_payload=True, with_vectors=False)
        points.extend((p.id, p.payload or {}) for p in page)
        if offset is None:
            break
    plan = plan_qdrant(points)
    if apply:
        for chunk in _chunks(plan["rekey"], batch):
            vectors = {p.id: p.vector for p in client.retrieve(collection_name=collection, ids=[old for old, _, _ in chunk], with_vectors=True)}
            client.upsert(collection_name=collection, points=[
                models.PointStruct(id=new, vector=vectors[old], payload=payload)
                for old, new, payload in chunk if old in vectors
            ])
            client.delete(collection_name=collection, points_selector=models.PointIdsList(points=[old for old, _, _ in chunk]))
        for chunk in _chunks(plan["drop"], batch):
            client.delete(collection_name=collection, points_selector=models.PointIdsList(points=chunk))
        for old in plan["retype"]:
            client.set_payload(
                collection_name=collection,
                payload={"source_type": LEGACY_SOURCE_TYPE[old].value},
                points=models.Filter(must=[models.FieldCondition(key="source_type", match=models.MatchValue(value=old))]),
            )
        for pid, urn in plan["urn_fixes"]:
            client.set_payload(collection_name=collection, payload={"article_urn": urn}, points=[pid])
    return {
        "rekeyed": len(plan["rekey"]),
        "duplicates_dropped": len(plan["drop"]),
        "retyped": plan["retype"],
        "urns_canonicalized": len(plan["urn_fixes"]),
        "unkeyed": len(plan["unkeyed"]),
    }


def load_seed_keys(path: Path) -> set[str]:
    """The keys of the nodes the Libro IV seed brought: `provenance` tells them from ingestion."""
    graph = json.loads(path.read_text(encoding="utf-8"))
    keys = set()
    for node in graph["nodes"]:
        props = node.get("properties") or {}
        key = props.get("URN") or props.get("node_id")
        if key:
            keys.add(key)
    return keys


def _qdrant_client():
    from qdrant_client import QdrantClient

    url = os.getenv("QDRANT_URL")
    if url:
        return QdrantClient(url=url)
    return QdrantClient(host=os.getenv("QDRANT_HOST", "localhost"), port=int(os.getenv("QDRANT_PORT", "6333")))


def _report_half(half: dict[str, Any]) -> None:
    """One half's report on stderr, on one line, as soon as it is ready: if the other half
    fails, this one is not lost with the final report."""
    print(json.dumps(half, ensure_ascii=False), file=sys.stderr, flush=True)


async def _run(apply: bool, batch: int) -> dict[str, Any]:
    from merlt.scripts.load_seed_libro_iv import SEED_GRAPH_JSON
    from merlt.storage.vectors.collection import default_chunks_collection

    if not SEED_GRAPH_JSON.exists():
        raise SystemExit(f"{SEED_GRAPH_JSON} is missing: provenance cannot tell the seed from ingestion")
    seed_keys = load_seed_keys(SEED_GRAPH_JSON)
    # The vectors' store first, before anything is written: a missing collection (or an
    # unreachable Qdrant) stops the run here, not after the graph has been migrated.
    qdrant = _qdrant_client()
    collection = default_chunks_collection()
    if not qdrant.collection_exists(collection_name=collection):
        raise SystemExit(f"Qdrant collection {collection!r} is missing: nothing was migrated")
    client = FalkorDBClient()
    await client.connect()
    try:
        # The indexes first: the migration's MERGEs and MATCHes look nodes up by their keys.
        indexes_graph = await ensure_graph_indexes(client, apply)
        graph_report = await migrate_graph(client, apply=apply, batch=batch, seed_keys=seed_keys)
        integrity = await integrity_report(client)
    finally:
        await client.close()
    _report_half({"half": "graph", "applied": apply, "graph": graph_report, "indexes": indexes_graph, "integrity": integrity})
    indexes_vectors = ensure_payload_indexes(qdrant, collection, apply)
    vectors_report = migrate_qdrant(qdrant, collection, apply=apply)
    _report_half({"half": "vectors", "applied": apply, "vectors": vectors_report, "indexes": indexes_vectors})
    return {
        "applied": apply, "graph": graph_report, "vectors": vectors_report,
        "indexes": {"graph": indexes_graph, "vectors": indexes_vectors}, "integrity": integrity,
    }


def _batch_arg(value: str) -> int:
    try:
        return _batch_size(int(value))
    except ValueError as exc:
        raise argparse.ArgumentTypeError(str(exc)) from None


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate the MERL-T graph and its vectors to the schema's vocabulary.")
    parser.add_argument("--apply", action="store_true", help="write the changes (default: report only)")
    parser.add_argument("--batch", type=_batch_arg, default=500, help=f"rows per statement, 1 to {MAX_BATCH}")
    args = parser.parse_args()
    # stdout carries the report alone, so that it can be kept as JSON; the log goes to
    # stderr, without the per-query debug lines, with each half's report as soon as it is
    # ready (one JSON line each, `"half": "graph"` then `"half": "vectors"`).
    structlog.configure(
        logger_factory=structlog.PrintLoggerFactory(sys.stderr),
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
    )
    print(json.dumps(asyncio.run(_run(args.apply, args.batch)), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
