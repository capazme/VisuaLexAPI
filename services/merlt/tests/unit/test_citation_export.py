"""The citation export (`/citations`) writes norms in the owner's style (source convention).

Measured on 4 Oct 2026 (inventory §3.4): the old parser dropped the article of every code
keyed with its annex, wrote the Constitution as "Costituzione~Art81" and EU acts as their
URL title-cased.
"""
from merlt.citation import CitationFormatter

N = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:"


def _text(urn: str) -> str:
    return CitationFormatter().format_single({"article_urn": urn}, "italian_legal").text


def test_a_code_keyed_with_its_annex_keeps_its_article():
    assert _text(N + "regio.decreto:1942-03-16;262:2~art2043") == "art. 2043 c.c."
    assert _text(N + "regio.decreto:1942-03-16;262:1~art12") == "art. 12 preleggi"


def test_the_constitution_and_an_ordinary_act():
    assert _text(N + "costituzione~art81") == "art. 81 Cost."
    assert _text(N + "legge:1990-08-07;241~art2") == "art. 2, l. 7 agosto 1990, n. 241"
    assert _text(N + "decreto.legislativo:2003-06-30;196~art7") == "art. 7, d.lgs. 30 giugno 2003, n. 196"


def test_an_eu_act_is_cited_not_title_cased():
    assert _text("https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita") == "reg. (UE) 2016/679"


def test_the_plain_text_format_cites_the_same_way():
    urn = N + "regio.decreto:1942-03-16;262:2~art2043"
    assert CitationFormatter().format_single({"article_urn": urn}, "plain_text").text == "art. 2043 c.c."
