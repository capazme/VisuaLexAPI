"""A norm typed as a lawyer types it, read into the API's parameters — the search's reading.

`/parse_query` reads one string with it before it builds the URN; `/parse_query_batch` reads
up to 200 with it and stops there (design 2026-10-29-document-analysis §4.4). One function,
so the two routes cannot drift. Tables and regexes only: no request, no log, no cache.
"""
from __future__ import annotations

from typing import Optional

from .act_identity import identifies_act
from .act_resolver import known_act_names
from .alias_resolver import get_all_presets, resolve_alias
from .nl_parser import parse_nl_query
from .recital_clause import split_recital_clause

# The acts with numbered recitals (spec 2026-11-17 §1): a regulation or a directive of the Union.
RECITAL_ACT_TYPES = frozenset({"regolamento ue", "direttiva ue"})
# The act's fields a refused recital reading keeps: never an article (or its comma, part, annex),
# so a reader that does not know `refusal` finds no article to add or open (spec §3.2).
_ACT_FIELDS = ("act_type", "act_number", "date")


def _read(query: str) -> tuple[Optional[dict], Optional[str]]:
    params = resolve_alias(query)
    if params:
        return params, "alias"
    parsed = parse_nl_query(query)
    if parsed is None:
        return None, None
    return parsed.to_api_params(), "nl_parser"


def read_norm_query(query: str) -> tuple[Optional[dict], Optional[str]]:
    """(parameters, source): the preset aliases first («gdpr» → regolamento UE 2016/679),
    then the parser («art 1453 cc»). (None, None) when neither reads it.

    A recital clause («considerando 26», spec 2026-11-17 §3) is taken out first and the rest is
    read the same way. Its reading gains `recital` ("26", "26,27", "26-30"):
    - with an EU regulation or directive: the act's fields and `recital`;
    - with no act it can read: `recital` alone (incomplete, source "recital");
    - with another act: `refusal: "recital_not_eu"`, and with an article too:
      `refusal: "recital_with_article"`; both keep the act's fields only, never the article.
    """
    spec, rest = split_recital_clause(query)
    if spec is None:
        return _read(query)
    params, source = _read(rest) if rest else (None, None)
    if not params or not params.get("act_type"):
        return {"recital": spec}, "recital"
    act = {k: params[k] for k in _ACT_FIELDS if params.get(k)}
    if params.get("article"):
        return {**act, "recital": spec, "refusal": "recital_with_article"}, source
    if str(params["act_type"]).casefold() not in RECITAL_ACT_TYPES:
        return {**act, "recital": spec, "refusal": "recital_not_eu"}, source
    return {**act, "recital": spec}, source


_ACT_NAMES: Optional[list[str]] = None


def act_names() -> list[str]:
    """Every name, of the presets and of the resolver's tables, that names an act on its own:
    «codice civile», «gdpr», «statuto dei lavoratori», «tusl». A bare type word («legge»,
    «d.lgs.», «dpcm») names an act only with a number, so it is left out; so is a name the
    reading refuses. Built once: the tables are fixed for the process's life."""
    global _ACT_NAMES
    if _ACT_NAMES is None:
        names = set()
        for name in set(get_all_presets()) | set(known_act_names()):
            name = name.strip()
            if len(name) < 2 or name.isdigit():
                continue
            if identifies_act(read_norm_query(name)[0]):
                names.add(name)
        _ACT_NAMES = sorted(names)
    return _ACT_NAMES
