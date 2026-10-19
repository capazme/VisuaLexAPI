"""The convention for legal sources, as this API holds it.

Spec: docs/superpowers/specs/2026-10-04-source-convention-design.md. Golden file:
conventions/sources/golden.json, read by tests/test_sources_golden.py.

- ``normalize_norm_urn``: any spelling of a norm (a bare URN, Normattiva's alias form of a
  code, a version marker, a malformed type token, a ministry-form decree) → its identity.
- ``eu_identity``: an act of the Union, or one of its articles, by CELEX.
- ``cite_article``: how a lawyer cites an article, in the owner's style, with every form the
  owner decided (golden file). The web app's ``utils/citation.ts`` and the server's
  ``norms/citation.ts`` write the forms decided on 1 October and take the others with the
  plan's PRs 1 and 2, which pin them to the same golden file; MERL-T keeps its own copy
  (it does not import this package).
"""
from __future__ import annotations

import re
from typing import Any, Mapping, Optional

from .map import extract_codice_details

NORMATTIVA_RESOLVER = "https://www.normattiva.it/uri-res/N2Ls?"

# Normattiva's alias form of a code → the enacting decree and annex VisuaLex keys it by
# (NORMATTIVA_URN_CODICI). Mirrors MERL-T's massimario/urns.py CODE_ACTS.
_CODE_ALIASES = {
    "stato:codice.civile:1942-03-16;262": "stato:regio.decreto:1942-03-16;262:2",
    "stato:codice.procedura.civile:1940-10-28;1443": "stato:regio.decreto:1940-10-28;1443:1",
    "stato:codice.penale:1930-10-19;1398": "stato:regio.decreto:1930-10-19;1398:1",
    "stato:codice.procedura.penale:1988-09-22;447": "stato:decreto.del.presidente.della.repubblica:1988-09-22;447",
    "stato:costituzione:1947-12-27": "stato:costituzione",
}
# Normattiva names a ministerial decree by its ministry; VisuaLex's identity is the State form
# (spec §1.4). The resolver answers both with the same act.
_MINISTRY_DECREE = re.compile(r"ministero\.[a-z.]+:decreto:(\d{4}-\d{2}-\d{2});(\d+)")


# What may stand before the last "urn:nir:": nothing, the resolver URL, or the resolver URL
# doubled the way generate_urn wrote two rows of the codes table ("…stato:/uri-res/N2Ls?").
_NIR_PREFIX = re.compile(
    r"(?:https?://(?:www\.)?normattiva\.it/uri-res/N2Ls\?)?(?:urn:nir:stato:/uri-res/N2Ls\?)?", re.IGNORECASE)
# What follows it: an authority, a type (a space or a hyphen in it is a malformed token the
# normaliser repairs), then the rest of the URN with no space.
_NIR_TAIL = re.compile(r"[^\s:~]+:[A-Za-z.\- ]*[A-Za-z.\-](?:[:~;!@]\S*)?")


def _is_nir(text: str) -> bool:
    at = text.lower().rfind("urn:nir:")
    return at != -1 and bool(_NIR_PREFIX.fullmatch(text[:at])) and bool(_NIR_TAIL.fullmatch(text[at + 8:]))
_YEAR_ONLY = re.compile(r"[a-z.]+:[a-z.]+:\d{4};.*")


def normalize_norm_urn(value: Optional[str]) -> Optional[str]:
    """The identity of the norm a string names. Anything that is not a NIR URN (a decision
    key, a sentence that contains a URN), and a year-only URN, which is no identity until
    its date is known (spec §1.3), come back as they came."""
    if not value or not _is_nir(value.strip()):
        return value
    text = value.strip()
    # The last "urn:nir:": a doubled URL ("…stato:/uri-res/N2Ls?urn:nir:ministero…", which
    # generate_urn wrote for two rows of the codes table) names the inner act.
    body = text[text.lower().rindex("urn:nir:") + len("urn:nir:"):]
    cuts = [at for at in (body.find("!"), body.find("@")) if at != -1]
    if cuts:
        body = body[: min(cuts)]
    head, sep, article = body.partition("~")
    parts = head.split(":", 2)
    if len(parts) >= 2:
        # Authority and type are lower case; the rest keeps its case (an annex "81:A").
        parts[0] = parts[0].lower()
        parts[1] = re.sub(r"[\s\-]+", ".", parts[1].strip().lower())
        head = ":".join(parts)
    if _YEAR_ONLY.fullmatch(head):
        return value
    ministry = _MINISTRY_DECREE.fullmatch(head)
    if ministry:
        head = f"stato:decreto.ministeriale:{ministry.group(1)};{ministry.group(2)}"
    head = _CODE_ALIASES.get(head, head)
    return f"{NORMATTIVA_RESOLVER}urn:nir:{head}{sep}{article.lower()}"


_TREATY_CELEX = {"tfue": "12016E", "tue": "12016M", "cdfue": "12016P"}
_EU_SECTOR_3 = {"regolamento ue": "R", "direttiva ue": "L"}


def eu_identity(tipo_atto: str, data: Optional[str], numero_atto: Optional[str],
                articolo: Optional[str] = None) -> Optional[str]:
    """``celex:32016R0679`` for the act, ``celex:32016R0679~art5`` for an article; None when the
    act is not one of the Union's or its year and number are not both known."""
    kind = (tipo_atto or "").strip().lower()
    if kind in _TREATY_CELEX:
        celex = _TREATY_CELEX[kind]
    elif kind in _EU_SECTOR_3:
        year = (data or "")[:4]
        number = (numero_atto or "").strip()
        if not (year.isdigit() and len(year) == 4 and number.isdigit()):
            return None
        celex = f"3{year}{_EU_SECTOR_3[kind]}{int(number):04d}"
    else:
        return None
    key = f"celex:{celex}"
    return f"{key}~art{articolo.replace('-', '')}" if articolo else key


# Cited by their own name, with no comma (owner, 1 October 2026).
_NAMED = {
    "codice civile": "c.c.",
    "codice penale": "c.p.",
    "codice di procedura civile": "c.p.c.",
    "codice procedura civile": "c.p.c.",
    "codice di procedura penale": "c.p.p.",
    "codice procedura penale": "c.p.p.",
    "costituzione": "Cost.",
    "preleggi": "preleggi",
    "disposizioni per l'attuazione del codice civile e disposizioni transitorie": "disp. att. c.c.",
    "disposizioni per l'attuazione del codice di procedura civile e disposizioni transitorie": "disp. att. c.p.c.",
    "tue": "TUE",
    "tfue": "TFUE",
    "cdfue": "CDFUE",
}
_EU = {"regolamento ue": "reg. (UE)", "direttiva ue": "dir. (UE)"}
# In lower case, like the act (owner, 1 October 2026; D4 of 4 October). A type the table does
# not know is written in full.
_TYPES = {
    "legge": "l.",
    "decreto legislativo": "d.lgs.",
    "decreto legge": "d.l.",
    "decreto-legge": "d.l.",
    "decreto del presidente della repubblica": "d.p.r.",
    "regio decreto": "r.d.",
    "decreto ministeriale": "d.m.",
    "legge costituzionale": "l. cost.",
    "decreto del presidente del consiglio dei ministri": "d.p.c.m.",
    "regio decreto legge": "r.d.l.",
    "regio decreto-legge": "r.d.l.",
    "decreto legislativo luogotenenziale": "d.lgs.lgt.",
}
_MONTHS = ("gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
           "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre")
_ISO_DAY = re.compile(r"(\d{4})-(\d{2})-(\d{2})")


def _key(text: Optional[str]) -> str:
    return " ".join((text or "").strip().lower().split())


def _text(norm: Mapping[str, Any], field: str) -> str:
    value = norm.get(field)
    return value.strip() if isinstance(value, str) else ""


def _day(iso: str) -> Optional[str]:
    """"29 dicembre 2007", "1° settembre 1993"; None for anything that is not a full ISO day."""
    match = _ISO_DAY.fullmatch(iso)
    if not match or not 1 <= int(match.group(2)) <= 12:
        return None
    day = int(match.group(3))
    return f"{'1°' if day == 1 else day} {_MONTHS[int(match.group(2)) - 1]} {match.group(1)}"


def _act(norm: Mapping[str, Any]) -> tuple[str, str]:
    """The act as cited, and how an article joins it (a space for the named acts, else a comma)."""
    kind = _key(_text(norm, "tipo_atto"))
    if kind in _NAMED:
        return _NAMED[kind], " "
    number, date, real = _text(norm, "numero_atto"), _text(norm, "data"), _text(norm, "tipo_atto_reale")
    if kind in _EU:
        year = date[:4]
        return (f"{_EU[kind]} {year}/{number}" if number and year.isdigit() else _EU[kind]), ", "
    if not real:
        # An act the codes table names (an aliased code, the regulation of the c.p.i.): cited by
        # its decree, with the table's date and number where the norm carries none.
        details = extract_codice_details(_text(norm, "tipo_atto"))
        if details:
            real, date, number = details["tipo_atto_reale"], date or details["data"], number or details["numero_atto"]
    real_key = _key(real) or kind
    act = _TYPES.get(real_key, real_key)
    day = _day(date)
    if day:
        return f"{act} {day}" + (f", n. {number}" if number else ""), ", "
    if re.fullmatch(r"\d{4}", date):
        # Known by its year only (D7): never a day the source did not give.
        return (f"{act} n. {number} del {date}" if number else f"{act} del {date}"), ", "
    return act + (f", n. {number}" if number else ""), ", "


def cite_act(norm: Mapping[str, Any]) -> str:
    """The act alone: "l. 7 agosto 1990, n. 241", "c.c.", "reg. (UE) 2016/679"."""
    return _act(norm)[0]


def cite_article(norm: Mapping[str, Any]) -> str:
    """"art. 2, l. 7 agosto 1990, n. 241", "art. 2043 c.c.", "art. 5, reg. (UE) 2016/679"."""
    act, joiner = _act(norm)
    annex = _text(norm, "allegato")
    kind = _key(_text(norm, "tipo_atto"))
    # A code's annex is the code itself (c.c. is Allegato 2 of r.d. 262/1942): never named.
    named = f" (Allegato {annex})" if annex and joiner == ", " and kind not in _EU else ""
    return f"art. {_text(norm, 'numero_articolo')}{joiner}{act}{named}"
