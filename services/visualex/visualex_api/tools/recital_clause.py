"""A recital clause in a search («considerando 26 GDPR»), told apart from the act it names.

Spec docs/superpowers/specs/2026-11-17-eu-recitals-design.md §3.1. A clause is a head
(«considerando», «cons.», «cons», «consid.»), an optional «n.», «n°» or «nr.», and a number, a list
(«26 e 27», «26, 27 e 30») or a range («26-30»); the number may sit in brackets as the Official
Journal prints it, «(26)». It stands anywhere in the query. What is left once the clause, and the
«e» or comma just before it, are taken out is the rest, read by the other readers as today.

A head with no number after it is no clause: «Cons. St.» stays a Consiglio di Stato decision and
«considerando il contratto» is left alone. ASCII digits only, no leading zero, and at most
`MAX_ARTICLES_PER_REQUEST` numbers once a list or a range is expanded. A leaf module: tables and
regexes, no import from the parsers.
"""
from __future__ import annotations

import re
from typing import Optional

from .config import MAX_ARTICLES_PER_REQUEST

_NUMBER = r"\(?\s*[1-9][0-9]{0,3}\s*\)?"
_CLAUSE = re.compile(
    r"(?P<before>\s*,\s*|\s+e\s+|\s*)"
    r"(?<![\w.])(?:considerando|consid\.|cons\.?)"
    r"\s*(?:(?:n\.|n°|nr\.)\s*)?"
    rf"(?P<spec>{_NUMBER}(?:\s*[-–]\s*{_NUMBER}|(?:\s*(?:,|\be\b)\s*{_NUMBER})*))"
    # The number ends here: not «26/2016», not «26.1», not «260» cut short.
    r"(?![\w/]|\.[0-9])",
    re.IGNORECASE | re.ASCII,
)
_DIGITS = re.compile(r"[0-9]+")
# What a clause leaves at the rest's edges: a comma, a lone «e».
_EDGES = re.compile(r"^(?:\s*(?:,|\be\b)\s*)+|(?:\s*(?:,|\be\b)\s*)+$", re.IGNORECASE)


def _spec_of(raw: str) -> Optional[str]:
    """«26», «26,27», «26-30» from the clause's numbers; None past the ceiling or for a range
    that runs backwards."""
    numbers = _DIGITS.findall(raw)
    if re.search(r"[-–]", raw):
        start, end = int(numbers[0]), int(numbers[1])
        if end <= start or end - start + 1 > MAX_ARTICLES_PER_REQUEST:
            return None
        return f"{start}-{end}"
    if len(numbers) > MAX_ARTICLES_PER_REQUEST:
        return None
    return ",".join(numbers)


def split_recital_clause(text: str) -> tuple[Optional[str], str]:
    """(the recital spec, the rest): («26», «GDPR») for «considerando 26 GDPR»; (None, text) when
    the text holds no clause, or a clause this reading refuses (past the ceiling, a range that runs
    backwards, two clauses of which one is a range)."""
    if not text:
        return None, text
    matches = list(_CLAUSE.finditer(text))
    if not matches:
        return None, text
    specs = [_spec_of(m.group("spec")) for m in matches]
    if any(spec is None for spec in specs):
        return None, text
    if len(specs) > 1:
        if any("-" in spec for spec in specs):
            return None, text
        spec = ",".join(specs)
        if len(spec.split(",")) > MAX_ARTICLES_PER_REQUEST:
            return None, text
    else:
        spec = specs[0]
    rest, last = [], 0
    for m in matches:
        rest.append(text[last:m.start()])
        rest.append(" ")
        last = m.end()
    rest.append(text[last:])
    remainder = re.sub(r"\s+", " ", "".join(rest)).strip()
    return spec, _EDGES.sub("", remainder).strip()


def expand_recital_spec(spec: str) -> list[str]:
    """The numbers a spec names, in order: «26-28» → ["26", "27", "28"], «26,30» → ["26", "30"]."""
    if "-" in spec:
        start, end = (int(n) for n in spec.split("-", 1))
        return [str(n) for n in range(start, end + 1)]
    return [n for n in spec.split(",") if n]
