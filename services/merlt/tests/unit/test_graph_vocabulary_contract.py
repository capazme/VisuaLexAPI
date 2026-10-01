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
import ast
import re
from pathlib import Path

from merlt.storage.graph.schema import Fonte, Label, Provenance, Rel

ROOT = Path(__file__).resolve().parents[2] / "merlt"
EXEMPT = {
    # The disagreement companion's offline collector reads relations between
    # decisions that no writer produces; it is not wired to the live graph.
    ROOT / "disagreement" / "data" / "collector.py",
    # ConstitutionalBasisTool (ATTUA/RECEPISCE/DERIVA) and CitationChainTool
    # (cita/conferma/supera between decisions) are not wired (api/engine_bootstrap.py):
    # no writer produces those relations, so every call returned nothing.
    ROOT / "tools" / "constitutional_basis.py",
    ROOT / "tools" / "citation_chain.py",
}
REL_RE = re.compile(r"-\[\w*:([A-Za-z_]+(?:\|:?[A-Za-z_]+)*)")
LABEL_RE = re.compile(r"\(\w*:([A-Z][A-Za-z]+)")
FONTE_RE = re.compile(r"\bfonte\s*[=:]\s*'([^']+)'")
# `x.provenance = 'seed'`, `{provenance: 'seed'}` and the non-destructive
# `x.provenance = coalesce(x.provenance, 'ingestion')` that the ingestion writers use.
PROVENANCE_RE = re.compile(r"\bprovenance\s*[=:]\s*(?:coalesce\(\s*\w+\.provenance\s*,\s*)?'([^']+)'")
CYPHER_RE = re.compile(r"\b(MATCH|MERGE)\b")

KNOWN_LEGACY_RELS: set[str] = set()
KNOWN_UNKNOWN_LABELS: set[str] = set()
KNOWN_LEGACY_FONTI: set[str] = set()


def _units(tree: ast.AST) -> list[tuple[int, str]]:
    docstrings, inside = set(), set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)) and node.body:
            first = node.body[0]
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) and isinstance(first.value.value, str):
                docstrings.add(id(first.value))
    units = []
    for node in ast.walk(tree):
        if isinstance(node, ast.JoinedStr):
            parts = []
            for value in node.values:
                if isinstance(value, ast.Constant) and isinstance(value.value, str):
                    parts.append(value.value)
                    inside.add(id(value))
                else:
                    parts.append("{}")
            units.append((node.lineno, "".join(parts)))
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in inside | docstrings:
            units.append((node.lineno, node.value))
    return units


def _found() -> dict[str, dict[str, list[str]]]:
    found: dict[str, dict[str, list[str]]] = {"rel": {}, "label": {}, "fonte": {}, "provenance": {}}
    # Scan Python files
    for path in sorted(ROOT.rglob("*.py")):
        if path in EXEMPT:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for line, text in _units(tree):
            where = f"{path.relative_to(ROOT)}:{line}"
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
    # Scan YAML templates
    yaml_paths = sorted(set(ROOT.rglob("*.yaml")) | set(ROOT.rglob("*.yml")))
    for path in yaml_paths:
        if path in EXEMPT:
            continue
        text = path.read_text(encoding="utf-8")
        # Blank out comment lines
        lines = []
        for line in text.split("\n"):
            if line.lstrip().startswith("#"):
                lines.append("")
            else:
                lines.append(line)
        text = "\n".join(lines)
        where = f"{path.relative_to(ROOT)}:1"
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


def test_every_provenance_in_cypher_is_canonical():
    _check("provenance", {p.value for p in Provenance}, set())
