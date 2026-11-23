# services/visualex/visualex_api/services/massimario/volume.py
"""One volume of the reviews, read in order (design 2026-10-30-rassegne-without-merlt §3 (a)).

The reading half of MERL-T's `merlt/pipeline/massimario/volume.py`, unchanged: the volume's
title, the index walked in the portal's order, and every paragraph with its context. A
volume arrives raw, as `{volume_id, index, capitoli, sezioni}` (the portal's `objectData`
of each element), from the portal (`fetch_volume`) or from a local archive in the portal's
own JSON (`load_archive_volume`). Assembling the records is `records.py`.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator, Optional

from .paragraphs import Paragraph, extract_paragraphs
from .urns import is_decision_link, parse_portal_urn

_TITLE = re.compile(r"Massimario\s+(\d{4})\s+(CIVILE E PENALE|CIVILE|PENALE)(?:\s+Vol\.\s*(\d+))?", re.IGNORECASE)


@dataclass(frozen=True)
class VolumeMeta:
    volume_id: int
    titolo: str
    anno: int
    archivio: str  # civile | penale | misto
    numero: Optional[int]


@dataclass(frozen=True)
class SectionRef:
    id: int
    numero: str
    titolo: str


@dataclass
class IndexTree:
    capitoli: list[int] = field(default_factory=list)
    sezioni: dict[int, Optional[int]] = field(default_factory=dict)
    parte_of: dict[int, Optional[tuple[str, str]]] = field(default_factory=dict)
    # chapters and sections outside any chapter, in the index's order: ("capitolo" | "sezione", id)
    order: list[tuple[str, int]] = field(default_factory=list)


@dataclass(frozen=True)
class ParagraphContext:
    meta: VolumeMeta
    archivio: Optional[str]  # civile | penale, None in the mixed volume when nothing says
    parte: Optional[tuple[str, str]]
    capitolo: Optional[dict]  # {id, nome, titolo, autori, materie}
    sezione: SectionRef
    index: int   # paragraph position in its section
    ordine: int  # reading position in the volume: volume_id * 1_000_000 + running index
    paragraph: Paragraph


def parse_volume_title(volume_id: int, text: str) -> VolumeMeta:
    match = _TITLE.search(text or "")
    if not match:
        raise ValueError(f"titolo di volume non riconosciuto: {text!r}")
    kind = match.group(2).upper()
    archivio = "misto" if " " in kind else kind.lower()
    return VolumeMeta(volume_id, text.strip(), int(match.group(1)), archivio,
                      int(match.group(3)) if match.group(3) else None)


def volume_meta(raw: dict) -> VolumeMeta:
    return parse_volume_title(raw["volume_id"], raw["index"]["items"][0].get("text", ""))


def walk_index(index: dict) -> IndexTree:
    tree = IndexTree()

    def walk(node: dict, parte: Optional[tuple[str, str]], capitolo: Optional[int]) -> None:
        kind, element = node.get("elementType"), node.get("elementId")
        if node.get("functionName") == "refreshParte":
            parte = (node.get("text", "").strip(), (node.get("title") or "").strip())
        elif kind == "capitolo":
            tree.capitoli.append(element)
            tree.order.append(("capitolo", element))
            tree.parte_of[element] = parte
            capitolo = element
        elif kind == "sezione":
            tree.sezioni[element] = capitolo
            if capitolo is None:
                tree.order.append(("sezione", element))
                tree.parte_of[element] = parte
        for child in node.get("nodes") or []:
            walk(child, parte, capitolo)

    walk(index["items"][0], None, None)
    return tree


def _archivio(meta: VolumeMeta, parte, capitolo) -> Optional[str]:
    if meta.archivio != "misto":
        return meta.archivio
    hint = " ".join(filter(None, [parte[1] if parte else "", (capitolo or {}).get("titolo", "")]))
    penale = re.search(r"\bPENAL", hint, re.IGNORECASE) is not None
    civile = re.search(r"\bCIVIL", hint, re.IGNORECASE) is not None
    if penale != civile:  # both words ("giudizio penale e giudizio civile") say nothing
        return "penale" if penale else "civile"
    return None


def _sections(sections: list[dict]) -> Iterator[dict]:
    for section in sections or []:
        yield section
        yield from _sections(section.get("sottoSezioni") or [])


def iter_paragraphs(raw: dict) -> Iterator[ParagraphContext]:
    meta = volume_meta(raw)
    tree = walk_index(raw["index"])
    running = 0

    def emit(section: dict, capitolo: Optional[dict], parte) -> Iterator[ParagraphContext]:
        nonlocal running
        ref = SectionRef(int(section["id"]), str(section.get("numeroSezioneVis") or ""),
                         (section.get("titolo") or "").strip())
        archivio = _archivio(meta, parte, capitolo)
        for i, paragraph in enumerate(extract_paragraphs(section.get("testo") or "")):
            yield ParagraphContext(meta, archivio, parte, capitolo, ref, i,
                                   meta.volume_id * 1_000_000 + running, paragraph)
            running += 1

    for kind, element in tree.order:
        if kind == "sezione":
            if element in raw["sezioni"]:
                yield from emit(raw["sezioni"][element], None, tree.parte_of.get(element))
            continue
        data = raw["capitoli"].get(element)
        if data is None:
            continue
        capitolo = {
            "id": element,
            "nome": (data.get("nome") or "").strip(),
            "titolo": (data.get("titolo") or "").strip(),
            "autori": [f"{a.get('nome', '')} {a.get('cognome', '')}".strip() for a in data.get("autori") or []],
            "materie": [m.get("nome", "") for m in data.get("materie") or []],
        }
        for section in _sections(data.get("sezioni") or []):
            yield from emit(section, capitolo, tree.parte_of.get(element))


SECTION_URL = "https://www.portaledelmassimario.ipzs.it/frontoffice/rassegneAnnuali/{volume}/dettaglio.do#{section}"


def year_only_acts(raw: dict) -> set[str]:
    acts = set()
    for ctx in iter_paragraphs(raw):
        for link in ctx.paragraph.links:
            if is_decision_link(link.text, ctx.paragraph.text[:link.start]):
                continue
            norm = parse_portal_urn(link.href)
            if norm is not None and norm.year_only:
                acts.add(norm.year_only_urn)
    return acts


async def fetch_volume(volume_id: int) -> dict:
    """A whole volume from the portal, element by element, through the paced client
    (`massimario_portal`): the index, its chapters, the sections outside any chapter."""
    from .. import massimario_portal

    index = await massimario_portal.fetch_element("index", str(volume_id))
    tree = walk_index(index)
    capitoli = {}
    for chapter_id in tree.capitoli:
        capitoli[chapter_id] = await massimario_portal.fetch_element("capitolo", str(chapter_id))
    sezioni = {}
    for section_id, chapter_id in tree.sezioni.items():
        if chapter_id is None:
            sezioni[section_id] = await massimario_portal.fetch_element("sezione", str(section_id))
    return {"volume_id": volume_id, "index": index, "capitoli": capitoli, "sezioni": sezioni}


def _object(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))["objectData"]


def load_archive_volume(directory: Path) -> dict:
    """A volume from a local archive: `<archive>/json/<volume>/index.json`,
    `capitolo_<id>.json`, `sezione_<id>.json`, each the portal's `{"valid": true,
    "objectData": …}` as served. No request leaves."""
    def by_id(prefix: str) -> dict[int, dict]:
        return {int(p.stem.split("_", 1)[1]): _object(p) for p in directory.glob(f"{prefix}_*.json")}

    return {
        "volume_id": int(directory.name),
        "index": _object(directory / "index.json"),
        "capitoli": by_id("capitolo"),
        "sezioni": by_id("sezione"),
    }


def archive_volumes(archive: Path) -> list[int]:
    """The volumes a local archive holds, by portal id."""
    root = archive / "json"
    return sorted(int(p.name) for p in root.iterdir() if p.is_dir() and p.name.isdigit()) if root.is_dir() else []
