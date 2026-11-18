"""Resolve an act the way a lawyer writes it into scraper parameters.

"statuto dei lavoratori", "del D.Lgs. 231/2001", "TUSL", "c.p.p." all name real
acts; the tables in map.py hold what they mean. This module is the lookup side:
it normalises the query, tries the tables in order of trustworthiness, and
returns None rather than guessing — an unrecognised name must be reported to the
user, not silently answered with the wrong law.
"""
from __future__ import annotations

import difflib
import re
from datetime import date
from typing import Optional

from .dated_names import DATED_NAMES, act_at, spans_of
from .map import (
    ATTI_DENOMINATI,
    ATTI_NOTI,
    NORMATTIVA_SEARCH,
    NORMATTIVA_URN_CODICI,
    extract_codice_details,
)
from .regional_law import cites_regional_law

# Leading articles and prepositions: "art. 111 *della* Costituzione".
# The trailing \s+ is load-bearing: without it "le" would be stripped from "legge".
_LEADING_WORDS = re.compile(
    r"^(?:(?:del|della|dello|dei|degli|delle|di|il|lo|la|i|gli|le|un|una|uno)\s+|[dl]')",
    re.IGNORECASE,
)

# A dotted acronym: letters and dots only, at least one dot ("t.u.e.l.", "c.c.").
# Restricted to letter-only keys so "d.lgs. 196/2003" keeps its shape and goes
# down the citation-pattern path instead of being mangled into a lookup key.
_DOTTED_ACRONYM = re.compile(r"^[a-zà-ù]+(?:\.[a-zà-ù]*)+$", re.IGNORECASE)


# Spellings that name two acts. Refused rather than read as one of them, so the search asks
# instead of guessing (design 2026-10-29-document-analysis §4.8, Q9). Kept by hand and short:
# an entry is a spelling lawyers really write for two acts, with a name of each that the tables
# resolve, so the search can offer them (`ambiguous_act`).
# «T.U.E.» is the testo unico edilizia (d.P.R. 380/2001) in a brief, and the dotted acronym of
# «TUE», the Treaty on European Union, to the tables; «TUE» without dots stays the Treaty.
# «TUA» is the codice dell'ambiente («testo unico ambientale») and the testo unico accise, «TUA»
# in the Agenzia delle dogane's practice, at the same date: the date cannot split them (G-577;
# mcp-legal-it found no new testo unico accise on 18 November 2026).
AMBIGUOUS_NAMES: dict[str, tuple[str, ...]] = {
    "t.u.e": ("testo unico edilizia", "tue"),
    "tua": ("codice dell'ambiente", "testo unico accise"),
    "t.u.a": ("codice dell'ambiente", "testo unico accise"),
}

def _normalize_search_type(input_type: str) -> str:
    """Act-type abbreviation -> canonical full name, via NORMATTIVA_SEARCH.

    Named apart from text_op.normalize_act_type, which has an incompatible
    three-argument signature and selects between three different tables.
    """
    if input_type in {"TUE", "TFUE", "CDFUE"}:
        return input_type
    key = input_type.lower().strip()
    return NORMATTIVA_SEARCH.get(key, key)


def _normalize_key(name: str) -> str:
    """Lowercase and tidy an act name for table lookup.

    Trailing dots are preserved: several table keys are dotted abbreviations
    ("c.c.", "d.lgs."), so stripping them would break resolution rather than help.
    """
    key = name.strip().lower()
    key = key.replace("’", "'").replace("ʼ", "'")
    # Nicknames arrive quoted the way Brocardi prints them: Decreto "Sostegni".
    key = key.replace('"', "").replace("“", "").replace("”", "")
    key = re.sub(r"\s+", " ", key)
    return key.strip(" ,;:")


def _strip_leading_words(key: str) -> str:
    """Drop leading articles/prepositions, repeatedly ("del lo statuto" -> "statuto")."""
    while True:
        stripped = _LEADING_WORDS.sub("", key, count=1).strip()
        if stripped == key or not stripped:
            return key
        key = stripped


def _candidate_keys(name: str):
    """Yield lookup keys for an act name, most literal first.

    Literal-first ordering means pre-existing exact matches always win; the
    normalised variants only ever add resolutions, never change one.
    """
    seen = set()
    normalized = _normalize_key(name)
    candidates = [name.strip(), normalized, _strip_leading_words(normalized)]
    if _DOTTED_ACRONYM.match(normalized):
        candidates.append(normalized.replace(".", ""))
    for candidate in candidates:
        if candidate and candidate not in seen:
            seen.add(candidate)
            yield candidate


def _lookup_key(key: str, day: Optional[date] = None) -> dict | None:
    """Resolve one exact key against the tables, in order of trustworthiness.

    A dated name («tuir») first, at `day` (`dated_names`). ATTI_NOTI and the codici URN
    table are hand-verified and take precedence over ATTI_DENOMINATI, whose base was
    generated from Brocardi labels.
    """
    dated = act_at(key, day)
    if dated is not None:
        return dated
    if key in ATTI_NOTI:
        return dict(ATTI_NOTI[key])

    details = extract_codice_details(key)
    if details:
        # The codice NAME stays in tipo_atto: generate_urn keys the default
        # allegato off it (codice civile ":2", codice penale ":1", ...).
        return {"tipo_atto": key, "data": details["data"],
                "numero_atto": details["numero_atto"]}

    if key in ATTI_DENOMINATI:
        return dict(ATTI_DENOMINATI[key])

    normalized = _normalize_search_type(key)
    if normalized != key:
        if normalized in ATTI_NOTI:
            return dict(ATTI_NOTI[normalized])
        details = extract_codice_details(normalized)
        if details:
            return {"tipo_atto": normalized, "data": details["data"],
                    "numero_atto": details["numero_atto"]}
        if normalized.lower() in ATTI_DENOMINATI:
            return dict(ATTI_DENOMINATI[normalized.lower()])

    return None


def ambiguous_act(name: str) -> tuple[str, ...] | None:
    """A name of each act an ambiguous spelling names («T.U.E.», «del t. u. e.», «TUA»), each
    one the tables resolve; or None."""
    if not name:
        return None
    normalized = _normalize_key(name)
    for key in (normalized, _strip_leading_words(normalized)):
        acts = AMBIGUOUS_NAMES.get(re.sub(r"\s+", "", key).rstrip("."))
        if acts:
            return acts
    return None

def resolve_atto(name: str, day: Optional[date] = None) -> dict | None:
    """Resolve a common act name to scraper parameters.

    Returns {"tipo_atto", "data", "numero_atto"}, or None. Never guesses: an ambiguous
    spelling and a regional law (`regional_law`) are None. A dated name («tuir»,
    `dated_names`) is read at `day`, today in Rome when None; its act carries `notice`, and
    `allegato` when its text is an annex.
    """
    if not name or ambiguous_act(name) or cites_regional_law(name):
        return None
    for key in _candidate_keys(name):
        result = _lookup_key(key, day)
        if result:
            return result
    return None


def act_typed_with(name: str, number: str | None, act_date: str | None,
                   day: Optional[date] = None) -> dict | None:
    """The act a name and the number or year typed beside it name together, or None.

    «TUIR 917/1986» is the d.p.r. 917/1986 on any day, never a «d.lgs. 917/1986, allegato 1»;
    «TUA 152/2006» is the codice dell'ambiente. For a dated name, the span whose act has the
    number and the year (with that span's notice); for an ambiguous one, the act among its own
    that has them; for any other name, its act when it has them. None when no act of the name
    has them: reading the name's act with another act's number would name an act that does not
    exist (review of G-577).
    """
    year = (act_date or "")[:4]
    names = ambiguous_act(name)
    if names:
        acts = [resolve_atto(each, day) for each in names]
    else:
        spans = next((spans_of(key) for key in _candidate_keys(name) if key in DATED_NAMES), None)
        acts = ([{**span.act, "notice": span.notice} for span in spans] if spans
                else [resolve_atto(name, day)])
    for act in acts:
        if act and (not number or act.get("numero_atto") == number) \
                and (not year or str(act.get("data") or "")[:4] == year):
            return act
    return None


def strip_leading_particles(name: str) -> str:
    """Normalise an act name and drop leading articles/prepositions."""
    return _strip_leading_words(_normalize_key(name))


def known_act_names() -> list[str]:
    """Every act name the resolver recognises — used to suggest near misses."""
    return sorted(
        set(ATTI_NOTI)
        | set(ATTI_DENOMINATI)
        | set(NORMATTIVA_SEARCH)
        | set(NORMATTIVA_URN_CODICI)
        | set(DATED_NAMES)
    )


def suggest_acts(name: str, limit: int = 3) -> list[str]:
    """Near misses for an unresolved act name, best first."""
    if not name:
        return []
    return difflib.get_close_matches(
        strip_leading_particles(name), known_act_names(), n=limit, cutoff=0.7
    )
