"""Unit tests for devil's-advocate canon derivation (Slice 4 P2a gap-closure).

`_derive_devils_advocate_expert` is a HEURISTIC, not a recorded ground-truth
attribution: the synthesizer never records which canon dissented, so we
approximate it as the minority canon (lowest `weight`, falling back to
`confidence`) within the pairwise conflict with the highest `conflict_score`.
"""

from __future__ import annotations

from types import SimpleNamespace

from merlt.api.experts_router import (
    _build_devils_advocate_flag,
    _derive_devils_advocate_expert,
)


def _pair(expert_a: str, expert_b: str, conflict_score: float) -> SimpleNamespace:
    return SimpleNamespace(expert_a=expert_a, expert_b=expert_b, conflict_score=conflict_score)


def _result(*, disagreement_analysis=None, expert_contributions=None, devils_advocate_flag=None):
    kwargs = {}
    if disagreement_analysis is not None:
        kwargs["disagreement_analysis"] = disagreement_analysis
    if expert_contributions is not None:
        kwargs["expert_contributions"] = expert_contributions
    if devils_advocate_flag is not None:
        kwargs["devils_advocate_flag"] = devils_advocate_flag
    return SimpleNamespace(**kwargs)


def test_derive_returns_none_when_no_disagreement_analysis():
    result = _result(expert_contributions={"literal": {"weight": 0.5}})
    assert _derive_devils_advocate_expert(result) is None


def test_derive_returns_none_when_no_conflicting_pairs():
    result = _result(
        disagreement_analysis=SimpleNamespace(conflicting_pairs=[]),
        expert_contributions={"literal": {"weight": 0.5}, "systemic": {"weight": 0.3}},
    )
    assert _derive_devils_advocate_expert(result) is None


def test_derive_picks_minority_by_weight_within_top_conflict():
    # Two pairs; the highest conflict_score pair is (systemic, principles).
    # Within that pair, "principles" has the lower weight -> minority/dissenter.
    result = _result(
        disagreement_analysis=SimpleNamespace(
            conflicting_pairs=[
                _pair("literal", "precedent", conflict_score=0.4),
                _pair("systemic", "principles", conflict_score=0.9),
            ]
        ),
        expert_contributions={
            "literal": {"weight": 0.2, "confidence": 0.9},
            "systemic": {"weight": 0.7, "confidence": 0.6},
            "principles": {"weight": 0.1, "confidence": 0.8},
            "precedent": {"weight": 0.3, "confidence": 0.5},
        },
    )
    assert _derive_devils_advocate_expert(result) == "principles"


def test_derive_falls_back_to_confidence_when_weight_absent():
    result = _result(
        disagreement_analysis=SimpleNamespace(
            conflicting_pairs=[_pair("literal", "systemic", conflict_score=0.8)]
        ),
        expert_contributions={
            "literal": {"confidence": 0.9},
            "systemic": {"confidence": 0.4},
        },
    )
    assert _derive_devils_advocate_expert(result) == "systemic"


def test_derive_returns_none_when_a_candidate_is_missing_from_contributions():
    result = _result(
        disagreement_analysis=SimpleNamespace(
            conflicting_pairs=[_pair("literal", "systemic", conflict_score=0.8)]
        ),
        expert_contributions={"literal": {"weight": 0.5}},  # systemic missing
    )
    assert _derive_devils_advocate_expert(result) is None


def test_build_devils_advocate_flag_active_with_derived_expert():
    result = _result(
        devils_advocate_flag=True,
        disagreement_analysis=SimpleNamespace(
            conflicting_pairs=[_pair("literal", "systemic", conflict_score=0.8)]
        ),
        expert_contributions={
            "literal": {"weight": 0.6},
            "systemic": {"weight": 0.2},
        },
    )
    flag = _build_devils_advocate_flag(result)
    assert flag.active is True
    assert flag.expert == "systemic"


def test_build_devils_advocate_flag_inactive_or_undetectable_stays_none():
    result = _result(devils_advocate_flag=False)
    flag = _build_devils_advocate_flag(result)
    assert flag.active is False
    assert flag.expert is None


def test_build_devils_advocate_flag_missing_attribute_returns_none():
    result = SimpleNamespace()  # no devils_advocate_flag at all
    assert _build_devils_advocate_flag(result) is None
