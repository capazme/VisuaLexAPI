# services/merlt/merlt/pipeline/massimario/volume.py
"""One volume of the reviews: reading it in order (Task 6), assembling the batch (Task 8)."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterator, Optional

from .paragraphs import Paragraph, extract_paragraphs

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
            tree.parte_of[element] = parte
            capitolo = element
        elif kind == "sezione":
            tree.sezioni[element] = capitolo
            if capitolo is None:
                tree.parte_of[element] = parte
        for child in node.get("nodes") or []:
            walk(child, parte, capitolo)

    walk(index["items"][0], None, None)
    return tree


def _archivio(meta: VolumeMeta, parte, capitolo) -> Optional[str]:
    if meta.archivio != "misto":
        return meta.archivio
    hint = " ".join(filter(None, [parte[1] if parte else "", (capitolo or {}).get("titolo", "")]))
    if re.search(r"\bPENAL", hint, re.IGNORECASE):
        return "penale"
    if re.search(r"\bCIVIL", hint, re.IGNORECASE):
        return "civile"
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

    for chapter_id in tree.capitoli:
        data = raw["capitoli"].get(chapter_id)
        if data is None:
            continue
        capitolo = {
            "id": chapter_id,
            "nome": (data.get("nome") or "").strip(),
            "titolo": (data.get("titolo") or "").strip(),
            "autori": [f"{a.get('nome', '')} {a.get('cognome', '')}".strip() for a in data.get("autori") or []],
            "materie": [m.get("nome", "") for m in data.get("materie") or []],
        }
        for section in _sections(data.get("sezioni") or []):
            yield from emit(section, capitolo, tree.parte_of.get(chapter_id))
    for section_id, chapter_id in tree.sezioni.items():
        if chapter_id is None and section_id in raw["sezioni"]:
            yield from emit(raw["sezioni"][section_id], None, tree.parte_of.get(section_id))
