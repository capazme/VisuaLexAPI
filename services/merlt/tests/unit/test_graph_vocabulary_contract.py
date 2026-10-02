"""No Cypher string under merlt/ may name a relation, a label, a fonte or a
provenance that merlt/storage/graph/schema.py does not define.

It reads string literals in Python files (AST, docstrings skipped, an f-string's
pieces joined with `{}` for its placeholders), and also Cypher in YAML templates
(comment lines blanked out, every file as one unit). Python slice syntax
never matches. Names built at runtime are invisible here: the writers and readers
that build them test their values against the schema themselves.

The KNOWN_* sets are a ratchet: they list what is still old, and a name must
leave them as soon as the code stops using it. They are empty now: a name outside
the schema fails the day it appears.
"""
import re

from cypher_scan import cypher_texts
from merlt.storage.graph.schema import Fonte, Label, Provenance, Rel

REL_RE = re.compile(r"-\[\w*:([A-Za-z_]+(?:\|:?[A-Za-z_]+)*)")
LABEL_RE = re.compile(r"\(\w*:([A-Z][A-Za-z]+)")
# `x.fonte = 'Normattiva'`, `{fonte: 'community'}` and the non-destructive
# `x.fonte = coalesce(x.fonte, 'Normattiva')` that the lazy writers use for nodes that may exist.
FONTE_RE = re.compile(r"\bfonte\s*[=:]\s*(?:coalesce\(\s*\w+\.fonte\s*,\s*)?'([^']+)'")
# `x.provenance = 'seed'`, `{provenance: 'seed'}` and the non-destructive
# `x.provenance = coalesce(x.provenance, 'ingestion')` that the ingestion writers use.
PROVENANCE_RE = re.compile(r"\bprovenance\s*[=:]\s*(?:coalesce\(\s*\w+\.provenance\s*,\s*)?'([^']+)'")
CYPHER_RE = re.compile(r"\b(MATCH|MERGE)\b")

KNOWN_LEGACY_RELS: set[str] = set()
KNOWN_UNKNOWN_LABELS: set[str] = set()
KNOWN_LEGACY_FONTI: set[str] = set()


def _found() -> dict[str, dict[str, list[str]]]:
    found: dict[str, dict[str, list[str]]] = {"rel": {}, "label": {}, "fonte": {}, "provenance": {}}
    for where, text in cypher_texts():
        for match in REL_RE.finditer(text):
            for name in match.group(1).split("|"):
                name = name.lstrip(":")  # strip leading colon from alternation
                found["rel"].setdefault(name, []).append(where)
        for match in LABEL_RE.finditer(text):
            found["label"].setdefault(match.group(1), []).append(where)
        if CYPHER_RE.search(text):
            for match in FONTE_RE.finditer(text):
                found["fonte"].setdefault(match.group(1), []).append(where)
            for match in PROVENANCE_RE.finditer(text):
                found["provenance"].setdefault(match.group(1), []).append(where)
    return found


def _check(kind: str, allowed: set[str], known: set[str]) -> None:
    names = _found()[kind]
    assert names.keys() & allowed, f"the scan found no canonical {kind} at all: is ROOT right?"
    offenders = {name: where for name, where in names.items() if name not in allowed}
    new = {name: where for name, where in offenders.items() if name not in known}
    assert not new, f"{kind} outside the schema: {new}"
    gone = known - offenders.keys()
    assert not gone, f"no longer used, remove from the known {kind} set: {sorted(gone)}"


def test_every_relation_in_cypher_is_canonical():
    _check("rel", {r.value for r in Rel}, KNOWN_LEGACY_RELS)


def test_every_label_in_cypher_is_known():
    _check("label", {label.value for label in Label}, KNOWN_UNKNOWN_LABELS)


def test_every_fonte_in_cypher_is_canonical():
    _check("fonte", {f.value for f in Fonte}, KNOWN_LEGACY_FONTI)


def test_the_fonte_scan_reads_the_coalesce_form_too():
    assert FONTE_RE.search("SET c.fonte = coalesce(c.fonte, 'Nope')").group(1) == "Nope"
    assert FONTE_RE.search("SET n.fonte = 'Nope'").group(1) == "Nope"
    assert FONTE_RE.search("{fonte: 'Nope'}").group(1) == "Nope"


def test_every_provenance_in_cypher_is_canonical():
    _check("provenance", {p.value for p in Provenance}, set())


# `labels(n)[0]` as a node's type is "Entity" for a community entity (`:Entity:<Label>`, and
# FalkorDB orders a node's labels by label id): a type is read with `schema.node_type_cypher`.
FIRST_LABEL_RE = re.compile(r"labels\(\w+\)\[0\]")


def test_no_cypher_reads_a_nodes_type_as_its_first_label():
    offenders = {}
    for where, text in cypher_texts(include_yaml=False):
        if FIRST_LABEL_RE.search(text):
            offenders.setdefault(where.rsplit(":", 1)[0], []).append(int(where.rsplit(":", 1)[1]))
    assert not offenders, f"read a node's type with schema.node_type_cypher: {offenders}"


# `MERGE (x:Norma {URN: $urn})`, also with a second label (`MERGE (x:Entity:Principio {…`) and
# with the braces doubled of a `.format` template. It reads the first key of the map, the one a
# lookup is by. A label or a key built at runtime (`MERGE (x:{label} {{{key}: $k}})`, an f-string
# placeholder) is invisible here: the writers that build them (the seed loader, the entity
# writer) are covered by the schema tests of their own.
MERGE_KEY_RE = re.compile(r"\bMERGE\s*\(\w*:([A-Z]\w*)(?::\w+)*\s*\{\{?\s*(\w+)\s*:")


def test_every_merge_key_has_an_index():
    """A new `MERGE (x:Label {key: …})` on a key `GRAPH_INDEXES` does not list scans its whole
    label on every write: add the index, or the writer, in the same change."""
    from merlt.storage.graph.schema import GRAPH_INDEXES

    found: dict[tuple[str, str], list[str]] = {}
    for where, text in cypher_texts():
        for match in MERGE_KEY_RE.finditer(text):
            found.setdefault((match.group(1), match.group(2)), []).append(where)
    # Not vacuous: the scan sees the known writers' keys.
    assert {("Norma", "URN"), ("Comma", "URN"), ("Lettera", "URN"), ("Numero", "URN"), ("Dottrina", "node_id")} <= found.keys()
    indexed = {(label.value, key) for label, key in GRAPH_INDEXES}
    missing = {key: where for key, where in found.items() if key not in indexed}
    assert not missing, f"MERGE on a key with no index in schema.GRAPH_INDEXES: {missing}"


def test_the_merge_scan_reads_the_shapes_it_claims():
    assert MERGE_KEY_RE.search("MERGE (x:Norma {URN: $u})").groups() == ("Norma", "URN")
    assert MERGE_KEY_RE.search("MERGE (:Norma {URN: $u})").groups() == ("Norma", "URN")
    assert MERGE_KEY_RE.search("MERGE (x:Entity:Principio {node_id: $i})").groups() == ("Entity", "node_id")
    assert MERGE_KEY_RE.search("MERGE (x:Norma {{URN: $u}})").groups() == ("Norma", "URN")
    assert not MERGE_KEY_RE.search("MERGE (x:{} {{node_id: $i}})")
