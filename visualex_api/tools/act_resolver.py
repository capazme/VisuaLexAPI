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

from .map import (
    ATTI_DENOMINATI,
    ATTI_NOTI,
    NORMATTIVA_SEARCH,
    NORMATTIVA_URN_CODICI,
    extract_codice_details,
)

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


def _lookup_key(key: str) -> dict | None:
    """Resolve one exact key against the tables, in order of trustworthiness.

    ATTI_NOTI and the codici URN table are hand-verified and take precedence
    over ATTI_DENOMINATI, whose base was generated from Brocardi labels.
    """
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


def resolve_atto(name: str) -> dict | None:
    """Resolve a common act name to scraper parameters.

    Returns {"tipo_atto", "data", "numero_atto"} or None. Never guesses.
    """
    if not name:
        return None
    for key in _candidate_keys(name):
        result = _lookup_key(key)
        if result:
            return result
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
    )


def suggest_acts(name: str, limit: int = 3) -> list[str]:
    """Near misses for an unresolved act name, best first."""
    if not name:
        return []
    return difflib.get_close_matches(
        strip_leading_particles(name), known_act_names(), n=limit, cutoff=0.7
    )
