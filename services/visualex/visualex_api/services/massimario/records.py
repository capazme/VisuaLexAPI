# services/visualex/visualex_api/services/massimario/records.py
"""A volume's paragraphs as records, with the volume's parse report (design
2026-10-30-rassegne-without-merlt §3.1).

The per-paragraph logic MERL-T's `_Volume` held, without the graph: the `Sez. L` links that
are decisions are dropped, the norms resolved and counted, the decisions de-duplicated by key
with their `Rv.` merged. A record carries what the reader shows and what MERL-T needs to build
its chunks, nodes and rows: the text, its context, the norm spans, the decisions and the
pieces `split_for_vectors` cuts (which fix MERL-T's vector texts, hence its point ids).

Every norm URN `urns.to_canonical` writes is passed through `normalize_norm_urn` before it
is stored, so the store keys norms by the convention's identity (§5); the report counts the
links that normalisation rewrote (`norme.normalizzate`), which MERL-T keys otherwise today.

The report is MERL-T's `massimario` block minus what belongs to the graph: the two
`gia_nel_grafo` (MERL-T's `report.py` adds them at staging) and `norme.stub`, the number of `Norma`
stubs MERL-T's assembly makes (its articles plus its acts), which MERL-T recomputes from the
records once its adapter reads them (PR 3 of the design).
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Optional

from ...tools.sources import normalize_norm_urn
from .citations import parse_citations
from .identity import CitedDecision
from .paragraphs import split_for_vectors
from .rv_bands import RvBands
from .urns import is_decision_link, parse_portal_urn, to_canonical
from .volume import SECTION_URL, ParagraphContext, VolumeMeta, iter_paragraphs, volume_meta

#: Raise it with any change that alters a record of the same raw volume: its text, its spans,
#: its decisions, its pieces, or the paragraph keys (a section split otherwise renumbers them).
#: Stored per volume, so anchors, if ever decided, can pin `(paragraph_key, parser_version)`
#: (design §4).
PARSER_VERSION = 1
SOURCE = "massimario"
FONTE = "Ufficio del Massimario"
MAX_PIECE = 2000
_SAMPLES = 20


@dataclass
class VolumeRecords:
    meta: VolumeMeta
    records: list[dict]
    report: dict


def volume_dict(meta: VolumeMeta) -> dict:
    return {"id": meta.volume_id, "titolo": meta.titolo, "anno": meta.anno,
            "archivio": meta.archivio, "numero": meta.numero}


def decision_entry(d: CitedDecision) -> dict:
    return {
        "key": d.identity.key if d.identity else None,
        "motivo_senza_identita": d.motivo_senza_identita if d.identity is None else None,
        "corte": d.corte, "archivio": d.archivio, "numero": d.numero, "anno": d.anno,
        "sezione": d.sezione, "rv": list(d.rv), "relatore": d.relatore,
        "data_udienza": d.data_udienza, "anno_implicito": d.anno_implicito, "forma": d.forma,
    }


class _Builder:
    def __init__(self, meta: VolumeMeta, resolved: dict, bands: RvBands) -> None:
        self.meta, self.resolved, self.bands = meta, resolved, bands
        self.count: Counter = Counter()
        self.forms: Counter = Counter()
        self.reasons: Counter = Counter()
        self.unrecognized: list[str] = []
        self.unresolved: list[str] = []
        self.article_urns: set[str] = set()
        self.act_urns: set[str] = set()
        self.loose_sections: set[int] = set()
        # per decision key across the volume: its sections, and whether every mention lacked the year
        self.sections_of: dict[str, list[str]] = {}
        self.implicit: dict[str, bool] = {}

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
            canonical = to_canonical(norm, self.resolved)
            if canonical is None:
                self.count["non_risolte"] += 1
                if len(self.unresolved) < _SAMPLES:
                    self.unresolved.append(link.href)
                continue
            if norm.year_only:
                self.count["date_completate"] += 1
            urn = normalize_norm_urn(canonical)
            if urn != canonical:
                self.count["normalizzate"] += 1
            (self.article_urns if norm.article else self.act_urns).add(urn)
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
                kept.rv += [rv for rv in dict.fromkeys(d.rv) if rv not in kept.rv]
            else:
                unique[d.identity.key] = d
        for d in unique.values():
            key = d.identity.key
            sections = self.sections_of.setdefault(key, [])
            if d.sezione and d.sezione not in sections:
                sections.append(d.sezione)
            self.implicit[key] = self.implicit.get(key, True) and d.anno_implicito
        return list(unique.values()) + others

    def record(self, ctx: ParagraphContext, norms: list[dict], decisions: list[CitedDecision]) -> dict:
        text = ctx.paragraph.text
        capitolo = ctx.capitolo
        return {
            "paragraph_key": f"{SOURCE}|{self.meta.volume_id}|{ctx.sezione.id}|{ctx.index}",
            "ordine": ctx.ordine,
            "anno": self.meta.anno,
            "archivio": ctx.archivio or self.meta.archivio,
            "text": text,
            "volume": {"id": self.meta.volume_id, "numero": self.meta.numero, "titolo": self.meta.titolo},
            "parte": {"nome": ctx.parte[0], "titolo": ctx.parte[1]} if ctx.parte else None,
            "capitolo": {k: capitolo[k] for k in ("id", "nome", "titolo", "autori", "materie")} if capitolo else None,
            "sezione": {"id": ctx.sezione.id, "numero": ctx.sezione.numero, "titolo": ctx.sezione.titolo},
            "url": SECTION_URL.format(volume=self.meta.volume_id, section=ctx.sezione.id),
            "fonte": FONTE,
            "norme": norms,
            "decisioni": [decision_entry(d) for d in decisions],
            "pieces": [list(p) for p in split_for_vectors(text, MAX_PIECE)],
        }

    def report(self, records: list[dict]) -> dict:
        total, recognized = self.count["rv_totali"], self.count["rv_riconosciute"]
        coverage = round(100 * recognized / total, 1) if total else None
        multi = {k: v for k, v in self.sections_of.items() if len(v) > 1}
        return {
            "volume": volume_dict(self.meta),
            "parser_version": PARSER_VERSION,
            "paragrafi": self.count["paragrafi"],
            "frammenti": sum(len(r["pieces"]) for r in records),
            "citazioni": {
                "rv_totali": total, "rv_riconosciute": recognized, "copertura_pct": coverage,
                "per_forma": dict(sorted(self.forms.items())),
                "senza_identita": dict(sorted(self.reasons.items())),
                "non_riconosciute": self.unrecognized,
            },
            "pronunce": {
                "totali": len(self.sections_of),
                "anno_implicito": sum(1 for v in self.implicit.values() if v),
                "chiavi_con_piu_sezioni": [
                    {"key": k, "sezioni": sorted(v)} for k, v in sorted(multi.items())
                ][:_SAMPLES],
            },
            "norme": {
                "riferimenti": self.count["riferimenti"], "articoli": len(self.article_urns),
                "atti": len(self.act_urns), "date_completate": self.count["date_completate"],
                "non_risolte": self.count["non_risolte"], "partizioni": self.count["partizioni"],
                "campioni_non_risolti": self.unresolved, "link_a_pronunce": self.count["link_a_pronunce"],
                "normalizzate": self.count["normalizzate"],
            },
            "sezioni_fuori_capitolo": len(self.loose_sections),
        }


def build_records(raw: dict, *, resolved: dict, bands: Optional[RvBands] = None) -> VolumeRecords:
    """One raw volume → its records, in reading order, and its parse report. Pure: the
    year-only acts come resolved in `resolved` (`urn:nir:<act>;<n>` → full URN or None)."""
    meta = volume_meta(raw)
    builder = _Builder(meta, resolved, bands if bands is not None else RvBands.load())
    records = []
    for ctx in iter_paragraphs(raw):
        builder.count["paragrafi"] += 1
        if ctx.capitolo is None:
            builder.loose_sections.add(ctx.sezione.id)
        norms = builder.norms(ctx)
        decisions = builder.decisions_of(ctx)
        records.append(builder.record(ctx, norms, decisions))
    return VolumeRecords(meta, records, builder.report(records))
