"""Migrate the MERL-T graph and its vectors to the schema's vocabulary.

Dry run by default: it reads and reports. `--apply` writes. Idempotent: a second
run changes nothing; what it only reports (twins, a key two nodes would share)
it reports again. Run `scripts/backup.sh` first.
Design: docs/superpowers/specs/2026-09-30-merlt-graph-structure-design.md, §4.4.

    python -m merlt.scripts.migrate_graph_vocabulary            # report
    python -m merlt.scripts.migrate_graph_vocabulary --apply    # write

Every label and relation name in the Cypher text below comes from the code's own
sets (`Label`, `Rel`, `LEGACY_REL`, `LEGACY_ENTITY_LABELS`), never from the data;
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
    LEGACY_REL,
    LEGACY_SOURCE_TYPE,
    SEED_TWIN,
    Label,
    Provenance,
    Rel,
    act_name_from_urn,
    canonical_urn,
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
# The same test, negated: an article or an act, not a placeholder.
_NOT_STUB_WHERE = f"NOT {_STUB_WHERE}"
# A stub among nodes of any label: a Norma that is no community entity and passes the test.
_STUB_NODE = f"(n:Norma AND NOT n:Entity AND {_STUB_WHERE})"

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
    for row in await client.query(
        "MATCH (v:Norma {tipo_documento: 'versione_storica'}) WHERE NOT (v)-[:VERSIONE_DI]->() RETURN v.URN AS urn"
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
) -> dict[str, Any]:
    """Every stub ends with exactly the properties `schema.stub_properties` gives it:
    the one definition of the shape (spec 4.1). The missing ones are set
    (`numero_articolo`, `estremi`, `node_id`, a Boolean `is_stub`), the others removed
    (`stub_source`, `created_at`, `fonte`, `trust`...). Its provenance is always
    `ingestion`: a stub carries no seed content, and a `seed` stamp would survive the
    ingestion that completes it (backfill_provenance_seed stamped every node).

    Reported, never reshaped: a stub without a URN; a flagged stub that carries text
    (reshaping would delete it, and the two signals disagree); a stub whose canonical
    key another node holds. A community entity still carrying a legacy `Norma` label
    is no stub: on --apply `drop_legacy_entity_labels` has removed it already. A dry
    run reads a bare key `wrap_bare_keys` would have wrapped (`renames`) as wrapped."""
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
        if not isinstance(urn, str) or not urn.strip() or props.get("testo") is not None \
                or props.get("testo_vigente") is not None:
            report["reported"].append(str(urn or props.get("node_id") or f"id:{row['id']}"))
            continue
        shape = stub_properties(urn, Provenance.INGESTION)
        if shape["URN"] != urn and (shape["URN"] in taken or await _norma_holds(client, shape["URN"])):
            report["reported"].append(urn)
            continue
        taken.add(shape["URN"])
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


async def reset_entity_writer_stamps(client, apply: bool, batch: int, seed_keys: set[str]) -> dict[str, int]:
    """Before Task 4 the entity writer stamped the article it linked an entity to:
    `provenance = coalesce(provenance, 'community_validated')`, `trust = coalesce(trust,
    1.0)`. The community validated the link, which carries its own provenance, not the
    article. Stubs are unify_stubs' job; an article or an act gets what stamp_provenance
    would give it (`seed` or `ingestion`) and no trust. Written here, not left to
    stamp_provenance, so that a dry run reports what --apply does."""
    rows = await client.query(
        f"MATCH (n:Norma) WHERE n.provenance = 'community_validated' AND {_NOT_STUB_WHERE} "
        "RETURN id(n) AS id, coalesce(n.URN, n.node_id) AS key"
    )
    by_value: dict[str, list[int]] = {}
    for row in rows:
        value = Provenance.SEED.value if row["key"] in seed_keys else Provenance.INGESTION.value
        by_value.setdefault(value, []).append(row["id"])
    if apply:
        for value, ids in by_value.items():
            for chunk in _chunks(ids, batch):
                await client.query(
                    "UNWIND $ids AS i MATCH (n) WHERE id(n) = i SET n.provenance = $p, n.trust = NULL",
                    {"ids": chunk, "p": value},
                )
    return {value: len(ids) for value, ids in by_value.items()}


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


async def rewrite_estremi(client, apply: bool, batch: int) -> int:
    """The estremi of the articles. A stub's are `unify_stubs`' (its shape includes
    them): counted here too, a dry run, which has not reshaped it, would count it twice."""
    rows = await client.query(
        f"MATCH (n:Norma) WHERE n.numero_articolo IS NOT NULL AND NOT {_STUB_NODE} "
        "RETURN id(n) AS id, n.URN AS urn, n.estremi AS estremi"
    )
    changes = plan_estremi(rows)
    if apply:
        for chunk in _chunks(changes, batch):
            await client.query("UNWIND $rows AS row MATCH (n) WHERE id(n) = row.id SET n.estremi = row.estremi", {"rows": chunk})
    return len(changes)


async def remap_provenance(client, apply: bool) -> dict[str, dict[str, int]]:
    """A provenance written before this round becomes the schema value it means
    (`LEGACY_PROVENANCE`); any other value outside `Provenance` is reported, unchanged.
    A stub's is `unify_stubs`' (always `ingestion`)."""
    known = {p.value for p in Provenance}
    report: dict[str, dict[str, int]] = {"remapped": {}, "unknown": {}}
    not_stub = f"NOT {_STUB_NODE}"
    for row in await client.query(
        f"MATCH (n) WHERE n.provenance IS NOT NULL AND {not_stub} RETURN DISTINCT n.provenance AS p"
    ):
        value = row["p"]
        if value in known:
            continue
        count = await _count(
            client, f"MATCH (n) WHERE n.provenance = $p AND {not_stub} RETURN count(n) AS n", {"p": value}
        )
        if value in LEGACY_PROVENANCE:
            report["remapped"][value] = count
            if apply:
                await client.query(
                    f"MATCH (n) WHERE n.provenance = $p AND {not_stub} SET n.provenance = $new",
                    {"p": value, "new": LEGACY_PROVENANCE[value].value},
                )
        else:
            report["unknown"][str(value)] = count
    return report


async def stamp_provenance(client, apply: bool, batch: int, seed_keys: set[str]) -> dict[str, int]:
    """`seed` for what the Libro IV seed brought, `ingestion` for the rest. A community
    entity is never stamped here, whatever label it carries: its provenance is its own.
    Nor is a stub: `unify_stubs` gives it `ingestion`, and on a dry run, which has not
    written that, this step must not count it as what it would stamp. A node with two
    content labels is counted once, in a dry run as on --apply."""
    report: dict[str, int] = {}
    seen: set[int] = set()
    for label in PROVENANCE_LABELS:
        not_stub = f" AND {_NOT_STUB_WHERE}" if label is Label.NORMA else ""
        rows = await client.query(
            f"MATCH (n:{label.value}) WHERE n.provenance IS NULL AND NOT n:Entity{not_stub} "
            "RETURN id(n) AS id, coalesce(n.URN, n.node_id) AS key"
        )
        by_value: dict[str, list[int]] = {}
        for row in rows:
            if row["id"] in seen:
                continue
            seen.add(row["id"])
            value = Provenance.SEED.value if row["key"] in seed_keys else Provenance.INGESTION.value
            by_value.setdefault(value, []).append(row["id"])
        for value, ids in by_value.items():
            report[value] = report.get(value, 0) + len(ids)
            if apply:
                for chunk in _chunks(ids, batch):
                    await client.query("UNWIND $ids AS i MATCH (n) WHERE id(n) = i SET n.provenance = $p", {"ids": chunk, "p": value})
    return report


async def normalize_fonti(client, apply: bool) -> dict[str, int]:
    """The canonical `fonte` on nodes and edges. A stub has none: `unify_stubs` removes it."""
    report: dict[str, int] = {}
    for pattern, where in (("(n)", f"n.fonte IS NOT NULL AND NOT {_STUB_NODE}"), ("()-[n]->()", "n.fonte IS NOT NULL")):
        rows = await client.query(f"MATCH {pattern} WHERE {where} RETURN DISTINCT n.fonte AS fonte")
        for row in rows:
            old = row["fonte"]
            new = normalize_fonte(old) if isinstance(old, str) else old
            if new == old:
                continue
            match = f"MATCH {pattern} WHERE {where} AND n.fonte = $old"
            report[old] = report.get(old, 0) + await _count(client, f"{match} RETURN count(n) AS n", {"old": old})
            if apply:
                await client.query(f"{match} SET n.fonte = $new", {"old": old, "new": new})
    return report


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
    rows = await client.query(
        "MATCH (n:Norma) WHERE n.testo_sha256 IS NULL AND coalesce(n.testo, n.testo_vigente) IS NOT NULL "
        "RETURN id(n) AS id, coalesce(n.testo, n.testo_vigente) AS testo"
    )
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


async def migrate_graph(client, *, apply: bool, batch: int = 500, seed_keys: set[str]) -> dict[str, Any]:
    # The old entity labels first (no community entity may answer a `Norma` step), then
    # the keys (the steps after them read URN and node_id), then shapes and stamps, then
    # the community entities, whose provenance is their own, then the report.
    batch = _batch_size(batch)
    renames: dict[int, tuple[str, str]] = {}
    return {
        "relations_collapsed": await collapsed_relations(client),
        "relations": await rename_relations(client, apply, batch),
        "legacy_entity_labels": await drop_legacy_entity_labels(client, apply),
        "bare_keys": await wrap_bare_keys(client, apply, renames),
        "versions": await rekey_versions(client, apply),
        "stubs": await unify_stubs(client, apply, batch, renames),
        "provenance_reset": await reset_entity_writer_stamps(client, apply, batch, seed_keys),
        "estremi": await rewrite_estremi(client, apply, batch),
        "provenance_legacy": await remap_provenance(client, apply),
        "provenance": await stamp_provenance(client, apply, batch, seed_keys),
        "fonte": await normalize_fonti(client, apply),
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
        canonical = canonical_urn(urn) or ""
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


async def _run(apply: bool, batch: int) -> dict[str, Any]:
    from merlt.scripts.load_seed_libro_iv import SEED_GRAPH_JSON
    from merlt.storage.vectors.collection import default_chunks_collection

    if not SEED_GRAPH_JSON.exists():
        raise SystemExit(f"{SEED_GRAPH_JSON} is missing: provenance cannot tell the seed from ingestion")
    client = FalkorDBClient()
    await client.connect()
    try:
        graph_report = await migrate_graph(client, apply=apply, batch=batch, seed_keys=load_seed_keys(SEED_GRAPH_JSON))
    finally:
        await client.close()
    vectors_report = migrate_qdrant(_qdrant_client(), default_chunks_collection(), apply=apply)
    return {"applied": apply, "graph": graph_report, "vectors": vectors_report}


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
    # stderr, without the per-query debug lines.
    structlog.configure(
        logger_factory=structlog.PrintLoggerFactory(sys.stderr),
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
    )
    print(json.dumps(asyncio.run(_run(args.apply, args.batch)), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
