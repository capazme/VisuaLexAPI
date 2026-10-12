"""The CGUE reader (design 2026-10-12 §4): the SPARQL step, the text, the lookup and the resolver.

The documents are synthetic, written for these tests in the shapes of the source (no text of the
Court). Real judgments are read by the `_local` freeze test, outside the repository.
"""
import asyncio
import json
from datetime import date
from pathlib import Path

import pytest

from visualex_api.services.decisions import curia
from visualex_api.services.decisions.curia import (
    CuriaReader,
    Hit,
    case_label,
    case_tokens,
    hits_from_sparql,
    sparql_query,
    text_from_old_html,
    text_from_xhtml,
)
from visualex_api.services.decisions.model import Decision, Identity, parse_reference
from visualex_api.services.decisions.resolver import Resolver, SourceUnavailable
from visualex_api.services.http_client import HttpResult
from visualex_api.tools.exceptions import DocumentNotFoundError, NetworkError

FIX = Path(__file__).parent / "fixtures" / "decisions"
XHTML = (FIX / "curia_synthetic.xhtml").read_text(encoding="utf-8")
OLD = (FIX / "curia_synthetic_old.html").read_text(encoding="utf-8")


def _row(celex, case, title="Sentenza della Corte (Terza Sezione) del 1° gennaio 2099.#Alfa Srl contro Beta SpA.#Prova.",
         ecli="ECLI:EU:C:2099:1", day="2099-01-01"):
    return {"celex": {"value": celex}, "case": {"value": case}, "title": {"value": title},
            "ecli": {"value": ecli}, "date": {"value": day}}


def _payload(*rows):
    return {"results": {"bindings": list(rows)}}


# --- case numbers ----------------------------------------------------------------------------

def test_case_tokens_read_every_spelling_of_the_source():
    assert case_tokens("Causa C‑634/21") == [("C", 634, 21)]
    assert case_tokens("Cause riunite C‑293/12 e C‑594/12") == [("C", 293, 12), ("C", 594, 12)]
    assert case_tokens("Causa 26-62.") == [(None, 26, 62)]
    assert case_tokens("Causa T-612/17") == [("T", 612, 17)]
    assert case_tokens("Causa C-1594/12") == [("C", 1594, 12)]


def test_case_label_writes_a_plain_dash_and_a_slash():
    assert case_label("C", 634, 2021) == "C-634/21"
    assert case_label(None, 26, 1962) == "26/62"
    assert case_label("T", 1, 2003) == "T-1/03"


# --- the query and its answers ---------------------------------------------------------------

def test_the_query_holds_integers_and_fixed_codes_only():
    q = sparql_query("corte_giustizia_ue", 634, 2021)
    assert '"2021"^^' in q and '"CJ"^^' in q
    assert 'CONTAINS(STR(?case), "634/21") || CONTAINS(STR(?case), "634-21")' in q
    q = sparql_query("tribunale_ue", 612, 2017, by_year=False)
    assert "resource_legal_year" not in q and '"TJ"^^' in q and '"612/17"' in q
    with pytest.raises(ValueError):
        sparql_query("corte_giustizia_ue", "634\") } DROP", 2021)  # type: ignore[arg-type]


def test_only_exact_cases_of_the_right_court_are_kept():
    payload = _payload(
        _row("62012CJ0293", "Cause riunite C‑293/12 e C‑594/12"),
        _row("62012CJ1594", "Causa C‑1594/12"),
        _row("62012TJ0594", "Causa T‑594/12"),
        _row("62012CJ0293", "Cause riunite C‑293/12 e C‑594/12"),  # a second row of the same work
    )
    hits = hits_from_sparql(payload, "corte_giustizia_ue", 594, 2012)
    assert [h.celex for h in hits] == ["62012CJ0293"]
    assert hits_from_sparql(payload, "tribunale_ue", 594, 2012)[0].celex == "62012TJ0594"


def test_a_case_before_1989_has_no_letter():
    payload = _payload(_row("61962CJ0026", "Causa 26-62."))
    assert [h.celex for h in hits_from_sparql(payload, "corte_giustizia_ue", 26, 1962)] == ["61962CJ0026"]
    assert hits_from_sparql(payload, "tribunale_ue", 26, 1962) == []


@pytest.mark.parametrize("payload", [None, [], {}, {"results": {}}, {"results": {"bindings": "x"}}])
def test_an_answer_that_cannot_be_read_is_an_error_never_none_found(payload):
    with pytest.raises(ValueError):
        hits_from_sparql(payload, "corte_giustizia_ue", 634, 2021)


def test_a_row_that_is_not_a_judgment_celex_is_ignored():
    payload = _payload(_row("62021CC0634", "Causa C‑634/21"), _row("not a celex", "Causa C-634/21"))
    assert hits_from_sparql(payload, "corte_giustizia_ue", 634, 2021) == []


# --- the text ----------------------------------------------------------------------------------

def test_the_xhtml_is_read_into_three_blocks():
    testo, language = text_from_xhtml(XHTML)
    assert language == "l’italiano"
    assert testo["epigrafe"].split("\n\n")[:3] == [
        "SENTENZA DELLA CORTE (Terza Sezione)", "1° gennaio 2099",
        "«Rinvio pregiudiziale – Prova di un lettore – Spazi e a capo del markup»"]
    assert testo["epigrafe"].endswith("ha pronunciato la seguente\n\nSentenza")
    assert "– per Alfa Srl, da un avvocato;" in testo["epigrafe"]
    assert testo["motivazione"].split("\n\n") == [
        "1 La domanda di prova verte sull’interpretazione dell’articolo 1 (esempio).",
        "Un secondo capoverso dello stesso punto: «virgolette», è, à.",
        "Sulla questione",
        "2 Il secondo punto."]
    assert testo["dispositivo"].split("\n\n") == [
        "Per questi motivi, la Corte (Terza Sezione) dichiara:",
        "L’articolo 1 va letto nel senso della prova.", "Firme"]


def test_footnotes_and_the_closing_index_are_not_text():
    testo, _ = text_from_xhtml(XHTML)
    every = "".join(testo.values())
    assert "*1" not in every and "Lingua processuale" not in every
    assert "Indice" not in every and "I. Fatti" not in every


def test_the_source_characters_stay_as_they_are():
    testo, _ = text_from_xhtml(XHTML)
    assert "C‑999/99" in testo["epigrafe"]  # the source's non-breaking hyphen is kept
    assert "  " not in "".join(testo.values())


def test_a_note_of_substance_stays_text_and_the_operative_part_starts_at_the_last_marker():
    markup = XHTML.replace(
        '<p class="coj-normal">Il secondo punto.</p>',
        '<p class="coj-normal">Per questi motivi, che non sono il dispositivo, il punto prosegue.</p>',
    ).replace("</body>", '<p class="coj-note">( *2 ) Una nota di merito.</p></body>')
    testo, language = text_from_xhtml(markup)
    assert language == "l’italiano"
    assert "Per questi motivi, che non sono il dispositivo" in testo["motivazione"]
    assert testo["dispositivo"].startswith("Per questi motivi, la Corte (Terza Sezione) dichiara:")
    assert testo["dispositivo"].endswith("Una nota di merito.")


def test_an_unknown_section_of_the_former_html_keeps_its_text():
    markup = OLD.replace('<a name="CO"/>', '<a name="ZZ"/>')
    assert "NIENTE SPESE ." in text_from_old_html(markup)["motivazione"]


def test_unprefixed_classes_read_alike():
    testo, language = text_from_xhtml(XHTML.replace('class="coj-', 'class="'))
    assert (testo, language) == text_from_xhtml(XHTML)


def test_a_document_without_its_markers_keeps_every_line_in_the_reasons():
    testo, _ = text_from_xhtml("<html><body><p class='coj-normal'>Solo un capoverso.</p></body></html>")
    assert testo == {"motivazione": "Solo un capoverso."}


def test_a_page_without_the_courts_markup_is_not_read_as_its_text():
    with pytest.raises(ValueError):
        text_from_xhtml("<html><body><p>Il servizio non è disponibile.</p></body></html>")


def test_the_former_html_is_read_by_its_sections_without_keywords_or_summary():
    testo = text_from_old_html(OLD)
    assert testo == {
        "epigrafe": "NEL PROCEDIMENTO 999-99\n\nALFA CONTRO BETA\n\nDOMANDA DI PROVA .",
        "motivazione": "1 . IL PRIMO MOTIVO D' ESEMPIO .\n\n2 . IL SECONDO .\n\nNIENTE SPESE .",
        "dispositivo": "LA CORTE\n\nDICHIARA LA PROVA .",
    }
    assert text_from_old_html("<html><body><p>altro</p></body></html>") == {}


# --- the lookup -----------------------------------------------------------------------------

class FakeClient:
    """The decisions client: SPARQL answers by query kind, documents by CELEX and format."""

    def __init__(self, by_year=None, anywhere=None, by_celex=None, documents=None, sparql_headers=None):
        self.by_year, self.anywhere = by_year or _payload(), anywhere or _payload()
        self.by_celex = by_celex or _payload()
        self.documents = documents or {}
        self.sparql_headers = sparql_headers or {}
        self.calls = []

    async def request(self, method, url, **kwargs):
        self.calls.append((url, kwargs.get("headers", {}).get("Accept")))
        if url == curia.SPARQL_URL:
            query = kwargs["params"]["query"]
            body = (self.by_year if "resource_legal_year" in query
                    else self.by_celex if "resource_legal_id_celex \"" in query else self.anywhere)
            return HttpResult(json.dumps(body), 200, {"Content-Type": "application/sparql-results+json",
                                                      **self.sparql_headers})
        key = (url.rsplit("/", 1)[1], kwargs["headers"]["Accept"])
        if key not in self.documents:
            raise DocumentNotFoundError("404")
        answer = self.documents[key]
        if isinstance(answer, HttpResult):
            return answer
        kind = "application/xhtml+xml" if "xhtml" in key[1] else "text/html"
        return HttpResult(answer, 200, {"Content-Type": f"{kind};charset=UTF-8"})


def _use(monkeypatch, client):
    monkeypatch.setattr(curia, "decisions_http_client", client)
    return client


async def test_a_judgment_is_found_with_its_attributes_and_text(monkeypatch):
    client = _use(monkeypatch, FakeClient(
        by_year=_payload(_row("62099CJ0999", "Causa C‑999/99")),
        documents={("62099CJ0999", "application/xhtml+xml"): XHTML}))
    [decision] = await CuriaReader().lookup("corte_giustizia_ue", 999, 2099)
    assert decision.identita == Identity("corte_giustizia_ue", 999, 2099)
    assert (decision.tipo, decision.sezione, decision.data_decisione, decision.ecli) == (
        "sentenza", "III", "2099-01-01", "ECLI:EU:C:2099:1")
    assert decision.parti == "Alfa Srl contro Beta SpA"
    assert decision.cause_riunite is None and decision.lingua_processuale == "l’italiano"
    assert decision.fonte["url"] == "https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:62099CJ0999"
    assert decision.testo == text_from_xhtml(XHTML)[0]
    assert [c[1] for c in client.calls] == ["application/sparql-results+json", "application/xhtml+xml"]


async def test_a_joined_case_is_found_under_the_first_case(monkeypatch):
    _use(monkeypatch, FakeClient(
        by_year=_payload(_row("62012CJ0293", "Cause riunite C‑293/12 e C‑594/12",
                              title="Sentenza della Corte (Grande Sezione) dell’8 aprile 2014.#A contro B.#x")),
        documents={("62012CJ0293", "application/xhtml+xml"): XHTML}))
    [decision] = await CuriaReader().lookup("corte_giustizia_ue", 594, 2012)
    assert decision.identita == Identity("corte_giustizia_ue", 293, 2012)
    assert decision.cause_riunite == ["C-293/12", "C-594/12"] and decision.sezione == "grande"


async def test_a_case_joined_to_an_earlier_year_is_looked_for_without_the_year(monkeypatch):
    client = _use(monkeypatch, FakeClient(
        anywhere=_payload(_row("62011CJ0010", "Cause riunite C‑10/11 e C‑5/12")),
        documents={("62011CJ0010", "application/xhtml+xml"): XHTML}))
    [decision] = await CuriaReader().lookup("corte_giustizia_ue", 5, 2012)
    assert decision.identita == Identity("corte_giustizia_ue", 10, 2011)
    assert sum(1 for c in client.calls if c[0] == curia.SPARQL_URL) == 2


async def test_an_old_judgment_falls_back_to_the_former_html(monkeypatch):
    _use(monkeypatch, FakeClient(
        by_year=_payload(_row("61962CJ0026", "Causa 26-62.", title="Sentenza della Corte del 5 febbraio 1963.#A.#x")),
        documents={("61962CJ0026", "text/html"): OLD}))
    [decision] = await CuriaReader().lookup("corte_giustizia_ue", 26, 1962)
    assert decision.testo == text_from_old_html(OLD) and decision.sezione is None


async def test_a_judgment_without_an_italian_text_is_found_without_text(monkeypatch):
    _use(monkeypatch, FakeClient(by_year=_payload(_row("62099CJ0999", "Causa C-999/99"))))
    [decision] = await CuriaReader().lookup("corte_giustizia_ue", 999, 2099)
    assert decision.testo == {}


async def test_a_judgment_without_an_italian_case_line_is_found_by_its_celex(monkeypatch):
    client = _use(monkeypatch, FakeClient(by_celex=_payload({"ecli": {"value": "ECLI:EU:T:2099:9"},
                                                             "date": {"value": "2099-02-03"}})))
    [decision] = await CuriaReader().lookup("tribunale_ue", 9, 2099)
    assert decision.identita == Identity("tribunale_ue", 9, 2099)
    assert (decision.ecli, decision.data_decisione, decision.testo) == ("ECLI:EU:T:2099:9", "2099-02-03", {})
    assert sum(1 for c in client.calls if c[0] == curia.SPARQL_URL) == 3


@pytest.mark.parametrize("answer", [
    HttpResult("", 202, {"Content-Type": "text/html"}),            # a firewall's challenge
    HttpResult("<html/>", 300, {"Content-Type": "text/html"}),     # a choice of files
    HttpResult("<html><body><p>Avviso</p></body></html>", 200, {"Content-Type": "text/html"}),
    HttpResult("<html><body><p>Avviso</p></body></html>", 200, {"Content-Type": "application/xhtml+xml"}),
])
async def test_an_answer_that_is_not_the_judgment_is_an_error_never_its_text(monkeypatch, answer):
    _use(monkeypatch, FakeClient(by_year=_payload(_row("62099CJ0999", "Causa C-999/99")),
                                 documents={("62099CJ0999", "application/xhtml+xml"): answer}))
    with pytest.raises(ValueError):
        await CuriaReader().lookup("corte_giustizia_ue", 999, 2099)


async def test_a_partial_or_full_sparql_answer_is_an_error_never_none_found(monkeypatch):
    _use(monkeypatch, FakeClient(sparql_headers={"X-SQL-State": "S1TAT"}))
    with pytest.raises(ValueError):
        await CuriaReader().lookup("corte_giustizia_ue", 999, 2099)
    full = _payload(*[_row(f"62099CJ{i:04d}", "Causa C-1/99") for i in range(1, 201)])
    _use(monkeypatch, FakeClient(by_year=full))
    with pytest.raises(ValueError):
        await CuriaReader().lookup("corte_giustizia_ue", 999, 2099)


async def test_no_judgment_is_none_found(monkeypatch):
    _use(monkeypatch, FakeClient())
    assert await CuriaReader().lookup("corte_giustizia_ue", 999, 2099) == []


# --- the resolver ------------------------------------------------------------------------------

class MemoryCache:
    def __init__(self):
        self.data = {}

    def get_persistent(self, name):
        cache = self

        class NS:
            async def get(self, key):
                return cache.data.get((name, key))

            async def set(self, key, value):
                cache.data[(name, key)] = value
        return NS()


class FakeCuria:
    def __init__(self, decisions=None, error=None):
        self.decisions, self.error, self.calls = decisions or [], error, 0

    async def lookup(self, corte, numero, anno):
        self.calls += 1
        if self.error:
            raise self.error
        return self.decisions


def _decision(numero=293, anno=2012, testo=None):
    return Decision(identita=Identity("corte_giustizia_ue", numero, anno), tipo="sentenza",
                    testo={"motivazione": "x"} if testo is None else testo, fonte={"nome": "f"})


def _resolver(fake, cache=None):
    return Resolver(None, None, cache=cache or MemoryCache(), today=lambda: date(2026, 10, 12), curia=fake)


def _ref(numero, anno, corte="corte_giustizia_ue"):
    return parse_reference({"corte": corte, "numero": numero, "anno": anno}, date(2026, 10, 12))


async def test_the_resolver_answers_a_judgment_and_keeps_it(monkeypatch):
    fake = FakeCuria([_decision()])
    cache = MemoryCache()
    first = await _resolver(fake, cache).resolve(_ref(293, 2012))
    second = await _resolver(fake, cache).resolve(_ref(293, 2012))
    assert first.esito == second.esito == "trovata" and fake.calls == 1
    assert ("decisions_found", "curia:v1:corte_giustizia_ue:293:2012") in cache.data


async def test_a_joined_case_says_which_case_holds_the_judgment():
    outcome = await _resolver(FakeCuria([_decision()])).resolve(_ref(594, 2012))
    assert outcome.esito == "trovata"
    assert outcome.avvisi == [{"tipo": "causa_riunita", "numero": "293", "anno": "2012"}]


async def test_two_judgments_of_one_case_are_ambiguous():
    outcome = await _resolver(FakeCuria([_decision(), _decision(294)])).resolve(_ref(293, 2012))
    assert outcome.esito == "ambigua" and len(outcome.candidati) == 2


async def test_no_judgment_is_not_found_and_kept_an_hour():
    cache = MemoryCache()
    outcome = await _resolver(FakeCuria([]), cache).resolve(_ref(999, 2020))
    assert (outcome.esito, outcome.motivo) == ("non_trovata", "inesistente")
    assert cache.data[("decisions_absent", "curia:v1:corte_giustizia_ue:999:2020")] is True


async def test_a_judgment_without_text_is_kept_a_day_with_its_notice():
    cache = MemoryCache()
    outcome = await _resolver(FakeCuria([_decision(testo={})]), cache).resolve(_ref(293, 2012))
    assert {"tipo": "testo_non_disponibile"} in outcome.avvisi
    assert ("decisions_pending", "curia:v1:corte_giustizia_ue:293:2012") in cache.data


@pytest.mark.parametrize("error", [NetworkError("down"), ValueError("SPARQL: risposta non leggibile"),
                                   asyncio.TimeoutError()])
async def test_a_source_that_fails_is_unreachable_never_not_found(error):
    cache = MemoryCache()
    with pytest.raises(SourceUnavailable):
        await _resolver(FakeCuria(error=error), cache).resolve(_ref(293, 2012))
    assert cache.data == {}


def test_the_general_court_starts_in_1989_and_numbers_up_to_9999():
    from visualex_api.services.decisions.model import InvalidReference
    with pytest.raises(InvalidReference):
        _ref(1, 1988, "tribunale_ue")
    with pytest.raises(InvalidReference):
        _ref(10000, 2020)
    assert _ref(612, 2017, "tribunale_ue").corte == "tribunale_ue"
    assert Identity("tribunale_ue", 612, 2017).key() == "tribunale_ue:612:2017"


def test_hit_identity_comes_from_the_celex():
    assert curia.identity_of(Hit("62017TJ0612", None, None, "", ""), "tribunale_ue") == Identity("tribunale_ue", 612, 2017)
