# services/merlt/merlt/pipeline/massimario/urns.py
"""The portal's Normattiva links → the canonical URNs of VisuaLex and the graph (spec §5.3).

The portal names the codes (`codice.civile:1942-03-16;262`); VisuaLex and the
graph name the enacting decree and its annex (`regio.decreto:1942-03-16;262:2`,
services/visualex/visualex_api/tools/map.py, NORMATTIVA_URN_CODICI). The article
is the join level; the comma part (`com2-num2`) is kept apart. Acts linked with
the year only are completed by VisuaLex's /resolve_act_dates (Task 2).
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

from merlt.utils.map import NORMATTIVA_URN_CODICI

NORMATTIVA_PREFIX = "https://www.normattiva.it/uri-res/N2Ls?"

CODE_ACTS = {
    "stato:codice.civile:1942-03-16;262": "stato:regio.decreto:1942-03-16;262:2",
    "stato:codice.procedura.civile:1940-10-28;1443": "stato:regio.decreto:1940-10-28;1443:1",
    "stato:codice.penale:1930-10-19;1398": "stato:regio.decreto:1930-10-19;1398:1",
    "stato:codice.procedura.penale:1988-09-22;447": "stato:decreto.del.presidente.della.repubblica:1988-09-22;447",
    "stato:costituzione:1947-12-27": "stato:costituzione",
}


def _annexed_codes() -> dict[str, str]:
    """`stato:<decree>` → `stato:<decree>:<annex>` for every code VisuaLex keys by the
    one annex of its decree (`decreto.legislativo:2010-07-02;104:2`, the c.p.a.). A
    decree with two annexes in the table (r.d. 262/1942: preleggi and codice civile)
    is left alone: its links cannot say which one they mean."""
    annexes: dict[str, list[str]] = {}
    for urn in NORMATTIVA_URN_CODICI.values():
        found = re.fullmatch(r"([a-z.]+:\d{4}-\d{2}-\d{2};\d+):\d", urn)
        if found:
            annexes.setdefault("stato:" + found.group(1), []).append("stato:" + urn)
    return {act: keyed[0] for act, keyed in annexes.items() if len(keyed) == 1}


CODE_ACTS.update({act: keyed for act, keyed in _annexed_codes().items() if act not in CODE_ACTS})
_AUTHORITIES = {
    "presidente.repubblica:decreto:": "stato:decreto.del.presidente.della.repubblica:",
    "presidente.consiglio.ministri:decreto:": "stato:decreto.del.presidente.del.consiglio.dei.ministri:",
}

_HREF = re.compile(r"^(?:https?://www\.normattiva\.it)?/uri-res/N2Ls\?urn:nir:([^\s\"'<>]+)$")
_ACT = re.compile(r"([a-z.]{1,60}):([a-z.]{1,60}):(\d{4}(?:-\d{2}-\d{2})?)(?:;([1-9]\d{0,5}[a-z]*))?(?::(\d))?")
_ARTICLE = re.compile(r"art(\d{1,5}[a-z]*(?:\.\d{1,2})?)(?:-(.+))?")
# The portal links some Sezione lavoro citations as laws: in "Sez. 6 - L, n. 09952/2022"
# the anchor is "L, n. 09952/2022" and the href `stato:legge:2022;9522`. The anchor is
# the section's letter, with a comma after it, or after a section label; lower case only
# after a label ("conv. in l, n. 27 del 2012" is a law).
_SECTION_LETTER = re.compile(r"L\.?\s*,")
_SECTION_LETTER_AFTER_LABEL = re.compile(r"[Ll]\.?[\s,]")
_SECTION_LABEL_BEFORE = re.compile(r"\bSez(?:ione|\.)?\s*,?\s*(?:[0-9]{1,2}\s*[-–]?\s*)?$", re.IGNORECASE)


@dataclass(frozen=True)
class PortalNorm:
    act: str                # "stato:legge:1983;184" (no "urn:nir:"), authority already mapped
    article: Optional[str]  # "369", "380bis"
    comma: Optional[str]    # "com2-num2"
    year_only: bool

    @property
    def year_only_urn(self) -> Optional[str]:
        return f"urn:nir:{self.act}" if self.year_only else None


def is_decision_link(text: str, before: str) -> bool:
    """A link whose anchor is a Cassazione section's letter (`L, n. …`), not a law.
    `before` is the paragraph's text just before the anchor."""
    anchor = (text or "").lstrip()
    if _SECTION_LETTER.match(anchor):
        return True
    return bool(_SECTION_LETTER_AFTER_LABEL.match(anchor) and _SECTION_LABEL_BEFORE.search((before or "")[-40:]))


def parse_portal_urn(href: str) -> Optional[PortalNorm]:
    """The norm a portal link points to; None for partitions and unusable links."""
    match = _HREF.match((href or "").strip())
    if not match:
        return None
    act, _, tail = match.group(1).partition("~")
    for portal, visualex in _AUTHORITIES.items():
        if act.startswith(portal):
            act = visualex + act[len(portal):]
    parts = _ACT.fullmatch(act)
    if not parts:
        return None
    if parts.group(4) is None and act not in CODE_ACTS:
        return None  # an act without its number: VisuaLex and the graph key acts by it
    article = comma = None
    if tail:
        found = _ARTICLE.fullmatch(tail)
        if not found:
            return None  # a partition (`sez2`, `prt1`, `tit2`, `cap3`): not an article
        article, comma = found.group(1), found.group(2)
    year_only = len(parts.group(3)) == 4 and parts.group(4) is not None
    return PortalNorm(act=act, article=article, comma=comma, year_only=year_only)


def to_canonical(norm: PortalNorm, resolved: dict) -> Optional[str]:
    """The canonical URN (full Normattiva URL, article level); None if a year-only act is unresolved."""
    act = norm.act
    if norm.year_only:
        full = resolved.get(norm.year_only_urn)
        if not full:
            return None
        act = full[len("urn:nir:"):]
    act = CODE_ACTS.get(act, act)
    return NORMATTIVA_PREFIX + "urn:nir:" + act + (f"~art{norm.article}" if norm.article else "")
