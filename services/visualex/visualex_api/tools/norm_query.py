"""A norm typed as a lawyer types it, read into the API's parameters — the search's reading.

`/parse_query` reads one string with it before it builds the URN; `/parse_query_batch` reads
up to 200 with it and stops there (design 2026-10-29-document-analysis §4.4). One function,
so the two routes cannot drift. Tables and regexes only: no request, no log, no cache.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Optional

from .act_identity import identifies_act
from .act_resolver import ambiguous_act, known_act_names, resolve_atto
from .article_suffixes import ARTICLE_SUFFIX_ALTERNATION
from .alias_resolver import get_all_presets, resolve_alias, split_article
from .nl_parser import parse_nl_query
from .recital_clause import split_recital_clause
from .regional_law import local_law
from .sources import cite_act

# The acts with numbered recitals (spec 2026-11-17 §1): a regulation or a directive of the Union.
RECITAL_ACT_TYPES = frozenset({"regolamento ue", "direttiva ue"})
# The act's fields a refused recital reading keeps: never an article (or its comma, part, annex),
# so a reader that does not know `refusal` finds no article to add or open (spec §3.2).
_ACT_FIELDS = ("act_type", "act_number", "date")
# An article named in what is left, though no act was read with it: «art. 4 e considerando 26».
_ARTICLE_HEAD = re.compile(r"\bart(?:icol[oi]|t?\.)?\s*[0-9]", re.IGNORECASE)


def _read(query: str, day: Optional[date] = None) -> tuple[Optional[dict], Optional[str]]:
    params = resolve_alias(query, day)
    if params:
        return params, "alias"
    parsed = parse_nl_query(query, day)
    if parsed is None:
        return None, None
    return parsed.to_api_params(), "nl_parser"


def read_norm_query(query: str, day: Optional[date] = None) -> tuple[Optional[dict], Optional[str]]:
    """(parameters, source): the preset aliases first («gdpr» → regolamento UE 2016/679),
    then the parser («art 1453 cc»). (None, None) when neither reads it.

    A regional or a provincial law is never read as a State law (G-577): `({"refusal":
    "regional_law"}, "regional")` or `({"refusal": "provincial_law"}, "provincial")`, before
    anything else reads the query. A dated name («art. 1 tuir»,
    `dated_names`) is read at `day`, today in Rome when None: the reading adds `annex` when the
    act's text is an annex, and `notice`, the one line the search shows with it. An ambiguous
    name («art. 1 tua») reads nothing: `ambiguous_choices` names the acts it could mean.

    A recital clause («considerando 26», spec 2026-11-17 §3) is taken out first and the rest is
    read the same way. Its reading gains `recital` ("26", "26,27", "26-30"):
    - with an EU regulation or directive: the act's fields and `recital`;
    - with no act it can read: `recital` alone (incomplete, source "recital"), or, when an article
      is named, `refusal: "recital_with_article"`;
    - with another act: `refusal: "recital_not_eu"`;
    - with an EU act and an article: `refusal: "recital_with_article"`. A refusal keeps the act's
      fields only, never the article.
    An article of an act that has no recitals («art. 2043 c.c. considerando 5 anni») cannot sit
    beside one: the «considerando» is the gerund, and the query is read as if the clause were not
    there, as before.
    """
    refusal = local_law(query)
    if refusal:
        return {"refusal": refusal}, refusal.removesuffix("_law")
    spec, rest = split_recital_clause(query)
    if spec is None:
        return _read(query, day)
    params, source = _read(rest, day) if rest else (None, None)
    if not params or not params.get("act_type"):
        if _ARTICLE_HEAD.search(rest or ""):
            return {"recital": spec, "refusal": "recital_with_article"}, "recital"
        return {"recital": spec}, "recital"
    eu = str(params["act_type"]).casefold() in RECITAL_ACT_TYPES
    if params.get("article") and not eu:
        return _read(query, day)
    act = {k: params[k] for k in _ACT_FIELDS if params.get(k)}
    if params.get("article"):
        return {**act, "recital": spec, "refusal": "recital_with_article"}, source
    if not eu:
        return {**act, "recital": spec, "refusal": "recital_not_eu"}, source
    return {**act, "recital": spec}, source


def ambiguous_choices(query: str, day: Optional[date] = None) -> Optional[list[dict]]:
    """The acts an ambiguous name could mean («art. 1 tua», «T.U.E.»), so the search can ask
    which: each as `{name, parsed, display}`, where `parsed` is the act's reading (with the
    article, when one was typed) and `display` the act's citation. None when the query names no
    ambiguous act."""
    if not query or not query.strip():
        return None
    with_comma = _ARTICLE_AND_COMMA.match(query.strip())
    if with_comma:
        number, suffix, name = with_comma.groups()
        article = f"{number}-{suffix.lower()}" if suffix else number
    else:
        article, name = split_article(query)
    names = ambiguous_act(name)
    if not names:
        return None
    choices = []
    for each in names:
        act = resolve_atto(each, day)
        if act is None:
            continue
        parsed = {"act_type": act["tipo_atto"]}
        if act.get("numero_atto"):
            parsed["act_number"] = act["numero_atto"]
        if act.get("data"):
            parsed["date"] = act["data"]
        if act.get("allegato"):
            parsed["annex"] = act["allegato"]
        if article:
            parsed["article"] = article
        choices.append({"name": each, "parsed": parsed, "display": cite_act(act)})
    return choices or None


# «art. 29, comma 1, TUA», «art. 29 bis comma 1 TUA»: an article with its comma ahead of the name,
# which `split_article` leaves whole. The comma is dropped: the choice names the act and the article.
_ARTICLE_AND_COMMA = re.compile(
    rf"^(?:artt?\.?|articol[oi])\s*(\d+)(?:\s*-?\s*({ARTICLE_SUFFIX_ALTERNATION})\b)?\s*,?\s*"
    r"(?:comma|co\.)\s*\d+[a-z]*\s*,?\s*(\S.*)$",
    re.IGNORECASE)


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
