# services/merlt/merlt/pipeline/massimario/volume.py
"""One volume of the reviews: reading it in order (Task 6), assembling the batch (Task 8)."""
from __future__ import annotations

import hashlib
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Iterator, Optional

from merlt.storage.graph.schema import Fonte, Label, Provenance, Rel, SourceType, point_id, stub_properties

from .citations import parse_citations
from .identity import CitedDecision
from .paragraphs import Paragraph, extract_paragraphs, split_for_vectors
from .rv_bands import RvBands
from .urns import is_decision_link, parse_portal_urn, to_canonical

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


SOURCE = "massimario"
BRIDGE_REL_NORMA = "CITA_NORMA"
BRIDGE_REL_PRONUNCIA = "CITA_PRONUNCIA"
COCITATION_CONFIDENCE = 0.5
MAX_PIECE = 2000
SECTION_URL = "https://www.portaledelmassimario.ipzs.it/frontoffice/rassegneAnnuali/{volume}/dettaglio.do#{section}"
_SAMPLES = 20


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


def _decision_entry(d: CitedDecision) -> dict:
    return {
        "key": d.identity.key if d.identity else None,
        "label": d.label, "corte": d.corte, "archivio": d.archivio,
        "numero": d.numero, "anno": d.anno, "sezione": d.sezione, "rv": list(d.rv),
    }


class _Volume:
    def __init__(self, meta: VolumeMeta, resolved: dict, bands: RvBands) -> None:
        self.meta, self.resolved, self.bands = meta, resolved, bands
        self.decisions: dict[str, dict] = {}
        self.stubs: dict[str, dict] = {}
        self.edges: dict[tuple[str, str], dict] = {}
        self.chunks: list[dict] = []
        self.count = Counter()
        self.forms = Counter()
        self.reasons = Counter()
        self.unrecognized: list[str] = []
        self.unresolved: list[str] = []
        self.multi_section: dict[str, set[str]] = {}
        self.article_urns: set[str] = set()
        self.act_urns: set[str] = set()
        self.loose_sections: set[int] = set()

    def norms(self, ctx: ParagraphContext) -> list[dict]:
        found = []
        for link in ctx.paragraph.links:
            if is_decision_link(link.text, ctx.paragraph.text[:link.start]):
                self.count["link_a_pronunce"] += 1  # the citation itself is read from the text
                continue
            self.count["riferimenti"] += 1
            norm = parse_portal_urn(link.href)
            if norm is None:
                self.count["partizioni" if "~" in link.href and "~art" not in link.href else "non_risolte"] += 1
                if len(self.unresolved) < _SAMPLES and "~art" in link.href:
                    self.unresolved.append(link.href)
                continue
            urn = to_canonical(norm, self.resolved)
            if urn is None:
                self.count["non_risolte"] += 1
                if len(self.unresolved) < _SAMPLES:
                    self.unresolved.append(link.href)
                continue
            if norm.year_only:
                self.count["date_completate"] += 1
            (self.article_urns if norm.article else self.act_urns).add(urn)
            self.stubs.setdefault(urn, {"id": urn, "labels": [Label.NORMA.value], "properties": stub_properties(urn)})
            found.append({"urn": urn, "start": link.start, "end": link.end,
                          "citazione": link.text, "comma": norm.comma, "articolo": bool(norm.article)})
        return found

    def decisions_of(self, ctx: ParagraphContext) -> list[CitedDecision]:
        scan = parse_citations(ctx.paragraph.text, review_year=self.meta.anno, archivio=ctx.archivio, bands=self.bands)
        self.count["rv_totali"] += scan.rv_total
        self.count["rv_riconosciute"] += scan.rv_recognized
        self.forms.update(scan.forms)
        self.reasons.update(scan.reasons)
        self.unrecognized.extend(scan.unrecognized[: max(0, _SAMPLES - len(self.unrecognized))])
        unique: dict[str, CitedDecision] = {}
        others: list[CitedDecision] = []
        for d in scan.decisions:
            if d.identity is None:
                others.append(d)
                continue
            if d.identity.key in unique:
                kept = unique[d.identity.key]
                kept.rv += [rv for rv in d.rv if rv not in kept.rv]
            else:
                unique[d.identity.key] = d
        for d in unique.values():
            self.add_decision(d)
        return list(unique.values()) + others

    def add_decision(self, d: CitedDecision) -> None:
        key = d.identity.key
        node = self.decisions.get(key)
        if node is None:
            props = {
                "node_id": key, "corte": d.corte, "archivio": d.archivio, "numero": d.numero, "anno": d.anno,
                "estremi": d.estremi, "sezioni": [], "rv": [], "anni_rassegna": [self.meta.anno],
                "anno_implicito": d.anno_implicito,
                "fonte": Fonte.MASSIMARIO.value, "provenance": Provenance.INGESTION.value,
            }
            node = self.decisions[key] = {"id": key, "labels": [Label.ATTO_GIUDIZIARIO.value], "properties": props}
        props = node["properties"]
        if d.sezione and d.sezione not in props["sezioni"]:
            props["sezioni"].append(d.sezione)
            if len(props["sezioni"]) > 1:
                self.multi_section[key] = set(props["sezioni"])
        props["rv"] += [rv for rv in d.rv if rv not in props["rv"]]
        for name, value in (("relatore", d.relatore), ("data_udienza", d.data_udienza)):
            if value and not props.get(name):
                props[name] = value
        props["anno_implicito"] = props["anno_implicito"] and d.anno_implicito

    def add_edges(self, decisions: list[CitedDecision], norms: list[dict]) -> None:
        articles = {n["urn"] for n in norms if n["articolo"]}
        for d in decisions:
            if d.identity is None:
                continue
            for urn in articles:
                pair = (d.identity.key, urn)
                edge = self.edges.get(pair)
                if edge is None:
                    # one edge per (decision, norm) across every volume (spec 5.4): the
                    # years and volumes are unions and the paragraphs are counted per
                    # volume, so promote.py merges a volume's share and a re-run
                    # rewrites it instead of adding a parallel edge
                    mass_key = hashlib.sha1(f"{pair[0]}|{urn}".encode()).hexdigest()
                    edge = self.edges[pair] = {"start": pair[0], "end": urn, "type": Rel.INTERPRETA.value, "properties": {
                        "tipo": "co-citazione", "confidenza": COCITATION_CONFIDENCE,
                        "fonte": Fonte.MASSIMARIO.value, "provenance": Provenance.INGESTION.value,
                        "anni_rassegna": [self.meta.anno], "volumi": [self.meta.volume_id],
                        "paragrafi": 0, "_mass_key": mass_key,
                    }}
                props = edge["properties"]
                props["paragrafi"] += 1
                props["paragrafi_per_volume"] = [f"{self.meta.volume_id}:{props['paragrafi']}"]

    def add_chunks(self, ctx: ParagraphContext, norms: list[dict], decisions: list[CitedDecision]) -> None:
        text = ctx.paragraph.text
        archivio = ctx.archivio or self.meta.archivio
        paragraph_key = f"{SOURCE}|{self.meta.volume_id}|{ctx.sezione.id}|{ctx.index}"
        articles = sorted({n["urn"] for n in norms if n["articolo"]})
        entries = [_decision_entry(d) for d in decisions]
        common = {
            "source_type": SourceType.RASSEGNA.value, "fonte": Fonte.MASSIMARIO.value,
            "anno": self.meta.anno, "archivio": archivio,
            "volume": {"id": self.meta.volume_id, "numero": self.meta.numero, "titolo": self.meta.titolo},
            "parte": {"nome": ctx.parte[0], "titolo": ctx.parte[1]} if ctx.parte else None,
            "capitolo": {"nome": ctx.capitolo["nome"], "titolo": ctx.capitolo["titolo"]} if ctx.capitolo else None,
            "sezione": {"id": ctx.sezione.id, "numero": ctx.sezione.numero, "titolo": ctx.sezione.titolo},
            "autori": ctx.capitolo["autori"] if ctx.capitolo else [],
            "materie": ctx.capitolo["materie"] if ctx.capitolo else [],
            "url": SECTION_URL.format(volume=self.meta.volume_id, section=ctx.sezione.id),
            "paragraph_key": paragraph_key, "ordine": ctx.ordine,
            "article_urn": articles[0] if articles else None, "article_urns": articles,
            "decisioni": entries,
        }
        rows = [
            {"graph_node_urn": urn, "node_type": Label.NORMA.value, "relation_type": BRIDGE_REL_NORMA,
             "confidence": 1.0, "metadata": {"anno": self.meta.anno, "archivio": archivio, "ordine": ctx.ordine,
                                             "fonte": Fonte.MASSIMARIO.value}}
            for urn in sorted({n["urn"] for n in norms})
        ] + [
            {"graph_node_urn": e["key"], "node_type": Label.ATTO_GIUDIZIARIO.value, "relation_type": BRIDGE_REL_PRONUNCIA,
             "confidence": 1.0, "metadata": {"anno": self.meta.anno, "archivio": archivio, "ordine": ctx.ordine,
                                             "fonte": Fonte.MASSIMARIO.value, "rv": e["rv"]}}
            for e in entries if e["key"]
        ]
        for piece, (start, end) in enumerate(split_for_vectors(text, MAX_PIECE)):
            payload = {
                **common, "piece": piece,
                "text": text if piece == 0 else text[start:end],
                "norme": [{k: n[k] for k in ("urn", "start", "end", "citazione", "comma")} for n in norms] if piece == 0 else [],
            }
            self.chunks.append({
                "point_id": point_id(f"{SOURCE}:{self.meta.volume_id}:{ctx.sezione.id}", SourceType.RASSEGNA.value, f"{ctx.index}.{piece}"),
                "paragraph_key": paragraph_key, "piece": piece, "ordine": ctx.ordine,
                "vector_text": text[start:end], "payload": payload,
                "bridge": [{**row, "metadata": {**row["metadata"], "piece": piece}} for row in rows],
            })

    def output(self) -> dict:
        nodes = list(self.decisions.values()) + list(self.stubs.values())
        edges = list(self.edges.values())
        total, recognized = self.count["rv_totali"], self.count["rv_riconosciute"]
        coverage = round(100 * recognized / total, 1) if total else None
        report = {
            "urn_conflicts": [], "node_updates": [], "node_new": [], "orphan_edges": [], "duplicates": [],
            "coverage": None,
            "stats": {
                "nodes_total": len(nodes), "nodes_new": 0, "nodes_update": 0, "edges_total": len(edges),
                "edges_new": 0, "edges_orphan": 0, "duplicates": 0, "coverage_pct": coverage,
            },
            "massimario": {
                "volume": {"id": self.meta.volume_id, "titolo": self.meta.titolo, "anno": self.meta.anno,
                           "archivio": self.meta.archivio, "numero": self.meta.numero},
                "paragrafi": self.count["paragrafi"],
                "frammenti": len(self.chunks),
                "citazioni": {
                    "rv_totali": total, "rv_riconosciute": recognized, "copertura_pct": coverage,
                    "per_forma": dict(sorted(self.forms.items())),
                    "senza_identita": dict(sorted(self.reasons.items())),
                    "non_riconosciute": self.unrecognized,
                },
                "pronunce": {
                    "totali": len(self.decisions),
                    "anno_implicito": sum(1 for d in self.decisions.values() if d["properties"]["anno_implicito"]),
                    "chiavi_con_piu_sezioni": [
                        {"key": k, "sezioni": sorted(v)} for k, v in sorted(self.multi_section.items())
                    ][:_SAMPLES],
                    "gia_nel_grafo": None,
                },
                "norme": {
                    "riferimenti": self.count["riferimenti"], "articoli": len(self.article_urns),
                    "atti": len(self.act_urns), "stub": len(self.stubs),
                    "date_completate": self.count["date_completate"], "non_risolte": self.count["non_risolte"],
                    "partizioni": self.count["partizioni"], "campioni_non_risolti": self.unresolved,
                    "link_a_pronunce": self.count["link_a_pronunce"],
                    "gia_nel_grafo": None,
                },
                "sezioni_fuori_capitolo": len(self.loose_sections),
            },
        }
        return {"nodes": nodes, "edges": edges, "extras": {"chunks": self.chunks}, "report": report}


def build_volume(raw: dict, *, resolved: dict, bands: RvBands) -> dict:
    """The adapter's output for one volume: nodes, edges, chunks with bridge rows, report."""
    volume = _Volume(volume_meta(raw), resolved, bands)
    for ctx in iter_paragraphs(raw):
        volume.count["paragrafi"] += 1
        if ctx.capitolo is None:
            volume.loose_sections.add(ctx.sezione.id)
        norms = volume.norms(ctx)
        decisions = volume.decisions_of(ctx)
        volume.add_edges(decisions, norms)
        volume.add_chunks(ctx, norms, decisions)
    return volume.output()
