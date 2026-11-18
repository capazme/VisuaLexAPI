"""Names whose act follows the date: the fiscal testi unici of 2027 (G-577).

The fiscal reform's testi unici replace older acts from the day they apply, which is not the day
they enter into force. «TUIR», «TUR» and «TUIVA», and their long names, name the old act until
31 December 2026 and the new testo unico from 1 January 2027; each new testo unico is the annex
(«allegato 1») of the decree that approves it, so its reading carries `allegato`. Both spans
carry a one-line notice: before the day, that the new testo unico is coming; from the day, that
the name has moved and where the old text is.

The date is the one the reading is made at, today in Rome unless a caller gives one: a note
already saved keeps the act it was made on, since what is saved is the act, never the name.

Every act and date below is mcp-legal-it's (pull request 191, decision LI-086), read there on
Normattiva act by act on 18 November 2026: d.lgs. 19 giugno 2026, n. 117 (art. 377), d.lgs. 1°
agosto 2025, n. 123 (art. 205, comma 1, as replaced by art. 4, comma 5, d.l. 200/2025) and d.lgs.
19 gennaio 2026, n. 10 (art. 171) all apply from 1 January 2027. Normattiva serves art. 1 of the
d.p.r. 917/1986 as repealed on that day (tests/fixtures/normattiva/README.md). The citations are
written as `sources.cite_act` writes them (`tests/test_dated_names.py` checks it).

A leaf module: tables and one lookup, no import from the readers.
"""
from __future__ import annotations

from datetime import date
from typing import NamedTuple, Optional

from ..services.normattiva_validity import today_in_rome


class Span(NamedTuple):
    """One span of a dated name: from `since` (ISO day; "" for always) the act it names."""

    since: str
    #: `{tipo_atto, data, numero_atto}`, plus `allegato` when the text is an annex.
    act: dict
    #: The one-line notice the reading carries in this span.
    notice: str


_DPR = "decreto del presidente della repubblica"
_DLGS = "decreto legislativo"
_SWITCH = "2027-01-01"
_SWITCH_WORDS = "1° gennaio 2027"


def _succession(old: dict, old_citation: str, new: dict, new_citation: str, title: str) -> tuple[Span, Span]:
    """The two spans of a name that passes from `old` to `new`, the annex of its decree, on
    1 January 2027."""
    named = f"{title} ({new_citation}, allegato {new['allegato']})"
    return (
        Span("", old, f"Dal {_SWITCH_WORDS} si applica il {named}."),
        Span(_SWITCH, new,
             f"Dal {_SWITCH_WORDS} questo nome indica il {named}; il testo precedente è il {old_citation}."),
    )


_TUIR = _succession(
    {"tipo_atto": _DPR, "data": "1986-12-22", "numero_atto": "917"}, "d.p.r. 22 dicembre 1986, n. 917",
    {"tipo_atto": _DLGS, "data": "2026-06-19", "numero_atto": "117", "allegato": "1"},
    "d.lgs. 19 giugno 2026, n. 117", "testo unico delle imposte sui redditi")
_REGISTRO = _succession(
    {"tipo_atto": _DPR, "data": "1986-04-26", "numero_atto": "131"}, "d.p.r. 26 aprile 1986, n. 131",
    {"tipo_atto": _DLGS, "data": "2025-08-01", "numero_atto": "123", "allegato": "1"},
    "d.lgs. 1° agosto 2025, n. 123", "testo unico dell'imposta di registro e degli altri tributi indiretti")
_IVA = _succession(
    {"tipo_atto": _DPR, "data": "1972-10-26", "numero_atto": "633"}, "d.p.r. 26 ottobre 1972, n. 633",
    {"tipo_atto": _DLGS, "data": "2026-01-19", "numero_atto": "10", "allegato": "1"},
    "d.lgs. 19 gennaio 2026, n. 10", "testo unico dell'imposta sul valore aggiunto")

#: Name (lower case, as `act_resolver` keys it) → its spans, oldest first. «T.U.I.R.» reaches
#: «tuir» through the resolver's dotted-acronym key.
DATED_NAMES: dict[str, tuple[Span, ...]] = {
    **dict.fromkeys(("tuir", "testo unico delle imposte sui redditi", "testo unico imposte sui redditi",
                     "testo unico imposte redditi", "tu imposte redditi"), _TUIR),
    **dict.fromkeys(("tur", "tu registro", "testo unico registro", "testo unico dell'imposta di registro",
                     "testo unico imposta di registro"), _REGISTRO),
    **dict.fromkeys(("tuiva", "tu iva", "testo unico iva"), _IVA),
}


def spans_of(key: str) -> tuple[Span, ...]:
    """The spans of the dated name keyed `key`, oldest first; () when it is not one."""
    return DATED_NAMES.get(key, ())


def act_at(key: str, day: Optional[date] = None) -> Optional[dict]:
    """The act a dated name keyed `key` names on `day` (today in Rome when None), with its
    notice under `notice`; None when `key` is not a dated name."""
    spans = DATED_NAMES.get(key)
    if spans is None:
        return None
    day = day or today_in_rome()
    chosen = spans[0]
    for span in spans:
        if not span.since or date.fromisoformat(span.since) <= day:
            chosen = span
    return {**chosen.act, "notice": chosen.notice}
