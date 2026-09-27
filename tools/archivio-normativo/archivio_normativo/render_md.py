"""One Markdown file per act, rendered from the store — deterministic.

The file is for reading: a front matter with the act's identity, an index
grouped by the act's own divisions, then one section per article with its
text verbatim and, below it, whatever enrichment the archive holds, each
block headed by its source and the day it was asked. Third-party markdown
is escaped (`<` → `&lt;`) so nothing a source emits can act in a viewer;
the article text is plain text from VisuaLex and is written as it is.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

from .hierarchy import LEVELS
from .manifest import AREAS, _SLUG
from .store import ActRecord, Store, UnitRecord

KIND_TITLES: dict[str, str] = {
    "brocardi": "Annotazioni (Brocardi)",
    "cassazione": "Cassazione (Italgiure)",
    "cassazione_massime": "Cassazione dalle massime (Brocardi → Italgiure)",
    "amministrativa": "Giurisprudenza amministrativa (TAR / Consiglio di Stato)",
    "tributaria": "Giurisprudenza tributaria (CeRDEF)",
    "cgue": "Corte di giustizia UE",
    "costituzionale": "Corte costituzionale",
    "garante": "Garante privacy",
    "attuazione": "Attuazione nazionale (EUR-Lex)",
    "base_ue": "Base giuridica UE (EUR-Lex)",
}
_BROCARDI_ORDER = ("Brocardi", "Ratio", "Spiegazione", "Massime", "Relazioni", "RelazioneCostituzione",
                   "Footnotes", "RelatedArticles", "CrossReferences", "Glossario")


def anchor_for(kind: str, number: str) -> str:
    return f"{'art' if kind == 'article' else 'considerando'}-{number}"


def heading_for(unit: UnitRecord) -> str:
    if unit.kind == "recital":
        return f"Considerando {unit.number}"
    label = f"Art. {unit.number.replace('-', ' ')}"
    return f"{label} — {unit.rubrica}" if unit.rubrica else label


def escape_md(text: str) -> str:
    return (text or "").replace("<", "&lt;")


def demote_headings(text: str) -> str:
    """Push a source's own headings below the article's H2 (## → #####)."""
    out = []
    for line in (text or "").splitlines():
        stripped = line.lstrip()
        if stripped.startswith("#"):
            hashes = len(stripped) - len(stripped.lstrip("#"))
            if 0 < hashes <= 6 and stripped[hashes:hashes + 1] in (" ", ""):
                line = "#" * min(6, hashes + 3) + stripped[hashes:]
        out.append(line)
    return "\n".join(out)


def _yaml_str(value) -> str:
    return json.dumps("" if value is None else str(value), ensure_ascii=False)


def _front_matter(act: ActRecord, units: list[UnitRecord], rendered_at: str) -> str:
    articles = [u for u in units if u.kind == "article"]
    recitals = [u for u in units if u.kind == "recital"]
    vigenza = max((u.vigenza_al for u in units), default="")
    lines = [
        "---",
        f"id: {act.id}",
        f"label: {_yaml_str(act.label)}",
        f"identifier: {_yaml_str(act.identifier)}",
        f"source: {act.source}",
        f"text_status: {act.text_status}",
    ]
    if act.consolidated_celex:
        lines.append(f"consolidated_celex: {act.consolidated_celex}")
    lines += [
        f"vigenza_al: {_yaml_str(vigenza)}",
        f"units: {len(units)}",
        f"articles: {len(articles)}",
        f"recitals: {len(recitals)}",
        f"rendered_at: {_yaml_str(rendered_at)}",
        "---",
    ]
    return "\n".join(lines)


def _index(units: list[UnitRecord]) -> list[str]:
    lines: list[str] = ["## Indice", ""]
    current: dict[str, str | None] = {level: None for level in LEVELS}
    for unit in units:
        if unit.kind != "article":
            continue
        depth = 0
        changed = False
        for level in LEVELS:
            value = getattr(unit, level)
            if value is None:
                continue
            if changed or value != current[level]:
                changed = True
                current[level] = value
                lines.append(f"{'  ' * depth}- **{value}**")
            depth += 1
        if changed:
            for level in LEVELS:
                if getattr(unit, level) is None:
                    current[level] = None
        lines.append(f"{'  ' * depth}- [{heading_for(unit)}](#{anchor_for(unit.kind, unit.number)})")
    recitals = [u for u in units if u.kind == "recital"]
    if recitals:
        lines += ["", "### Considerando", ""]
        lines.append(", ".join(f"[{u.number}](#{anchor_for(u.kind, u.number)})" for u in recitals))
    return lines


def _render_json_value(value, depth: int = 0) -> list[str]:
    pad = "  " * depth
    if isinstance(value, dict):
        out = []
        for key, inner in value.items():
            if inner in (None, "", [], {}):
                continue
            if isinstance(inner, (dict, list)):
                out.append(f"{pad}- **{escape_md(str(key))}**")
                out += _render_json_value(inner, depth + 1)
            else:
                out.append(f"{pad}- **{escape_md(str(key))}**: {escape_md(str(inner))}")
        return out
    if isinstance(value, list):
        out = []
        for item in value:
            if isinstance(item, dict) and "termine" in item:
                url = item.get("url")
                out.append(f"{pad}- {escape_md(str(item['termine']))}" + (f" ({url})" if url else ""))
            elif isinstance(item, (dict, list)):
                out += _render_json_value(item, depth)
            else:
                out.append(f"{pad}- {escape_md(str(item))}")
        return out
    return [f"{pad}{escape_md(str(value))}"]


def _render_brocardi(payload: dict) -> list[str]:
    lines: list[str] = []
    keys = [k for k in _BROCARDI_ORDER if k in payload] + [k for k in payload if k not in _BROCARDI_ORDER]
    for key in keys:
        value = payload.get(key)
        if value in (None, "", [], {}) or key in ("position", "link"):
            continue
        lines.append(f"**{key}**")
        lines.append("")
        if isinstance(value, str):
            lines.append(escape_md(value))
        else:
            lines += _render_json_value(value)
        lines.append("")
    if payload.get("link"):
        lines.append(f"Fonte: {payload['link']}")
        lines.append("")
    return lines


def _render_enrichment(row: dict) -> list[str]:
    title = KIND_TITLES.get(row["kind"], row["kind"])
    day = (row.get("fetched_at") or "")[:10]
    lines = [f"### {title}", "", f"*{row['tool']} — interrogato il {day}*", ""]
    if row["status"] == "empty":
        lines += ["_Nessun risultato._", ""]
    elif row["status"] == "error":
        lines += [f"_Errore: {escape_md(row.get('error') or 'sconosciuto')}_", ""]
    elif row.get("content_json") is not None:
        lines += _render_brocardi(row["content_json"])
    else:
        lines += [demote_headings(escape_md(row.get("content_md") or "")), ""]
    return lines


def _meta_line(unit: UnitRecord) -> str:
    parts = []
    if unit.identifier:
        parts.append(f"`{unit.identifier}`")
    if unit.source_url:
        parts.append(f"[fonte]({unit.source_url})")
    parts.append(f"vigente al {unit.vigenza_al}")
    if unit.ultimo_aggiornamento:
        parts.append(f"ultimo aggiornamento {unit.ultimo_aggiornamento}")
    if unit.abrogato:
        parts.append("**abrogato**")
    return " · ".join(parts)


def render_act(act: ActRecord, units: list[UnitRecord], enrichments: list[dict], rendered_at: str) -> str:
    by_unit: dict[str, list[dict]] = {}
    for row in enrichments:
        by_unit.setdefault(row["unit_id"], []).append(row)
    lines: list[str] = [_front_matter(act, units, rendered_at), "", f"# {act.label}", ""]
    if act.text_status == "oj":
        lines += ["> Testo della Gazzetta ufficiale (versione pubblicata), non consolidato.", ""]
    lines += _index(units)
    act_level = by_unit.get("", [])
    if act_level:
        lines += ["", "## Note sull'atto", ""]
        for row in sorted(act_level, key=lambda r: r["kind"]):
            lines += _render_enrichment(row)
    for unit in units:
        lines += ["", f'<a id="{anchor_for(unit.kind, unit.number)}"></a>', "",
                  f"## {heading_for(unit)}", "", _meta_line(unit), "", unit.text, ""]
        for row in sorted(by_unit.get(unit.id, []), key=lambda r: r["kind"]):
            lines += _render_enrichment(row)
    return "\n".join(lines).rstrip("\n") + "\n"


def render_index(acts: list[ActRecord], unit_counts: dict[str, int], vigenza: dict[str, str],
                 last_run: dict | None, rendered_at: str) -> str:
    lines = ["# Archivio normativo", ""]
    if last_run:
        lines.append(f"Ultimo run: {last_run.get('started_at', '')} ({last_run.get('status', '')})")
    lines.append(f"Generato: {rendered_at}")
    lines.append("")
    by_area: dict[str, list[ActRecord]] = {}
    for act in acts:
        by_area.setdefault(act.area, []).append(act)
    for area in sorted(by_area):
        lines += [f"## {area}", ""]
        for act in sorted(by_area[area], key=lambda a: a.id):
            status = "" if act.text_status == "consolidated" else " · testo GU non consolidato"
            lines.append(f"- [{act.label}]({area}/{act.id}.md) — {unit_counts.get(act.id, 0)} unità, "
                         f"vigente al {vigenza.get(act.id, '')}{status}")
        lines.append("")
    return "\n".join(lines).rstrip("\n") + "\n"


def act_path(out_dir: Path, act: ActRecord) -> Path:
    """`<out>/<area>/<id>.md`. The manifest already admits only a slug and
    one of `AREAS`, but the path is built from the store, so the same two
    checks stand here: nothing a row could carry may escape `out_dir`."""
    if not _SLUG.match(act.id or ""):
        raise ValueError(f"act id must be a slug [a-z0-9-], got {act.id!r}")
    if act.area not in AREAS:
        raise ValueError(f"act area must be one of {', '.join(AREAS)}, got {act.area!r}")
    return Path(out_dir) / act.area / f"{act.id}.md"


def write_outputs(store: Store, out_dir: Path, act_ids: Iterable[str] | None, rendered_at: str) -> list[Path]:
    """Render the given acts (all when None), any act whose file does not
    exist yet, and always the root index.

    The missing-file rule covers an act stored by an interrupted run and
    `unchanged` ever after: it is never in the changed list, so without it
    the act would sit in the store with no Markdown for good."""
    out_dir = Path(out_dir)
    acts = store.acts()
    wanted = set(act_ids) if act_ids is not None else None
    written: list[Path] = []
    counts: dict[str, int] = {}
    vigenza: dict[str, str] = {}
    for act in acts:
        units = store.units_for_act(act.id)
        counts[act.id] = len(units)
        vigenza[act.id] = max((u.vigenza_al for u in units), default="")
        path = act_path(out_dir, act)
        if wanted is not None and act.id not in wanted and path.exists():
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(render_act(act, units, store.enrichments_for_act(act.id), rendered_at), encoding="utf-8")
        written.append(path)
    index = out_dir / "INDICE.md"
    index.parent.mkdir(parents=True, exist_ok=True)
    index.write_text(render_index(acts, counts, vigenza, store.latest_run(), rendered_at), encoding="utf-8")
    written.append(index)
    return written
