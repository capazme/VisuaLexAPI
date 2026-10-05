"""The Cassazione reader (design 2026-10-01 §3)."""
import asyncio
import json
import pathlib
import ssl

import pytest

from tests.decisions_pdf_synth import Text, make_pdf
from visualex_api.services.decisions import italgiure
from visualex_api.services.decisions.italgiure import (
    ItalgiureReader,
    SourceAnswerError,
    _plausible,
    paragraphs,
    pdf_url,
    split_dispositivo,
    to_decision,
)
from visualex_api.services.decisions.pdf_text import (
    read_decision_pdf, read_decision_pdf_async, text_from_pdf)
from visualex_api.services.http_client import HttpResult
from visualex_api.tools.exceptions import DocumentNotFoundError, NetworkError
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


async def test_a_number_below_10000_is_tried_padded_only(monkeypatch):
    # the index stores the number padded to five digits: the bare form never matched (measured
    # on 2026-10-02), and every query costs a homepage GET and a Solr POST
    calls = _serve(monkeypatch, [json.dumps({"response": {"numFound": 0, "docs": []}})])
    assert await ItalgiureReader().lookup("civile", 123, 2024) is None
    assert [c[2]["data"]["q"] for c in calls if c[0] == "POST"] == [
        'kind:"snciv" AND numdec:00123 AND anno:2024']
    assert [c[0] for c in calls] == ["GET", "POST"]


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


def test_the_valuation_notice_is_never_the_text():
    d = to_decision({"numdec": "5722", "anno": "2022", "szdec": "3",
                     "ocr": ["in fase di valutazione oscuramento"]}, "civile")
    assert d.testo == {} and d.testo_assente == "valutazione_oscuramento"


def test_a_short_stub_about_obscuring_is_never_the_text():
    stub = "Oscuramento disposto Numero registro generale 21174/2023 Numero sezionale 1"
    d = to_decision({"numdec": "1", "anno": "2025", "ocr": [stub]}, "civile")
    assert d.testo == {} and d.testo_assente is None


@pytest.mark.parametrize("text,expected", [
    # an upper-case heading, and P.Q.M.
    ("composta dai magistrati FATTI DI CAUSA La Corte d'appello ha deciso. RAGIONI DELLA DECISIONE "
     "Il ricorso è fondato. P.Q.M. La Corte accoglie il ricorso.",
     "composta dai magistrati \n\nFATTI DI CAUSA La Corte d'appello ha deciso. \n\nRAGIONI DELLA DECISIONE "
     "Il ricorso è fondato. \n\nP.Q.M. La Corte accoglie il ricorso."),
    # a mixed-case lead and the numbered point right after it
    ("Presidente e relatore. Rilevato che: 1.L'Agenzia propone ricorso. 2. Resiste il contribuente.",
     "Presidente e relatore. \n\nRilevato che: \n\n1.L'Agenzia propone ricorso. \n\n2. Resiste il contribuente."),
    # sub-points and a point after a code abbreviation
    ("Il motivo è infondato. 2.1. Come statuito. 2.1.2. La sentenza. Ai sensi dell'art. 360 c.p.c. 3. La Corte rigetta.",
     "Il motivo è infondato. \n\n2.1. Come statuito. \n\n2.1.2. La sentenza. Ai sensi dell'art. 360 c.p.c. \n\n3. La Corte rigetta."),
    # a number after a word that introduces numbers is not a point
    ("Come prevede l'art. 47. Il termine decorre dalla notifica, secondo il n. 3. La parte resiste.",
     "Come prevede l'art. 47. Il termine decorre dalla notifica, secondo il n. 3. La parte resiste."),
    # a «P. Q. M.» with spaces, and a point with a dash
    ("Così deciso. 4 - La Corte. P. Q. M. rigetta.",
     "Così deciso. \n\n4 - La Corte. \n\nP. Q. M. rigetta."),
    # nothing to mark
    ("Il ricorso è inammissibile per tardività.", "Il ricorso è inammissibile per tardività."),
    # a combined heading stays one, whatever the case of its connective
    ("Premessa. RITENUTO IN FATTO E CONSIDERATO IN DIRITTO Il ricorso.",
     "Premessa. \n\nRITENUTO IN FATTO E CONSIDERATO IN DIRITTO Il ricorso."),
    ("Premessa. FATTI DI CAUSA e RAGIONI DELLA DECISIONE La Corte.",
     "Premessa. \n\nFATTI DI CAUSA e RAGIONI DELLA DECISIONE La Corte."),
    # a numbered point keeps the words it opens: no break between its label and a lead, a
    # «P.Q.M.» or a heading right after it
    ("Fine. 1.2. Rileva, poi, la Corte che il motivo.",
     "Fine. \n\n1.2. Rileva, poi, la Corte che il motivo."),
    ("Fine. 3. P.Q.M. La Corte rigetta.", "Fine. \n\n3. P.Q.M. La Corte rigetta."),
    ("Fine. 3. RITENUTO CHE il ricorso.", "Fine. \n\n3. RITENUTO CHE il ricorso."),
    # a point skipped after «art.» does not take away the lead's own break
    ("Visto l'art. 5. Considerato che, il ricorso.", "Visto l'art. 5. \n\nConsiderato che, il ricorso."),
])
def test_paragraphs_are_restored_with_blank_lines_only(text, expected):
    assert paragraphs(text) == expected
    assert paragraphs(text).replace("\n", "") == text.replace("\n", "")


def test_a_decision_comes_with_its_paragraphs():
    d = to_decision({"numdec": "1", "anno": "2024",
                     "ocr": "Premessa. FATTI DI CAUSA Il fatto. P.Q.M. Rigetta.",
                     "ocrdis": "Visto il ricorso. P.Q.M. Rigetta."}, "civile")
    assert d.testo["motivazione"] == "Premessa. \n\nFATTI DI CAUSA Il fatto. \n\nP.Q.M. Rigetta."
    assert d.testo["dispositivo"] == "Visto il ricorso. \n\nP.Q.M. Rigetta."


def test_a_long_word_before_a_number_is_still_read_by_its_last_part():
    # the look-back for the word before a number is a window, not the whole text before it: a
    # citation after a word longer than the window («dell'art.» is «art.») is still skipped
    text = "x" * 100 + "'art. 5. Il motivo."
    assert paragraphs(text) == text


@pytest.mark.parametrize("text,dispositivo,expected,from_the_text", [
    # the text ends with the dispositivo: it is cut off, so the decision reads once
    ("Premessa. FATTI DI CAUSA Il fatto. P.Q.M. Rigetta il ricorso.", "P.Q.M. Rigetta il ricorso.",
     ("Premessa. FATTI DI CAUSA Il fatto.", "P.Q.M. Rigetta il ricorso."), True),
    # whitespace aside: the dispositivo returned is the text's own, with its own spacing
    ("Premessa. Il fatto. P.Q.M. Rigetta  il ricorso.", "P.Q.M.\nRigetta il ricorso.",
     ("Premessa. Il fatto.", "P.Q.M. Rigetta  il ricorso."), True),
    # held elsewhere than at the end: dropped, and the text stays whole
    ("Premessa. P.Q.M. Rigetta. Così deciso in Roma.", "P.Q.M. Rigetta.",
     ("Premessa. P.Q.M. Rigetta. Così deciso in Roma.", ""), True),
    # not held at all: it stays as the source gave it
    ("Premessa. FATTI DI CAUSA Il fatto. P.Q.M. Rigetta.", "Visto il ricorso. P.Q.M. Rigetta.",
     ("Premessa. FATTI DI CAUSA Il fatto. P.Q.M. Rigetta.", "Visto il ricorso. P.Q.M. Rigetta."),
     False),
    # the text is the dispositivo and nothing else
    ("P.Q.M. Rigetta.", "P.Q.M. Rigetta.", ("P.Q.M. Rigetta.", ""), True),
    # no dispositivo
    ("Premessa. Il fatto.", "", ("Premessa. Il fatto.", ""), True),
    # the text ends with it only inside a word: a cut never falls inside one, so it is held
    # elsewhere and dropped, never «Si Rige» and «tta.»
    ("Si Rigetta.", "tta.", ("Si Rigetta.", ""), True),
], ids=["the text ends with it", "whitespace aside", "held elsewhere", "not held",
        "the text is the dispositivo", "no dispositivo", "never inside a word"])
def test_the_dispositivo_the_text_ends_with_is_read_once(text, dispositivo, expected,
                                                         from_the_text):
    motivazione, cut = split_dispositivo(text, dispositivo)
    assert (motivazione, cut) == expected
    if from_the_text:
        # nothing is added, dropped or changed but whitespace: every character is the text's own
        assert "".join((motivazione + cut).split()) == "".join(text.split())


def test_a_decision_reads_its_dispositivo_once():
    d = to_decision({"numdec": "1", "anno": "2024",
                     "ocr": "Premessa. FATTI DI CAUSA Il fatto. P.Q.M. Rigetta il ricorso.",
                     "ocrdis": "P.Q.M. Rigetta il ricorso."}, "civile")
    assert d.testo == {"motivazione": "Premessa. \n\nFATTI DI CAUSA Il fatto.",
                       "dispositivo": "P.Q.M. Rigetta il ricorso."}


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
        # the public archive is a moving window: once it starts after 2021, the Sezioni Unite
        # case is out of reach, not broken
        start = None if any(d is not None for d in su) else await reader.archive_start("civile")
    except TRANSPORT_ERRORS as exc:
        skip_if_unreachable("italgiure", exc)
    assert civ is not None and pen is not None
    assert (civ.sezione, pen.sezione) == ("3", "7")
    assert len(pen.testo["motivazione"]) > 2000  # the whole text, not a cut
    # the civil text was withheld on 2026-10-02 (personal data being removed): absent or whole
    assert not civ.testo or len(civ.testo["motivazione"]) > 2000
    assert missing is None
    if start is not None and start[0] > 2021:
        pytest.skip("the archive window has passed 2021")
    assert "U" in {d.sezione for d in su if d is not None}  # civil or penal: both are read


# --- the text from the court's PDF (design 2026-10-05 §11), on invented text ---

FILENAME = "./20260101/snciv@s10@a2026@n12345@tO.pdf"


def _sentences(prefix: str, count: int) -> list[str]:
    return [f"{prefix} riga {i} del ragionamento svolto dal collegio sulla questione proposta."
            for i in range(count)]


def _pdf_of(lines: list[str], header: str | None = None) -> bytes:
    page = [Text(85, 700 - 14 * i, line) for i, line in enumerate(lines)]
    if header:
        page.append(Text(85, 800, header))
    return make_pdf([page])


def _record(lines: list[str], **extra) -> dict:
    return {"id": "snciv2026012345O", "numdec": "12345", "anno": "2026", "kind": "snciv",
            "datdep": "20260101", "szdec": "1", "tipoprov": "Sentenza", "filename": FILENAME,
            "ocr": " ".join(lines), **extra}


def _serve_with_pdf(monkeypatch, record: dict, pdf: bytes | Exception = b"", status: int = 200):
    """Solr answers the record; the attach URL answers `pdf` (or raises it)."""
    calls = []

    async def fake_request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        if method == "POST":
            return HttpResult(text=json.dumps({"response": {"numFound": 1, "docs": [record]}}),
                              status=200, headers={})
        if "verbo=attach" in url:
            if isinstance(pdf, Exception):
                raise pdf
            if pdf == "hang":
                await asyncio.sleep(3600)
            return HttpResult(text=pdf.decode("latin-1"), status=status,
                              headers={"Content-Type": "application/pdf"})
        return HttpResult(text="", status=200, headers={})

    monkeypatch.setattr(italgiure.decisions_http_client, "request", fake_request)
    return calls


LINES = _sentences("Prima", 40)


async def test_the_text_comes_from_the_pdf_when_there_is_one(monkeypatch):
    pdf = _pdf_of(LINES)
    calls = _serve_with_pdf(monkeypatch, _record(LINES), pdf)
    decision, data = await ItalgiureReader().lookup_with_pdf("civile", 12345, 2026)
    assert decision.testo_origine == "pdf" and data == pdf
    assert decision.testo["motivazione"] == text_from_pdf(pdf)["motivazione"]
    assert calls[-1][1].endswith(".clean.pdf") and "verbo=attach" in calls[-1][1]
    assert "db=snciv" in calls[-1][1] and calls[-1][2]["ssl"] is italgiure_ssl_context()
    assert [c[0] for c in calls] == ["GET", "POST", "GET"]  # homepage, Solr, PDF


@pytest.mark.parametrize("pdf_answer", ["refused", "error", "missing_filename", "too_short",
                                        "other_decision", "not_found", "status_204",
                                        "header_other_decision", "other_number_in_name"])
async def test_without_a_usable_pdf_the_field_is_used_and_said(monkeypatch, pdf_answer):
    record, pdf, status = _record(LINES), _pdf_of(LINES), 200
    if pdf_answer == "refused":
        pdf = b"<html>Accesso negato</html>"
    elif pdf_answer == "error":
        pdf = NetworkError("Exceeded retry budget")
    elif pdf_answer == "missing_filename":
        del record["filename"]
    elif pdf_answer == "too_short":
        pdf = _pdf_of(LINES[:10])
    elif pdf_answer == "not_found":
        pdf = DocumentNotFoundError("Document not found")
    elif pdf_answer == "status_204":
        status = 204
    elif pdf_answer == "header_other_decision":
        pdf = _pdf_of(LINES, "Civile Ord. Sez. 1 Num. 12346 Anno 2026")
    elif pdf_answer == "other_number_in_name":
        record["filename"] = FILENAME.replace("n12345", "n99999")
    else:  # a whole PDF of another text: long enough, opening words unrelated
        pdf = _pdf_of([" ".join(f"altra{i}x{j}" for j in range(12)) for i in range(40)])
    calls = _serve_with_pdf(monkeypatch, record, pdf, status)
    decision, data = await ItalgiureReader().lookup_with_pdf("civile", 12345, 2026)
    assert decision.testo_origine == "archivio" and data is None
    assert decision.testo["motivazione"].startswith("Prima riga 0")
    assert any("verbo=attach" in c[1] for c in calls) == (pdf_answer not in ("missing_filename", "other_number_in_name"))


async def test_a_fallback_is_logged_with_its_reason(monkeypatch):
    _serve_with_pdf(monkeypatch, _record(LINES), b"<html>")
    events = []
    monkeypatch.setattr(italgiure.log, "warning", lambda event, **kw: events.append((event, kw)))
    await ItalgiureReader().lookup_with_pdf("civile", 12345, 2026)
    assert events and events[0][1]["key"] == "cassazione:civile:12345:2026"
    assert "PDF refused" in events[0][1]["reason"]


async def test_a_withheld_text_fetches_no_pdf(monkeypatch):
    calls = _serve(monkeypatch, [_fixture("italgiure_snciv_10787_2024.json")])
    decision, data = await ItalgiureReader().lookup_with_pdf("civile", 10787, 2024)
    assert decision.testo == {} and data is None and decision.testo_origine is None
    assert not any("verbo=attach" in c[1] for c in calls)


async def test_lookup_returns_the_decision_alone(monkeypatch):
    _serve_with_pdf(monkeypatch, _record(LINES), _pdf_of(LINES))
    decision = await ItalgiureReader().lookup("civile", 12345, 2026)
    assert decision.testo_origine == "pdf"


def test_the_pdf_address_is_the_clean_attachment_or_none():
    assert pdf_url({"filename": FILENAME, "kind": "snciv", "numdec": "12345", "anno": "2026"}) == (
        "https://www.italgiure.giustizia.it/xway/application/nif/clean/hc.dll"
        "?verbo=attach&db=snciv&id=./20260101/snciv@s10@a2026@n12345@tO.clean.pdf")
    assert pdf_url({"filename": [FILENAME], "kind": ["snciv"], "numdec": ["12345"], "anno": ["2026"]})
    for doc in ({}, {"kind": "snciv"}, {"filename": FILENAME},
                {"filename": FILENAME, "kind": "snciv"},  # a name with a number, a record without
                {"filename": "http://elsewhere/x.pdf", "kind": "snciv"},
                {"filename": "./20260101/../../x.pdf", "kind": "snciv"},
                {"filename": FILENAME, "kind": "other"}):
        assert pdf_url(doc) is None


def test_the_plausibility_checks_are_both_needed():
    field = {"motivazione": " ".join(f"parola{i}" for i in range(100))}
    assert _plausible(field, field) is None
    # the field cut at its front: 3 words missing at the start still share more than ten
    assert _plausible(field, {"motivazione": " ".join(f"parola{i}" for i in range(3, 100))}) is None
    assert "shorter" in _plausible({"motivazione": "parola0 parola1"}, field)
    unrelated = {"motivazione": " ".join(f"altra{i}" for i in range(100))}
    assert "opening words" in _plausible(unrelated, field)


def test_the_pdf_step_leaves_room_in_the_resolvers_limit():
    from visualex_api.services.decisions.resolver import ITALGIURE_TIMEOUT
    assert italgiure.PDF_REQUEST_TIMEOUT + italgiure.PDF_PARSE_TIMEOUT <= italgiure.PDF_STEP_TIMEOUT
    assert italgiure.PDF_STEP_TIMEOUT + 10 <= ITALGIURE_TIMEOUT


async def test_a_pdf_that_hangs_falls_back_and_says_why(monkeypatch):
    monkeypatch.setattr(italgiure, "PDF_STEP_TIMEOUT", 0.05)
    calls = _serve_with_pdf(monkeypatch, _record(LINES), "hang")
    events = []
    monkeypatch.setattr(italgiure.log, "warning", lambda event, **kw: events.append(kw))
    decision, data = await ItalgiureReader().lookup_with_pdf("civile", 12345, 2026)
    assert decision.testo_origine == "archivio" and data is None
    assert events[0]["reason"] == "PDF step timed out"
    # one try and a short timeout of its own, so the resolver's limit is not used up
    kwargs = calls[-1][2]
    assert kwargs["max_retries"] == italgiure.PDF_RETRIES == 0
    assert kwargs["timeout"].total == italgiure.PDF_REQUEST_TIMEOUT


@pytest.mark.parametrize("header", [None, "Civile Ord. Sez. 1 Num. 12345 Anno 2026",
                                    "Penale   Sent.  Sez. 3   Num.  12345   Anno 2026"])
async def test_a_pdf_without_a_header_or_with_the_right_one_is_accepted(monkeypatch, header):
    pdf = _pdf_of(LINES, header)
    _serve_with_pdf(monkeypatch, _record(LINES), pdf)
    decision, data = await ItalgiureReader().lookup_with_pdf("civile", 12345, 2026)
    assert decision.testo_origine == "pdf" and data == pdf


async def test_the_header_year_is_checked_too(monkeypatch):
    _serve_with_pdf(monkeypatch, _record(LINES), _pdf_of(LINES, "Civile Ord. Sez. 1 Num. 12345 Anno 2025"))
    decision, _ = await ItalgiureReader().lookup_with_pdf("civile", 12345, 2026)
    assert decision.testo_origine == "archivio"


async def test_the_header_is_read_and_the_text_is_unchanged():
    pdf = _pdf_of(LINES, "Civile Ord. Sez. 1 Num. 12345 Anno 2026")
    text, header = read_decision_pdf(pdf)
    assert header == (12345, 2026) and text == text_from_pdf(pdf)
    assert await read_decision_pdf_async(pdf) == (text, header)
    assert read_decision_pdf(_pdf_of(LINES))[1] is None


def test_a_filename_naming_another_decision_has_no_pdf():
    ok = {"filename": FILENAME, "kind": "snciv", "numdec": "12345", "anno": "2026"}
    assert pdf_url(ok)
    assert pdf_url({**ok, "numdec": "00012345"})  # zero-padded, same number
    assert pdf_url({**ok, "numdec": "12346"}) is None
    assert pdf_url({**ok, "anno": "2025"}) is None
    assert pdf_url({**ok, "filename": FILENAME.replace("n12345", "nx")}) is not None  # no digits: not a number tag
    assert pdf_url({**ok, "filename": "./20260101/snciv@s10@a2026@n12345@t\u00e8.pdf"}) is None  # ASCII only
