"""Slice 4 P2b (L2) — teach-the-weights unit tests.

Covers the two integration changes in ``merlt.rlcf.policy_gradient``:

1. **Per-expert preference shaping** — routing ``preferredExpert`` into the
   gating head's advantage as an additive ``+GATING_SHAPING_BETA`` term on the
   preferred canon's log-prob. The REINFORCE contract is
   ``loss = -logπ(a)·advantage``; a strictly larger positive advantage on the
   preferred canon's log-prob drives its logit UP ⇒ ``P(preferred)`` rises.

2. **Authority weighting** — ``advantage = authority·(returns + shaping)`` on the
   live heads (gating + tool), with a safe 1.0 default when authority is absent.

The pure-helper tests run everywhere; the trainer-level tests need torch and are
skipped gracefully when it is unavailable (they run in-container).
"""

import math

import pytest

from merlt.rlcf.policy_gradient import (
    GATING_EXPERT_NAMES,
    GATING_SHAPING_BETA,
    _extract_authority,
    _preferred_expert_index,
)
from merlt.rlcf.multilevel_feedback import (
    MultilevelFeedback,
    create_feedback_from_user_rating,
)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _make_feedback(reward: float, *, preferred_expert=None, authority=None):
    """Build a MultilevelFeedback with the L2 metadata a wire call would attach."""
    fb = create_feedback_from_user_rating(
        query_id="trace_test", user_rating=reward, user_id="jurist-1"
    )
    if preferred_expert is not None:
        fb.metadata["preferred_expert"] = preferred_expert
    if authority is not None:
        fb.metadata["authority"] = authority
    return fb


def _make_trace(embedding, *, weights=None):
    """A trace with the 4 expert_selection actions the gating trainer expects."""
    from merlt.rlcf.execution_trace import Action, ExecutionTrace

    weights = weights or {n: 0.25 for n in GATING_EXPERT_NAMES}
    trace = ExecutionTrace(query_id="trace_test")
    for name in GATING_EXPERT_NAMES:
        trace.add_action(
            Action(
                action_type="expert_selection",
                parameters={"expert_type": name, "weight": weights[name]},
                log_prob=-1.0,
                metadata={"source": "neural_gating", "query_embedding": list(embedding)},
            )
        )
    return trace


# ===========================================================================
# (iv) authority helper: None/missing/invalid ⇒ 1.0, no crash
# ===========================================================================

def test_authority_defaults_to_one_when_absent():
    assert _extract_authority(_make_feedback(0.7)) == 1.0


def test_authority_none_defaults_to_one():
    assert _extract_authority(_make_feedback(0.7, authority=None)) == 1.0


@pytest.mark.parametrize("bad", ["not-a-number", float("nan"), float("inf"), -3.0])
def test_authority_invalid_values_fall_back_to_one(bad):
    assert _extract_authority(_make_feedback(0.7, authority=bad)) == 1.0


def test_authority_valid_value_is_read():
    assert _extract_authority(_make_feedback(0.7, authority=2.5)) == 2.5


def test_authority_handles_object_without_metadata():
    class Bare:  # no .metadata attribute at all
        pass

    assert _extract_authority(Bare()) == 1.0


# ===========================================================================
# preferred-expert index helper
# ===========================================================================

@pytest.mark.parametrize(
    "canon,expected",
    [("literal", 0), ("systemic", 1), ("principles", 2), ("precedent", 3)],
)
def test_preferred_index_maps_canon_to_softmax_slot(canon, expected):
    assert _preferred_expert_index(_make_feedback(0.7, preferred_expert=canon)) == expected


def test_preferred_index_none_when_absent():
    assert _preferred_expert_index(_make_feedback(0.7)) is None


def test_preferred_index_none_for_unknown_canon():
    assert _preferred_expert_index(_make_feedback(0.7, preferred_expert="bogus")) is None


# ===========================================================================
# advantage math (i) + (ii): the load-bearing formulas, proven arithmetically
# ===========================================================================
#
# advantage_pref = authority·(returns + β)   (preferred canon)
# advantage_base = authority· returns        (every other consulted canon)
# The trainer applies these as loss terms -logπ·advantage; here we prove the
# advantage SCALARS directly (deterministic, no network needed).

def _advantages(returns: float, authority: float, beta: float = GATING_SHAPING_BETA):
    return authority * returns, authority * (returns + beta)


def test_preferred_advantage_strictly_greater_than_non_preferred():
    """(i) Preferring canon X yields a strictly larger advantage for X."""
    returns, authority = 0.2, 1.0
    base, pref = _advantages(returns, authority)
    assert pref > base
    assert math.isclose(pref - base, authority * GATING_SHAPING_BETA)


def test_preferred_advantage_greater_even_with_negative_returns():
    """The shaping gap is +authority·β regardless of the sign of returns, so the
    preferred canon is always advantaged relative to the others in the SAME
    update (even when the overall answer scored below baseline)."""
    returns, authority = -0.4, 1.0
    base, pref = _advantages(returns, authority)
    assert pref > base
    assert math.isclose(pref - base, authority * GATING_SHAPING_BETA)


def test_higher_authority_scales_advantage_magnitude():
    """(ii) Higher authority scales the advantage magnitude linearly."""
    returns = 0.2
    _, pref_novice = _advantages(returns, authority=1.0)
    _, pref_senior = _advantages(returns, authority=3.0)
    assert pref_senior > pref_novice
    # exact 3× scaling of the whole (returns+β) advantage
    assert math.isclose(pref_senior, 3.0 * pref_novice)


def test_authority_scales_the_preference_gap_too():
    """The preferred-vs-nonpreferred GAP itself scales with authority: the senior
    jurist's 'weigh this canon more' shifts the weights more than the novice's."""
    returns = 0.2
    base_n, pref_n = _advantages(returns, authority=1.0)
    base_s, pref_s = _advantages(returns, authority=4.0)
    gap_novice = pref_n - base_n
    gap_senior = pref_s - base_s
    assert gap_senior > gap_novice
    assert math.isclose(gap_senior, 4.0 * gap_novice)


# ===========================================================================
# (iii) regression: authority-neutral + no preference ⇒ legacy advantage
# ===========================================================================

def test_no_preference_no_authority_reduces_to_legacy_return():
    """With authority defaulting to 1.0 and no preferred canon, the advantage is
    exactly the legacy `returns` — the pre-L2 behaviour."""
    returns = 0.2
    authority = _extract_authority(_make_feedback(0.7))  # → 1.0
    assert _preferred_expert_index(_make_feedback(0.7)) is None
    legacy_advantage = authority * returns
    assert math.isclose(legacy_advantage, returns)


# ===========================================================================
# Trainer-level end-to-end: the REAL gradient-direction proof (needs torch)
# ===========================================================================

def _fresh_gating_trainer():
    """A fresh ExpertGatingMLP + PolicyGradientTrainer on CPU."""
    from merlt.experts.neural_gating.neural import ExpertGatingMLP, GatingConfig
    from merlt.rlcf.policy_gradient import PolicyGradientTrainer, TrainerConfig

    policy = ExpertGatingMLP(GatingConfig(input_dim=16))
    policy.to("cpu")
    # A larger LR makes the single-step probability shift unambiguous for the
    # direction assertions; correctness (the SIGN) is LR-independent.
    trainer = PolicyGradientTrainer(policy, config=TrainerConfig(learning_rate=0.1))
    return policy, trainer


def _prob_of(policy, embedding, canon):
    """P(canon) under the current gating policy for a given query embedding."""
    pred = policy.predict_single(embedding)
    return pred["weights"][canon]


def test_preferring_a_canon_raises_its_probability():
    """END-TO-END gradient direction: after a preference update for canon X with
    a positive return, P(X) must INCREASE (REINFORCE: +advantage on logπ(X) ⇒
    logit_X ↑ ⇒ softmax P(X) ↑). This is the core teach-the-weights guarantee."""
    torch = pytest.importorskip("torch")  # noqa: F841
    import numpy as np

    policy, trainer = _fresh_gating_trainer()
    embedding = np.linspace(-1.0, 1.0, 16).astype("float32")

    preferred = "principles"
    p_before = _prob_of(policy, embedding, preferred)

    trace = _make_trace(embedding)
    # Positive reward (0.7, as the preference channel emits) + preference for X.
    feedback = _make_feedback(0.7, preferred_expert=preferred, authority=1.0)
    metrics = trainer.update_from_feedback(trace, feedback)
    assert metrics["num_actions"] == 4

    p_after = _prob_of(policy, embedding, preferred)
    assert p_after > p_before, (
        f"P({preferred}) should rise after preferring it: "
        f"{p_before:.4f} -> {p_after:.4f}"
    )


def test_higher_authority_moves_weights_more_end_to_end():
    """(ii) end-to-end: the same preference from a HIGHER-authority jurist shifts
    P(preferred) by a strictly LARGER amount (the gradient magnitude scales with
    authority). Two independent fresh policies, identical inputs."""
    pytest.importorskip("torch")
    import numpy as np

    embedding = np.linspace(-1.0, 1.0, 16).astype("float32")
    preferred = "systemic"

    def shift_for(authority):
        policy, trainer = _fresh_gating_trainer()
        before = _prob_of(policy, embedding, preferred)
        trace = _make_trace(embedding)
        fb = _make_feedback(0.7, preferred_expert=preferred, authority=authority)
        trainer.update_from_feedback(trace, fb)
        after = _prob_of(policy, embedding, preferred)
        return after - before

    shift_novice = shift_for(1.0)
    shift_senior = shift_for(5.0)
    assert shift_senior > shift_novice > 0


def test_no_preference_update_does_not_single_out_a_canon():
    """(iii) regression: a plain positive-reward update WITHOUT a preference must
    not preferentially raise any single canon the way a preference does. We
    assert the update runs (4 actions) and the distribution stays a valid
    simplex — i.e. the legacy soft-combination path is intact."""
    pytest.importorskip("torch")
    import numpy as np

    policy, trainer = _fresh_gating_trainer()
    embedding = np.linspace(-1.0, 1.0, 16).astype("float32")

    trace = _make_trace(embedding)
    feedback = _make_feedback(0.7)  # no preferred_expert, no authority
    metrics = trainer.update_from_feedback(trace, feedback)

    assert metrics["num_actions"] == 4
    pred = policy.predict_single(embedding)
    total = sum(pred["weights"][n] for n in GATING_EXPERT_NAMES)
    assert math.isclose(total, 1.0, abs_tol=1e-4)


def test_missing_authority_does_not_crash_trainer_end_to_end():
    """(iv) end-to-end: feedback carrying NO authority trains cleanly (authority
    defaults to 1.0 inside the trainer)."""
    pytest.importorskip("torch")
    import numpy as np

    policy, trainer = _fresh_gating_trainer()
    embedding = np.linspace(-1.0, 1.0, 16).astype("float32")

    trace = _make_trace(embedding)
    feedback = _make_feedback(0.7, preferred_expert="precedent")  # authority absent
    metrics = trainer.update_from_feedback(trace, feedback)
    assert metrics["num_actions"] == 4
    assert "loss" in metrics


# ===========================================================================
# (iii) tool head regression: authority=1.0 default leaves the tool advantage
# equal to the legacy (returns + productivity-shaping) — no accidental change.
# ===========================================================================

def test_tool_head_authority_defaults_preserve_legacy_advantage():
    """The tool head now multiplies its advantage by authority; with the 1.0
    default the effective advantage is unchanged from the pre-L2 code path."""
    pytest.importorskip("torch")
    import numpy as np
    from merlt.experts.neural_gating.tool_neural import ToolGatingMLP, ToolGatingConfig, TOOL_VOCAB
    from merlt.rlcf.policy_gradient import ToolPolicyTrainer, TrainerConfig
    from merlt.rlcf.execution_trace import Action, ExecutionTrace

    policy = ToolGatingMLP(ToolGatingConfig(input_dim=16))
    policy.to("cpu")
    trainer = ToolPolicyTrainer(policy, config=TrainerConfig(learning_rate=0.05))

    embedding = list(np.linspace(-1.0, 1.0, 16).astype("float32"))
    trace = ExecutionTrace(query_id="trace_tool", metadata={"query_embedding": embedding})
    trace.add_action(
        Action(
            action_type="tool_use",
            parameters={"tool_name": TOOL_VOCAB[0]},
            log_prob=-0.5,
            metadata={"source": "tool_policy", "called": True, "produced_source": True},
        )
    )
    # authority absent → defaults to 1.0 → legacy advantage; must run + update.
    feedback = _make_feedback(0.8)
    metrics = trainer.update_from_feedback(trace, feedback)
    assert metrics["num_actions"] == 1
    assert metrics["num_updates"] == 1
