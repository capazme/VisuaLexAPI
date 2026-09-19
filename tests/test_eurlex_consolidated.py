"""EU consolidated texts.

For regulations and directives VisuaLex reads the Official Journal page
(`/eli/…/oj/ita`) — the act as published. That is the wrong text for an act
that has been amended: Dir. 2002/58/CE without the 2009 amendment has no
cookie rule in art. 5(3); Reg. 910/2014 was rewritten by Reg. 2024/1183.
EUR-Lex publishes consolidated versions under a sector-0 CELEX
("02002L0058-20091219"); a request may name one and VisuaLex serves it.
"""
from unittest.mock import AsyncMock, patch

import pytest

from app import NormaController
from visualex_api.services.eurlex_scraper import EurlexScraper
from visualex_api.tools.exceptions import ValidationError
from visualex_api.tools.norma import Norma, NormaVisitata

CONSOLIDATED = "https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=CELEX:02002L0058-20091219"
OJ = "https://eur-lex.europa.eu/eli/dir/2002/58/oj/ita"


@pytest.fixture
def client():
    return NormaController().app.test_client()


class TestModel:
    def test_without_the_field_the_oj_url_is_unchanged(self):
        norma = Norma(tipo_atto="direttiva ue", data="2002", numero_atto="58")
        assert norma.url == OJ

    def test_the_field_selects_the_consolidated_url(self):
        norma = Norma(tipo_atto="direttiva ue", data="2002", numero_atto="58",
                      celex_consolidated="02002L0058-20091219")
        assert norma.url == CONSOLIDATED

    def test_the_article_urn_follows_the_act_url(self):
        norma = Norma(tipo_atto="direttiva ue", data="2002", numero_atto="58",
                      celex_consolidated="02002L0058-20091219")
        nv = NormaVisitata(norma=norma, numero_articolo="5")
        assert nv.urn == CONSOLIDATED

    def test_to_dict_round_trips_the_field(self):
        norma = Norma(tipo_atto="direttiva ue", data="2002", numero_atto="58",
                      celex_consolidated="02002L0058-20091219")
        nv = NormaVisitata(norma=norma, numero_articolo="5")
        data = nv.to_dict()
        assert data["celex_consolidated"] == "02002L0058-20091219"
        assert data["url"] == CONSOLIDATED
        again = NormaVisitata.from_dict(data)
        assert again.norma.celex_consolidated == "02002L0058-20091219"
        assert again.urn == CONSOLIDATED

    def test_to_dict_omits_the_field_when_unset(self):
        nv = NormaVisitata(norma=Norma(tipo_atto="direttiva ue", data="2002", numero_atto="58"),
                           numero_articolo="5")
        assert "celex_consolidated" not in nv.to_dict()

    def test_consolidated_and_oj_versions_are_different_visits(self):
        base = dict(tipo_atto="direttiva ue", data="2002", numero_atto="58")
        oj = NormaVisitata(norma=Norma(**base), numero_articolo="5")
        cons = NormaVisitata(norma=Norma(**base, celex_consolidated="02002L0058-20091219"),
                             numero_articolo="5")
        assert oj != cons
        assert hash(oj) != hash(cons)

    def test_a_malformed_celex_is_rejected(self):
        with pytest.raises(ValidationError):
            Norma(tipo_atto="direttiva ue", data="2002", numero_atto="58",
                  celex_consolidated="32002L0058").url  # sector 3 is the OJ act, not a consolidation

    def test_get_uri_accepts_the_field_directly(self):
        scraper = EurlexScraper()
        assert scraper.get_uri("direttiva ue", "2002", "58",
                               celex_consolidated="02002L0058-20091219") == CONSOLIDATED
        assert scraper.get_uri("direttiva ue", "2002", "58") == OJ


class TestRequestThreading:
    @pytest.fixture(autouse=True)
    def _no_network(self):
        # create_norma_visitata_from_data probes the tree for the annex lookup
        # and the AKN index for the existence check; both are network.
        with patch("app.get_tree", AsyncMock(return_value=([], 0, {}))), \
             patch("app.fetch_act_index", AsyncMock(return_value=None)), \
             patch("app.add_to_history"):
            yield

    async def test_fetch_norma_data_carries_the_consolidated_url(self, client):
        response = await client.post("/fetch_norma_data", json={
            "act_type": "direttiva ue", "date": "2002", "act_number": "58",
            "article": "5", "celex_consolidated": "02002L0058-20091219",
        })
        assert response.status_code == 200
        norma_data = (await response.get_json())["norma_data"][0]
        assert norma_data["url"] == CONSOLIDATED
        assert norma_data["urn"] == CONSOLIDATED
        assert norma_data["celex_consolidated"] == "02002L0058-20091219"

    async def test_without_the_field_nothing_changes(self, client):
        response = await client.post("/fetch_norma_data", json={
            "act_type": "direttiva ue", "date": "2002", "act_number": "58", "article": "5",
        })
        norma_data = (await response.get_json())["norma_data"][0]
        assert norma_data["url"] == OJ

    async def test_the_field_on_a_normattiva_act_is_a_400(self, client):
        response = await client.post("/fetch_norma_data", json={
            "act_type": "codice civile", "article": "2043",
            "celex_consolidated": "02002L0058-20091219",
        })
        assert response.status_code == 400
        assert "EUR-Lex" in (await response.get_json())["error"]
