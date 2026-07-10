"""Mechanical (zero-LLM) parsing — source adapters producing seed-JSON batches.

Every adapter emits the same shape the seed loader already understands
(`{"nodes": [{"id", "labels", "properties"}], "edges": [{"start", "end",
"type", "properties"}]}`, see `merlt.scripts.load_seed_libro_iv`), so
promotion can reuse `_build_id_to_key` / `_merge_nodes` / `_merge_edges`
unmodified. The parser NEVER writes to FalkorDB — it only produces the batch
that later gets staged, reviewed, and (on admin approval) promoted.

Node/edge `id` values are the article's own URN string (not a sequential
integer as in the seed file) — `_build_id_to_key` accepts any hashable id, and
using the URN directly lets RINVIA edges reference other articles in the same
batch by URN without a separate id-assignment pass.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Optional, Protocol

import structlog
import yaml

log = structlog.get_logger()

_SUFFIX_WORDS = (
    "bis",
    "ter",
    "quater",
    "quinquies",
    "sexies",
    "septies",
    "octies",
    "novies",
    "decies",
)
_SUFFIX_ALT = "|".join(_SUFFIX_WORDS)

# Separator between "Art. N" and the rubrica: em dash (U+2014), en dash
# (U+2013), or a plain hyphen. The rubrica itself may or may not be
# parenthesized — both `— (Rubrica).` and `— Rubrica.` occur in the wild.
_DASH_CHARS = "—–-"

# `### Art. 1. — (Rubrica).` / `### Art. 1-bis. — Rubrica senza parentesi` /
# `### Art. 30bis — (Altra rubrica)`. The separator+rubrica group is entirely
# optional (a bare `### Art. 1.` heading is valid). Only level-3 ("###")
# headings starting with "Art" are articles — a `### SEZIONE ...` or
# `#### CAPO ...` heading never matches this (see `_GENERIC_HEADING_RE`
# below for how those are skipped instead of folded into article text).
_ARTICLE_HEADING_RE = re.compile(
    r"^###\s+Art\.?\s*(?P<num>\d+(?:[\s_-]?(?:" + _SUFFIX_ALT + r"))?)\.?"
    r"(?:\s*[" + _DASH_CHARS + r"]\s*(?P<rubrica>.+?)\s*)?$",
    re.IGNORECASE,
)

# `## TITOLO I — Dei beni` (level-2 heading; excludes level-3 article headings
# because "##" never matches inside a "###\s" prefix — the char right after
# "##" would be "#", not whitespace).
_SECTION_HEADING_RE = re.compile(r"^##\s+(?P<titolo>.+?)\s*$")

# Any other Markdown heading level (`### SEZIONE ...`, `#### CAPO ...`, a
# stray `#####`, ...) that is NOT an article and NOT the `## TITOLO` form
# above. Recognized so its text is skipped rather than folded into whichever
# article happened to be open (design doc §8 — sub-hierarchy headings carry
# no `Norma` node of their own).
_GENERIC_HEADING_RE = re.compile(r"^#{1,6}\s+\S")

# `[art. 10](urn:nir:...;123#art_10)` or `[art. 10](https://www.normattiva.it/...#art_10)`
_LINK_RE = re.compile(
    r"\[[^\]]*\]\((?P<base>[^)#]+)#art_(?P<num>\d+(?:[\s_-](?:" + _SUFFIX_ALT + r"))?)\)",
    re.IGNORECASE,
)

_NORMATTIVA_PREFIX = "https://www.normattiva.it/uri-res/N2Ls?"


def _normalize_article_number(raw: str) -> str:
    """Canonicalize `"1 bis"` / `"1_bis"` / `"1bis"` / `"1-bis"` -> `"1-bis"`.

    Mirrors the frontend's `normalizeArticleUrn()` convention (hyphen form),
    documented in CLAUDE.md as the canonical anti-regression shape. This is
    the HUMAN-readable form stored in `numero_articolo` — the URN suffix
    uses a different, concatenated form (see `_urn_article_suffix`).
    """
    raw = raw.strip()
    m = re.match(r"^(\d+)\s*[\s_-]?\s*(" + _SUFFIX_ALT + r")?$", raw, re.IGNORECASE)
    if not m:
        return raw.replace(" ", "").replace("_", "-")
    digits, suffix = m.group(1), m.group(2)
    return f"{digits}-{suffix.lower()}" if suffix else digits


def _urn_article_suffix(numero: str) -> str:
    """`"30-bis"` -> `"30bis"` — the graph CONCATENATES bis/ter/... suffixes
    in the URN (`~art30bis`, verified against `data/seeds/libro-iv-cc-graph.json`),
    while `numero_articolo` stays human-hyphenated ("30-bis") to match the
    graph's own `numero_articolo` property. Never use the hyphenated form
    when building a URN.
    """
    return numero.replace("-", "")


def _normalize_base_urn(raw: str) -> str:
    """Return the normattiva-URL base (no `~artN` suffix, no fragment)."""
    raw = raw.strip().split("#", 1)[0]
    if raw.startswith("http"):
        return raw
    if raw.startswith("urn:"):
        return f"{_NORMATTIVA_PREFIX}{raw}"
    return raw


def _article_urn(base_urn: str, numero: str) -> str:
    return f"{base_urn}~art{_urn_article_suffix(numero)}"


class MechanicalSourceAdapter(Protocol):
    """A source-specific parser: `source_ref` -> seed-JSON batch shape."""

    async def parse(self, source_ref: str) -> dict[str, list]: ...


class ItaliaCorpusAdapter:
    """Adapter reading an italia-corpus Markdown file from `source_ref` (path)."""

    async def parse(self, source_ref: str) -> dict[str, list]:
        import asyncio

        path = Path(source_ref)
        text = await asyncio.to_thread(path.read_text, encoding="utf-8")
        return parse_italia_corpus_markdown(text)


class VisualexTreeAdapter:
    """Placeholder for the VisuaLex tree-extractor adapter (CC/CP).

    Deliberately out of scope for this piece (design doc §9 step 2, "primo,
    per l'obiettivo 'ingerire la CC'" — a separate follow-up). Raising here
    keeps `POST /run` honest: a batch requested with `source=visualex_tree`
    fails fast with status=failed rather than silently producing an empty batch.
    """

    async def parse(self, source_ref: str) -> dict[str, list]:
        raise NotImplementedError(
            "visualex_tree adapter not implemented yet (design doc §9 step 2)"
        )


def get_adapter(source: str) -> MechanicalSourceAdapter:
    if source == "italia_corpus":
        return ItaliaCorpusAdapter()
    if source == "visualex_tree":
        return VisualexTreeAdapter()
    raise ValueError(f"unknown mechanical ingestion source: {source}")


def _split_frontmatter(md_text: str) -> tuple[dict[str, Any], str]:
    text = md_text.lstrip("﻿")
    if not text.startswith("---"):
        return {}, text
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}, text
    _, fm_block, rest = parts
    meta = yaml.safe_load(fm_block) or {}
    if not isinstance(meta, dict):
        meta = {}
    return meta, rest.lstrip("\n")


# KNOWN LIMITATION (design doc §10): italia-corpus does NOT carry the
# consolidated Codice Civile (URN `1942;262`) — it splits the pre-consolidation
# legislative history across several standalone `regio.decreto` acts (the "CC
# books") plus the Codice Penale's own origin decree. Ingesting any of these
# via italia_corpus would create URN-orphaned article nodes that duplicate —
# under a DIFFERENT URN — what the graph seed already has under `1942;262`
# (see `merlt_ingestion_governance` memory / design doc §1). The consolidated
# CC/CP MUST go through the `visualex_tree` adapter instead (design doc §9
# step 2), which queries `/fetch_tree` against the consolidated act and is
# therefore URN-aligned with the seed by construction.
#
# This list is a best-effort BLOCKLIST, not exhaustive overlap detection —
# building general URN-independent overlap detection was explicitly out of
# scope for this fix (adversarial review item #2). If another CC/CP
# origin-fragment decree is discovered in italia-corpus, add its
# (year, act_number) pair here rather than relaxing this check.
_CC_CP_FRAGMENT_ACTS = frozenset(
    {
        ("1938", "1852"),  # Codice Civile — Libro I (Delle persone e della famiglia)
        ("1939", "1586"),  # Codice Civile — Libro II (Delle successioni)
        ("1941", "18"),  # Codice Civile — Libro VI (Della tutela dei diritti)
        ("1930", "1398"),  # Codice Penale (R.D. 19 ottobre 1930, n. 1398)
    }
)

_ACT_YEAR_NUMBER_RE = re.compile(r"regio\.decreto:(\d{4})(?:-\d{2}-\d{2})?;(\d+)")


def _is_cc_cp_fragment(raw_urn: str) -> bool:
    m = _ACT_YEAR_NUMBER_RE.search(raw_urn)
    if not m:
        return False
    return (m.group(1), m.group(2)) in _CC_CP_FRAGMENT_ACTS


def parse_italia_corpus_markdown(md_text: str) -> dict[str, list]:
    """Deterministic, zero-LLM parse of one italia-corpus act into a batch.

    Frontmatter (YAML) carries the act-level attributes:
        tipo_documento: legge | decreto | regio.decreto | ...
        estremi: "Legge 20 maggio 1970, n. 300"
        urn: "urn:nir:stato:legge:1970-05-20;300" (or full normattiva URL)
        vigente: true | false

    Body:
        `## TITOLO ...` (level-2 heading) sets the current section label,
        recorded on every subsequent article's `titolo` property (no separate
        hierarchy node — the graph has no Libro/Titolo label). Any OTHER
        heading level (`### SEZIONE ...`, `#### CAPO ...`, ...) is recognized
        and skipped rather than folded into an open article's `testo_vigente`.
        `### Art. N. — (rubrica).` (level-3 heading) starts a Norma node; the
        text until the next heading is `testo_vigente`. The node's
        `estremi`/`tipo_documento` are ARTICLE-level ("Art. N <atto>" /
        "articolo") to match the graph schema — see
        `data/seeds/libro-iv-cc-graph.json` — not the act-level frontmatter
        values verbatim.
        Markdown links `[...](...urn...#art_N)` inside an article's body
        become `RINVIA` edges from that article to the linked URN (normalized
        to the graph's `~artN`/`~artNbis` concatenated form). Links outside
        any article are skipped (no source node to anchor them to).

    Raises:
        ValueError: the source is a known Codice Civile/Codice Penale
            origin-fragment act (see `_CC_CP_FRAGMENT_ACTS`), or the
            frontmatter carries no usable `urn` at all.
    """
    meta, body = _split_frontmatter(md_text)

    raw_urn = str(meta.get("urn", ""))
    if _is_cc_cp_fragment(raw_urn):
        raise ValueError(
            f"italia_corpus source '{raw_urn}' is a known Codice Civile/Codice "
            "Penale origin-fragment decree — ingesting it would duplicate the "
            "consolidated act (1942;262) under a different URN. Use the "
            "visualex_tree adapter for CC/CP instead (design doc §9 step 2)."
        )

    base_urn = _normalize_base_urn(raw_urn)
    if not base_urn:
        raise ValueError(
            "italia_corpus source has no usable base URN (missing/empty `urn` "
            "in frontmatter) — refusing to emit degenerate `~artN` article URNs."
        )

    act_estremi = meta.get("estremi")
    vigenza = "vigente" if meta.get("vigente", True) else "non vigente"

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    seen_edge_keys: set[tuple[str, str]] = set()

    current_titolo: Optional[str] = None
    current_urn: Optional[str] = None
    current_props: Optional[dict[str, Any]] = None
    current_body_lines: list[str] = []

    def _flush_article() -> None:
        if current_urn is None or current_props is None:
            return
        current_props["testo_vigente"] = "\n".join(current_body_lines).strip()
        nodes.append(
            {
                "id": current_urn,
                "labels": ["Norma"],
                "properties": current_props,
            }
        )
        for m in _LINK_RE.finditer(current_props["testo_vigente"]):
            target_base = _normalize_base_urn(m.group("base"))
            target_num = _normalize_article_number(m.group("num"))
            target_urn = _article_urn(target_base, target_num)
            edge_key = (current_urn, target_urn)
            if edge_key in seen_edge_keys:
                continue
            seen_edge_keys.add(edge_key)
            edges.append(
                {
                    "start": current_urn,
                    "end": target_urn,
                    "type": "RINVIA",
                    "properties": {},
                }
            )

    for raw_line in body.splitlines():
        line = raw_line.rstrip()

        article_match = _ARTICLE_HEADING_RE.match(line)
        if article_match:
            _flush_article()
            numero = _normalize_article_number(article_match.group("num"))
            rubrica_raw = (article_match.group("rubrica") or "").strip().rstrip(".").strip()
            if rubrica_raw.startswith("(") and rubrica_raw.endswith(")"):
                rubrica_raw = rubrica_raw[1:-1].strip()
            current_urn = _article_urn(base_urn, numero)
            current_props = {
                "URN": current_urn,
                "node_id": current_urn,
                "numero_articolo": numero,
                "rubrica": f"({rubrica_raw})." if rubrica_raw else "",
                "tipo_documento": "articolo",
                "estremi": (
                    f"Art. {numero} {act_estremi}".strip() if act_estremi else f"Art. {numero}"
                ),
                "vigenza": vigenza,
                "fonte": "italia_corpus",
            }
            if current_titolo:
                current_props["titolo"] = current_titolo
            current_body_lines = []
            continue

        section_match = _SECTION_HEADING_RE.match(line)
        if section_match:
            _flush_article()
            current_urn = None
            current_props = None
            current_body_lines = []
            current_titolo = section_match.group("titolo").strip()
            continue

        if _GENERIC_HEADING_RE.match(line):
            # A sub-hierarchy heading that is neither an article nor a
            # `## TITOLO` (e.g. `### SEZIONE ...`, `#### CAPO ...`) — flush
            # and skip so it never folds into an article's testo_vigente.
            _flush_article()
            current_urn = None
            current_props = None
            current_body_lines = []
            continue

        if current_urn is not None:
            current_body_lines.append(raw_line)

    _flush_article()

    log.info(
        "italia_corpus.parsed",
        nodes=len(nodes),
        edges=len(edges),
        base_urn=base_urn,
    )
    return {"nodes": nodes, "edges": edges}


__all__ = [
    "MechanicalSourceAdapter",
    "ItaliaCorpusAdapter",
    "VisualexTreeAdapter",
    "get_adapter",
    "parse_italia_corpus_markdown",
]
