"""giustizia-amministrativa.it: the search form, the result list and the document (the CdS/TAR
design note of 12 October 2026). Synthetic pages in the source's shapes; no real decision."""
from pathlib import Path

import pytest

from visualex_api.services.decisions import giustizia_amministrativa as ga
from visualex_api.services.decisions.giustizia_amministrativa import (
    GiustiziaAmministrativaReader,
    SourceChanged,
    document_format,
    read_results,
    read_search_form,
    search_fields,
    text_from_document,
)

FIX = Path(__file__).parent / "fixtures" / "decisions"
PAGE = (FIX / "ga_search_page.html").read_text(encoding="utf-8")
RESULTS = (FIX / "ga_results.html").read_text(encoding="utf-8")
DOCUMENT = (FIX / "ga_document.xml").read_text(encoding="utf-8")
PREFIX = "_decisioni_pareri_web_DecisioniPareriWebPortlet_INSTANCE_Test123_"


def test_the_form_is_read_from_the_page_with_its_token_and_prefix():
    form = read_search_form(PAGE)
    assert form.prefix == PREFIX
    assert form.action.startswith("https://www.giustizia-amministrativa.it/web/guest/dcsnprr?")
    assert "&p_auth=tok3n" in form.action and "&amp;" not in form.action


@pytest.mark.parametrize("page", [
    "<html><body>manutenzione</body></html>",
    PAGE.replace("form-provvedimenti", "altro"),
    PAGE.replace("https://www.giustizia-amministrativa.it/web/guest/dcsnprr", "https://example.org/x"),
    PAGE.replace("&amp;p_auth=tok3n", ""),
])
def test_a_page_without_the_known_form_is_a_changed_source(page):
    with pytest.raises(SourceChanged):
        read_search_form(page)


def test_the_search_fields_ask_for_seat_number_and_year_in_the_provv_mode():
    fields = search_fields(read_search_form(PAGE), "Consiglio di Stato", 42, 2099)
    assert fields[f"{PREFIX}sedeProvvedimenti"] == "Consiglio di Stato"
    assert fields[f"{PREFIX}numeroProvvedimenti"] == "42" and fields[f"{PREFIX}DataYearItem"] == "2099"
    assert fields[f"{PREFIX}asSearchMode"] == fields[f"{PREFIX}searchModeRadio"] == "provv"


def test_every_measure_is_listed_with_its_kind_and_link_on_the_document_host():
    results = read_results(RESULTS)
    assert [(r.kind, r.sezione, r.anno, r.numero, r.nrg, r.ecli) for r in results] == [
        ("ORDINANZA CAUTELARE", "SEZIONE 6", 2099, 42, "209900001", "ECLI:IT:CDS:2099:42OCAU"),
        ("SENTENZA", "SEZIONE 6", 2099, 42, "209800002", "ECLI:IT:CDS:2099:42SENT"),
    ]  # the row whose link leaves the document host is dropped
    assert results[1].sede == "CONSIGLIO DI STATO"
    assert results[1].url.startswith("https://mdp.giustizia-amministrativa.it/visualizza/?")
    assert document_format(results[1].url) == "html"


def test_an_answer_with_no_count_is_a_changed_source_and_a_count_of_zero_is_none():
    with pytest.raises(SourceChanged):
        read_results("<html><body>errore</body></html>")
    with pytest.raises(SourceChanged):
        read_results("<html><body>Nessun risultato trovato</body></html>")
    assert read_results("<html><body><h2>Trovati <strong>0</strong> risultati</h2></body></html>") == []


def test_results_announced_and_not_read_are_a_changed_source():
    with pytest.raises(SourceChanged):
        read_results("<html><body><section>Trovati 2 risultati</section><div>altro</div></body></html>")


def test_the_document_is_read_into_three_blocks_without_metadata_or_german():
    testo = text_from_document(DOCUMENT)
    assert testo["epigrafe"].split("\n\n") == [
        "Il Consiglio di Stato", "in sede giurisdizionale (Sezione Sesta)", "Primo Esempio, Presidente",
        "sul ricorso proposto da", "Alfa Srl, rappresentata da un avvocato;"]
    assert testo["motivazione"] == "FATTO e DIRITTO\n\n1. Il primo punto: «virgolette», è."
    assert testo["dispositivo"].split("\n\n") == [
        "P.Q.M.", "Il Consiglio di Stato accoglie l'appello.", "Così deciso in Roma il 1° gennaio 2099", "IL PRESIDENTE"]
    every = "".join(testo.values())
    assert "Staatsrat" not in every and "Sachverhalt" not in every and "nome di prova" not in every


def test_the_document_is_read_with_no_dtd_and_no_entity():
    bomb = DOCUMENT.replace('<!DOCTYPE GA SYSTEM "galight3.dtd">',
                            '<!DOCTYPE GA [<!ENTITY x SYSTEM "file:///etc/passwd">]>').replace("FATTO e DIRITTO", "&x;")
    assert "root:" not in "".join(text_from_document(bomb).values())


def test_a_document_that_is_not_one_is_a_changed_source():
    with pytest.raises(SourceChanged):
        text_from_document("<html><body>altro</body></html>")


class FakeClient:
    def __init__(self):
        self.calls = []

    async def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs.get("data")))
        if method == "GET" and url == ga.SEARCH_PAGE:
            text = PAGE
        elif method == "POST":
            text = RESULTS
        else:
            text = DOCUMENT
        return type("R", (), {"text": text})()


async def test_a_lookup_is_the_page_the_search_and_the_document(monkeypatch):
    client = FakeClient()
    monkeypatch.setattr(ga, "decisions_http_client", client)
    reader = GiustiziaAmministrativaReader()
    results = await reader.search("Consiglio di Stato", 42, 2099)
    sentenza = next(r for r in results if r.kind == "SENTENZA")
    testo, published = await reader.text(sentenza)
    assert testo["dispositivo"].startswith("P.Q.M.") and published == "2099-02-01"
    assert [c[0] for c in client.calls] == ["GET", "POST", "GET"]
    assert client.calls[1][1].endswith("p_auth=tok3n")


async def test_a_pdf_or_a_foreign_link_is_not_fetched(monkeypatch):
    client = FakeClient()
    monkeypatch.setattr(ga, "decisions_http_client", client)
    pdf = ga.Result("SENTENZA", "CONSIGLIO DI STATO", None, 2026, 1, None, None,
                    "https://mdp.giustizia-amministrativa.it/visualizza/?nomeFile=202600001_11.pdf")
    foreign = ga.Result("SENTENZA", "x", None, 2026, 1, None, None, "https://example.org/?nomeFile=a.html")
    assert await GiustiziaAmministrativaReader().text(pdf) == ({}, None)
    assert await GiustiziaAmministrativaReader().text(foreign) == ({}, None)
    assert client.calls == []


# --- from a result to a decision ---------------------------------------------------------------

def test_the_kind_is_the_eclis_suffix_and_a_parere_is_left_out():
    sentenza, ordinanza = read_results(RESULTS)[1], read_results(RESULTS)[0]
    assert ga.kind_of(sentenza) == "sent" and ga.kind_of(ordinanza) == "ocau"
    assert ga.family_of("senb") == "sentenza" and ga.family_of("ocol") == "ordinanza" and ga.family_of("xyz") is None
    parere = ga.Result("PARERE", "CONSIGLIO DI STATO", None, 2099, 42, None, "ECLI:IT:CDS:2099:42PINTE", sentenza.url)
    assert ga.to_decision(parere, "consiglio_di_stato", None) is None
    assert ga.to_decision(ga.Result("SENTENZA", "x", None, 2099, 42, None, None, sentenza.url), "consiglio_di_stato", None) is None


@pytest.mark.parametrize("raw,section", [
    ("SEZIONE 6", "VI"), ("SEZIONE 1", "I"), ("SEZIONE 2Q", "II-quater"), ("SEZIONE 3B", "III-bis"),
    ("SEZIONE 1T", "I-ter"), ("ADUNANZA PLENARIA", "plenaria"), ("SEZIONE 2X", None), ("altro", None), (None, None),
])
def test_a_section_is_written_as_the_convention_writes_it(raw, section):
    assert ga.section_of(raw) == section


def test_a_result_becomes_a_decision_with_its_kind_section_family_and_source():
    sentenza = read_results(RESULTS)[1]
    decision = ga.to_decision(sentenza, "consiglio_di_stato", None, {"motivazione": "x"}, "2099-02-01")
    assert decision.identita.key() == "consiglio_di_stato:sent:42:2099"
    assert (decision.sezione, decision.tipo, decision.data_deposito) == ("VI", "sentenza", "2099-02-01")
    assert decision.fonte["url"].startswith("https://mdp.giustizia-amministrativa.it/")
    tar = ga.to_decision(sentenza, "tar", "roma")
    assert tar.identita.key() == "tar:roma:sent:42:2099"


def test_the_portal_names_each_seat_its_own_way():
    assert ga.portal_seat("consiglio_di_stato", None) == "Consiglio di Stato"
    assert ga.portal_seat("cgars", None) == "C.G.A.R.S"
    assert ga.portal_seat("tar", "reggio-calabria") == "Reggio Calabria"
