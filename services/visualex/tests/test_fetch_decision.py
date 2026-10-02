"""POST /fetch_decision (design 2026-10-01 §3)."""
import pytest

from app import NormaController
from visualex_api.services.decisions.model import Decision, Identity
from visualex_api.services.decisions.resolver import Outcome, SourceUnavailable

D = Decision(identita=Identity("cassazione", 10787, 2024, "civile"), sezione="3",
             testo={"motivazione": "t"}, fonte={"nome": "f"})


class FakeResolver:
    def __init__(self, outcome=None, error=None):
        self.outcome, self.error, self.refs = outcome, error, []

    async def resolve(self, ref):
        self.refs.append(ref)
        if self.error:
            raise self.error
        return self.outcome


@pytest.fixture
def client():
    return NormaController().app.test_client()


def _use(monkeypatch, resolver):
    monkeypatch.setattr("app.get_resolver", lambda: resolver)
    return resolver


async def test_found(client, monkeypatch):
    resolver = _use(monkeypatch, FakeResolver(Outcome("trovata", decisione=D)))
    resp = await client.post("/fetch_decision", json={
        "corte": "cassazione", "numero": 10787, "anno": 2024, "sezione": "III"})
    assert resp.status_code == 200
    body = await resp.get_json()
    assert body["esito"] == "trovata" and body["identita"]["archivio"] == "civile"
    assert resolver.refs[0].sezione.code == "3"


async def test_ambiguous_is_200(client, monkeypatch):
    _use(monkeypatch, FakeResolver(Outcome("ambigua", candidati=[D, D])))
    resp = await client.post("/fetch_decision", json={"corte": "cassazione", "numero": 1,
                                                       "anno": 2024})
    assert resp.status_code == 200 and (await resp.get_json())["esito"] == "ambigua"


async def test_not_found_is_404_with_the_reason(client, monkeypatch):
    _use(monkeypatch, FakeResolver(Outcome("non_trovata", motivo="fuori_archivio",
                                           archivio_dal="2021-02-17")))
    resp = await client.post("/fetch_decision", json={"corte": "cassazione", "numero": 1,
                                                       "anno": 2019})
    assert resp.status_code == 404
    assert await resp.get_json() == {"esito": "non_trovata", "motivo": "fuori_archivio",
                                     "archivio_dal": "2021-02-17"}


async def test_a_source_down_is_503_never_404(client, monkeypatch):
    _use(monkeypatch, FakeResolver(error=SourceUnavailable("cassazione", "timeout")))
    resp = await client.post("/fetch_decision", json={"corte": "cassazione", "numero": 1,
                                                       "anno": 2024})
    assert resp.status_code == 503
    assert await resp.get_json() == {"esito": "fonte_non_raggiungibile", "fonte": "cassazione"}


@pytest.mark.parametrize("payload", [
    {"corte": "tar", "numero": 1, "anno": 2024},
    {"corte": "cassazione", "numero": "abc", "anno": 2024},
    {"corte": "cassazione", "numero": 1, "anno": 3000},
    ["cassazione"],
])
async def test_invalid_bodies_are_400_and_never_reach_a_source(client, monkeypatch, payload):
    resolver = _use(monkeypatch, FakeResolver(Outcome("trovata", decisione=D)))
    resp = await client.post("/fetch_decision", json=payload)
    assert resp.status_code == 400
    assert (await resp.get_json())["esito"] == "richiesta_non_valida"
    assert resolver.refs == []


async def test_a_body_that_is_not_json_is_400(client, monkeypatch):
    _use(monkeypatch, FakeResolver(Outcome("trovata", decisione=D)))
    resp = await client.post("/fetch_decision", data="corte=cassazione",
                             headers={"Content-Type": "application/json"})
    assert resp.status_code == 400


async def test_a_bug_is_a_json_500_without_its_text(client, monkeypatch):
    _use(monkeypatch, FakeResolver(error=RuntimeError("/srv/somewhere exploded")))
    resp = await client.post("/fetch_decision", json={"corte": "cassazione", "numero": 1,
                                                       "anno": 2024})
    assert resp.status_code == 500
    assert await resp.get_json() == {"esito": "errore_interno"}


async def test_a_nested_body_is_400_and_never_reaches_a_source(client, monkeypatch):
    resolver = _use(monkeypatch, FakeResolver(Outcome("trovata", decisione=D)))
    resp = await client.post("/fetch_decision", data="[" * 100_000 + "]" * 100_000,
                             headers={"Content-Type": "application/json"})
    assert resp.status_code == 400
    assert (await resp.get_json())["esito"] == "richiesta_non_valida"
    assert resolver.refs == []


async def test_a_body_that_is_not_utf8_is_400(client, monkeypatch):
    resolver = _use(monkeypatch, FakeResolver(Outcome("trovata", decisione=D)))
    resp = await client.post("/fetch_decision", data=b"\xff",
                             headers={"Content-Type": "application/json"})
    assert resp.status_code == 400
    assert (await resp.get_json())["esito"] == "richiesta_non_valida"
    assert resolver.refs == []
