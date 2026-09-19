"""Integrity checks over the store, so a bad download shows itself.

Per act: gaps in the numeric sequence (a signal, not an error — real acts
have holes), empty texts, texts too short to be an article unless the act
says the article is repealed, and two units with identical text — the
signature of "nonexistent article → Normattiva answered with art. 1"
(CLAUDE.md gotcha 24), which VisuaLex intercepts today and which costs
nothing to keep watching.
"""
from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass

from .store import Store, UnitRecord

SHORT_TEXT_CHARS = 40
_ABROGATO = re.compile(r"^\(?\s*(?:articolo\s+)?(?:abrogat|soppress)", re.IGNORECASE)
_NUMERIC_HEAD = re.compile(r"^(\d+)")


@dataclass(frozen=True)
class Finding:
    act_id: str
    kind: str  # gap | empty | short | identical
    detail: str
    unit_ids: tuple[str, ...]


def _looks_repealed(unit: UnitRecord) -> bool:
    return unit.abrogato or bool(_ABROGATO.match((unit.text or "").strip()))


def verify_act(act_id: str, units: list[UnitRecord]) -> list[Finding]:
    findings: list[Finding] = []
    articles = [u for u in units if u.kind == "article"]

    heads = []
    for u in articles:
        match = _NUMERIC_HEAD.match(u.number)
        if match:
            heads.append(int(match.group(1)))
    if heads:
        present = set(heads)
        missing = [n for n in range(min(heads), max(heads) + 1) if n not in present]
        if missing:
            shown = ", ".join(str(n) for n in missing[:20]) + (" …" if len(missing) > 20 else "")
            findings.append(Finding(act_id, "gap", f"{len(missing)} numeri assenti fra {min(heads)} e {max(heads)}: {shown}", ()))

    for u in units:
        text = (u.text or "").strip()
        if not text:
            findings.append(Finding(act_id, "empty", f"{u.number}: testo vuoto", (u.id,)))
        elif len(text) < SHORT_TEXT_CHARS and not _looks_repealed(u):
            findings.append(Finding(act_id, "short", f"{u.number}: {len(text)} caratteri: {text!r}", (u.id,)))

    by_hash: dict[str, list[UnitRecord]] = defaultdict(list)
    for u in articles:
        if (u.text or "").strip() and not _looks_repealed(u):
            by_hash[u.text_hash].append(u)
    for group in by_hash.values():
        if len(group) > 1:
            numbers = ", ".join(u.number for u in group[:10]) + (" …" if len(group) > 10 else "")
            findings.append(Finding(act_id, "identical",
                                    f"{len(group)} articoli con testo identico: {numbers}",
                                    tuple(u.id for u in group)))
    return findings


def verify_store(store: Store, act_ids=None) -> list[Finding]:
    findings: list[Finding] = []
    for act in store.acts():
        if act_ids is not None and act.id not in act_ids:
            continue
        findings += verify_act(act.id, store.units_for_act(act.id))
    return findings


def format_findings(findings: list[Finding]) -> str:
    if not findings:
        return "Verifica: nessuna anomalia."
    lines = [f"Verifica: {len(findings)} segnalazioni"]
    for f in findings:
        lines.append(f"  [{f.kind}] {f.act_id}: {f.detail}")
    return "\n".join(lines)
