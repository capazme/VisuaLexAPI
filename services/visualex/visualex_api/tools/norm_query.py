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


def read_norm_query(query: str) -> tuple[Optional[dict], Optional[str]]:
    """(parameters, source): the preset aliases first («gdpr» → regolamento UE 2016/679),
    then the parser («art 1453 cc»). (None, None) when neither reads it."""
    params = resolve_alias(query)
    if params:
        return params, "alias"
    parsed = parse_nl_query(query)
    if parsed is None:
        return None, None
    return parsed.to_api_params(), "nl_parser"


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
