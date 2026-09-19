"""Enrichment beyond Brocardi: case law, the Consulta, the Garante, EU↔IT.

Every kind is one or two legal-it tool calls per article (or per act). The
answers are markdown for a reader and are stored verbatim, attributed to the
tool and dated. The refresh policy keeps the sources' load proportional to
what changed: a fresh answer on an unchanged article is kept; a changed
text, an aged answer, a past failure or `--refresh-enrich` asks again.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Callable

from .manifest import KINDS, ActSpec
from .pipeline import ActReport, RunOptions, UnitOutcome, stamp
from .sources.legalit import LegalItError, ToolCall, act_calls, classify_result, unit_calls
from .sources.visualex import ActResolution
from .store import Store


class Enricher:
    def __init__(self, *, store: Store, legalit, options: RunOptions, run_id: int,
                 log: logging.Logger, now: Callable[[], datetime]):
        self.store = store
        self.legalit = legalit
        self.options = options
        self.run_id = run_id
        self.log = log
        self.now = now

    # -- what applies -------------------------------------------------------

    def _kinds(self, spec: ActSpec) -> tuple[list[str], list[str]]:
        kinds = self.options.enrich_override if self.options.enrich_override is not None else spec.enrich
        unit_kinds = [k for k in kinds if KINDS[k].level == "unit" and k != "brocardi"]
        act_kinds = [k for k in kinds if KINDS[k].level == "act"]
        return unit_kinds, act_kinds

    def plan_act(self, spec: ActSpec, numbers: list[str]) -> int:
        unit_kinds, act_kinds = self._kinds(spec)
        selection = spec.enrich_selection()
        chosen = [n for n in numbers if selection is None or selection.contains(n)]
        calls = sum(len(unit_calls(kind, spec, n)) for kind in unit_kinds for n in chosen)
        calls += sum(len(act_calls(kind, spec)) for kind in act_kinds)
        return calls

    def _due(self, act_id: str, uid: str, kind: str, outcome: str | None) -> bool:
        if self.options.refresh_enrich or outcome in ("new", "updated"):
            return True
        existing = self.store.get_enrichment(act_id, uid, kind)
        if existing is None or existing["status"] == "error":
            return True
        try:
            age = self.now() - datetime.fromisoformat(existing["fetched_at"])
        except ValueError:
            return True
        return age.days >= self.options.enrich_ttl_days

    # -- the pass -----------------------------------------------------------

    async def enrich_act(self, spec: ActSpec, res: ActResolution, units: list[UnitOutcome],
                         report: ActReport) -> None:
        unit_kinds, act_kinds = self._kinds(spec)
        if not unit_kinds and not act_kinds:
            return
        for kind in act_kinds:
            if self._due(spec.id, "", kind, None):
                await self._execute(spec, "", kind, act_calls(kind, spec), report)
            else:
                report.enrich_kept += 1
        selection = spec.enrich_selection()
        for unit in units:
            if selection is not None and not selection.contains(unit.number):
                continue
            for kind in unit_kinds:
                if self._due(spec.id, unit.unit_id, kind, unit.outcome):
                    await self._execute(spec, unit.unit_id, kind, unit_calls(kind, spec, unit.number), report)
                else:
                    report.enrich_kept += 1

    async def _execute(self, spec: ActSpec, uid: str, kind: str, calls: list[ToolCall],
                       report: ActReport) -> None:
        sections: list[str] = []
        statuses: list[str] = []
        error: str | None = None
        for call in calls:
            try:
                text = await self.legalit.call(call)
            except LegalItError as exc:
                error = str(exc)
                self.log.warning("ENRICH %s act=%s unit=%s tool=%s error=%s", kind, spec.id, uid or "-", call.tool, exc)
                break
            statuses.append(classify_result(text))
            if statuses[-1] == "error":
                error = text.strip()
            sections.append(text if len(calls) == 1 else f"### {call.tool}\n\n{text}")
        if error is not None:
            status = "error"
        elif "ok" in statuses:
            status = "ok"
        else:
            status = "empty"
        content_md = "\n\n".join(sections) if sections else None
        self.store.upsert_enrichment(
            spec.id, uid, kind, "+".join(c.tool for c in calls),
            {c.tool: c.args for c in calls} if len(calls) > 1 else dict(calls[0].args),
            content_md, None, status, error, stamp(self.now), self.run_id,
        )
        report.count(f"enrich_{status}")
        self.log.info("ENRICH %s act=%s unit=%s status=%s", kind, spec.id, uid or "-", status)
