"""The parts a Normattiva article is split into, read from its page's article tree.

Normattiva splits a very long article into parts, each its own entry in the tree on
the left of the page: «1 (commi 1-100)», «1 (commi 101-200)», … up to «1 (commi
1301-1364)» for art. 1 l. 296/2006, linked with `art.progressivo=k`. The article's
URN serves the first part only, so comma 773 was not there for us and nothing said
so (G-387). This module reads the list of parts from the page the scraper already
keeps in its persistent cache, as `normattiva_validity` does: no request, and
`article_text` never touched (root CLAUDE.md, rule 23). It does not fetch a part:
that needs the page's session and comes with the parts as entries (G-387 (a)).

The shape is the one agreed for mcp-legal-it 3.0.x: `{progressivo, commi_dal,
commi_al, url}` per part, `[]` when the article is not split. Best effort: a page
with no tree yields None, never a guess.
"""
from __future__ import annotations

import html
import re
from typing import List, Optional, TypedDict

import structlog

from .akn_parser import comparable_article_key
from .normattiva_validity import _CLASS_VALUE

log = structlog.get_logger()

BASE_URL = "https://www.normattiva.it"

# Linear on any page: an opening tag cannot run past the next "<" or ">", a label is
# read from a bounded slice, and the class is read from one opening's text only.
_A_OPENING = re.compile(r"<a\b[^<>]*>", re.I)
_PROGRESSIVO = re.compile(r"art\.progressivo=(\d{1,4})\b")
_LOAD_PATH = re.compile(r"""showArticle\(\s*'(/atto/caricaArticolo\?[^'<>\s]{1,2000})'""")
# «1 (commi 1-100)», «art. 1 (commi 701-800)», «2-bis (commi 1-50)». The article is
# compared by key, so its spelling is the tree's.
_PART_LABEL = re.compile(
    r"^(?:art\.?\s*)?([0-9][0-9a-z .-]{0,30}?)\s*\(\s*commi\s+(\d{1,5}[a-z-]{0,12})\s*-\s*(\d{1,5}[a-z-]{0,12})\s*\)$",
    re.I,
)
_LABEL_MAX = 120


class ArticlePart(TypedDict):
    """One part on the wire, as mcp-legal-it 3.0.x writes it."""

    progressivo: int     # the page's `art.progressivo`, as written (1 … 14 for art. 1 l. 296/2006)
    commi_dal: str       # the first comma, as the tree labels it
    commi_al: str        # the last comma
    url: str             # the part's page on Normattiva; it opens only in the article page's session


def extract_parts(raw_html: str, *, article: str) -> Optional[List[ArticlePart]]:
    """The parts of `article` listed in the page's tree, ordered by `progressivo`;
    `[]` when the tree lists the article whole; None when the page has no tree.

    Only the entries labelled «<article> (commi a-b)» count: the tree also lists an
    article's earlier versions split the same way («agg.149 (commi 1-100)»).
    """
    if not raw_html or not article:
        return None
    wanted = comparable_article_key(article)
    seen_tree = False
    parts: dict[int, ArticlePart] = {}
    for opening in _A_OPENING.finditer(raw_html):
        tag = opening.group()
        value = _CLASS_VALUE.search(tag)
        if value is None or "numero_articolo" not in (value.group(1) or value.group(2) or "").split():
            continue
        seen_tree = True
        close = raw_html.find("</a>", opening.end(), opening.end() + _LABEL_MAX)
        if close < 0:
            continue
        label = " ".join(html.unescape(raw_html[opening.end():close]).split())
        found = _PART_LABEL.match(label)
        if found is None or comparable_article_key(found.group(1)) != wanted:
            continue
        progressivo = _PROGRESSIVO.search(tag)
        path = _LOAD_PATH.search(html.unescape(tag))
        if progressivo is None or path is None:
            continue
        number = int(progressivo.group(1))
        parts.setdefault(number, {
            "progressivo": number,
            "commi_dal": found.group(2).lower(),
            "commi_al": found.group(3).lower(),
            "url": BASE_URL + path.group(1).rstrip("&"),
        })
    if not seen_tree:
        return None
    ordered = [parts[k] for k in sorted(parts)]
    if ordered:
        log.info("Article split into parts", article=article, parts=len(ordered))
    return ordered


def partial_notice(parts: List[ArticlePart]) -> str:
    """«testo parziale: commi 1-100 di 1364 (diviso in 14 parti)»: the first part is the one the article's URN serves."""
    first, last = parts[0], parts[-1]
    return (f"testo parziale: commi {first['commi_dal']}-{first['commi_al']} di {last['commi_al']} "
            f"(diviso in {len(parts)} parti)")


def parts_fields(parts: Optional[List[ArticlePart]]) -> dict:
    """The keys an article answer carries for a Normattiva text.

    - `parti`: the list (`[]` when the article is whole), or None when the tree could
      not be read or the text is the AKN export's, which holds the whole article.
    - `testo_parziale`: the text served is one part of a split article.
    """
    return {"parti": parts, "testo_parziale": bool(parts)}
