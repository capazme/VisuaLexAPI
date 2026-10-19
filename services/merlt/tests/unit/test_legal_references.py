"""Unit tests for Loop β #2 — build_legal_references.

Pure mapping from a VisuaLex /parse_query payload to structured legal
references (human display form for cite_law + canonical URN for the graph).
No network, no heavy deps.
"""

from merlt.experts.query_analyzer import build_legal_references


def test_recognized_query_builds_human_display_and_urn():
    parse_result = {
        "recognized": True,
        "parsed": {"act_type": "codice civile", "article": "1453"},
        "urn": "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453",
        "display": "Art. 1453 — codice civile",
        "source": "nl_parser",
    }
    refs = build_legal_references(parse_result)
    assert len(refs) == 1
    # The display is rebuilt into the form cite_law accepts (verified live),
    # NOT the dash-form VisuaLex returns.
    assert refs[0]["display"] == "art. 1453 codice civile"
    assert refs[0]["urn"].endswith("~art1453")
    assert refs[0]["act_type"] == "codice civile"
    assert refs[0]["article"] == "1453"


def test_unrecognized_returns_empty():
    assert build_legal_references({"recognized": False, "parsed": None}) == []
    assert build_legal_references(None) == []
    assert build_legal_references({}) == []


def test_law_with_number_keeps_fields():
    parse_result = {
        "recognized": True,
        "parsed": {
            "act_type": "legge",
            "act_number": "241",
            "date": "1990",
            "article": "1",
        },
        "urn": "https://example/urn~art1",
    }
    refs = build_legal_references(parse_result)
    # Numbered acts must carry number/year so cite_law can resolve them
    # (verified live: "art. 1 legge 241/1990" resolves; "art. 1 legge" does not).
    assert refs[0]["display"] == "art. 1 legge 241/1990"
    assert refs[0]["act_number"] == "241"
    assert refs[0]["date"] == "1990"
    assert refs[0]["article"] == "1"


def test_act_type_only_falls_back_to_provided_display():
    parse_result = {
        "recognized": True,
        "parsed": {"act_type": "costituzione"},
        "display": "Costituzione",
    }
    refs = build_legal_references(parse_result)
    assert len(refs) == 1
    assert refs[0]["display"] == "Costituzione"
    assert refs[0]["article"] is None
