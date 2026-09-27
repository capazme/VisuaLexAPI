"""
Tool Selector (Loop β — task E.3, orchestrator-side)
====================================================

Bridges the ``ToolGatingMLP`` policy to the reasoning pipeline. Lives in the
orchestrator (where the query embedding and the selected experts are available
*before* the experts are dispatched), so ``experts/base.py`` — a CRITICAL file —
needs only a one-line additive read of the resulting selection.

Per query it:
  1. assigns an **A/B arm** (deterministic hash of the query id) — ``treatment``
     (the policy prunes) vs ``control`` (all tools fire, exploration);
  2. runs the policy ONCE (query-conditioned) → per-tool P(call);
  3. for each selected expert, masks to that expert's curated tools, samples
     Bernoulli call decisions (floor ≥1 tool so grounding is never starved);
  4. emits a ``tool_use`` Action per tool into the trace (BOTH arms — the
     control arm feeds the "should-have-called" signal), recording the policy's
     ``log_prob`` of the action that ``base.py`` will actually take;
  5. returns the per-expert pruned selection **only for the treatment arm**
     (``{expert_type: [tool...]}``) — the orchestrator writes it into
     ``context.entities["selected_live_tools"]``. Control returns ``None`` →
     ``base.py`` falls back to ALL tools.

Fully failure-isolated: any error returns ``None`` (fallback to A.3 all-tools),
never breaking the answer path.
"""

import hashlib
import math
import random
import structlog
from typing import Any, Dict, List, Optional

import numpy as np

from merlt.experts.neural_gating.tool_neural import TOOL_VOCAB, WARM_START_PROB

log = structlog.get_logger()

_EPS = 1e-8


class ToolSelector:
    """Holds the tool-gating policy + A/B config; selects and traces tool calls."""

    def __init__(
        self,
        policy: Any,
        expert_tool_map: Dict[str, Any],
        *,
        enabled: bool = True,
        ab_ratio: float = 0.7,
    ):
        """
        Args:
            policy: a ``ToolGatingMLP`` (or None → disabled).
            expert_tool_map: ``{expert_type: iterable[tool_name]}`` (the curated
                ``EXPERT_MCP_TOOLS``). Restricted to known TOOL_VOCAB and ordered.
            enabled: master on/off (``MERLT_TOOL_GATING_ENABLED``).
            ab_ratio: fraction of queries in the treatment (pruning) arm
                (``MERLT_TOOL_GATING_AB_RATIO``). 0.0 = pure shadow, 1.0 = always prune.
        """
        self.policy = policy
        self.enabled = bool(enabled) and policy is not None
        self.ab_ratio = max(0.0, min(1.0, float(ab_ratio)))
        # Per-expert ordered tool subset (intersection with the global vocab).
        self.expert_tool_map: Dict[str, List[str]] = {
            et: [t for t in TOOL_VOCAB if t in set(tools)]
            for et, tools in (expert_tool_map or {}).items()
        }

    def _assign_arm(self, key: str) -> str:
        """Deterministic A/B arm from a stable hash (reproducible, no RNG)."""
        digest = hashlib.sha256((key or "").encode("utf-8")).hexdigest()
        bucket = (int(digest, 16) % 10000) / 10000.0
        return "treatment" if bucket < self.ab_ratio else "control"

    def select_and_trace(
        self,
        *,
        query_embedding: Optional[List[float]],
        expert_types: List[str],
        query_id: str,
        trace: Any,
    ) -> Optional[Dict[str, List[str]]]:
        """Run the policy, emit ``tool_use`` actions, return the treatment-arm selection.

        Returns ``{expert_type: [selected tools]}`` for the treatment arm (to be
        written into the context), or ``None`` (control arm / disabled / failure
        → ``base.py`` uses all tools).
        """
        if not self.enabled or not query_embedding:
            return None
        try:
            arm = self._assign_arm(query_id)
            trace.metadata["tool_gating_arm"] = arm
            trace.metadata["tool_gating_ratio"] = self.ab_ratio
            # Store the embedding ONCE for the tool-policy trainer (avoids
            # duplicating 1024 floats on every tool_use action).
            trace.metadata.setdefault("query_embedding", list(query_embedding))

            probs = self.policy.predict_single(np.asarray(query_embedding, dtype=np.float32))

            selection: Dict[str, List[str]] = {}
            for et in expert_types:
                tools = self.expert_tool_map.get(et)
                if not tools:
                    continue

                # Sample a call decision per tool (treatment intent).
                decisions: List[tuple] = []  # (tool, p, sampled_called)
                for t in tools:
                    p = float(probs.get(t, WARM_START_PROB))
                    decisions.append((t, p, random.random() < p))

                # Floor ≥1: never let the POLICY prune an expert down to zero
                # tools (safety guardrail). NB: this floor is at the policy level
                # — if the MCP sidecar was down at boot a selected tool may not be
                # registered in the expert's registry, in which case base.py skips
                # it and the expert runs on graph+semantic retrieval only (an
                # accepted failure-isolation outcome, not a crash).
                if not any(c for (_t, _p, c) in decisions):
                    top_tool = max(decisions, key=lambda d: d[1])[0]
                    decisions = [(t, p, (t == top_tool) or c) for (t, p, c) in decisions]

                # Single source of truth: the tools actually called in THIS arm.
                called_tools: List[str] = []
                for (t, p, sampled_called) in decisions:
                    # In control ALL tools actually fire (no pruning) → the action
                    # base.py takes is "call". In treatment the action is the
                    # sampled decision. log_prob is the policy's prob of THAT action.
                    actual_called = True if arm == "control" else sampled_called
                    p_clamped = min(max(p, _EPS), 1.0 - _EPS)
                    log_prob = math.log(p_clamped) if actual_called else math.log(1.0 - p_clamped)
                    trace.add_tool_use(
                        tool_name=t,
                        parameters={"expert_type": et},
                        log_prob=log_prob,
                        metadata={
                            "expert_type": et,
                            "called": actual_called,
                            "arm": arm,
                            "p_call": round(p, 4),
                            "source": "tool_policy",
                        },
                    )
                    # Treatment selection = exactly the tools traced as called,
                    # so context["selected_live_tools"] mirrors the `called` flags.
                    if arm == "treatment" and sampled_called:
                        called_tools.append(t)

                if arm == "treatment":
                    selection[et] = called_tools  # the pruned subset base.py should use

            if arm == "treatment" and selection:
                log.info(
                    "tool-gating selection (treatment)",
                    query_id=query_id,
                    selection={k: len(v) for k, v in selection.items()},
                )
                return selection
            return None
        except Exception as exc:  # noqa: BLE001 - never break the answer path
            log.warning("tool-gating selection failed (fallback to all tools)", error=str(exc))
            return None


__all__ = ["ToolSelector"]
