"""Slice 4 L3 — teach-the-weights, traversal head: unit tests.

Covers the four L3 pieces:

1. **Neural traversal SAFE BLEND** (``SystemicExpert._select_traversal_relations``):
   the static curated floor is ALWAYS traversed; the TraversalPolicy can only
   ADD/reorder. Untrained/uniform policy ⇒ exactly today's static list.
2. **Env flag** ``MERLT_NEURAL_TRAVERSAL_ENABLED=false`` ⇒ exactly the legacy
   static behaviour (no policy call, no trace recording).
3. **preferred_relation shaping** in the traversal trainer:
   ``advantage = authority·(reward + β·preferred)`` — strictly larger for the
   preferred relation, authority-scaled, and P(preferred) RISES end-to-end
   through the REAL TraversalPolicy (REINFORCE sign proof).
4. **Checkpoint-safe expert one-hot**: a legacy (pre-one-hot) state_dict loads
   via zero-init column expansion and produces IDENTICAL outputs.

Plus regression guards for the P2b invariants (authority default,
TraversalTrainingSample fields, shaping betas).

Pure-python tests run everywhere; torch-dependent tests are skipped gracefully
when torch is unavailable (they run in-container).
"""

import asyncio
import math

import pytest

from merlt.rlcf.policy_gradient import (
    GATING_SHAPING_BETA,
    KNOWN_RELATION_VOCABULARY,
    RELATION_FEEDBACK_SOURCE_PREFIX,
    RELATION_PREFERENCE_REWARD,
    TRAVERSAL_EXPERT_TYPES,
    TRAVERSAL_RELATION_TYPES,
    TRAVERSAL_SHAPING_BETA,
    _extract_authority,
    normalize_relation_type,
    preferred_relation_from_source_id,
)
from merlt.rlcf.traversal_training_service import (
    TraversalTrainingSample,
    TraversalTrainingService,
)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

STATIC_FLOOR = ["DISCIPLINA", "modifica", "abroga", "interpreta", "IMPONE"]


def _run(coro):
    """Run a coroutine to completion (no pytest-asyncio dependency in-container)."""
    return asyncio.run(coro)


class _FakePolicyManager:
    """Stub PolicyManager: scores keyed on POLICY-vocab relation names."""

    def __init__(self, scores=None, available=True):
        self.scores = scores or {}
        self.available = available
        self.batch_calls = []

    def is_traversal_policy_available(self):
        return self.available

    async def compute_batch_weights(self, query_embedding, relation_types, expert_type, trace=None):
        self.batch_calls.append((tuple(relation_types), expert_type))
        return {
            rel: self.scores.get(rel, (0.5, math.log(0.5)))
            for rel in relation_types
        }


def _make_expert(pm=None):
    from merlt.experts.systemic import SystemicExpert

    return SystemicExpert(policy_manager=pm)


def _ctx(embedding=None):
    from merlt.experts.base import ExpertContext

    return ExpertContext(
        query_text="quali norme hanno modificato l'art. 2043 c.c.?",
        query_embedding=embedding,
        trace_id="trace_l3_test",
    )


@pytest.fixture(autouse=True)
def _reset_traversal_flag():
    """The env flag is read once and cached — reset around every test."""
    from merlt.experts import systemic

    systemic._reset_neural_traversal_flag_for_tests()
    yield
    systemic._reset_neural_traversal_flag_for_tests()


# ===========================================================================
# vocabulary helpers (pure python)
# ===========================================================================

def test_normalize_maps_graph_names_to_policy_vocab():
    assert normalize_relation_type("modifica") == "MODIFICA"
    assert normalize_relation_type("abroga") == "ABROGA"
    assert normalize_relation_type("interpreta") == "INTERPRETED_BY"
    assert normalize_relation_type("DISCIPLINA") == "APPLIES_TO"
    assert normalize_relation_type("IMPONE") == "APPLIES_TO"
    assert normalize_relation_type("rinvia") == "RIFERIMENTO"


def test_normalize_keeps_policy_vocab_verbatim():
    for rel in TRAVERSAL_RELATION_TYPES:
        assert normalize_relation_type(rel) == rel


def test_normalize_unknown_passes_through_and_empty_is_related_to():
    # Unknown names pass through (get_relation_index applies its own fallback)
    assert normalize_relation_type("RELAZIONE_NUOVA") == "RELAZIONE_NUOVA"
    assert normalize_relation_type("") == "RELATED_TO"


def test_preferred_relation_decoding():
    assert preferred_relation_from_source_id("relation:modifica") == "modifica"
    assert preferred_relation_from_source_id("relation:DISCIPLINA") == "DISCIPLINA"
    assert preferred_relation_from_source_id("urn:nir:stato:codice.civile:1942;art2043") is None
    assert preferred_relation_from_source_id(None) is None
    assert preferred_relation_from_source_id("relation:") is None
    assert RELATION_FEEDBACK_SOURCE_PREFIX == "relation:"


def test_known_vocabulary_covers_static_floor_and_policy_vocab():
    for rel in STATIC_FLOOR:
        assert rel in KNOWN_RELATION_VOCABULARY or rel.lower() in KNOWN_RELATION_VOCABULARY
    for rel in TRAVERSAL_RELATION_TYPES:
        assert rel in KNOWN_RELATION_VOCABULARY


# ===========================================================================
# (i) blend safety — static floor always present, uniform policy ≈ today
# ===========================================================================

def test_uniform_policy_returns_exactly_the_static_floor(monkeypatch):
    """An untrained/uniform policy scores everything ~equal ⇒ no extra clears
    the floor_max+margin threshold ⇒ the selection is EXACTLY today's list."""
    monkeypatch.setenv("MERLT_NEURAL_TRAVERSAL_ENABLED", "true")
    pm = _FakePolicyManager()  # every relation scores 0.5
    expert = _make_expert(pm)
    chosen = _run(expert._select_traversal_relations(_ctx([0.1] * 8)))
    assert chosen == STATIC_FLOOR  # same content AND order (stable tie sort)
    assert len(pm.batch_calls) == 1


def test_skewed_policy_adds_extras_but_never_drops_the_floor(monkeypatch):
    monkeypatch.setenv("MERLT_NEURAL_TRAVERSAL_ENABLED", "true")
    pm = _FakePolicyManager(scores={
        "DEROGA": (0.95, math.log(0.95)),       # graph name: deroga
        "RIFERIMENTO": (0.90, math.log(0.90)),  # graph name: rinvia
    })
    expert = _make_expert(pm)
    chosen = _run(expert._select_traversal_relations(_ctx([0.1] * 8)))

    # Floor fully present (the non-negotiable safety invariant)
    for rel in STATIC_FLOOR:
        assert rel in chosen
    # The two clearly-better extras were ADDED (score > floor_max + margin)
    assert "deroga" in chosen
    assert "rinvia" in chosen
    assert len(chosen) == len(STATIC_FLOOR) + 2
    # Reordered by score: the best-scoring relation leads
    assert chosen[0] == "deroga"


def test_extras_are_capped_at_max_extra(monkeypatch):
    monkeypatch.setenv("MERLT_NEURAL_TRAVERSAL_ENABLED", "true")
    pm = _FakePolicyManager(scores={
        "DEROGA": (0.99, math.log(0.99)),
        "RIFERIMENTO": (0.98, math.log(0.98)),
        "CITATO_DA": (0.97, math.log(0.97)),  # graph name: cita — third extra
    })
    expert = _make_expert(pm)
    chosen = _run(expert._select_traversal_relations(_ctx([0.1] * 8)))
    extras = [r for r in chosen if r not in STATIC_FLOOR]
    assert len(extras) == expert.NEURAL_TRAVERSAL_MAX_EXTRA
    assert set(extras) == {"deroga", "rinvia"}  # top-2 by score


def test_floor_survives_even_when_policy_hates_it(monkeypatch):
    """Even if the policy scores the floor at ~0, every floor relation stays."""
    monkeypatch.setenv("MERLT_NEURAL_TRAVERSAL_ENABLED", "true")
    low = (0.01, math.log(0.01))
    pm = _FakePolicyManager(scores={
        "APPLIES_TO": low, "MODIFICA": low, "ABROGA": low, "INTERPRETED_BY": low,
        "DEROGA": (0.9, math.log(0.9)),
    })
    expert = _make_expert(pm)
    chosen = _run(expert._select_traversal_relations(_ctx([0.1] * 8)))
    for rel in STATIC_FLOOR:
        assert rel in chosen


def test_policy_unavailable_falls_back_to_static(monkeypatch):
    monkeypatch.setenv("MERLT_NEURAL_TRAVERSAL_ENABLED", "true")
    pm = _FakePolicyManager(available=False)
    expert = _make_expert(pm)
    chosen = _run(expert._select_traversal_relations(_ctx([0.1] * 8)))
    assert chosen == STATIC_FLOOR
    assert pm.batch_calls == []  # never scored


def test_no_embedding_falls_back_to_static(monkeypatch):
    monkeypatch.setenv("MERLT_NEURAL_TRAVERSAL_ENABLED", "true")
    pm = _FakePolicyManager(scores={"DEROGA": (0.99, -0.01)})
    expert = _make_expert(pm)
    chosen = _run(expert._select_traversal_relations(_ctx(embedding=None)))
    assert chosen == STATIC_FLOOR
    assert pm.batch_calls == []


# ===========================================================================
# (ii) flag off → exact static behavior
# ===========================================================================

def test_flag_off_is_exactly_the_legacy_static_path(monkeypatch):
    monkeypatch.setenv("MERLT_NEURAL_TRAVERSAL_ENABLED", "false")
    from merlt.experts import systemic

    systemic._reset_neural_traversal_flag_for_tests()

    pm = _FakePolicyManager(scores={"DEROGA": (0.99, -0.01)})
    expert = _make_expert(pm)
    ctx = _ctx([0.1] * 8)
    expert._init_trace(ctx)
    chosen = _run(expert._select_traversal_relations(ctx))

    assert chosen == STATIC_FLOOR          # identical list, identical order
    assert pm.batch_calls == []            # the policy is NEVER consulted
    # and NOTHING is recorded — byte-for-byte today's behaviour
    assert expert._current_trace.num_actions == 0


@pytest.mark.parametrize("raw", ["0", "", "FALSE", "False"])
def test_flag_off_variants(monkeypatch, raw):
    monkeypatch.setenv("MERLT_NEURAL_TRAVERSAL_ENABLED", raw)
    from merlt.experts import systemic

    systemic._reset_neural_traversal_flag_for_tests()
    expert = _make_expert(_FakePolicyManager(scores={"DEROGA": (0.99, -0.01)}))
    chosen = _run(expert._select_traversal_relations(_ctx([0.1] * 8)))
    assert chosen == STATIC_FLOOR


# ===========================================================================
# (v) the trace records the traversal decision (log_probs + neural/fallback)
# ===========================================================================

def test_trace_records_scored_relations_with_log_probs(monkeypatch):
    monkeypatch.setenv("MERLT_NEURAL_TRAVERSAL_ENABLED", "true")
    pm = _FakePolicyManager(scores={"DEROGA": (0.9, math.log(0.9))})
    expert = _make_expert(pm)
    ctx = _ctx([0.1] * 8)
    expert._init_trace(ctx)

    chosen = _run(expert._select_traversal_relations(ctx))

    actions = expert._current_trace.get_actions_by_type("graph_traversal")
    all_candidates = STATIC_FLOOR + expert.NEURAL_EXTRA_CANDIDATE_RELATIONS
    assert len(actions) == len(all_candidates)  # every scored candidate recorded

    by_rel = {a.parameters["relation_type"]: a for a in actions}
    for rel in all_candidates:
        a = by_rel[rel]
        assert isinstance(a.log_prob, float)
        assert a.metadata["neural"] is True
        assert a.metadata["source"] == "traversal_policy"
        assert a.metadata["expert_type"] == "systemic"
        assert a.metadata["selected"] == (rel in chosen)
        assert "policy_relation" in a.metadata
    # the floor is flagged as such (FE can distinguish curated vs learned)
    assert by_rel["modifica"].metadata["static_floor"] is True
    assert by_rel["deroga"].metadata["static_floor"] is False


def test_trace_records_fallback_when_policy_missing(monkeypatch):
    monkeypatch.setenv("MERLT_NEURAL_TRAVERSAL_ENABLED", "true")
    expert = _make_expert(_FakePolicyManager(available=False))
    ctx = _ctx([0.1] * 8)
    expert._init_trace(ctx)
    _run(expert._select_traversal_relations(ctx))

    actions = expert._current_trace.get_actions_by_type("graph_traversal")
    assert len(actions) == len(STATIC_FLOOR)
    for a in actions:
        assert a.metadata["neural"] is False
        assert a.metadata["source"] == "traversal_static_fallback"
        assert a.metadata["selected"] is True
        assert a.log_prob == 0.0


# ===========================================================================
# (iii) preferred_relation shaping — advantage math (pure python)
# ===========================================================================
#
# Trainer contract (traversal_training_service.train_traversal_policy):
#   advantage = reward + β·preferred        (loss term)
#   step lr   = lr · authority              (_authority_scaled_lr on the step)
# Authority lives in the STEP, not the loss: the loop steps Adam once per
# sample, and Adam's second-moment normalisation cancels a uniform loss
# scaling (design note in policy_gradient.py).
# REINFORCE: loss = -log σ(w) · advantage with log σ(w) < 0 and advantage > 0
# ⇒ minimizing raises log σ(w) ⇒ P(traverse preferred relation) RISES.

def _traversal_advantage(reward, preferred):
    shaping = TRAVERSAL_SHAPING_BETA if preferred else 0.0
    return reward + shaping


def test_preferred_relation_gets_strictly_larger_advantage():
    base = _traversal_advantage(RELATION_PREFERENCE_REWARD, preferred=False)
    pref = _traversal_advantage(RELATION_PREFERENCE_REWARD, preferred=True)
    assert pref > base
    assert math.isclose(pref - base, TRAVERSAL_SHAPING_BETA)


def test_authority_scales_the_relation_step_lr():
    """Authority is an lr-scale on the per-sample step (the Adam-correct
    per-sample importance weight), restored after the step."""
    from merlt.rlcf.policy_gradient import _authority_scaled_lr

    class _FakeOpt:
        def __init__(self):
            self.param_groups = [{"lr": 1e-4}]

    opt = _FakeOpt()
    with _authority_scaled_lr(opt, 3.0):
        assert math.isclose(opt.param_groups[0]["lr"], 3e-4)
    assert math.isclose(opt.param_groups[0]["lr"], 1e-4)


def test_relation_advantage_is_always_positive():
    """Load-bearing REINFORCE-sign invariant: no baseline subtraction in this
    trainer and reward ≥ 0, so the preferred relation's advantage can never go
    negative (which would train the OPPOSITE direction)."""
    assert _traversal_advantage(RELATION_PREFERENCE_REWARD, preferred=True) > 0
    assert _traversal_advantage(0.0, preferred=True) > 0  # even at zero reward


def test_betas_mirror_each_other():
    assert TRAVERSAL_SHAPING_BETA == GATING_SHAPING_BETA == 0.3
    assert RELATION_PREFERENCE_REWARD == 0.7  # mirror of the preference channel


# ===========================================================================
# (iii) end-to-end: P(preferred relation) rises through the REAL TraversalPolicy
# ===========================================================================

def _save_seeded_policy(torch, tmp_dir, seed, input_dim=32):
    """Create a seeded small TraversalPolicy and persist it as 'latest'."""
    from pathlib import Path

    from merlt.rlcf.policy_gradient import TraversalPolicy
    from merlt.rlcf.policy_manager import PolicyConfig, PolicyManager

    torch.manual_seed(seed)
    policy = TraversalPolicy(input_dim=input_dim, relation_dim=8, hidden_dim=16, device="cpu")
    pm = PolicyManager(config=PolicyConfig(checkpoint_dir=Path("checkpoints")))
    pm.save_traversal_policy(policy, name="latest")
    return pm


def _measure_weight(torch, pm, embedding, relation, expert_type):
    policy = pm.get_traversal_policy()
    assert policy is not None
    policy.eval()
    q = torch.tensor([embedding], dtype=torch.float32)
    rel = torch.tensor([policy.get_relation_index(relation)], dtype=torch.long)
    eidx = policy.get_expert_index(expert_type)
    et = torch.tensor([eidx], dtype=torch.long) if eidx is not None else None
    with torch.no_grad():
        w, _ = policy.forward(q, rel, et)
    return float(w[0, 0])


def _train_relation_preference(tmp_path, monkeypatch, authority):
    """Shared harness: returns (w_before, w_after) for the preferred relation."""
    torch = pytest.importorskip("torch")
    monkeypatch.chdir(tmp_path)

    embedding = [0.05] * 32
    preferred_rel = "MODIFICA"

    pm = _save_seeded_policy(torch, tmp_path, seed=42)
    w_before = _measure_weight(torch, pm, embedding, preferred_rel, "systemic")

    samples = [
        TraversalTrainingSample(
            query_embedding=embedding,
            relation_type=preferred_rel,
            expert_type="systemic",
            reward=RELATION_PREFERENCE_REWARD,
            authority=authority,
            preferred=True,
        )
        for _ in range(30)  # ≥ MIN_SAMPLES
    ]

    torch.manual_seed(123)  # deterministic dropout across runs
    svc = TraversalTrainingService()
    result = _run(svc.train_traversal_policy(samples, epochs=3))
    assert result.samples_used == 30
    assert result.epochs_completed == 3

    pm.reset_policies()
    w_after = _measure_weight(torch, pm, embedding, preferred_rel, "systemic")
    return w_before, w_after


def test_preferring_a_relation_raises_its_traversal_probability(tmp_path, monkeypatch):
    """END-TO-END gradient direction through the REAL TraversalPolicy: after
    relation-preference training, P(traverse preferred | query) must RISE."""
    w_before, w_after = _train_relation_preference(tmp_path, monkeypatch, authority=1.0)
    assert w_after > w_before, (
        f"P(MODIFICA) should rise after preferring it: {w_before:.4f} -> {w_after:.4f}"
    )


def test_higher_authority_steers_the_relation_more(tmp_path, monkeypatch):
    """The senior jurist's steer moves the traversal weight strictly more than
    the novice's (identical seeds, only authority differs)."""
    pytest.importorskip("torch")
    d1 = tmp_path / "novice"
    d2 = tmp_path / "senior"
    d1.mkdir()
    d2.mkdir()
    b1, a1 = _train_relation_preference(d1, monkeypatch, authority=1.0)
    b2, a2 = _train_relation_preference(d2, monkeypatch, authority=3.0)
    assert math.isclose(b1, b2, abs_tol=1e-7)  # same seeded start
    shift_novice = a1 - b1
    shift_senior = a2 - b2
    assert shift_senior > shift_novice > 0


# ===========================================================================
# (iv) checkpoint zero-init expansion: legacy weights load, output identical
# ===========================================================================

def test_legacy_state_dict_loads_and_outputs_are_identical():
    torch = pytest.importorskip("torch")
    import torch.nn as nn

    from merlt.rlcf.policy_gradient import TraversalPolicy

    input_dim, relation_dim, hidden = 32, 8, 16

    # A LEGACY-architecture MLP (no expert one-hot columns)
    legacy_mlp = nn.Sequential(
        nn.Linear(input_dim + relation_dim, hidden),
        nn.ReLU(),
        nn.Dropout(0.1),
        nn.Linear(hidden, hidden // 2),
        nn.ReLU(),
        nn.Linear(hidden // 2, 1),
        nn.Sigmoid(),
    )
    legacy_sd = legacy_mlp.state_dict()

    policy = TraversalPolicy(
        input_dim=input_dim, relation_dim=relation_dim, hidden_dim=hidden, device="cpu"
    )
    policy.load_mlp_state_dict(legacy_sd)  # zero-init expansion

    policy.eval()
    legacy_mlp.eval()

    q = torch.randn(4, input_dim)
    rel_idx = torch.tensor([0, 2, 5, 9], dtype=torch.long)
    with torch.no_grad():
        rel_emb = policy.relation_embeddings(rel_idx)
        legacy_out = legacy_mlp(torch.cat([q, rel_emb], dim=-1))

        # Unconditioned forward (expert one-hot = zeros) == legacy output
        w_none, _ = policy.forward(q, rel_idx, None)
        assert torch.allclose(w_none, legacy_out, atol=1e-6)

        # ANY expert one-hot multiplies zero columns ⇒ still identical
        for i in range(len(TRAVERSAL_EXPERT_TYPES)):
            w_e, _ = policy.forward(
                q, rel_idx, torch.tensor([i] * 4, dtype=torch.long)
            )
            assert torch.allclose(w_e, legacy_out, atol=1e-6)


def test_legacy_checkpoint_file_loads_through_policy_manager(tmp_path):
    """Boot-path proof: a LEGACY traversal_policy_latest.pt (saved before the
    expert one-hot existed) loads through PolicyManager without error."""
    torch = pytest.importorskip("torch")
    import torch.nn as nn

    from merlt.rlcf.policy_manager import PolicyConfig, PolicyManager

    input_dim, relation_dim, hidden = 32, 8, 16
    legacy_mlp = nn.Sequential(
        nn.Linear(input_dim + relation_dim, hidden),
        nn.ReLU(),
        nn.Dropout(0.1),
        nn.Linear(hidden, hidden // 2),
        nn.ReLU(),
        nn.Linear(hidden // 2, 1),
        nn.Sigmoid(),
    )
    legacy_emb = nn.Embedding(len(TRAVERSAL_RELATION_TYPES), relation_dim)

    ckpt_dir = tmp_path / "checkpoints"
    ckpt_dir.mkdir()
    torch.save(
        {
            "input_dim": input_dim,
            "relation_dim": relation_dim,
            "hidden_dim": hidden,
            "mlp_state_dict": legacy_mlp.state_dict(),
            "relation_embeddings_state_dict": legacy_emb.state_dict(),
            "relation_types": list(TRAVERSAL_RELATION_TYPES),
        },
        ckpt_dir / "traversal_policy_latest.pt",
    )

    pm = PolicyManager(config=PolicyConfig(checkpoint_dir=ckpt_dir, device="cpu"))
    policy = pm.get_traversal_policy()
    assert policy is not None
    # sanity forward on the expanded net
    q = torch.zeros(1, input_dim)
    rel = torch.tensor([0], dtype=torch.long)
    with torch.no_grad():
        w, lp = policy.forward(q, rel, None)
    assert 0.0 <= float(w[0, 0]) <= 1.0


def test_incompatible_state_dict_is_rejected():
    torch = pytest.importorskip("torch")
    import torch.nn as nn

    from merlt.rlcf.policy_gradient import TraversalPolicy

    policy = TraversalPolicy(input_dim=32, relation_dim=8, hidden_dim=16, device="cpu")
    bogus = nn.Sequential(
        nn.Linear(7, 16), nn.ReLU(), nn.Dropout(0.1),
        nn.Linear(16, 8), nn.ReLU(), nn.Linear(8, 1), nn.Sigmoid(),
    )
    with pytest.raises(ValueError):
        policy.load_mlp_state_dict(bogus.state_dict())


# ===========================================================================
# (vi) regression — P2b invariants unchanged
# ===========================================================================

def test_traversal_sample_defaults_preserve_p2b_contract():
    """P2b regression: `authority` still defaults to 1.0 and the new `preferred`
    defaults to False, so every pre-L3 sample trains with advantage == reward."""
    s = TraversalTrainingSample(
        query_embedding=[0.0] * 4,
        relation_type="RIFERIMENTO",
        expert_type="literal",
        reward=0.5,
    )
    assert s.authority == 1.0
    assert s.preferred is False
    # advantage (loss term) is authority-free; authority=1.0 leaves the step
    # lr untouched, so a pre-L3 sample trains exactly as before.
    assert math.isclose(_traversal_advantage(s.reward, s.preferred), s.reward)


def test_gating_authority_helper_unchanged():
    """P2b regression: the gating/tool heads' authority extraction still
    defaults to 1.0 on absent/invalid values."""

    class Bare:
        pass

    assert _extract_authority(Bare()) == 1.0

    class WithMeta:
        metadata = {"authority": 2.0}

    assert _extract_authority(WithMeta()) == 2.0


def test_gating_expert_names_and_traversal_expert_types_aligned():
    from merlt.rlcf.policy_gradient import GATING_EXPERT_NAMES

    assert TRAVERSAL_EXPERT_TYPES == GATING_EXPERT_NAMES


def test_wire_reward_contract_for_relation_channel():
    """The endpoint wire assigns the relation channel the same fixed positive
    endorsement as the preference channel (0.7) — asserted via the module
    constant the trainer consumes."""
    assert RELATION_PREFERENCE_REWARD == 0.7
