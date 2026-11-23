"""The reviews' copy of the decision identity is pinned to the convention's golden file (design
2026-10-30-rassegne-without-merlt §3.1): MERL-T's copy is pinned to the same keys by its own
`tests/unit/test_sources_golden.py`, so the two cannot drift apart unnoticed."""
import pytest

from tests.test_sources_golden import _DECISIONS
from visualex_api.services.decisions.model import Identity
from visualex_api.services.massimario.identity import DecisionIdentity


@pytest.mark.parametrize("case", _DECISIONS, ids=[c["id"] for c in _DECISIONS])
def test_the_reviews_key_is_the_golden_key(case):
    ref = case["input"]["reference"]
    identity = DecisionIdentity(ref["corte"], ref["numero"], ref["anno"], ref.get("archivio"),
                                ref.get("sede"), ref.get("provvedimento"))
    assert identity.key == case["identity"]["key"]["value"]
    # and the decision page's own model agrees
    assert identity.key == Identity(ref["corte"], ref["numero"], ref["anno"], ref.get("archivio"),
                                    ref.get("sede"), ref.get("provvedimento")).key()


@pytest.mark.parametrize("args", [
    ("cassazione", 1, 2024, None),          # no archive
    ("corte_costituzionale", 1, 2024, "civile"),
    ("cassazione", 0, 2024, "civile"),
    ("cassazione", 1, 1899, "civile"),
    ("tar", 1, 2020, None, "atlantide", "sent"),
    ("tribunale_ue", 1, 1980),
    ("corte_suprema", 1, 2024),
])
def test_an_impossible_identity_is_refused(args):
    with pytest.raises(ValueError):
        DecisionIdentity(*args)
