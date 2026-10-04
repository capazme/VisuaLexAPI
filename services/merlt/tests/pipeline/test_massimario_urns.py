# services/merlt/tests/pipeline/test_massimario_urns.py
"""Portal links → the graph's canonical URNs (spec §5.3)."""
import pytest

from merlt.pipeline.massimario.urns import NORMATTIVA_PREFIX, parse_portal_urn, to_canonical

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
