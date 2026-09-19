"""Live checks for the three archive extensions. Run with `-m live`.

One request per feature against the real sources, asserting only what a
change on their side would break: a recital count, a fingerprint shape, a
consolidated article the OJ text does not have.
"""
import pytest

from visualex_api.services.akn_fetch import fetch_act_index
from visualex_api.services.eurlex_scraper import EurlexScraper
from visualex_api.tools.norma import Norma

pytestmark = pytest.mark.live


async def test_gdpr_has_173_recitals():
    recitals, url = await EurlexScraper().get_recitals(
        Norma(tipo_atto="regolamento ue", data="2016", numero_atto="679"))
    assert url.endswith("/eli/reg/2016/679/oj/ita")
    assert [r["number"] for r in recitals][:3] == ["1", "2", "3"]
    assert len(recitals) == 173


async def test_legge_241_fingerprints_cover_every_article():
    index = await fetch_act_index(Norma(tipo_atto="legge", data="1990-08-07", numero_atto="241"))
    assert index is not None
    assert set(index.fingerprints) == set(index.keys)
    assert all(len(v["fingerprint"]) == 64 for v in index.fingerprints.values())


async def test_eprivacy_consolidated_has_the_2009_cookie_rule():
    norma = Norma(tipo_atto="direttiva ue", data="2002", numero_atto="58",
                  celex_consolidated="02002L0058-20091219")
    scraper = EurlexScraper()
    text, url = await scraper.get_document(normavisitata=None, act_type="direttiva ue",
                                           article="5", year="2002", num="58", urn=norma.url)
    assert "CELEX:02002L0058-20091219" in url
    assert "consenso" in text  # art. 5(3) as amended by Dir. 2009/136/CE
