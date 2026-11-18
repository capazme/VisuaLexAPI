"""A regional law, told apart so it is never read as a State law (G-577).

No reader of this API covers a regional law. Its citation shares the State's words («legge
10 novembre 2014, n. 65»), so the parser read «l.r. 65/2014», «legge regionale 12 marzo 2015,
n. 3» or «L. 65/2014 (Toscana)» as the legge 65/2014 or 3/2015 of the State, and «l. reg.
3/2015» as a regulation of the Union: the wrong act, in silence. A citation these patterns
find is refused before any table or pattern reads it, and no address is built for a regional
act type.

The patterns are mcp-legal-it's (pull request 191, decision LI-086), reviewed there for the
same failure and for linear time: one separator class per gap, never two quantifiers over one
run of spaces. A leaf module: patterns only, no import from the readers.
"""
from __future__ import annotations

import re

from .article_suffixes import ARTICLE_SUFFIX_ALTERNATION

#: What the API answers for a regional law: one sentence, no promise of coverage.
REGIONAL_LAW_REFUSAL = (
    "Le leggi regionali non sono coperte: verifica il testo sul Bollettino ufficiale o sulla "
    "banca dati della Regione."
)

_MONTHS = ("gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|"
           "novembre|dicembre")
#: The twenty regions as a citation names them («l.r. Toscana», «legge della Regione Siciliana»).
_REGIONS = (r"abruzzo|basilicata|calabria|campania|emilia[\s-]?romagna|friuli[\s-]?venezia[\s-]?giulia|"
            r"lazio|liguria|lombardia|marche|molise|piemonte|puglia|sardegna|sicilia(?:na)?|toscana|"
            r"trentino[\s-]?alto[\s-]?adige(?:\s?/\s?s[üu]dtirol)?|umbria|valle\s+d['’]\s?aosta|veneto")
#: «legge» as the State's patterns read it: «legge», «L.», «L», «l.». Every spelling they take is
#: read here too, or «L. 65/2014 della Regione Toscana» falls to the State's legge 65/2014.
_LAW = r"(?:legge|l\b\.?)"
#: «l.r.», «L.R.», «l. r.», «LR», «L.R.T.»; «l. reg.», «legge reg.», «legge reg.le», «legge
#: regionale», «l. regionale».
_SIGLA = rf"(?:l\.?\s?r\.?(?:\s?t\.)?|{_LAW}\s*reg(?:ionale\b|\.(?:le\b)?))"
#: An act's number and date as a citation writes them: «10 novembre 2014, n. 65», «n. 3/2015»,
#: «65/2014», «n. 65 del 10 novembre 2014», «n. 3 del 2015».
_EXTREMES = (rf"(?:\d{{1,2}}(?:\s?[°º])?\s+(?:{_MONTHS})\s+\d{{4}}[\s,]*n\.?\s*\d+"
             r"|(?:n\.?\s*)?\d+\s*/\s*\d{2,4}\b"
             rf"|(?:n\.?\s*)?\d+\s+del\s+\d{{1,2}}(?:\s?[°º])?\s+(?:{_MONTHS})\s+\d{{4}}"
             r"|(?:n\.?\s*)?\d+\s+del\s+\d{4}\b)")
#: «Regione Toscana», «Regione autonoma della Sardegna», «Reg. Toscana», «R. Toscana», «della
#: Toscana», «(Toscana)».
_REGION = (r"(?:(?:della|dalla)\s+)?(?:(?:regione|reg\.|r\.)\s*(?:autonoma\s+)?(?:(?:della|del|dell['’])\s*)?)?"
           rf"(?:{_REGIONS})\b")
#: A regional law anywhere in a query or a name: a regional sigla («l.r.», «legge regionale»,
#: with or without a number: no State law is called so); «legge (della) Regione …», «legge
#: Toscana 65/2014»; or the State's spelling followed by a Region («legge 10 novembre 2014, n. 65
#: della Regione Toscana», «L. 65/2014 (Toscana)», «legge 65/2014 Reg. Toscana»). After the
#: extremes «reg.» counts only with a Region after it: «l. 241/1990 reg. UE 2016/679» is two acts
#: of the State and the Union, «l. 449/1997 reg. imprese» the register (review of this PR).
_REGIONAL_LAW = re.compile(
    rf"(?<![\w.])(?:{_SIGLA}(?![a-zà-ù])"
    rf"|{_LAW}\s*(?:della\s+)?(?:regione|reg\.)(?![a-zà-ù])"
    rf"|{_LAW}\s+(?:{_REGIONS})\b"
    rf"|{_LAW}\s*{_EXTREMES}[\s,(]*(?:(?:(?:della|dalla)\s+)?regione(?![a-zà-ù])|{_REGION}))",
    re.IGNORECASE,
)
#: A URN kind of a Region, «regione.toscana:legge», with or without «urn:nir:».
_REGIONAL_URN_KIND = re.compile(r"^\s*(?:urn:nir:)?regione\b", re.IGNORECASE)


def cites_regional_law(text: str | None) -> bool:
    """Whether a query or an act name cites a regional law («art. 3 l.r. Toscana 65/2014»,
    «legge regionale 12 marzo 2015, n. 3», «legge 10 novembre 2014, n. 65 della Regione
    Toscana»). «legge 241/1990, che si applica alle regioni» and «legge costituzionale 3/2001»
    do not."""
    return bool(text) and bool(_REGIONAL_LAW.search(text))


def is_regional_act_type(act_type: str | None) -> bool:
    """Whether an act type names a regional act: a regional law («legge regionale», «l.r.»), or a
    URN kind of a Region («regione.toscana:legge»). No address is built for it."""
    return bool(act_type) and (cites_regional_law(act_type) or bool(_REGIONAL_URN_KIND.match(act_type)))


#: One article number as a citation writes it: «4», «4-bis», «4 bis».
_ARTICLE_NUMBER = rf"\d+(?:\s*-?\s*(?:{ARTICLE_SUFFIX_ALTERNATION})\b)?"
#: «art. 3 della », «artt. 3 e 4 della », «Art. 4 bis della », «art. 5, comma 2, dell'» just before
#: a regional law: the articles are the regional law's, not the act named before it.
_ARTICLE_BEFORE = re.compile(
    rf"\bart(?:icol[oi]|t?\.)?\s*{_ARTICLE_NUMBER}(?:\s*(?:,|\be\b|\bed\b)\s*{_ARTICLE_NUMBER})*"
    r"(?:\s*,\s*comma\s*\d+[\w-]*)?\s*,?\s*(?:(?:della|del|dell['’]|di)\s*)?$",
    re.IGNORECASE,
)
#: How far before a regional law an article is looked for: a short list of articles.
_ARTICLE_REACH = 96


def regional_law_spans(text: str) -> list[tuple[int, int]]:
    """Where a text cites a regional law: (start, end) of each citation, in order, an article
    written just before it included («art. 3 della l.r. Toscana 65/2014»). The citation linker
    reads none of them as a State law."""
    spans = []
    for m in _REGIONAL_LAW.finditer(text or ""):
        start = m.start()
        before = _ARTICLE_BEFORE.search(text, max(0, start - _ARTICLE_REACH), start)
        spans.append((before.start() if before else start, m.end()))
    return spans
