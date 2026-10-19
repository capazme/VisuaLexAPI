"""The scan of the Cypher text under merlt/, shared by the graph contract tests.

`cypher_texts()` yields `(where, text)` for every string literal in a Python file of the
package (AST, docstrings skipped, an f-string's pieces joined with `{}` for its placeholders)
and for every YAML template (comment lines blanked out, the file as one unit). A name built
at runtime is invisible to it.
"""
import ast
from pathlib import Path
from typing import Iterator

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


def units(tree: ast.AST) -> list[tuple[int, str]]:
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


def cypher_texts(include_yaml: bool = True) -> Iterator[tuple[str, str]]:
    for path in sorted(ROOT.rglob("*.py")):
        if path in EXEMPT:
            continue
        for line, text in units(ast.parse(path.read_text(encoding="utf-8"))):
            yield f"{path.relative_to(ROOT)}:{line}", text
    if not include_yaml:
        return
    for path in sorted(set(ROOT.rglob("*.yaml")) | set(ROOT.rglob("*.yml"))):
        if path in EXEMPT:
            continue
        lines = ["" if line.lstrip().startswith("#") else line for line in path.read_text(encoding="utf-8").split("\n")]
        yield f"{path.relative_to(ROOT)}:1", "\n".join(lines)
