"""How an article and a topic become one Solr query on Italgiure (design 2026-10-05 §5.2, §5.4).

Two ways to find the decisions that cite an article: the archive's index of cited norms
(`rnc-*` fields, codes and the Constitution only) and the text (`ocr`). The text is matched
against the ways lawyers write the article, never the bare «art. N», which also catches every
other act's article N (measured on 2026-10-05: 1,588 civil decisions for "art. 2043" against
939 for "art. 2043 c.c."). A topic is user input: only words reach Solr, as one quoted phrase,
so no field, operator or local parameter can.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

#: Solr proximity for an article of a numbered act: «art. 2 … 241 … 1990» within this many
#: positions (measured by plan Task 1, 2026-10-05: 8 and 12 already let art. 21-octies in).
PROXIMITY = 6

KINDS = {"civile": "snciv", "penale": "snpen"}

# tipo_atto as norma_data writes it (tools/map.py, search spelling) ->
# (abbreviations, spelled-out name or None, default archive)
_CODES: dict[str, tuple[tuple[str, ...], str | None, str | None]] = {
    "codice civile": (("c.c.", "cod. civ."), "codice civile", "civile"),
    "codice di procedura civile": (("c.p.c.", "cod. proc. civ."), "codice di procedura civile", "civile"),
    "codice penale": (("c.p.", "cod. pen."), "codice penale", "penale"),
    "codice di procedura penale": (("c.p.p.", "cod. proc. pen."), "codice di procedura penale", "penale"),
    "costituzione": (("Cost.",), "Costituzione", None),
    "preleggi": (("preleggi", "disp. prel."), None, None),
}
# Disposizioni di attuazione: text search only, never the index (they share `rnc-gen` "CC"/"PC"
# with the code itself, plan Task 2). The API reaches them as the long name (tools/map.py,
# search spelling), as the short form, or as the regio decreto (318/1942, 1368/1941).
_DISP_ATT_NAMES = {
    "disposizioni per l'attuazione del codice civile e disposizioni transitorie": "cc",
    "disposizioni per l'attuazione del codice di procedura civile e disposizioni transitorie": "cpc",
    "disp. att. c.c.": "cc", "disp. att. c.p.c.": "cpc",
}
_DISP_ATT_RD = {("318", "1942"): "cc", ("1368", "1941"): "cpc"}
_DISP_ATT_PHRASES = {
    "cc": ("disp. att. c.c.", "disp. att. cod. civ."),
    "cpc": ("disp. att. c.p.c.", "disp. att. cod. proc. civ."),
}
_NUMBERED = ("legge", "decreto legislativo", "decreto legge", "decreto-legge",
             "decreto del presidente della repubblica")

# Index: tipo_atto -> (rnc-gen, default archive). Codes and the Constitution only (plan Task 2):
# numbered acts, the preleggi and disp. att. c.c. are searched in the text.
_INDEX_CODES: dict[str, tuple[str, str | None]] = {
    "codice civile": ("CC", "civile"),
    "codice di procedura civile": ("PC", "civile"),
    "codice penale": ("CP", "penale"),
    "codice di procedura penale": ("PV", "penale"),
    "costituzione": ("LC", None),
}
#: rnc-art suffix codes: only "-bis" = "02" is established (five independent articles, plan Task 2).
_INDEX_SUFFIXES = {"": "00", "bis": "02"}

_ARTICLE = re.compile(r"^\d{1,5}(?:[- ][a-z]{2,15})?(?:\.\d{1,2})?$", re.ASCII)
_TOPIC_KEEP = re.compile(r"[^\w' -]", re.UNICODE)
_APOSTROPHES = str.maketrans({"\u2019": "'", "\u2018": "'", "\u02bc": "'"})
_TOPIC_MAX = 80


class UnsupportedAct(ValueError):
    """An act this search cannot phrase: the route answers `non_supportata`."""


def _article_number(raw: object) -> str:
    text = str(raw or "").strip().lower()
    if not _ARTICLE.match(text):
        raise UnsupportedAct(f"article {raw!r}")
    return text.replace("-", " ")


def _year(data: object) -> str | None:
    match = re.match(r"^(\d{4})", str(data or ""), re.ASCII)
    return match.group(1) if match else None


def _disp_att(tipo: str, norma: dict) -> str | None:
    named = _DISP_ATT_NAMES.get(tipo.translate(_APOSTROPHES))
    if named or tipo != "regio decreto":
        return named
    number = str(norma.get("numero_atto") or "").strip()
    return _DISP_ATT_RD.get((number, _year(norma.get("data")) or ""))


def article_clause(norma: dict) -> tuple[str, str | None]:
    tipo = str(norma.get("tipo_atto") or "").strip().lower()
    numero = _article_number(norma.get("numero_articolo"))
    disp = _disp_att(tipo, norma)
    if disp:
        phrases = [f"art. {numero} {_DISP_ATT_PHRASES[disp][0]}", f"art. {numero} {_DISP_ATT_PHRASES[disp][1]}",
                   f"articolo {numero} {_DISP_ATT_PHRASES[disp][0]}"]
        return " OR ".join(f'ocr:"{p}"' for p in phrases), "civile"
    if tipo in _CODES:
        abbreviations, name, archivio = _CODES[tipo]
        phrases = [f"art. {numero} {a}" for a in abbreviations]
        phrases += [f"articolo {numero} {abbreviations[0]}"]
        if name:
            of = "della" if name == "Costituzione" else "del"
            phrases += [f"art. {numero} {of} {name}", f"articolo {numero} {of} {name}"]
        return " OR ".join(f'ocr:"{p}"' for p in phrases), archivio
    act_number = str(norma.get("numero_atto") or "").strip()
    year = _year(norma.get("data"))
    if tipo in _NUMBERED and act_number.isascii() and act_number.isdigit() and year:
        return f'ocr:"art {numero} {act_number} {year}"~{PROXIMITY}', None
    raise UnsupportedAct(tipo or "no act type")


@dataclass(frozen=True)
class IndexCoordinates:
    """One citation as the Cassazione's index writes it (`rnc-*` fields, measured by plan Task 2)."""
    gen: str  # code family: "CC", "PC", "CP", "PV", "LC"
    art: str  # article as "2043 00": four digits, a space, the suffix code


def index_clause(norma: dict) -> tuple[str, str | None, IndexCoordinates]:
    """The index query for an article, its default archive, and the coordinates the server
    re-checks on each record. UnsupportedAct for an act or a suffix Task 2 did not establish:
    the route then searches the text."""
    tipo = str(norma.get("tipo_atto") or "").strip().lower()
    if tipo not in _INDEX_CODES:
        raise UnsupportedAct(tipo or "no act type")
    match = re.match(r"^(\d{1,4})(?:[- ]([a-z]{2,15}))?$", str(norma.get("numero_articolo") or "").strip().lower(), re.ASCII)
    if not match or match.group(2) not in (None, *(s for s in _INDEX_SUFFIXES if s)):
        raise UnsupportedAct(f"article {norma.get('numero_articolo')!r}")
    gen, archivio = _INDEX_CODES[tipo]
    art = f"{int(match.group(1)):04d} {_INDEX_SUFFIXES[match.group(2) or '']}"
    return f'rnc-gen:"{gen}" AND rnc-art:"{art}"', archivio, IndexCoordinates(gen, art)


def cites(doc: dict, c: IndexCoordinates) -> bool:
    """Whether one citation of the record carries both coordinates. The index's fields are
    parallel lists, so `rnc-gen:"CC" AND rnc-art:"2043 00"` can match a record citing art. 2043
    of another act and something else of the code."""
    gens, arts = doc.get("rnc-gen") or [], doc.get("rnc-art") or []
    if len(gens) != len(arts):
        # `rnc-art` is shorter than `rnc-gen` when a citation names no article (plan Task 2:
        # 49 % of matching records for the codes, 93-96 % for numbered acts), so positions
        # cannot be trusted: keep the record. On aligned records the false-match rate is 2.0 %.
        return True
    return any(g == c.gen and a == c.art for g, a in zip(gens, arts))


def topic_clause(raw: str) -> str:
    words = " ".join(_TOPIC_KEEP.sub(" ", (raw or "").translate(_APOSTROPHES)).replace("_", " ").split())
    words = words[:_TOPIC_MAX].strip()
    if not any(ch.isalnum() for ch in words):
        raise ValueError("no words in the topic")
    return f'ocr:"{words}"'


def build_query(article: str | None, topic: str | None, archivio: str | None) -> str:
    parts = [f"({c})" for c in (article, topic) if c]
    if not parts:
        raise ValueError("an article or a topic is needed")
    if archivio:
        if archivio not in KINDS:
            raise ValueError(f"unknown archive {archivio!r}")
        parts.insert(0, f'kind:"{KINDS[archivio]}"')
    return " AND ".join(parts)
