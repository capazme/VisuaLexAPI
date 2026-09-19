"""Where an article sits in its act, read from the tree VisuaLex serves.

`/fetch_tree` with `details=true` answers a flat, stateful listing: heading
strings ("LIBRO QUARTO Delle obbligazioni", "CAPO I …"), annex labels
("CODICE CIVILE") and article dicts, in document order. Nesting is implied by
order, so it is rebuilt here with a stack: a heading at one level clears
every level below it, and a change of annex clears them all.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from visualex_api.tools.article_suffixes import ARTICLE_SUFFIX_ALTERNATION

LEVELS: tuple[str, ...] = ("parte", "libro", "titolo", "capo", "sezione")

_HEADING = re.compile(r"^(PARTE|LIBRO|TITOLO|CAPO|SEZIONE)\b", re.IGNORECASE)
_ART_PREFIX = re.compile(r"^\s*art(?:icol[oi])?\.?\s*", re.IGNORECASE)
_SUFFIXED = re.compile(rf"^(\d+)\s*-?\s*({ARTICLE_SUFFIX_ALTERNATION})\b$")


def normalize_number(raw: str) -> str:
    """Canonical article key: "2 bis" / "2-BIS" / "2bis" -> "2-bis"."""
    key = str(raw or "").strip().lower()
    key = _ART_PREFIX.sub("", key).strip().rstrip(".").strip()
    match = _SUFFIXED.match(key)
    if match:
        return f"{match.group(1)}-{match.group(2)}"
    if re.fullmatch(r"\d+", key):
        return key
    key = re.sub(r"\s+", "-", key)
    return re.sub(r"-{2,}", "-", key).strip("-")


def classify_heading(text: str) -> tuple[str, str] | None:
    cleaned = re.sub(r"\s+", " ", str(text or "")).strip()
    match = _HEADING.match(cleaned)
    if not match:
        return None
    return match.group(1).lower(), cleaned


@dataclass(frozen=True)
class IndexedArticle:
    number: str
    raw_number: str
    position: int
    annex: str | None
    parte: str | None
    libro: str | None
    titolo: str | None
    capo: str | None
    sezione: str | None


def walk_tree(items: list) -> list[IndexedArticle]:
    levels: dict[str, str | None] = {level: None for level in LEVELS}
    # Headings met since the last article. When the next article opens a new
    # annex, the levels are cleared and these are replayed: they belong to the
    # annex being entered, not to the one being left.
    pending: list[tuple[str, str]] = []
    current_annex: str | None = None
    seen_any = False
    out: list[IndexedArticle] = []

    def apply(level: str, text: str) -> None:
        levels[level] = text
        for lower in LEVELS[LEVELS.index(level) + 1:]:
            levels[lower] = None

    for item in items:
        if isinstance(item, str):
            heading = classify_heading(item)
            if heading is None:
                continue  # an annex label or noise: the annex change is read off the articles
            apply(*heading)
            pending.append(heading)
            continue
        if not isinstance(item, dict):
            continue
        raw = item.get("numero")
        if not raw or not str(raw).strip():
            continue
        annex = item.get("allegato")
        annex = str(annex) if annex is not None else None
        if seen_any and annex != current_annex:
            for level in LEVELS:
                levels[level] = None
            for heading in pending:
                apply(*heading)
        pending = []
        current_annex = annex
        seen_any = True
        out.append(IndexedArticle(
            number=normalize_number(str(raw)),
            raw_number=str(raw),
            position=len(out),
            annex=annex,
            parte=levels["parte"],
            libro=levels["libro"],
            titolo=levels["titolo"],
            capo=levels["capo"],
            sezione=levels["sezione"],
        ))
    return out
