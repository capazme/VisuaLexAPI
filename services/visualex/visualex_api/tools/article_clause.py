"""The clause that qualifies an article — the one copy.

«comma 1», «co. 3», «commi 1 e 2», «comma 3-bis», «secondo comma», «commi primo e
secondo», «par. 1», «paragrafo 2», «n. 3», «lett. b)», «lettere c) ed e)», in that
order, each optional: «art. 360, primo comma, n. 3, c.p.c.», «art. 4, n. 7, GDPR»,
«art. 6, par. 1, lett. a), GDPR». A clause names a part of the article, never the
act: left unread, its words reached the act's reading — «n. 7» became the GDPR's
number, «par. 1» hid the act — or broke the citation, so the article fell to the
context (design 2026-10-29-document-analysis §4.8).

Read by ``nl_parser`` (the search) and ``citation_linker`` (a text); until then each
had its own copy and each read a different part of what lawyers write.

Every run of whitespace is possessive, as in the linker's patterns: the optional
parts sit next to each other, and a backtracking ``\\s*`` would split a long run
every way it could.
"""
from .article_suffixes import ARTICLE_SUFFIX_ALTERNATION

_SUFFIX = r"(?:" + ARTICLE_SUFFIX_ALTERNATION + r")\b"
_ORDINAL = r"(?:primo|secondo|terzo|quarto|quinto|sesto|settimo|ottavo|nono|decimo)\b"
# A list goes on in the kind it started with: after «comma 4,» an ordinal is the
# sentence's («secondo periodo», «secondo la Corte»), never a paragraph; and an
# ordinal before «periodo» is a sentence of the paragraph, not another paragraph.
_ORDINAL_ITEM = _ORDINAL + r"(?!\s++periodo\b)"
_DIGITS = r"\d+(?:\s*+(?:-\s*+)?" + _SUFFIX + r")?"
_SEPARATOR = r"\s*+(?:,|\be\b)\s*+"
_LEAD = r"\s*+(?:,\s*+)?"

_PARAGRAPH = (
    r"(?:"
    # «comma 1», «co. 3», «c. 2» (the dotted «c.» only before a number: «c.c.» is a code)
    r"(?:comm[ai]\.?|co\.?|c\.(?=\s*+\d))\s*+(?:"
    + _DIGITS + r"(?:" + _SEPARATOR + _DIGITS + r")*"
    r"|" + _ORDINAL_ITEM + r"(?:" + _SEPARATOR + _ORDINAL_ITEM + r")*)"
    # «secondo comma», «primo e secondo comma»
    r"|" + _ORDINAL + r"(?:" + _SEPARATOR + _ORDINAL + r")*\s++comm[ai]\b"
    # «par. 1», «parr. 1 e 2», «paragrafo 2»: the Union's acts number their paragraphs so
    r"|(?:parr?\.|paragraf[oi]\b)\s*+" + _DIGITS + r"(?:" + _SEPARATOR + _DIGITS + r")*"
    r")"
)
# «n. 3», «nn. 1 e 2»: a number of the article, right after it or after its paragraph.
# Never «n. 241/1990» nor «n. 241 del 1990»: those are an act's number and year.
_NUMBER = r"nn?\.\s*+\d++(?:" + _SEPARATOR + r"\d++)*(?![\d/])(?!\s*+/)(?!\s++del\b)"
# «lett. b)», «lettera a)», «lettere c) ed e)». After the first, a letter is a letter only
# alone («lett. a) e d.lgs. 196/2003»: the «d» is the decree's).
_LETTER = (
    r"(?:lett\.?|letter[ae])\s*+[a-z]\b\)?"
    r"(?:\s*+(?:,|\bed?\b)\s*+[a-z](?![\w.])\)?)*"
)

ARTICLE_CLAUSE_SOURCE = (
    r"(?:" + _LEAD + _PARAGRAPH + r")?"
    r"(?:" + _LEAD + _NUMBER + r")?"
    r"(?:" + _LEAD + _LETTER + r")?"
)
