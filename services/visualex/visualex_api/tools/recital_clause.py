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

# No whitespace inside the brackets: the OJ prints «(26)», and a `\s*` here beside the list's own
# would let two quantifiers share one run of spaces, a quadratic search (review of PR 1b).
_NUMBER = r"\(?[1-9][0-9]{0,3}\)?"
# Anchored on the head, so a search over a long query stays linear: nothing before the head is read
# by the pattern (the «e» or comma before it is taken off by hand, below).
_CLAUSE = re.compile(
    r"(?<![\w.])(?:considerando|consid\.|cons\.?)"
    r"\s*(?:(?:n\.|n°|nr\.)\s*)?"
    rf"(?P<spec>{_NUMBER}(?:\s*[-–]\s*{_NUMBER}|(?:\s*(?:,|\be\b)\s*{_NUMBER})*))"
    # The number ends here: not «26/2016», not «26.1», not «260» cut short.
    r"(?![\w/]|\.[0-9])",
    re.IGNORECASE | re.ASCII,
)
_DIGITS = re.compile(r"[0-9]+")
_WHITESPACE = re.compile(r"\s+")


def _trim_joins(text: str) -> str:
    """The rest without the comma or the lone «e» a clause leaves at its edges: «art. 4 e» → «art. 4»,
    «, reg. (UE) 2016/679» → «reg. (UE) 2016/679». «e-privacy» keeps its «e». String methods, no
    pattern: linear whatever the length."""
    words = text.split(" ")
    while words and (words[0] in ("", ",") or words[0].lower() == "e"):
        words.pop(0)
    while words and (words[-1] in ("", ",") or words[-1].lower() == "e"):
        words.pop()
    rest = " ".join(words)
    return rest.strip(", ").strip()


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
    pieces, last = [], 0
    for m in matches:
        pieces.append(_trim_joins(_WHITESPACE.sub(" ", text[last:m.start()]).strip()))
        last = m.end()
    pieces.append(_trim_joins(_WHITESPACE.sub(" ", text[last:]).strip()))
    return spec, " ".join(piece for piece in pieces if piece)


def expand_recital_spec(spec: str) -> list[str]:
    """The numbers a spec names, in order: «26-28» → ["26", "27", "28"], «26,30» → ["26", "30"]."""
    if "-" in spec:
        start, end = (int(n) for n in spec.split("-", 1))
        return [str(n) for n in range(start, end + 1)]
    return [n for n in spec.split(",") if n]
