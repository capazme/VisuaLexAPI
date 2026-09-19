"""Enrichment beyond Brocardi: what gets asked of legal-it, and when."""
import logging
from datetime import datetime

import pytest

from archivio_normativo.enrich import Enricher
from archivio_normativo.manifest import ActSpec
from archivio_normativo.pipeline import ActReport, RunOptions, UnitOutcome
from archivio_normativo.sources.legalit import LegalItError, ToolCall
from archivio_normativo.sources.visualex import ActResolution
from archivio_normativo.store import ActRecord, Store

NOW = datetime(2026, 9, 19, 21, 0, 0)
RES = ActResolution(act_url="https://www.normattiva.it/x", annex=None, tipo_atto="decreto legislativo",
                    data="2001-06-08", numero_atto="231", sample_urn="https://www.normattiva.it/x~art1")


def spec(**kw):
    base = dict(id="dlgs-231-2001", area="penale", label="D.Lgs. 231/2001", source="normattiva",
                act_type="decreto legislativo", date="2001-06-08", act_number="231", cite="D.Lgs. 231/2001",
                enrich=("cassazione", "costituzionale"))
    base.update(kw)
    return ActSpec(**base)


class FakeLegalIt:
    def __init__(self, responses=None):
        self.responses = dict(responses or {})
        self.calls: list[ToolCall] = []

    async def call(self, call: ToolCall) -> str:
        self.calls.append(call)
        answer = self.responses.get(call.tool, f"## {call.tool}\n- risultato per {call.args}")
        if isinstance(answer, Exception):
            raise answer
        return answer


@pytest.fixture
def store(tmp_path):
    with Store(tmp_path / "a.sqlite") as s:
        s.upsert_act(ActRecord(id="dlgs-231-2001", area="penale", label="D.Lgs. 231/2001", source="normattiva",
                               identifier="x", act_type="decreto legislativo", date="2001-06-08", act_number="231",
                               annex=None, source_url="x", text_status="consolidated", consolidated_celex=None),
                     unit_count=0, updated_at="t")
        yield s


def make(store, legalit, *, run_id=None, refresh=False, ttl=90, override=None, now=NOW):
    run_id = run_id or store.start_run({}, NOW.isoformat())
    options = RunOptions(out_dir=store.path.parent, refresh_enrich=refresh, enrich_ttl_days=ttl,
                         enrich_override=override)
    return Enricher(store=store, legalit=legalit, options=options, run_id=run_id,
                    log=logging.getLogger("t"), now=lambda: now), run_id


def units(*numbers, outcome="new"):
    return [UnitOutcome(f"dlgs-231-2001:art:{n}", n, outcome) for n in numbers]


class TestUnitLevel:
    async def test_new_units_get_every_unit_kind(self, store):
        legalit = FakeLegalIt()
        enricher, _ = make(store, legalit)
        report = ActReport("dlgs-231-2001", "x")
        await enricher.enrich_act(spec(), RES, units("6", "7"), report)
        tools = [(c.tool, c.args["riferimento"]) for c in legalit.calls]
        assert tools == [("giurisprudenza_su_norma", "art. 6 D.Lgs. 231/2001"),
                         ("pronunce_cost_su_norma", "art. 6 D.Lgs. 231/2001"),
                         ("giurisprudenza_su_norma", "art. 7 D.Lgs. 231/2001"),
                         ("pronunce_cost_su_norma", "art. 7 D.Lgs. 231/2001")]
        row = store.get_enrichment("dlgs-231-2001", "dlgs-231-2001:art:6", "cassazione")
        assert row["status"] == "ok" and row["tool"] == "giurisprudenza_su_norma"
        assert row["params"]["riferimento"] == "art. 6 D.Lgs. 231/2001"
        assert row["content_md"].startswith("## giurisprudenza_su_norma")
        assert row["fetched_at"] == "2026-09-19T21:00:00"
        assert (report.enrich_ok, report.enrich_kept) == (4, 0)

    async def test_selection_restricts_the_articles(self, store):
        legalit = FakeLegalIt()
        enricher, _ = make(store, legalit)
        await enricher.enrich_act(spec(enrich_articles="6-7"), RES, units("5", "6", "7", "25-bis"), ActReport("a", "b"))
        assert {c.args["riferimento"] for c in legalit.calls} == {"art. 6 D.Lgs. 231/2001", "art. 7 D.Lgs. 231/2001"}

    async def test_fresh_enrichment_on_an_unchanged_unit_is_kept(self, store):
        legalit = FakeLegalIt()
        enricher, _ = make(store, legalit)
        await enricher.enrich_act(spec(), RES, units("6"), ActReport("a", "b"))
        legalit.calls.clear()
        report = ActReport("a", "b")
        enricher2, _ = make(store, legalit, now=datetime(2026, 10, 1))
        await enricher2.enrich_act(spec(), RES, units("6", outcome="unchanged"), report)
        assert legalit.calls == [] and report.enrich_kept == 2

    async def test_updated_text_refreshes(self, store):
        legalit = FakeLegalIt()
        enricher, _ = make(store, legalit)
        await enricher.enrich_act(spec(), RES, units("6"), ActReport("a", "b"))
        legalit.calls.clear()
        enricher2, _ = make(store, legalit)
        await enricher2.enrich_act(spec(), RES, units("6", outcome="updated"), ActReport("a", "b"))
        assert len(legalit.calls) == 2

    async def test_ttl_and_refresh_flag(self, store):
        legalit = FakeLegalIt()
        enricher, _ = make(store, legalit)
        await enricher.enrich_act(spec(), RES, units("6"), ActReport("a", "b"))
        legalit.calls.clear()
        old, _ = make(store, legalit, now=datetime(2027, 1, 1))  # > 90 days later
        await old.enrich_act(spec(), RES, units("6", outcome="unchanged"), ActReport("a", "b"))
        assert len(legalit.calls) == 2
        legalit.calls.clear()
        forced, _ = make(store, legalit, refresh=True)
        await forced.enrich_act(spec(), RES, units("6", outcome="unchanged"), ActReport("a", "b"))
        assert len(legalit.calls) == 2

    async def test_override_replaces_the_manifest_kinds(self, store):
        legalit = FakeLegalIt()
        enricher, _ = make(store, legalit, override=("garante",))
        await enricher.enrich_act(spec(), RES, units("6"), ActReport("a", "b"))
        assert [c.tool for c in legalit.calls] == ["cerca_provvedimenti_garante"]

    async def test_brocardi_is_never_asked_of_legalit(self, store):
        legalit = FakeLegalIt()
        enricher, _ = make(store, legalit, override=("brocardi", "cassazione"))
        await enricher.enrich_act(spec(), RES, units("6"), ActReport("a", "b"))
        assert [c.tool for c in legalit.calls] == ["giurisprudenza_su_norma"]


class TestResults:
    async def test_empty_and_error_texts_are_classified(self, store):
        legalit = FakeLegalIt({"giurisprudenza_su_norma": "Nessun risultato su italgiure.",
                               "pronunce_cost_su_norma": "**Errore**: Consulta non raggiungibile."})
        enricher, _ = make(store, legalit)
        report = ActReport("a", "b")
        await enricher.enrich_act(spec(), RES, units("6"), report)
        assert store.get_enrichment("dlgs-231-2001", "dlgs-231-2001:art:6", "cassazione")["status"] == "empty"
        err = store.get_enrichment("dlgs-231-2001", "dlgs-231-2001:art:6", "costituzionale")
        assert err["status"] == "error" and "non raggiungibile" in err["error"]
        assert (report.enrich_ok, report.enrich_empty, report.enrich_error) == (0, 1, 1)

    async def test_an_exception_is_an_error_row_and_the_pass_goes_on(self, store):
        legalit = FakeLegalIt({"giurisprudenza_su_norma": LegalItError("server gone")})
        enricher, _ = make(store, legalit)
        report = ActReport("a", "b")
        await enricher.enrich_act(spec(), RES, units("6", "7"), report)
        assert store.get_enrichment("dlgs-231-2001", "dlgs-231-2001:art:6", "cassazione")["error"] == "server gone"
        assert store.get_enrichment("dlgs-231-2001", "dlgs-231-2001:art:7", "costituzionale")["status"] == "ok"
        assert report.enrich_error == 2 and report.enrich_ok == 2

    async def test_error_rows_are_retried_next_run(self, store):
        legalit = FakeLegalIt({"giurisprudenza_su_norma": LegalItError("gone")})
        enricher, _ = make(store, legalit)
        await enricher.enrich_act(spec(enrich=("cassazione",)), RES, units("6"), ActReport("a", "b"))
        legalit.responses.clear()
        legalit.calls.clear()
        again, _ = make(store, legalit)
        await again.enrich_act(spec(enrich=("cassazione",)), RES, units("6", outcome="unchanged"), ActReport("a", "b"))
        assert len(legalit.calls) == 1
        assert store.get_enrichment("dlgs-231-2001", "dlgs-231-2001:art:6", "cassazione")["status"] == "ok"


class TestActLevel:
    async def test_attuazione_joins_two_tools(self, store):
        eu = ActSpec(id="dlgs-231-2001", area="ue", label="NIS2", source="eurlex", act_type="direttiva ue",
                     date="2022", act_number="2555", celex="32022L2555", units=("articles", "recitals"),
                     cite="dir. (UE) 2022/2555", enrich=("attuazione",))
        legalit = FakeLegalIt({"get_italian_implementation": "D.Lgs. 138/2024", "elenco_misure_nazionali": "- ITA: D.Lgs. 138/2024"})
        enricher, _ = make(store, legalit)
        report = ActReport("a", "b")
        await enricher.enrich_act(eu, RES, units("1"), report)
        assert [c.tool for c in legalit.calls] == ["get_italian_implementation", "elenco_misure_nazionali"]
        row = store.get_enrichment("dlgs-231-2001", "", "attuazione")
        assert row["tool"] == "get_italian_implementation+elenco_misure_nazionali"
        assert "### get_italian_implementation\n\nD.Lgs. 138/2024" in row["content_md"]
        assert "### elenco_misure_nazionali\n\n- ITA: D.Lgs. 138/2024" in row["content_md"]
        assert row["status"] == "ok" and report.enrich_ok == 1

    async def test_base_ue_once_per_act_and_kept_when_fresh(self, store):
        legalit = FakeLegalIt()
        enricher, _ = make(store, legalit)
        await enricher.enrich_act(spec(enrich=("base_ue",)), RES, units("6", "7"), ActReport("a", "b"))
        assert [c.tool for c in legalit.calls] == ["get_eu_basis"]
        legalit.calls.clear()
        report = ActReport("a", "b")
        again, _ = make(store, legalit)
        await again.enrich_act(spec(enrich=("base_ue",)), RES, units("6", outcome="unchanged"), report)
        assert legalit.calls == [] and report.enrich_kept == 1


class TestExecuteGuard:
    async def test_empty_calls_list_is_a_no_op(self, store):
        enricher, _ = make(store, FakeLegalIt())
        report = ActReport("a", "b")
        await enricher._execute(spec(), "", "base_ue", [], report)
        assert store.get_enrichment("dlgs-231-2001", "", "base_ue") is None
        assert (report.enrich_ok, report.enrich_empty, report.enrich_error, report.enrich_kept) == (0, 0, 0, 0)


class TestPlan:
    def test_counts_the_calls_of_a_full_pass(self, store):
        enricher, _ = make(store, FakeLegalIt())
        assert enricher.plan_act(spec(), ["6", "7", "8"]) == 6
        assert enricher.plan_act(spec(enrich=("attuazione", "cassazione"), enrich_articles="6"), ["6", "7"]) == 3
        assert enricher.plan_act(spec(enrich=()), ["6"]) == 0
