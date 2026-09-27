"""Result collection + reporting for the E2E harness.

Flows record steps through the Report object; the client auto-records
request latency under the currently-open flow/step. At the end the runner
prints a console summary and writes a JSON artifact under e2e/out/.
"""
from __future__ import annotations

import json
import time
from contextlib import contextmanager
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

OUT_DIR = Path(__file__).parent / "out"


class StepFailure(Exception):
    """A step's assertion failed. Carries the request/response dump."""

    def __init__(self, message: str, dump: dict[str, Any] | None = None):
        super().__init__(message)
        self.dump = dump or {}


class FlowSkipped(Exception):
    """Raised by a flow to mark itself (or the rest of itself) as skipped."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@dataclass
class StepResult:
    flow: str
    step: str
    method: str
    url: str
    status: int | None
    latency_ms: float
    ok: bool
    detail: str = ""
    known_issue: str = ""


@dataclass
class FlowResult:
    name: str
    outcome: str = "PASS"  # PASS | FAIL | SKIPPED
    detail: str = ""
    duration_s: float = 0.0


class Report:
    def __init__(self, run_id: str):
        self.run_id = run_id
        self.steps: list[StepResult] = []
        self.flows: list[FlowResult] = []
        self.current_flow: str = ""
        self.current_step: str = ""
        self._flow_started: float = 0.0

    # ---- flow lifecycle (driven by the runner) ----
    def start_flow(self, name: str) -> None:
        self.current_flow = name
        self.current_step = ""
        self._flow_started = time.monotonic()
        print(f"\n=== FLOW {name} ===")

    def end_flow(self, name: str, outcome: str, detail: str = "") -> None:
        dur = time.monotonic() - self._flow_started
        self.flows.append(FlowResult(name, outcome, detail, round(dur, 2)))
        icon = {"PASS": "PASS", "FAIL": "FAIL", "SKIPPED": "SKIP"}.get(outcome, outcome)
        print(f"=== {icon} {name} ({dur:.1f}s) {detail}")
        self.current_flow = ""

    # ---- step context (used inside flows) ----
    @contextmanager
    def step(self, name: str):
        self.current_step = name
        print(f"  - {name}")
        try:
            yield
        finally:
            self.current_step = ""

    # ---- recording (called by client + flows) ----
    def record(
        self,
        method: str,
        url: str,
        status: int | None,
        latency_ms: float,
        ok: bool,
        detail: str = "",
        known_issue: str = "",
    ) -> None:
        self.steps.append(
            StepResult(
                flow=self.current_flow,
                step=self.current_step,
                method=method,
                url=url,
                status=status,
                latency_ms=round(latency_ms, 1),
                ok=ok,
                detail=detail[:500],
                known_issue=known_issue,
            )
        )

    def note(self, message: str) -> None:
        print(f"    NOTE: {message}")
        self.record("NOTE", "", None, 0.0, True, message)

    # ---- output ----
    def summary(self) -> str:
        lines = ["", f"{'FLOW':<18} {'OUTCOME':<9} {'DUR':>7}  DETAIL"]
        lines.append("-" * 70)
        for f in self.flows:
            lines.append(f"{f.name:<18} {f.outcome:<9} {f.duration_s:>6.1f}s  {f.detail}")
        n_pass = sum(1 for f in self.flows if f.outcome == "PASS")
        n_fail = sum(1 for f in self.flows if f.outcome == "FAIL")
        n_skip = sum(1 for f in self.flows if f.outcome == "SKIPPED")
        failed_steps = [s for s in self.steps if not s.ok]
        lines.append("-" * 70)
        lines.append(f"flows: {n_pass} pass / {n_fail} fail / {n_skip} skipped   "
                     f"steps: {len(self.steps)} recorded, {len(failed_steps)} failed")
        for s in failed_steps[:20]:
            lines.append(f"  FAILED {s.flow}/{s.step}: {s.method} {s.url} -> {s.status} {s.detail}")
        return "\n".join(lines)

    def write_json(self) -> Path:
        OUT_DIR.mkdir(exist_ok=True)
        path = OUT_DIR / f"report-{self.run_id}.json"
        payload = {
            "run_id": self.run_id,
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "flows": [asdict(f) for f in self.flows],
            "steps": [asdict(s) for s in self.steps],
        }
        path.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
        return path

    @property
    def failed_flow_count(self) -> int:
        return sum(1 for f in self.flows if f.outcome == "FAIL")
