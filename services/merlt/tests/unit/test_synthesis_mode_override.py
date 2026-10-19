"""Per-request synthesis mode and per-expert partial weight.

The convergent/divergent mode the user picks rides in ``context.mode`` and must
reach the synthesizer as a PER-REQUEST override (never written to the shared
synthesizer config), with a convergent fallback when a forced divergent answer
has fewer than 2 usable experts. The async progress callback must report the
routing weight, not the expert's self-confidence.
"""

from __future__ import annotations

import asyncio
import importlib
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest

from merlt.disagreement.types import DisagreementAnalysis
from merlt.experts.base import ExpertResponse
from merlt.experts.orchestrator import (
    MultiExpertOrchestrator,
    OrchestratorConfig,
    coerce_synthesis_mode,
)
from merlt.experts.synthesizer import AdaptiveSynthesizer, SynthesisConfig, SynthesisMode


def _resp(expert_type: str, confidence: float = 0.8, text: str | None = None) -> ExpertResponse:
    return ExpertResponse(
        expert_type=expert_type,
        interpretation=text if text is not None else f"Tesi {expert_type}",
        confidence=confidence,
    )


AGREEMENT = DisagreementAnalysis(has_disagreement=False, confidence=0.9)
STRONG_DISAGREEMENT = DisagreementAnalysis(
    has_disagreement=True, intensity=1.0, resolvability=0.0, confidence=0.6
)


# ---------------------------------------------------------------------------
# _determine_mode precedence
# ---------------------------------------------------------------------------

def test_no_forced_mode_keeps_the_automatic_decision():
    s = AdaptiveSynthesizer()
    assert s._determine_mode(AGREEMENT) == SynthesisMode.CONVERGENT
    assert s._determine_mode(STRONG_DISAGREEMENT) == SynthesisMode.DIVERGENT


def test_forced_mode_overrides_auto():
    s = AdaptiveSynthesizer()
    assert (
        s._determine_mode(AGREEMENT, forced_mode=SynthesisMode.DIVERGENT, usable_responses=2)
        == SynthesisMode.DIVERGENT
    )
    assert (
        s._determine_mode(STRONG_DISAGREEMENT, forced_mode=SynthesisMode.CONVERGENT, usable_responses=4)
        == SynthesisMode.CONVERGENT
    )


def test_forced_auto_means_automatic():
    s = AdaptiveSynthesizer()
    assert s._determine_mode(STRONG_DISAGREEMENT, forced_mode=SynthesisMode.AUTO) == SynthesisMode.DIVERGENT


def test_forced_mode_beats_config_mode_and_config_beats_auto():
    s = AdaptiveSynthesizer(config=SynthesisConfig(mode=SynthesisMode.CONVERGENT))
    assert s._determine_mode(STRONG_DISAGREEMENT) == SynthesisMode.CONVERGENT
    assert (
        s._determine_mode(AGREEMENT, forced_mode=SynthesisMode.DIVERGENT, usable_responses=3)
        == SynthesisMode.DIVERGENT
    )


def test_forced_divergent_with_one_usable_expert_falls_back_to_convergent():
    s = AdaptiveSynthesizer()
    assert (
        s._determine_mode(AGREEMENT, forced_mode=SynthesisMode.DIVERGENT, usable_responses=1)
        == SynthesisMode.CONVERGENT
    )


# ---------------------------------------------------------------------------
# synthesize(): end to end, shared config untouched
# ---------------------------------------------------------------------------

async def test_synthesize_forced_divergent_on_agreeing_experts():
    s = AdaptiveSynthesizer()
    result = await s.synthesize(
        query="Il venditore puo' recedere?",
        responses=[_resp("literal", 0.8), _resp("systemic", 0.8)],
        forced_mode=SynthesisMode.DIVERGENT,
    )
    assert result.mode == SynthesisMode.DIVERGENT
    assert {a["expert"] for a in result.alternatives} == {"literal", "systemic"}
    assert s.config.mode == SynthesisMode.AUTO


async def test_synthesize_forced_divergent_counts_only_usable_experts():
    # A timed-out expert comes back with confidence 0.0: it is not an
    # alternative, so a single real answer falls back to convergent.
    s = AdaptiveSynthesizer()
    result = await s.synthesize(
        query="Il venditore puo' recedere?",
        responses=[_resp("literal", 0.8), _resp("systemic", 0.0, "Timeout")],
        forced_mode=SynthesisMode.DIVERGENT,
    )
    assert result.mode == SynthesisMode.CONVERGENT
    assert result.alternatives == []


async def test_concurrent_requests_keep_their_own_mode():
    s = AdaptiveSynthesizer()
    responses = [_resp("literal", 0.8), _resp("systemic", 0.8)]
    divergent, convergent, automatic = await asyncio.gather(
        s.synthesize("q uno", responses, forced_mode=SynthesisMode.DIVERGENT),
        s.synthesize("q due", responses, forced_mode=SynthesisMode.CONVERGENT),
        s.synthesize("q tre", responses),
    )
    assert divergent.mode == SynthesisMode.DIVERGENT
    assert convergent.mode == SynthesisMode.CONVERGENT
    assert automatic.mode == SynthesisMode.CONVERGENT  # agreeing experts
    assert s.config.mode == SynthesisMode.AUTO


# ---------------------------------------------------------------------------
# orchestrator: string → SynthesisMode, and process() threading
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "value, expected",
    [
        ("divergent", SynthesisMode.DIVERGENT),
        (" Convergent ", SynthesisMode.CONVERGENT),
        ("auto", SynthesisMode.AUTO),
        (SynthesisMode.DIVERGENT, SynthesisMode.DIVERGENT),
        (None, None),
        ("tesi", None),
        (42, None),
    ],
)
def test_coerce_synthesis_mode(value, expected):
    assert coerce_synthesis_mode(value) == expected


class _FakeExpert:
    def __init__(self, expert_type: str, confidence: float = 0.8):
        self.expert_type = expert_type
        self.confidence = confidence

    async def analyze(self, context):
        return _resp(self.expert_type, self.confidence)

    def collect_and_reset_traces(self):
        return {"llm_calls": [], "tool_calls": [], "react_steps": []}

    def get_graph_traversal(self):
        return []

    def get_current_trace(self):
        return None


class _FakeRouter:
    _last_method = "regex"

    def __init__(self, selected):
        self.selected = selected

    async def route(self, context):
        return SimpleNamespace(
            query_type="interpretive",
            expert_weights=dict(self.selected),
            get_selected_experts=lambda threshold: list(self.selected),
        )


class _SpySynthesizer(AdaptiveSynthesizer):
    def __init__(self):
        super().__init__()
        self.calls = []

    async def synthesize(self, *args, **kwargs):
        self.calls.append(kwargs)
        return await super().synthesize(*args, **kwargs)


class _NoVisualex:
    async def parse_query(self, query):
        raise RuntimeError("offline")

    async def extract_citations(self, query):
        raise RuntimeError("offline")


@pytest.fixture
def make_orchestrator(monkeypatch):
    monkeypatch.setattr("merlt.experts.orchestrator.get_visualex_client", lambda: _NoVisualex())
    monkeypatch.setattr(
        MultiExpertOrchestrator,
        "_build_experts",
        lambda self: {
            "literal": _FakeExpert("literal", 0.9),
            "systemic": _FakeExpert("systemic", 0.6),
        },
    )

    def _make(parallel: bool = True):
        synthesizer = _SpySynthesizer()
        orchestrator = MultiExpertOrchestrator(
            synthesizer=synthesizer,
            router=_FakeRouter([("literal", 0.6), ("systemic", 0.2)]),
            config=OrchestratorConfig(parallel_execution=parallel, enable_circuit_breaker=False),
        )
        return orchestrator, synthesizer

    return _make


async def test_process_forwards_the_requested_mode_per_call(make_orchestrator):
    orchestrator, synthesizer = make_orchestrator()

    result = await orchestrator.process("Il venditore puo' recedere dal contratto?", forced_mode="divergent")

    assert synthesizer.calls[-1]["forced_mode"] == SynthesisMode.DIVERGENT
    assert result.mode == SynthesisMode.DIVERGENT
    assert synthesizer.config.mode == SynthesisMode.AUTO
    recorded = result.metadata["execution_trace"]["metadata"]["synthesis_result"]
    assert recorded["requested_mode"] == "divergent"
    assert recorded["mode"] == "divergent"


async def test_process_without_mode_stays_automatic(make_orchestrator):
    orchestrator, synthesizer = make_orchestrator()

    result = await orchestrator.process("Il venditore puo' recedere dal contratto?", forced_mode="bogus")

    assert synthesizer.calls[-1]["forced_mode"] is None
    assert result.metadata["execution_trace"]["metadata"]["synthesis_result"]["requested_mode"] is None


@pytest.mark.parametrize("parallel", [True, False])
async def test_progress_callback_receives_the_routing_weight(make_orchestrator, parallel):
    orchestrator, _ = make_orchestrator(parallel=parallel)
    seen = {}

    async def on_expert_complete(resp, weight):
        seen[resp.expert_type] = weight

    result = await orchestrator.process(
        "Il venditore puo' recedere dal contratto?", on_expert_complete=on_expert_complete
    )

    # 0.6 / 0.2 normalised to sum 1, the same weights the terminal result carries.
    assert seen == pytest.approx({"literal": 0.75, "systemic": 0.25})
    terminal = {k: v["weight"] for k, v in result.expert_contributions.items()}
    assert terminal == pytest.approx(seen)


# ---------------------------------------------------------------------------
# experts_router: context.mode reaches process(), partial weight on the wire
# ---------------------------------------------------------------------------

def test_to_partial_uses_the_routing_weight_and_falls_back_to_confidence():
    import numpy as np

    from merlt.api.experts_router import _to_partial

    resp = _resp("literal", 0.9)
    assert _to_partial(resp, 0.4)["weight"] == 0.4
    assert _to_partial(resp)["weight"] == pytest.approx(0.9)
    weight = _to_partial(resp, np.float32(0.25))["weight"]
    assert type(weight) is float and weight == pytest.approx(0.25)


async def test_async_runner_forwards_mode_and_reports_routing_weight(monkeypatch):
    # merlt.api re-exports the APIRouter under the module's name: load the module.
    experts_router = importlib.import_module("merlt.api.experts_router")

    posted = []

    async def fake_callback(bff_job_id, status, **kwargs):
        posted.append((status, kwargs))

    @asynccontextmanager
    async def fake_session():
        yield object()

    async def fake_build(result, **kwargs):
        return SimpleNamespace(model_dump=lambda mode=None: {"trace_id": kwargs["trace_id"]})

    class FakeOrchestrator:
        def __init__(self):
            self.kwargs = None

        async def process(self, **kwargs):
            self.kwargs = kwargs
            await kwargs["on_expert_complete"](_resp("literal", 0.9), 0.7)
            return SimpleNamespace()

    monkeypatch.setattr(experts_router, "_post_qa_callback", fake_callback)
    monkeypatch.setattr(experts_router, "get_async_session", fake_session)
    monkeypatch.setattr(experts_router, "build_and_persist_query_response", fake_build)

    orchestrator = FakeOrchestrator()
    request = experts_router.ExpertQueryAsyncRequest(
        query="Il venditore puo' recedere?",
        user_id="user-1",
        context={"mode": "divergent"},
        bff_job_id="job-1",
    )
    await experts_router.run_query_progressive(request, orchestrator, trace_id="trace_x")

    assert orchestrator.kwargs["forced_mode"] == "divergent"
    running = [kw["partial_expert"] for status, kw in posted if status == "running"]
    assert running == [{"expert": "literal", "thesis": "Tesi literal", "confidence": 0.9, "weight": 0.7}]
    assert posted[-1][0] == "completed"


def test_refine_keeps_the_mode_of_the_original_answer():
    from merlt.api.experts_router import _refine_mode

    requested = SimpleNamespace(
        synthesis_mode="convergent",
        full_trace={"execution_trace": {"metadata": {"synthesis_result": {"requested_mode": "divergent"}}}},
    )
    legacy = SimpleNamespace(synthesis_mode="divergent", full_trace=None)
    unknown = SimpleNamespace(synthesis_mode=None, full_trace={})

    # The user asked for divergent (the answer fell back to convergent): keep asking.
    assert _refine_mode(requested) == "divergent"
    assert _refine_mode(legacy) == "divergent"
    assert _refine_mode(unknown) is None
