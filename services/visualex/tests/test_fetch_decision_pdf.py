"""POST /fetch_decision_pdf (design 2026-10-05 §12.2), on synthetic records and PDFs."""
import pytest

from app import NormaController
from visualex_api.tools.exceptions import NetworkError

PDF = b"%PDF-1.4\n%fake but shaped\n"
CIVILE = {"corte": "cassazione", "archivio": "civile", "numero": 5625, "anno": 2022}


class FakeResolver:
    def __init__(self, data=None, error=None):
        self.data, self.error, self.asked = data, error, []

    async def original_pdf(self, identity):
        self.asked.append(identity)
        if self.error:
            raise self.error
        return self.data


@pytest.fixture
def client():
    return NormaController().app.test_client()


def _use(monkeypatch, resolver):
    monkeypatch.setattr("visualex_api.services.decisions.pdf_route.get_resolver", lambda: resolver)
    return resolver


async def test_the_pdf_is_served_as_an_attachment(client, monkeypatch):
    resolver = _use(monkeypatch, FakeResolver(PDF))
    resp = await client.post("/fetch_decision_pdf", json=CIVILE)
    assert resp.status_code == 200
    assert resp.headers["Content-Type"] == "application/pdf"
    assert resp.headers["Content-Disposition"] == 'attachment; filename="Cass_civ_n_5625_2022.pdf"'
    assert await resp.get_data() == PDF
    assert resolver.asked[0].key() == "cassazione:civile:5625:2022"


async def test_a_penal_file_name(client, monkeypatch):
    _use(monkeypatch, FakeResolver(PDF))
    resp = await client.post("/fetch_decision_pdf", json={**CIVILE, "archivio": "penale"})
    assert resp.headers["Content-Disposition"] == 'attachment; filename="Cass_pen_n_5625_2022.pdf"'


async def test_no_pdf_is_404(client, monkeypatch):
    _use(monkeypatch, FakeResolver(None))
    resp = await client.post("/fetch_decision_pdf", json={**CIVILE, "archivio": "penale"})
    assert resp.status_code == 404 and await resp.get_json() == {"esito": "non_disponibile"}


@pytest.mark.parametrize("body", [
    {"corte": "corte_costituzionale", "numero": 71, "anno": 2020},
    {"corte": "cassazione", "numero": 1, "anno": 2024},            # no archive: not an identity
    {"corte": "cassazione", "archivio": "civile", "numero": 0, "anno": 2024},
    {"corte": "cassazione", "archivio": "civile", "numero": True, "anno": 2024},
    {"corte": "cassazione", "archivio": "civile", "numero": 1, "anno": 2999},
    {"corte": "cassazione", "archivio": "civile", "numero": "1", "anno": 2024},
    [],
])
async def test_only_a_cassazione_identity_is_accepted(client, monkeypatch, body):
    resolver = _use(monkeypatch, FakeResolver(PDF))
    resp = await client.post("/fetch_decision_pdf", json=body)
    assert resp.status_code == 400 and (await resp.get_json())["esito"] == "richiesta_non_valida"
    assert resolver.asked == []


async def test_bytes_that_are_not_a_pdf_are_never_served(client, monkeypatch):
    _use(monkeypatch, FakeResolver(b"<html>Verifica</html>"))
    resp = await client.post("/fetch_decision_pdf", json=CIVILE)
    assert resp.status_code == 404


@pytest.mark.parametrize("error", [NetworkError("down"), TimeoutError()])
async def test_a_source_that_does_not_answer_is_503(client, monkeypatch, error):
    _use(monkeypatch, FakeResolver(error=error))
    resp = await client.post("/fetch_decision_pdf", json=CIVILE)
    assert resp.status_code == 503
    assert await resp.get_json() == {"esito": "fonte_non_raggiungibile", "fonte": "cassazione"}


async def test_a_bug_is_a_fixed_500(client, monkeypatch):
    _use(monkeypatch, FakeResolver(error=RuntimeError("secret detail")))
    resp = await client.post("/fetch_decision_pdf", json=CIVILE)
    assert resp.status_code == 500 and await resp.get_json() == {"esito": "errore_interno"}


async def test_a_body_that_is_not_json_is_400(client):
    resp = await client.post("/fetch_decision_pdf", data=b"\xff\xfe", headers={"Content-Type": "application/json"})
    assert resp.status_code == 400
