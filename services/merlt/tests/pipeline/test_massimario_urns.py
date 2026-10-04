# services/merlt/tests/pipeline/test_massimario_urns.py
"""Portal links → the graph's canonical URNs (spec §5.3)."""
import pytest

from merlt.pipeline.massimario.urns import NORMATTIVA_PREFIX, is_decision_link, parse_portal_urn, to_canonical

PORTAL = "http://www.normattiva.it/uri-res/N2Ls?urn:nir:"


@pytest.mark.parametrize("portal,canonical", [
    ("stato:codice.civile:1942-03-16;262~art2043", "stato:regio.decreto:1942-03-16;262:2~art2043"),
    ("stato:codice.procedura.civile:1940-10-28;1443~art380bis", "stato:regio.decreto:1940-10-28;1443:1~art380bis"),
    ("stato:codice.penale:1930-10-19;1398~art575", "stato:regio.decreto:1930-10-19;1398:1~art575"),
    ("stato:codice.procedura.penale:1988-09-22;447~art649",
     "stato:decreto.del.presidente.della.repubblica:1988-09-22;447~art649"),
    ("stato:costituzione:1947-12-27~art27", "stato:costituzione~art27"),
    ("presidente.repubblica:decreto:1973-01-23;43~art291ter",
     "stato:decreto.del.presidente.della.repubblica:1973-01-23;43~art291ter"),
    ("stato:legge:2009-04-23;38~art5", "stato:legge:2009-04-23;38~art5"),
    ("stato:decreto.legislativo:2018-04-10;36", "stato:decreto.legislativo:2018-04-10;36"),
    ("presidente.consiglio.ministri:decreto:2021-10-14;150~art1",
     "stato:decreto.del.presidente.del.consiglio.dei.ministri:2021-10-14;150~art1"),
])
def test_dated_links(portal, canonical):
    norm = parse_portal_urn(PORTAL + portal)
    assert to_canonical(norm, {}) == NORMATTIVA_PREFIX + "urn:nir:" + canonical


def test_comma_is_kept_apart_from_the_article():
    norm = parse_portal_urn(PORTAL + "stato:codice.procedura.civile:1940-10-28;1443~art369-com2-num2")
    assert (norm.article, norm.comma) == ("369", "com2-num2")
    assert to_canonical(norm, {}).endswith(";1443:1~art369")


def test_year_only_act_needs_its_resolution():
    norm = parse_portal_urn(PORTAL + "stato:legge:1983;184~art6")
    assert norm.year_only and norm.year_only_urn == "urn:nir:stato:legge:1983;184"
    assert to_canonical(norm, {}) is None
    assert to_canonical(norm, {"urn:nir:stato:legge:1983;184": "urn:nir:stato:legge:1983-05-04;184"}) == (
        NORMATTIVA_PREFIX + "urn:nir:stato:legge:1983-05-04;184~art6"
    )


@pytest.mark.parametrize("href", [
    PORTAL + "stato:decreto.legislativo:2006-02-23;109~sez2",
    PORTAL + "stato:decreto.legislativo:2006-02-23;109~prt1",
])
def test_partition_links_are_not_norms(href):
    assert parse_portal_urn(href) is None


@pytest.mark.parametrize("href", [
    "https://example.org/uri-res/N2Ls?urn:nir:stato:legge:1983;184",
    PORTAL + "regione.puglia:statuto:~art44",
    PORTAL + "stato:legge:abc;184",
    "",
])
def test_unusable_links(href):
    assert parse_portal_urn(href) is None


@pytest.mark.parametrize("act", [
    "stato:legge:1992-08-08",
    "stato:legge:1865-06-25~art51",
    "presidente.consiglio.ministri:decreto:2000-11-07~art1",
    "stato:legge:1983",
])
def test_an_act_without_its_number_has_no_canonical_key(act):
    # the graph and VisuaLex key every act but the codes by its number: a stub keyed
    # without one would never meet the act's node
    assert parse_portal_urn(PORTAL + act) is None


@pytest.mark.parametrize("portal,canonical", [
    ("stato:decreto.legislativo:2010-07-02;104~art133", "stato:decreto.legislativo:2010-07-02;104:2~art133"),
    ("stato:decreto.legislativo:2016-08-26;174~art172", "stato:decreto.legislativo:2016-08-26;174:1~art172"),
    ("presidente.repubblica:decreto:1973-03-29;156~art318",
     "stato:decreto.del.presidente.della.repubblica:1973-03-29;156:1~art318"),
])
def test_codes_keyed_with_their_annex(portal, canonical):
    # VisuaLex keys these codes by the decree's annex (merlt/utils/map.py)
    assert to_canonical(parse_portal_urn(PORTAL + portal), {}) == NORMATTIVA_PREFIX + "urn:nir:" + canonical


def test_a_resolved_year_only_code_takes_its_annex():
    norm = parse_portal_urn(PORTAL + "stato:decreto.legislativo:2010;104~art133")
    resolved = {"urn:nir:stato:decreto.legislativo:2010;104": "urn:nir:stato:decreto.legislativo:2010-07-02;104"}
    assert to_canonical(norm, resolved) == (
        NORMATTIVA_PREFIX + "urn:nir:stato:decreto.legislativo:2010-07-02;104:2~art133"
    )


def test_an_act_number_never_starts_with_zero():
    assert parse_portal_urn(PORTAL + "stato:legge:2021;0099") is None


@pytest.mark.parametrize("before,text", [
    ("ex multis, Sez. 6 - ", "L, n. 09952/2022"),
    ("Afferma Sez. ", "L., n. 20134/2024"),
    ("in conformità con Sez. 6-", "L, 00403/2012"),
    ("e Sez. ", "L, n. 687 del 2014"),
    ("qui anche Sez. ", "L. n. 24474/2024"),
    ("così ", "L, n. 1234/2020"),
    ("da ultimo Sez. ", "l, n. 13941 del 08/01/2015"),
])
def test_a_section_label_linked_as_a_law_is_a_decision(before, text):
    assert is_decision_link(text, before)


@pytest.mark.parametrize("before,text", [
    ("convertito dalla ", "l. n. 248 del 2005"),
    ("in attuazione della ", "L. 146/90"),
    ("della ", "legge n. 89 del 2001"),
    ("il ", "L. n. 67 del 1939"),
    ("conv. in ", "l, n. 27 del 2012"),
    ("dalla ", "l., n. 109 del 1994"),
])
def test_a_law_is_not_a_decision(before, text):
    assert not is_decision_link(text, before)
