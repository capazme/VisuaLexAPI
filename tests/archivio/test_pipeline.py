"""The per-act pipeline against the fake VisuaLex and a real SQLite store."""
import asyncio
import logging
from datetime import datetime

import pytest

from archivio_normativo.manifest import ActSpec
from archivio_normativo.pipeline import Pipeline, RunOptions, unit_id
from archivio_normativo.report import format_report
from archivio_normativo.sources.visualex import VisuaLexClient
from archivio_normativo.store import Store

CC_URL = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262"
GDPR_URL = "https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita"
NOW = datetime(2026, 9, 19, 21, 0, 0)


def cc_spec(**kw):
    base = dict(id="cc", area="civile", label="Codice civile", source="normattiva",
                act_type="codice civile", cite="c.c.")
    base.update(kw)
    return ActSpec(**base)


def gdpr_spec(**kw):
    base = dict(id="gdpr", area="ue", label="GDPR", source="eurlex", act_type="regolamento ue",
                date="2016", act_number="679", celex="32016R0679", units=("articles", "recitals"), cite="GDPR")
    base.update(kw)
    return ActSpec(**base)


def add_cc(fake, fingerprints="default", articles=None):
    if fingerprints == "default":
        fingerprints = {"2043": {"fingerprint": "a" * 64, "date": "1942-04-21"},
                        "2044": {"fingerprint": "b" * 64, "date": None},
                        "2-bis": {"fingerprint": "c" * 64, "date": None}}
    return fake.add_act(
        act_type="codice civile", url=CC_URL, annex="2",
        tree=["Disposizioni sulla legge in generale", {"numero": "1", "allegato": "1"},
              "CODICE CIVILE", "LIBRO QUARTO Delle obbligazioni", "TITOLO IX Dei fatti illeciti",
              {"numero": "2043", "allegato": "2"}, {"numero": "2044", "allegato": "2"},
              {"numero": "2 bis", "allegato": "2"}],
        annexes=[{"number": "1", "label": "Disposizioni sulla legge in generale", "article_count": 1, "article_numbers": ["1"]},
                 {"number": "2", "label": "CODICE CIVILE", "article_count": 3, "article_numbers": ["2043", "2044", "2 bis"]}],
        rubriche={"2043": "Risarcimento per fatto illecito", "2044": "Legittima difesa"}, abrogati=["2-bis"],
        fingerprints=fingerprints,
        articles=articles if articles is not None else {
            "1": "Le fonti del diritto…", "2043": "Qualunque fatto…", "2044": "Non è responsabile…",
            "2-bis": "(abrogato)"},
        brocardi={"2043": {"Ratio": "La ratio…", "Massime": ["Cass. 1/2024"]}},
    )


@pytest.fixture
def store(tmp_path):
    with Store(tmp_path / "archivio.sqlite") as s:
        yield s


@pytest.fixture
def make_pipeline(fake_visualex, session, throttle, store, tmp_path):
    def factory(*, run_store=store, dry_run=False, full=False, resume=None, refresh_enrich=False,
                batch_size=25, enricher=None, enrich_override=None):
        client = VisuaLexClient(fake_visualex.base_url, session, throttle)
        options = RunOptions(out_dir=tmp_path / "out", dry_run=dry_run, full=full, resume_run_id=resume,
                             enrich_override=enrich_override, refresh_enrich=refresh_enrich,
                             batch_size=batch_size, enrich_ttl_days=90)
        run_id = None
        if run_store is not None and not dry_run:
            run_id = resume if resume is not None else run_store.start_run({}, NOW.isoformat())
        return Pipeline(store=run_store, visualex=client, options=options, run_id=run_id,
                        log=logging.getLogger("test"), now=lambda: NOW, enricher=enricher)
    return factory


def streamed_numbers(fake):
    out = []
    for path, body in fake.calls:
        if path == "/stream_article_text":
            out.extend(body["article"].split(","))
    return out


class TestFirstRun:
    async def test_everything_is_new_and_placed(self, fake_visualex, store, make_pipeline):
        add_cc(fake_visualex)
        report = await make_pipeline().process_act(cc_spec())
        assert (report.total, report.new, report.updated, report.unchanged, report.failed) == (3, 3, 0, 0, 0)
        assert report.fingerprints_available is True
        units = {u.number: u for u in store.units_for_act("cc")}
        assert set(units) == {"2043", "2044", "2-bis"}, "annex 1 (preleggi) is not the codice civile"
        a = units["2043"]
        assert a.text == "Qualunque fatto…"
        assert a.rubrica == "Risarcimento per fatto illecito"
        assert (a.libro, a.titolo) == ("LIBRO QUARTO Delle obbligazioni", "TITOLO IX Dei fatti illeciti")
        assert a.identifier.endswith(":2~art2043")
        assert a.fingerprint == "a" * 64
        assert a.ultimo_aggiornamento == "1942-04-21"
        assert a.vigenza_al == "2026-09-19"
        assert a.fetched_at == "2026-09-19T21:00:00"
        assert a.abrogato is False and units["2-bis"].abrogato is True
        assert units["2-bis"].position == 2
        act = store.get_act("cc")
        assert act.annex == "2" and act.identifier == CC_URL and act.text_status == "consolidated"
        assert store.act_unit_count("cc") == 3
        assert report.changed is True

    async def test_batches_follow_batch_size(self, fake_visualex, make_pipeline):
        add_cc(fake_visualex)
        await make_pipeline(batch_size=2).process_act(cc_spec())
        bodies = [b["article"] for p, b in fake_visualex.calls if p == "/stream_article_text"]
        assert bodies == ["2043,2044", "2-bis"]

    async def test_brocardi_kind_stores_the_structured_payload(self, fake_visualex, store, make_pipeline):
        add_cc(fake_visualex)
        report = await make_pipeline().process_act(cc_spec(enrich=("brocardi",)))
        body = [b for p, b in fake_visualex.calls if p == "/stream_article_text"][0]
        assert body["show_brocardi_info"] is True
        got = store.get_enrichment("cc", "cc:art:2043", "brocardi")
        assert got["content_json"] == {"Ratio": "La ratio…", "Massime": ["Cass. 1/2024"]}
        assert got["tool"] == "visualex.show_brocardi_info" and got["status"] == "ok"
        assert store.get_enrichment("cc", "cc:art:2044", "brocardi") is None, "no payload, no row"
        assert report.enrich_ok == 1


class TestSecondRun:
    async def test_unchanged_fingerprints_mean_no_stream(self, fake_visualex, store, make_pipeline):
        add_cc(fake_visualex)
        await make_pipeline().process_act(cc_spec())
        fake_visualex.calls.clear()
        report = await make_pipeline().process_act(cc_spec())
        assert (report.new, report.updated, report.unchanged) == (0, 0, 3)
        assert streamed_numbers(fake_visualex) == []
        assert report.changed is False
        first, changed, checked = store.unit_run_columns("cc:art:2043")
        assert first == changed == 1 and checked == 2

    async def test_a_moved_fingerprint_refetches_that_article_only(self, fake_visualex, store, make_pipeline):
        scenario = add_cc(fake_visualex)
        await make_pipeline().process_act(cc_spec())
        scenario["fingerprints"]["2044"] = {"fingerprint": "z" * 64, "date": "2026-01-01"}
        scenario["articles"]["2044"] = "Testo nuovo dell'art. 2044."
        fake_visualex.calls.clear()
        report = await make_pipeline().process_act(cc_spec())
        assert (report.updated, report.unchanged) == (1, 2)
        assert streamed_numbers(fake_visualex) == ["2044"]
        assert store.get_unit("cc:art:2044").text == "Testo nuovo dell'art. 2044."
        assert store.get_unit("cc:art:2044").ultimo_aggiornamento == "2026-01-01"

    async def test_full_refetches_everything(self, fake_visualex, make_pipeline):
        add_cc(fake_visualex)
        await make_pipeline().process_act(cc_spec())
        fake_visualex.calls.clear()
        report = await make_pipeline(full=True).process_act(cc_spec())
        assert report.unchanged == 3 and sorted(streamed_numbers(fake_visualex)) == ["2-bis", "2043", "2044"]

    async def test_without_fingerprints_every_run_is_full(self, fake_visualex, make_pipeline):
        add_cc(fake_visualex, fingerprints=None)
        r1 = await make_pipeline().process_act(cc_spec())
        assert r1.fingerprints_available is False and r1.new == 3
        fake_visualex.calls.clear()
        r2 = await make_pipeline().process_act(cc_spec())
        assert r2.unchanged == 3 and len(streamed_numbers(fake_visualex)) == 3

    async def test_stale_brocardi_is_refetched_alone(self, fake_visualex, store, make_pipeline):
        add_cc(fake_visualex)
        await make_pipeline().process_act(cc_spec(enrich=("brocardi",)))
        fake_visualex.calls.clear()
        report = await make_pipeline(refresh_enrich=True).process_act(cc_spec(enrich=("brocardi",)))
        assert report.unchanged == 3
        assert sorted(streamed_numbers(fake_visualex)) == ["2-bis", "2043", "2044"], "brocardi-only pass"
        assert report.enrich_ok == 1


class TestFailures:
    async def test_error_lines_and_missing_articles_fail_and_are_retried_next_run(self, fake_visualex, store, make_pipeline):
        scenario = add_cc(fake_visualex, articles={"2043": "Qualunque fatto…", "2044": {"error": "ParsingError"}})
        report = await make_pipeline().process_act(cc_spec())
        assert report.new == 1 and report.failed == 2
        reasons = dict(report.failures)
        assert reasons["cc:art:2044"] == "ParsingError"
        assert "not returned" in reasons["cc:art:2-bis"]
        assert store.get_unit("cc:art:2044") is None
        scenario["articles"]["2044"] = "Ora c'è."
        scenario["articles"]["2-bis"] = "Anche questo."
        fake_visualex.calls.clear()
        report = await make_pipeline().process_act(cc_spec())
        assert report.new == 2 and report.unchanged == 1
        assert sorted(streamed_numbers(fake_visualex)) == ["2-bis", "2044"]

    async def test_a_stream_failure_fails_the_batch_not_the_run(self, fake_visualex, session, throttle, store, tmp_path):
        add_cc(fake_visualex)
        fake_visualex.fail["/stream_article_text"] = [500] * 10
        client = VisuaLexClient(fake_visualex.base_url, session, throttle, attempts=2, sleep=_no_sleep)
        run_id = store.start_run({}, NOW.isoformat())
        pipeline = Pipeline(store=store, visualex=client,
                            options=RunOptions(out_dir=tmp_path / "out", batch_size=2),
                            run_id=run_id, log=logging.getLogger("t"), now=lambda: NOW)
        report = await pipeline.process_act(cc_spec())
        assert report.failed == 3 and all("HTTP 500" in reason for _, reason in report.failures)

    async def test_a_batch_refused_with_400_is_retried_one_by_one(self, fake_visualex, store, make_pipeline):
        fake_visualex.add_act(
            act_type="codice civile", url=CC_URL, annex="2",
            tree=[{"numero": "2043", "allegato": "2"}, {"numero": "270-bis.1", "allegato": "2"},
                  {"numero": "2044", "allegato": "2"}],
            fingerprints=None,
            articles={"2043": "Qualunque fatto…", "270-bis.1": "Testo lecito…", "2044": "Non è responsabile…"},
            reject_numbers={"270-bis.1"},
        )
        report = await make_pipeline().process_act(cc_spec())
        assert report.new == 2 and report.failed == 1
        reasons = dict(report.failures)
        assert "270-bis.1" in reasons["cc:art:270-bis.1"]
        calls = [b["article"] for p, b in fake_visualex.calls if p == "/stream_article_text"]
        assert calls == ["2043,270-bis.1,2044", "2043", "270-bis.1", "2044"]
        assert store.get_unit("cc:art:2043") is not None and store.get_unit("cc:art:2044") is not None
        assert store.get_unit("cc:art:270-bis.1") is None

    async def test_unresolvable_act_is_reported_not_raised(self, fake_visualex, make_pipeline):
        report = await make_pipeline().process_act(cc_spec(act_type="codice inesistente"))
        assert report.resolved is False
        assert "404" in report.reason

    async def test_run_continues_past_a_broken_act(self, fake_visualex, make_pipeline):
        add_cc(fake_visualex)
        reports = await make_pipeline().run([cc_spec(act_type="codice inesistente", id="x"), cc_spec()])
        assert [r.resolved for r in reports] == [False, True]


async def _no_sleep(_):
    return None


class TestDryRunAndResume:
    async def test_dry_run_reads_but_never_writes_or_streams(self, fake_visualex, store, make_pipeline):
        add_cc(fake_visualex)
        report = await make_pipeline(dry_run=True).process_act(cc_spec())
        assert (report.planned_new, report.planned_changed, report.unchanged) == (3, 0, 0)
        assert streamed_numbers(fake_visualex) == []
        assert store.units_for_act("cc") == [] and store.get_act("cc") is None
        paths = {p for p, _ in fake_visualex.calls}
        assert paths == {"/fetch_norma_data", "/fetch_tree", "/fetch_rubriche", "/fetch_act_fingerprints"}

    async def test_dry_run_after_a_run_reports_the_changes(self, fake_visualex, store, make_pipeline):
        scenario = add_cc(fake_visualex)
        await make_pipeline().process_act(cc_spec())
        scenario["fingerprints"]["2043"] = {"fingerprint": "n" * 64, "date": None}
        report = await make_pipeline(dry_run=True).process_act(cc_spec())
        assert (report.planned_new, report.planned_changed, report.unchanged) == (0, 1, 2)

    async def test_dry_run_counts_the_brocardi_calls(self, fake_visualex, make_pipeline):
        add_cc(fake_visualex)
        report = await make_pipeline(dry_run=True).process_act(cc_spec(enrich=("brocardi",)))
        assert report.enrich_planned == 3
        assert streamed_numbers(fake_visualex) == []

    async def test_dry_run_adds_the_enrichers_plan(self, fake_visualex, make_pipeline):
        add_cc(fake_visualex)

        class StubEnricher:
            def plan_act(self, spec, numbers):
                return len(numbers) * 2

            async def enrich_act(self, spec, res, units, report):
                raise AssertionError("must not run in dry-run")

        report = await make_pipeline(dry_run=True, enricher=StubEnricher()).process_act(cc_spec())
        assert report.enrich_planned == 6

    async def test_resume_skips_units_already_logged(self, fake_visualex, store, make_pipeline):
        add_cc(fake_visualex)
        run_id = store.start_run({}, NOW.isoformat())
        store.log_unit(run_id, unit_id("cc", "article", "2043"), "new")
        report = await make_pipeline(resume=run_id).process_act(cc_spec())
        assert report.skipped == 1 and report.new == 2
        assert "2043" not in streamed_numbers(fake_visualex)


class TestEuActs:
    async def test_recitals_and_no_fingerprints(self, fake_visualex, store, make_pipeline):
        fake_visualex.add_act(
            act_type="regolamento ue", date="2016", act_number="679", url=GDPR_URL,
            tree=["CAPO I", {"numero": "1"}, {"numero": "2"}],
            rubriche={"1": "Oggetto e finalità"},
            recitals=[{"number": "1", "text": "La protezione…"}, {"number": "2", "text": "I principi…"}],
            articles={"1": "Il presente regolamento…", "2": "Ambito…"},
        )
        report = await make_pipeline().process_act(gdpr_spec())
        assert report.fingerprints_available is None
        assert report.new == 2 and report.recitals == 2
        assert "/fetch_act_fingerprints" not in {p for p, _ in fake_visualex.calls}
        units = store.units_for_act("gdpr")
        assert [(u.kind, u.number) for u in units] == [("article", "1"), ("article", "2"), ("recital", "1"), ("recital", "2")]
        assert units[0].identifier == "32016R0679#art_1" and units[0].capo == "CAPO I"
        assert units[2].identifier == "32016R0679#rct_1" and units[2].text == "La protezione…"
        assert store.get_act("gdpr").text_status == "oj"

    async def test_consolidated_articles_and_oj_recitals(self, fake_visualex, store, make_pipeline):
        cons = "https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=CELEX:02002L0058-20091219"
        fake_visualex.add_act(act_type="direttiva ue", date="2002", act_number="58",
                              celex_consolidated="02002L0058-20091219", url=cons,
                              tree=[{"numero": "5"}, {"numero": "14 bis"}],
                              articles={"5": "Riservatezza…", "14-bis": "Comitato…"})
        fake_visualex.add_act(act_type="direttiva ue", date="2002", act_number="58",
                              url="https://eur-lex.europa.eu/eli/dir/2002/58/oj/ita",
                              recitals=[{"number": "1", "text": "La direttiva 95/46/CE…"}])
        spec = ActSpec(id="eprivacy", area="ue", label="e-privacy", source="eurlex", act_type="direttiva ue",
                       date="2002", act_number="58", celex="32002L0058", celex_consolidated="02002L0058-20091219",
                       units=("articles", "recitals"), cite="dir. 2002/58/CE")
        report = await make_pipeline().process_act(spec)
        assert report.new == 2 and report.recitals == 1
        assert store.get_act("eprivacy").text_status == "consolidated"
        assert store.get_act("eprivacy").consolidated_celex == "02002L0058-20091219"
        assert store.get_unit("eprivacy:art:14-bis").text == "Comitato…"
        recital_body = [b for p, b in fake_visualex.calls if p == "/fetch_recitals"][0]
        assert "celex_consolidated" not in recital_body


class TestInterrupts:
    async def test_a_cancelled_act_keeps_the_reports_collected_so_far(self, fake_visualex, make_pipeline):
        add_cc(fake_visualex)
        pipeline = make_pipeline()
        real_resolve = pipeline.visualex.resolve_act
        calls = {"n": 0}

        async def flaky(spec):
            calls["n"] += 1
            if calls["n"] == 2:
                raise asyncio.CancelledError()
            return await real_resolve(spec)

        pipeline.visualex.resolve_act = flaky
        with pytest.raises(asyncio.CancelledError):
            await pipeline.run([cc_spec(), cc_spec(id="cc2")])
        assert len(pipeline.reports) == 1
        assert pipeline.reports[0].resolved is True


class TestDuplicateIndexEntries:
    async def test_a_number_listed_twice_is_reported(self, fake_visualex, store, make_pipeline):
        fake_visualex.add_act(
            act_type="codice civile", url=CC_URL, annex="2",
            tree=[{"numero": "2043", "allegato": "2"}, {"numero": "2043", "allegato": "2"},
                  {"numero": "2044", "allegato": "2"}],
            rubriche={"2043": "Risarcimento per fatto illecito"},
            fingerprints={"2043": {"fingerprint": "a" * 64, "date": None},
                          "2044": {"fingerprint": "b" * 64, "date": None}},
            articles={"2043": "Qualunque fatto…", "2044": "Non è responsabile…"},
        )
        report = await make_pipeline().process_act(cc_spec())
        assert report.duplicates == ["2043"]
        assert report.total == 3
        units = [u for u in store.units_for_act("cc") if u.number == "2043"]
        assert len(units) == 1
        text = format_report([report], [], duration_s=1, base_url="u", run_id=1, dry_run=False)
        assert "numeri duplicati nell'indice: 2043" in text
