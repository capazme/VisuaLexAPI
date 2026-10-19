"""`estremi` is a label (source convention): readers never match it case-sensitively.

The convention writes "art. 1453 c.c." where older nodes, and the examples a model reads in a
tool's description, wrote "Art. 1453 c.c.". An exact `n.estremi = $id` silently answered
"not found" for one of the two. Every Cypher comparison on `estremi` in the package lowers
both sides.
"""
import re
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[2] / "merlt"
# A comparison of estremi: = , CONTAINS, STARTS WITH, ENDS WITH, on a node property.
_COMPARISON = re.compile(r"(?<![\w(])([a-z]\w*)\.estremi\s*(=|CONTAINS|STARTS WITH|ENDS WITH)\s*(\S+)")
_LOWERED = re.compile(r"toLower\((?:coalesce\()?[a-z]\w*\.estremi")


def test_no_cypher_compares_estremi_case_sensitively():
    offenders = []
    for path in PACKAGE.rglob("*.py"):
        if "scripts" in path.parts:  # one-off maintenance scripts write labels, they do not look them up
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            match = _COMPARISON.search(line)
            # A condition (WHERE / OR / AND), not an assignment in a SET.
            condition = line.strip().upper().startswith(("WHERE", "OR ", "AND ")) or " WHERE " in line.upper()
            if not match or not condition:
                continue
            # "Cost." is the same in both spellings, so that constant comparison is safe.
            if match.group(3).startswith("'Cost.'"):
                continue
            offenders.append(f"{path.relative_to(PACKAGE)}:{number}: {line.strip()}")
    assert offenders == []


def test_the_tools_lower_both_sides():
    for name in ("hierarchy.py", "constitutional_basis.py", "verification.py", "citation_chain.py", "external_source.py"):
        assert _LOWERED.search((PACKAGE / "tools" / name).read_text(encoding="utf-8")), name
