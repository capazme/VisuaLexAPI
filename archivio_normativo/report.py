"""The end-of-run summary printed to the terminal."""
from __future__ import annotations

from .pipeline import ActReport
from .verify import Finding, format_findings

_COLUMNS = ("atto", "unità", "nuovi", "aggiorn.", "invariati", "falliti", "saltati", "arricch. ok/vuoti/err/tenuti", "note")


def _notes(r: ActReport) -> str:
    notes = []
    if not r.resolved:
        notes.append("NON RISOLTO")
    if r.fingerprints_available is False:
        notes.append("senza impronte (fetch completo)")
    if r.text_status == "oj":
        notes.append("testo GU non consolidato")
    if r.recitals:
        notes.append(f"{r.recitals} considerando")
    return "; ".join(notes)


def _row(r: ActReport, dry_run: bool) -> tuple[str, ...]:
    if dry_run:
        return (r.act_id, str(r.total), str(r.planned_new), str(r.planned_changed), str(r.unchanged), "-", "-",
                f"{r.enrich_planned} previste", _notes(r))
    return (r.act_id, str(r.total), str(r.new), str(r.updated), str(r.unchanged), str(r.failed), str(r.skipped),
            f"{r.enrich_ok}/{r.enrich_empty}/{r.enrich_error}/{r.enrich_kept}", _notes(r))


def _table(rows: list[tuple[str, ...]]) -> list[str]:
    widths = [max(len(str(row[i])) for row in [_COLUMNS] + rows) for i in range(len(_COLUMNS))]
    fmt = "  ".join(f"{{:<{w}}}" for w in widths)
    lines = [fmt.format(*_COLUMNS), fmt.format(*["-" * w for w in widths])]
    lines += [fmt.format(*row) for row in rows]
    return lines


def format_report(reports: list[ActReport], findings: list[Finding], *, duration_s: float, base_url: str,
                  run_id: int | None, dry_run: bool) -> str:
    title = "PROVA (dry-run): cosa farebbe" if dry_run else f"Run {run_id}"
    lines = [f"=== Archivio normativo — {title} — VisuaLex {base_url} — {duration_s:.0f} s ===", ""]
    lines += _table([_row(r, dry_run) for r in reports])
    totals = {
        "atti": len(reports), "risolti": sum(1 for r in reports if r.resolved),
        "unità": sum(r.total for r in reports), "nuovi": sum(r.new for r in reports),
        "aggiornati": sum(r.updated for r in reports), "invariati": sum(r.unchanged for r in reports),
        "falliti": sum(r.failed for r in reports), "saltati": sum(r.skipped for r in reports),
    }
    if dry_run:
        totals["da scaricare"] = sum(r.planned_new + r.planned_changed for r in reports)
        totals["chiamate arricchimento previste"] = sum(r.enrich_planned for r in reports)
    lines += ["", "Totali: " + ", ".join(f"{k} {v}" for k, v in totals.items())]
    unresolved = [r for r in reports if not r.resolved]
    if unresolved:
        lines += ["", "Atti non risolti:"]
        lines += [f"  - {r.act_id}: {r.reason}" for r in unresolved]
    failures = [(r.act_id, uid, reason) for r in reports for uid, reason in r.failures]
    if failures:
        lines += ["", f"Fallimenti ({len(failures)}):"]
        lines += [f"  - {uid}: {reason}" for _, uid, reason in failures[:200]]
        if len(failures) > 200:
            lines.append(f"  … e altri {len(failures) - 200}")
    if not dry_run:
        lines += ["", format_findings(findings)]
    return "\n".join(lines) + "\n"
