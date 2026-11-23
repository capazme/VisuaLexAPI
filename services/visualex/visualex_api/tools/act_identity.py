"""When a reading names an act: the one predicate (design 2026-10-29-document-analysis §4.4).

A copy of `conventions/sources/numbered-act-types.json`, which the container image does
not carry: `tests/test_act_identity.py` fails when the two differ. A leaf module, like
`article_suffixes`: `norm_query`, the citation linker and the controller read it.
"""
from __future__ import annotations

from typing import Optional

# The types that name an act only with their number and date, case folded.
NUMBERED_ACT_TYPES: frozenset[str] = frozenset({
    "legge",
    "legge costituzionale",
    "decreto legge",
    "decreto legislativo",
    "decreto legislativo luogotenenziale",
    "decreto del presidente della repubblica",
    "decreto del presidente del consiglio dei ministri",
    "decreto ministeriale",
    "regio decreto",
    "regio decreto legge",
    "regolamento ue",
    "direttiva ue",
})


def identifies_act(params: Optional[dict]) -> bool:
    """A reading names an act: a type that needs no number, or a type with its number
    and its date. «art. 2 d.m.» reads as a decreto ministeriale and names none."""
    if not params or not params.get("act_type"):
        return False
    if str(params["act_type"]).casefold() not in NUMBERED_ACT_TYPES:
        return True
    return bool(params.get("act_number") and params.get("date"))
