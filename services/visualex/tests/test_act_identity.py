"""When a reading names an act (design 2026-10-29-document-analysis §4.4): one list, one predicate."""
import json
from pathlib import Path

import pytest

from visualex_api.tools.act_identity import NUMBERED_ACT_TYPES, identifies_act
from visualex_api.tools.citation_linker import extract_citations


def _convention() -> dict:
    for directory in Path(__file__).resolve().parents:
        candidate = directory / "conventions" / "sources" / "numbered-act-types.json"
        if candidate.exists():
            return json.loads(candidate.read_text(encoding="utf-8"))
    raise FileNotFoundError("conventions/sources/numbered-act-types.json not found above " + __file__)


def test_the_numbered_types_are_the_conventions_copy():
    assert NUMBERED_ACT_TYPES == frozenset(_convention()["types"])


def test_the_conventions_types_are_written_case_folded():
    types = _convention()["types"]
    assert types == [t.casefold() for t in types] and len(types) == len(set(types))


@pytest.mark.parametrize("params, expected", [
    ({"act_type": "codice civile", "article": "2043"}, True),
    ({"act_type": "costituzione", "article": "3"}, True),
    ({"act_type": "TUE", "article": "6"}, True),
    ({"act_type": "legge", "act_number": "241", "date": "1990", "article": "2"}, True),
    ({"act_type": "regolamento UE", "act_number": "679", "date": "2016"}, True),
    # «art. 2 d.m.»: the parser reads it, and it names no act
    ({"act_type": "decreto ministeriale", "article": "2"}, False),
    ({"act_type": "decreto del presidente del consiglio dei ministri", "article": "1"}, False),
    ({"act_type": "legge", "act_number": "241", "article": "2"}, False),
    ({"act_type": "Regolamento UE", "date": "2016"}, False),
    ({"article": "5"}, False),
    ({}, False),
    (None, False),
])
def test_identifies_act(params, expected):
    assert identifies_act(params) is expected


def test_the_linker_reads_the_same_list():
    # A DPCM with no number cannot be opened, so the bare article after it keeps the code's context.
    # Before the convention's list the linker's own lacked the DPCM, and art. 2059 became a DPCM's.
    text = "Si veda l'art. 2043 c.c.; l'art. 3 d.p.c.m. e poi l'art. 2059."
    citations = {c.article: c for c in extract_citations(text)}
    assert citations["3"].act_type == "decreto del presidente del consiglio dei ministri"
    assert citations["2059"].act_type == "codice civile"
