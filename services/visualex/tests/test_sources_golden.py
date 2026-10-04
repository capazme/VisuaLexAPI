"""The convention for legal sources, as far as this API holds it today.

`conventions/sources/golden.json` (spec docs/superpowers/specs/2026-10-04-source-convention-design.md)
is read by every suite. Until this API adopts the convention, this test pins what the file
calls `current`: the URN `generate_urn` builds for a norm, and the key of a decision.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from visualex_api.services.decisions.model import Identity
from visualex_api.tools.urngenerator import generate_urn


def _golden() -> dict:
    for directory in Path(__file__).resolve().parents:
        candidate = directory / "conventions" / "sources" / "golden.json"
        if candidate.is_file():
            return json.loads(candidate.read_text(encoding="utf-8"))
    raise FileNotFoundError("conventions/sources/golden.json not found above " + __file__)


GOLDEN = _golden()

_NORMS = [c for c in GOLDEN["norms"] if c["identity"].get("article", {}).get("status") == "current"]
_DECISIONS = [c for c in GOLDEN["decisions"]
              if c["identity"].get("key", {}).get("status") == "current" and c["identity"]["key"]["value"]]


def test_the_file_has_current_cases():
    assert len(_NORMS) > 10
    assert len(_DECISIONS) > 4


@pytest.mark.parametrize("case", _NORMS, ids=[c["id"] for c in _NORMS])
def test_current_norm_identity_is_what_generate_urn_builds(case):
    n = case["input"]
    urn = generate_urn(n["tipo_atto"], n.get("data"), n.get("numero_atto"), n["numero_articolo"], n.get("allegato"))
    assert urn == case["identity"]["article"]["value"]
    act = case["identity"].get("act")
    if act and act["status"] == "current":
        assert urn.split("~")[0] == act["value"]


@pytest.mark.parametrize("case", _DECISIONS, ids=[c["id"] for c in _DECISIONS])
def test_current_decision_key_is_what_the_model_builds(case):
    ref = case["input"]["reference"]
    identity = Identity(ref["corte"], ref["numero"], ref["anno"], ref.get("archivio"))
    assert identity.key() == case["identity"]["key"]["value"]
