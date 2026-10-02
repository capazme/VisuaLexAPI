"""The Cassazione reader (design 2026-10-01 §3)."""
import json
import pathlib
import ssl

import pytest

from visualex_api.services.decisions import italgiure
from visualex_api.services.decisions.italgiure import (
    ItalgiureReader,
    SourceAnswerError,
    to_decision,
)
from visualex_api.services.http_client import HttpResult
from visualex_api.tools.exceptions import NetworkError
from visualex_api.tools.tls import italgiure_ssl_context

FIX = pathlib.Path(__file__).parent / "fixtures" / "decisions"
# Measured live on 2026-09-30 (n. 10787/2024 civile and penale) and checked again by the
# recording of Step 1.
EXPECTED = {
    "civile": {"sezione": "3"},
    "penale": {"sezione": "7"},
}


def _fixture(name: str) -> str:
    return (FIX / name).read_text()


def _serve(monkeypatch, answers):
    """Answer each Solr POST with the next body; record every request."""
    calls = []
    bodies = iter(answers)

    async def fake_request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        if method == "GET":
            return HttpResult(text="", status=200, headers={})
        return HttpResult(text=next(bodies), status=200, headers={})

    monkeypatch.setattr(italgiure.decisions_http_client, "request", fake_request)
    return calls


async def test_a_civil_decision(monkeypatch):
    calls = _serve(monkeypatch, [_fixture("italgiure_snciv_10787_2024.json")])
    d = await ItalgiureReader().lookup("civile", 10787, 2024)
    assert d.identita.key() == "cassazione:civile:10787:2024"
    assert d.sezione == EXPECTED["civile"]["sezione"]
    assert d.data_deposito and len(d.data_deposito) == 10  # ISO
    # recorded on 2026-10-02 while the source withheld the text: its notice is not the text
    assert d.testo == {}
    assert d.testo_assente == "oscuramento"
    assert d.fonte["nome"].startswith("Corte di cassazione")
    get, post = calls[0], calls[1]
    assert get[0] == "GET" and post[0] == "POST"
    assert post[2]["data"]["q"] == 'kind:"snciv" AND numdec:10787 AND anno:2024'
    for call in (get, post):
        ctx = call[2]["ssl"]
        assert ctx is italgiure_ssl_context()
        assert ctx.verify_mode == ssl.CERT_REQUIRED and ctx.check_hostname
    assert post[2]["headers"]["User-Agent"].startswith("VisuaLex/")


async def test_the_penal_decision_with_the_same_number(monkeypatch):
    _serve(monkeypatch, [_fixture("italgiure_snpen_10787_2024.json")])
    d = await ItalgiureReader().lookup("penale", 10787, 2024)
    assert d.identita.archivio == "penale" and d.sezione == EXPECTED["penale"]["sezione"]
    assert d.testo["motivazione"]
    assert d.tipo == "ordinanza"  # the source's label "Ordinanza"
    assert d.testo["dispositivo"] == "P. Q. M."
    assert d.relatore and d.presidente


async def test_a_number_below_10000_is_tried_padded_then_bare(monkeypatch):
    empty = json.dumps({"response": {"numFound": 0, "docs": []}})
    calls = _serve(monkeypatch, [empty, empty])
    assert await ItalgiureReader().lookup("civile", 123, 2024) is None
    queries = [c[2]["data"]["q"] for c in calls if c[0] == "POST"]
    assert queries == ['kind:"snciv" AND numdec:00123 AND anno:2024',
                       'kind:"snciv" AND numdec:123 AND anno:2024']


async def test_not_found_is_none(monkeypatch):
    _serve(monkeypatch, [_fixture("italgiure_snciv_99999_2024.json")])
    assert await ItalgiureReader().lookup("civile", 99999, 2024) is None


async def test_an_anti_bot_page_is_a_source_error(monkeypatch):
    _serve(monkeypatch, ["<html><body>Verifica di sicurezza</body></html>"])
    with pytest.raises(SourceAnswerError):
        await ItalgiureReader().lookup("civile", 10787, 2024)


@pytest.mark.parametrize("body", ["{}", '{"error": {"msg": "x"}}', "null", "[]", '"x"',
                                  '{"response": []}', '{"response": {"docs": ["x"]}}'])
async def test_an_answer_that_is_not_solrs_is_a_source_error(monkeypatch, body):
    _serve(monkeypatch, [body])
    with pytest.raises(SourceAnswerError):
        await ItalgiureReader().lookup("civile", 10787, 2024)


async def test_a_record_without_a_number_is_a_source_error(monkeypatch):
    _serve(monkeypatch, [json.dumps({"response": {"docs": [{"numdec": "", "anno": "2024"}]}})])
    with pytest.raises(SourceAnswerError):
        await ItalgiureReader().lookup("civile", 10787, 2024)


async def test_a_transport_failure_propagates(monkeypatch):
    async def down(method, url, **kwargs):
        raise NetworkError("Exceeded retry budget")

    monkeypatch.setattr(italgiure.decisions_http_client, "request", down)
    with pytest.raises(NetworkError):
        await ItalgiureReader().lookup("civile", 10787, 2024)


async def test_the_archive_start_is_read_from_the_archive(monkeypatch):
    calls = _serve(monkeypatch, [_fixture("italgiure_start_snciv.json")])
    year, iso = await ItalgiureReader().archive_start("civile")
    assert year == int(iso[:4]) and iso.startswith("2021-")
    post = [c for c in calls if c[0] == "POST"][0]
    assert post[2]["data"]["sort"] == "pd asc"


def test_multivalued_fields_are_read_whole():
    d = to_decision({"numdec": ["01234"], "anno": "2024", "szdec": "u", "datdep": ["20240422"],
                     "tipoprov": "O", "ocr": ["prima parte", "seconda parte"], "ocrdis": ""},
                    "civile")
    assert d.identita.numero == 1234 and d.sezione == "U" and d.tipo == "ordinanza"
    assert d.data_deposito == "2024-04-22"
    assert d.testo == {"motivazione": "prima parte\nseconda parte"}


def test_the_source_notice_is_never_the_text():
    notice = "CORTE SUPREMA DI CASSAZIONE ITALGIUREWEB La sentenza richiesta è in fase di oscuramento"
    d = to_decision({"numdec": "10787", "anno": "2024", "szdec": "3", "ocr": [notice],
                     "ocrdis": "P. Q. M."}, "civile")
    assert d.testo == {} and d.sezione == "3"
    assert d.testo_assente == "oscuramento"
    quoted = "Motivi della decisione. " * 20 + "il ricorrente afferma che l'atto era in fase di oscuramento"
    long = to_decision({"numdec": "1", "anno": "2024", "ocr": quoted}, "civile")
    assert long.testo == {"motivazione": quoted} and long.testo_assente is None
    split = {"numdec": "1", "anno": "2024", "ocr": ["La sentenza richiesta è in fase", "di  oscuramento"]}
    assert to_decision(split, "civile").testo == {}
    assert to_decision(split, "civile").testo_assente == "oscuramento"


def test_a_record_without_text_or_notice_gives_no_cause(monkeypatch):
    warnings = []

    class Log:
        def warning(self, event, **fields):
            warnings.append((event, fields))

    monkeypatch.setattr(italgiure, "log", Log())
    d = to_decision({"id": "snciv2024300001S", "numdec": "1", "anno": "2024", "szdec": "3"},
                    "civile")
    # never presented as the source's anonymisation: nothing said why
    assert d.testo == {} and d.testo_assente is None
    assert warnings == [("Italgiure record without text", {"id": "snciv2024300001S"})]


@pytest.mark.live
@pytest.mark.asyncio(loop_scope="session")
async def test_the_fixed_public_cases_still_answer():
    # the spec's live cases: the homonyms 10787/2024, the Sezioni Unite 41994/2021 and a
    # number that does not exist
    from tests.conftest import TRANSPORT_ERRORS, skip_if_unreachable
    reader = ItalgiureReader()
    try:
        civ = await reader.lookup("civile", 10787, 2024)
        pen = await reader.lookup("penale", 10787, 2024)
        su = [await reader.lookup(archivio, 41994, 2021) for archivio in ("civile", "penale")]
        missing = await reader.lookup("civile", 999999, 2024)
    except TRANSPORT_ERRORS as exc:
        skip_if_unreachable("italgiure", exc)
    assert civ is not None and pen is not None
    assert (civ.sezione, pen.sezione) == ("3", "7")
    assert len(pen.testo["motivazione"]) > 2000  # the whole text, not a cut
    # the civil text was withheld on 2026-10-02 (personal data being removed): absent or whole
    assert not civ.testo or len(civ.testo["motivazione"]) > 2000
    assert "U" in {d.sezione for d in su if d is not None}  # civil or penal: both are read
    assert missing is None
