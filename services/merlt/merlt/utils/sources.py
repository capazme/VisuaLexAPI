"""The convention for legal sources, as MERL-T holds it.

Spec: docs/superpowers/specs/2026-10-04-source-convention-design.md. Golden file:
conventions/sources/golden.json, read by tests/unit/test_sources_golden.py. MERL-T does
not import the VisuaLex API, so the normaliser and the citation are a copy of
services/visualex/visualex_api/tools/sources.py, pinned to the same golden file.

- ``normalize_norm_urn``: any spelling of a norm → its identity (the graph key).
- ``norm_from_urn``: the fields a norm is stored with, read back from its identity.
- ``cite_article`` / ``cite_act``: how a lawyer cites it (the owner's style).
- ``short_norm`` / ``short_act``: the same in little room; ``short_norm`` is a norm node's
  ``estremi``.
- ``act_heading``: an act node's ``titolo`` (the name for the acts cited by their own name,
  the act citation for every other act).
- ``authority``: an act node's ``autorita_emanante``, from its type.
- ``decision_short``: a decision node's ``estremi`` and the Massimario chip.
"""
from __future__ import annotations

import re
from typing import Any, Mapping, Optional

from merlt.utils.map import NORMATTIVA_URN_CODICI
from merlt.utils.urn_labels import article_number_from_urn

NORMATTIVA_RESOLVER = "https://www.normattiva.it/uri-res/N2Ls?"

# --------------------------------------------------------------------------- identity

_CODE_ALIASES = {
    "stato:codice.civile:1942-03-16;262": "stato:regio.decreto:1942-03-16;262:2",
    "stato:codice.procedura.civile:1940-10-28;1443": "stato:regio.decreto:1940-10-28;1443:1",
    "stato:codice.penale:1930-10-19;1398": "stato:regio.decreto:1930-10-19;1398:1",
    "stato:codice.procedura.penale:1988-09-22;447": "stato:decreto.del.presidente.della.repubblica:1988-09-22;447",
    "stato:costituzione:1947-12-27": "stato:costituzione",
}
_MINISTRY_DECREE = re.compile(r"ministero\.[a-z.]+:decreto:(\d{4}-\d{2}-\d{2});(\d+)")
_NIR_PREFIX = re.compile(
    r"(?:https?://(?:www\.)?normattiva\.it/uri-res/N2Ls\?)?(?:urn:nir:stato:/uri-res/N2Ls\?)?", re.IGNORECASE)
_NIR_TAIL = re.compile(r"[^\s:~]+:[A-Za-z.\- ]*[A-Za-z.\-](?:[:~;!@]\S*)?")
_YEAR_ONLY = re.compile(r"[a-z.]+:[a-z.]+:\d{4};.*")


def _is_nir(text: str) -> bool:
    at = text.lower().rfind("urn:nir:")
    return at != -1 and bool(_NIR_PREFIX.fullmatch(text[:at])) and bool(_NIR_TAIL.fullmatch(text[at + 8:]))


def normalize_norm_urn(value: Optional[str]) -> Optional[str]:
    """The identity of the norm a string names. Anything that is not a NIR URN, and a
    year-only URN (no identity until its date is known), come back as they came."""
    if not value or not _is_nir(value.strip()):
        return value
    text = value.strip()
    body = text[text.lower().rindex("urn:nir:") + len("urn:nir:"):]
    cuts = [at for at in (body.find("!"), body.find("@")) if at != -1]
    if cuts:
        body = body[: min(cuts)]
    head, sep, article = body.partition("~")
    parts = head.split(":", 2)
    if len(parts) >= 2:
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


_ACT_BY_URN = {urn.lower(): name for name, urn in NORMATTIVA_URN_CODICI.items()}
_CODES_BY_NAME = {" ".join(name.lower().split()): urn for name, urn in NORMATTIVA_URN_CODICI.items()}
_NIR_ACT = re.compile(r"(?P<type>[a-z.]+):(?P<date>\d{4}-\d{2}-\d{2});(?P<number>\d+[a-z]*)(?::(?P<annex>[^:~]+))?")
_ELI = re.compile(r"/eli/(?P<kind>reg|dir)/(?P<year>\d{4})/(?P<number>\d+)", re.IGNORECASE)


def norm_from_urn(urn: Optional[str]) -> Optional[dict[str, Any]]:
    """The fields of the norm an identity names (``tipo_atto``, ``tipo_atto_reale``, ``data``,
    ``numero_atto``, ``allegato``, ``numero_articolo``), or None when it names no norm."""
    if not urn:
        return None
    eli = _ELI.search(urn)
    if eli:
        kind = "regolamento ue" if eli.group("kind").lower() == "reg" else "direttiva ue"
        return {"tipo_atto": kind, "data": eli.group("year"), "numero_atto": eli.group("number"),
                "numero_articolo": None}
    identity = normalize_norm_urn(urn)
    if not identity or not identity.startswith(NORMATTIVA_RESOLVER):
        return None
    body = identity[len(NORMATTIVA_RESOLVER) + len("urn:nir:"):]
    head = body.split("~", 1)[0]
    norm: dict[str, Any] = {"numero_articolo": article_number_from_urn(identity)}
    act = head.split(":", 1)[1] if head.startswith("stato:") else head
    name = _ACT_BY_URN.get(act.lower())
    match = _NIR_ACT.fullmatch(act)
    if match:
        norm.update(tipo_atto_reale=match.group("type").replace(".", " "), data=match.group("date"),
                    numero_atto=match.group("number"))
        if match.group("annex") and not name:
            norm["allegato"] = match.group("annex")
    elif act.split(":")[0] == "costituzione":
        name = name or "costituzione"
    else:
        # An act with no number ("decreto.del.presidente.del.consiglio.dei.ministri:2020-03-08").
        bare = re.fullmatch(r"(?P<type>[a-z.]+):(?P<date>\d{4}-\d{2}-\d{2})", act)
        if not bare:
            return None
        norm.update(tipo_atto_reale=bare.group("type").replace(".", " "), data=bare.group("date"))
    norm["tipo_atto"] = name or norm.get("tipo_atto_reale")
    return norm


# --------------------------------------------------------------------------- labels

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
# The act heading of the acts cited by their own name: the dossier's table, verbatim
# (dossier spec 2026-10-04-dossier-per-atto-design.md §2, approved by the owner).
_HEADINGS = {
    "codice civile": "Codice civile",
    "codice penale": "Codice penale",
    "codice di procedura civile": "Codice di procedura civile",
    "codice procedura civile": "Codice di procedura civile",
    "codice di procedura penale": "Codice di procedura penale",
    "codice procedura penale": "Codice di procedura penale",
    "costituzione": "Costituzione",
    "preleggi": "Preleggi",
    "disposizioni per l'attuazione del codice civile e disposizioni transitorie":
        "Disposizioni di attuazione del codice civile",
    "disposizioni per l'attuazione del codice di procedura civile e disposizioni transitorie":
        "Disposizioni di attuazione del codice di procedura civile",
    "tue": "Trattato sull'Unione europea",
    "tfue": "Trattato sul funzionamento dell'Unione europea",
    "cdfue": "Carta dei diritti fondamentali dell'Unione europea",
}
_EU = {"regolamento ue": "reg. (UE)", "direttiva ue": "dir. (UE)"}
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
# The authority of an act, from its type (spec §5.1).
_AUTHORITIES = {
    "legge": "Parlamento",
    "legge costituzionale": "Parlamento",
    "decreto legislativo": "Governo",
    "decreto legge": "Governo",
    "decreto-legge": "Governo",
    "decreto del presidente della repubblica": "Presidente della Repubblica",
    "regio decreto": "Re",
    "regio decreto legge": "Re",
    "costituzione": "Assemblea costituente",
    "decreto ministeriale": "Ministro",
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
    match = _ISO_DAY.fullmatch(iso)
    if not match or not 1 <= int(match.group(2)) <= 12:
        return None
    day = int(match.group(3))
    return f"{'1°' if day == 1 else day} {_MONTHS[int(match.group(2)) - 1]} {match.group(1)}"


def _real_type(norm: Mapping[str, Any]) -> tuple[str, str, str]:
    """(type of the act, its date, its number): an aliased code by the decree it is, and an
    act of the codes table with no fields of its own by the table's row."""
    real, date, number = _key(_text(norm, "tipo_atto_reale")), _text(norm, "data"), _text(norm, "numero_atto")
    if not real:
        row = _CODES_BY_NAME.get(_key(_text(norm, "tipo_atto")))
        match = _NIR_ACT.fullmatch(row or "")
        if match:
            return match.group("type").replace(".", " "), date or match.group("date"), number or match.group("number")
    return real or _key(_text(norm, "tipo_atto")), date, number


def _act(norm: Mapping[str, Any], short: bool) -> tuple[str, str]:
    kind = _key(_text(norm, "tipo_atto"))
    if kind in _NAMED:
        return _NAMED[kind], " "
    if kind in _EU:
        number, year = _text(norm, "numero_atto"), _text(norm, "data")[:4]
        return (f"{_EU[kind]} {year}/{number}" if number and year.isdigit() else _EU[kind]), (" " if short else ", ")
    real, date, number = _real_type(norm)
    act = _TYPES.get(real, real)
    day = _day(date)
    year = date[:4] if re.fullmatch(r"\d{4}(-\d{2}-\d{2})?", date) else ""
    joiner = " " if short else ", "
    if short:
        if number and year:
            return f"{act} {number}/{year}", joiner
        if day:
            return f"{act} {day}", joiner
        return (f"{act} n. {number}" if number else act), joiner
    if day:
        return f"{act} {day}" + (f", n. {number}" if number else ""), joiner
    if year:
        return (f"{act} n. {number} del {year}" if number else f"{act} del {year}"), joiner
    return act + (f", n. {number}" if number else ""), joiner


def _annex(norm: Mapping[str, Any], joined: str, short: bool) -> str:
    annex = _text(norm, "allegato")
    if not annex or _key(_text(norm, "tipo_atto")) in _NAMED or _key(_text(norm, "tipo_atto")) in _EU:
        return ""
    return f" (All. {annex})" if short else f" (Allegato {annex})"


def cite_act(norm: Mapping[str, Any]) -> str:
    """"l. 7 agosto 1990, n. 241", "c.c.", "reg. (UE) 2016/679"."""
    return _act(norm, short=False)[0]


def cite_article(norm: Mapping[str, Any]) -> str:
    """"art. 2, l. 7 agosto 1990, n. 241", "art. 2043 c.c."."""
    act, joiner = _act(norm, short=False)
    return f"art. {_text(norm, 'numero_articolo')}{joiner}{act}{_annex(norm, joiner, short=False)}"


def short_act(norm: Mapping[str, Any]) -> str:
    """"l. 241/1990", "c.c.", "reg. (UE) 2016/679"."""
    return _act(norm, short=True)[0]


def short_norm(norm: Mapping[str, Any]) -> str:
    """"art. 2 l. 241/1990", "art. 2043 c.c.": a norm node's ``estremi``."""
    act, joiner = _act(norm, short=True)
    return f"art. {_text(norm, 'numero_articolo')}{joiner}{act}{_annex(norm, joiner, short=True)}"


def act_heading(norm: Mapping[str, Any]) -> str:
    """"Codice civile", "l. 7 agosto 1990, n. 241": an act node's ``titolo``."""
    return _HEADINGS.get(_key(_text(norm, "tipo_atto"))) or cite_act(norm)


def authority(norm: Mapping[str, Any]) -> Optional[str]:
    """The authority of an act, from its type; None when the type does not say."""
    kind = _key(_text(norm, "tipo_atto"))
    if kind == "costituzione":
        return _AUTHORITIES["costituzione"]
    return _AUTHORITIES.get(_real_type(norm)[0])


def short_from_urn(urn: Optional[str]) -> Optional[str]:
    """The ``estremi`` of the norm node an article identity keys; None without an article."""
    norm = norm_from_urn(urn)
    if not norm or not norm.get("numero_articolo"):
        return None
    return short_norm(norm)


# --------------------------------------------------------------------------- decisions

_ROMAN = {"1": "I", "2": "II", "3": "III", "4": "IV", "5": "V", "6": "VI", "7": "VII"}
_SECTIONS = {"U": "sez. un.", "L": "sez. lav.", "F": "sez. fer.", "T": "sez. trib."}


def _section(code: Optional[str]) -> Optional[str]:
    """`U` → "sez. un.", `3` → "sez. III", `6-1` → "sez. VI-1" (the section in Roman numerals, as the courts print it)."""
    if not code:
        return None
    code = re.sub(r"\s+", "", str(code)).upper().rstrip(".")
    if code in _SECTIONS:
        return _SECTIONS[code]
    head, dash, tail = code.partition("-")
    # The sub-section keeps its own writing ("sez. VI-1", "sez. VI-L").
    return f"sez. {_ROMAN.get(head, head)}{dash}{tail}"


def decision_short(corte: str, numero: int, anno: Optional[int], archivio: Optional[str] = None,
                   sezione: Optional[str] = None, rv: Optional[list[str]] = None) -> str:
    """"Cass. civ., sez. un., n. 31310/2024", "Corte cost., n. 71/2020"; with the massime,
    "… · Rv. 673165-01" (D2 of 4 October 2026)."""
    number = f"n. {numero}/{anno}" if anno else f"n. {numero}"
    if corte == "corte_costituzionale":
        head = ["Corte cost."]
    else:
        head = [{"civile": "Cass. civ.", "penale": "Cass. pen."}.get(archivio or "", "Cass."), _section(sezione)]
    label = ", ".join(part for part in [*head, number] if part)
    return f"{label} · Rv. {', '.join(rv)}" if rv else label


def decision_node_estremi(props: Mapping[str, Any]) -> Optional[str]:
    """A decision node's ``estremi`` from its own fields: the section only when the node
    records exactly one (a decision cited with two sections names none rather than the first
    one met). None when the node lacks court or number."""
    corte, numero = props.get("corte"), props.get("numero")
    if not corte or not str(numero or "").isdigit():
        return None
    sezioni = list(props.get("sezioni") or [])
    anno = props.get("anno")
    return decision_short(str(corte), int(numero), int(anno) if str(anno or "").isdigit() else None,
                          props.get("archivio"), sezioni[0] if len(sezioni) == 1 else None)
