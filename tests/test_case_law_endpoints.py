"""HTTP surface over the case-law registry (Task 8).

Three routes, one section per source. The two defects worth pinning down
explicitly:

- an unguarded `int()` on `limite`/`anno` must answer 400 naming the field,
  not crash the handler into an unrelated 500 (the same defect class fixed on
  the Node backend the same day);
- `registry.leggi` now lets `asyncio.TimeoutError` propagate rather than
  returning `None` (Task 7), so the handler must answer 504, distinct from
  the 400 for an unknown source and the 404 for a genuinely absent decision.
"""
import asyncio

import pytest

from app import NormaController
from visualex_api.services.case_law.base import Decisione, LinkKind, SourceResult


@pytest.fixture
def client(monkeypatch):
    async def fake_cerca(riferimento, limite=10):
        return [
            SourceResult(organo="CGUE", ok=True, decisioni=[
                Decisione(organo="CGUE", numero="62017CJ0496", anno=2019,
                          link_kind=LinkKind.CITED, url="u")]),
            SourceResult(organo="Cassazione", ok=False, error="timeout",
                         coverage="ultimi 5 anni"),
        ]

    monkeypatch.setattr("app.case_law_registry.cerca_per_norma", fake_cerca)
    return NormaController().app.test_client()


class TestFetchCaseLaw:
    async def test_returns_every_source_including_the_failed_one(self, client):
        resp = await client.post("/fetch_case_law", json={"riferimento": "art. 5 GDPR"})
        assert resp.status_code == 200
        body = await resp.get_json()

        per_organo = {s["organo"]: s for s in body["fonti"]}
        assert per_organo["CGUE"]["ok"] is True
        assert per_organo["CGUE"]["decisioni"][0]["link_kind"] == "cited"
        # The dead source is present and says so, rather than being absent.
        assert per_organo["Cassazione"]["ok"] is False
        assert per_organo["Cassazione"]["coverage"] == "ultimi 5 anni"

    async def test_a_missing_riferimento_is_a_400(self, client):
        resp = await client.post("/fetch_case_law", json={})
        assert resp.status_code == 400

    async def test_all_sources_failing_is_still_a_200(self, client, monkeypatch):
        """A source that is down reports ok:false inside its own section; an
        error status on the endpoint itself would hide the sources that did
        answer, and here NONE of them answered."""
        async def all_dead(riferimento, limite=10):
            return [
                SourceResult(organo="CGUE", ok=False, error="timeout"),
                SourceResult(organo="Cassazione", ok=False, error="timeout"),
                SourceResult(organo="CeRDEF", ok=False, error="connection refused"),
                SourceResult(organo="Giustizia Amministrativa", ok=False, error="timeout"),
            ]

        monkeypatch.setattr("app.case_law_registry.cerca_per_norma", all_dead)
        resp = await client.post("/fetch_case_law", json={"riferimento": "art. 5 GDPR"})
        assert resp.status_code == 200
        body = await resp.get_json()
        assert len(body["fonti"]) == 4
        assert all(s["ok"] is False for s in body["fonti"])

    async def test_a_non_numeric_limite_is_a_400_not_a_500(self, client):
        """The brief's `int(data.get('limite') or 10)` raises ValueError on a
        non-numeric value, which the un-fixed handler would let escape as a
        500 — a validation problem misreported as a server fault."""
        resp = await client.post(
            "/fetch_case_law", json={"riferimento": "art. 5 GDPR", "limite": "abc"})
        assert resp.status_code == 400
        assert "limite" in (await resp.get_json())["error"]

    async def test_a_zero_limite_is_a_400(self, client):
        """A zero or negative limite parses cleanly as an int and would
        otherwise reach every adapter as a nonsensical page-size/slice
        bound sent straight to an external service."""
        resp = await client.post(
            "/fetch_case_law", json={"riferimento": "art. 5 GDPR", "limite": 0})
        assert resp.status_code == 400

    async def test_a_negative_limite_is_a_400(self, client):
        resp = await client.post(
            "/fetch_case_law", json={"riferimento": "art. 5 GDPR", "limite": -3})
        assert resp.status_code == 400

    async def test_a_malformed_json_body_is_a_400_not_a_500(self, client):
        """`request.get_json()` raises `werkzeug.exceptions.BadRequest` on a
        body that claims to be JSON but isn't. Left unguarded that is a 500
        for a client-side mistake, the same defect class as the `int()` one."""
        resp = await client.post(
            "/fetch_case_law",
            headers={"Content-Type": "application/json"},
            data="not json",
        )
        assert resp.status_code == 400


class TestSearchCaseLaw:
    @pytest.fixture(autouse=True)
    def _stub(self, monkeypatch):
        async def fake_cerca(testo, limite=10):
            return [SourceResult(organo="CGUE", ok=True, decisioni=[])]

        monkeypatch.setattr("app.case_law_registry.cerca_libera", fake_cerca)

    async def test_a_missing_testo_is_a_400(self, client):
        resp = await client.post("/search_case_law", json={})
        assert resp.status_code == 400

    async def test_a_well_formed_query_answers_200(self, client):
        resp = await client.post("/search_case_law", json={"testo": "responsabilita' medica"})
        assert resp.status_code == 200
        body = await resp.get_json()
        assert body["fonti"][0]["organo"] == "CGUE"


class TestFetchDecision:
    async def test_missing_fields_are_a_400(self, client):
        resp = await client.post("/fetch_decision", json={"organo": "cassazione"})
        assert resp.status_code == 400

    async def test_a_non_numeric_anno_is_a_400_not_a_500(self, client):
        resp = await client.post(
            "/fetch_decision",
            json={"organo": "cassazione", "numero": "1234", "anno": "duemila"},
        )
        assert resp.status_code == 400
        assert "anno" in (await resp.get_json())["error"]

    async def test_an_unrecognised_organo_is_a_400(self, client, monkeypatch):
        # registry.leggi raises KeyError for an organo not in ADAPTERS.
        resp = await client.post(
            "/fetch_decision",
            json={"organo": "corte-costituzionale", "numero": "1", "anno": 2020},
        )
        assert resp.status_code == 400

    async def test_a_genuinely_absent_decision_is_a_404(self, client, monkeypatch):
        async def fake_leggi(organo, numero, anno):
            return None

        monkeypatch.setattr("app.case_law_registry.leggi", fake_leggi)
        resp = await client.post(
            "/fetch_decision",
            json={"organo": "cassazione", "numero": "999999", "anno": 2020},
        )
        assert resp.status_code == 404

    async def test_a_source_timeout_is_a_504_distinct_from_400_and_404(self, client, monkeypatch):
        """`registry.leggi` deliberately lets `asyncio.TimeoutError` propagate
        rather than returning None, because None already means "not found"
        and a timeout is a different, worse claim."""
        async def fake_leggi(organo, numero, anno):
            raise asyncio.TimeoutError()

        monkeypatch.setattr("app.case_law_registry.leggi", fake_leggi)
        resp = await client.post(
            "/fetch_decision",
            json={"organo": "cassazione", "numero": "1234", "anno": 2020},
        )
        assert resp.status_code == 504

    async def test_the_gdpr_is_not_a_cgue_judgment(self, client, monkeypatch):
        """End to end, through the real CellarAdapter with only the network
        stubbed: `{"organo":"cgue","numero":"32016R0679","anno":1900}` used to
        answer 200 with the GDPR — a regulation — dressed as a CJEU judgment
        with an invented year and `link_kind: cited`, which is this product's
        promise that the source declared the link."""
        async def fake_request(method, url, **kwargs):
            class R:
                text = '{"head":{},"boolean":true}'
                status = 200
                headers = {}
            return R()

        monkeypatch.setattr(
            "visualex_api.services.case_law.cellar.http_client.request", fake_request
        )
        resp = await client.post(
            "/fetch_decision",
            json={"organo": "cgue", "numero": "32016R0679", "anno": 1900},
        )
        assert resp.status_code == 404

    async def test_a_sparql_payload_in_numero_is_not_executed(self, client, monkeypatch):
        """`numero` reaches a SPARQL string literal in CellarAdapter.leggi.
        The route is public and unauthenticated, so the payload must die in
        the adapter's validation, with no request leaving the process."""
        calls = []

        async def fake_request(method, url, **kwargs):
            calls.append(url)
            class R:
                text = '{"head":{},"boolean":true}'
                status = 200
                headers = {}
            return R()

        monkeypatch.setattr(
            "visualex_api.services.case_law.cellar.http_client.request", fake_request
        )
        resp = await client.post(
            "/fetch_decision",
            json={"organo": "cgue", "numero": "x' } ASK WHERE { BIND(1 AS ?z) '",
                  "anno": 2019},
        )
        assert resp.status_code == 404
        assert calls == []

    async def test_a_found_decision_answers_200(self, client, monkeypatch):
        async def fake_leggi(organo, numero, anno):
            return Decisione(organo="Cassazione", numero=numero, anno=anno,
                              link_kind=LinkKind.MATCHED, url="u")

        monkeypatch.setattr("app.case_law_registry.leggi", fake_leggi)
        resp = await client.post(
            "/fetch_decision",
            json={"organo": "cassazione", "numero": "1234", "anno": 2020},
        )
        assert resp.status_code == 200
        body = await resp.get_json()
        assert body["numero"] == "1234"
        assert body["link_kind"] == "matched"


class TestFetchDecisionRoundTrip:
    """FIX 1: `registry.ADAPTERS` is keyed `"cgue"`/`"cassazione"`/`"cerdef"`/
    `"giustizia-amm"`, but `/fetch_case_law` used to answer `organo` as the
    human-readable label ("CGUE", "Giustizia amministrativa") with no
    mapping published anywhere — a client that read that field and sent it
    straight back to `/fetch_decision` got a 400 on all four sources. This
    exercises the real `registry` fan-out and lookup (only the four adapters
    are stubbed, at the `ADAPTERS` level, not `cerca_per_norma`/`leggi`
    themselves), because the defect lives in exactly that boundary.
    """

    class _FakeAdapter:
        def __init__(self, organo):
            self.organo = organo
            self.coverage = ""

        async def cerca_per_norma(self, riferimento, limite=10):
            return SourceResult(organo=self.organo, ok=True, decisioni=[
                Decisione(organo=self.organo, numero="62017CJ0496", anno=2019,
                          link_kind=LinkKind.CITED, url="u")])

        async def cerca_libera(self, testo, limite=10):
            return await self.cerca_per_norma(testo, limite)

        async def leggi(self, numero, anno):
            return Decisione(organo=self.organo, numero=numero, anno=anno,
                              link_kind=LinkKind.CITED, url="u")

    async def test_the_key_read_back_from_fetch_case_law_is_accepted(self, monkeypatch):
        monkeypatch.setattr(
            "app.case_law_registry.ADAPTERS",
            {"giustizia-amm": self._FakeAdapter("Giustizia amministrativa")},
        )
        app_client = NormaController().app.test_client()

        resp = await app_client.post("/fetch_case_law", json={"riferimento": "art. 21-septies"})
        assert resp.status_code == 200
        body = await resp.get_json()
        source = body["fonti"][0]
        # The label a lawyer reads and the key a client must send back are
        # not the same string ("Giustizia amministrativa" vs "giustizia-amm")
        # — this is precisely the case the fix has to cover, not the three
        # sources whose label happens to fold to the key.
        assert source["organo"] == "Giustizia amministrativa"
        assert source["fonte"] == "giustizia-amm"
        assert source["decisioni"][0]["fonte"] == "giustizia-amm"

        resp2 = await app_client.post(
            "/fetch_decision",
            json={"organo": source["fonte"], "numero": "62017CJ0496", "anno": 2019},
        )

        assert resp2.status_code != 400
        assert resp2.status_code == 200
        assert (await resp2.get_json())["fonte"] == "giustizia-amm"
