"""The archive on disk. Every write is a transaction; the text hash is the
change registry; nothing is guessed about time — callers pass ISO strings."""
import pytest

from archivio_normativo.store import ActRecord, Store, UnitRecord, text_hash


@pytest.fixture
def store(tmp_path):
    with Store(tmp_path / "archivio.sqlite") as s:
        yield s


def act(**kw):
    base = dict(id="cc", area="civile", label="Codice civile", source="normattiva",
                identifier="urn:nir:stato:regio.decreto:1942-03-16;262", act_type="codice civile",
                date="1942-03-16", act_number="262", annex="2", source_url="https://www.normattiva.it/x",
                text_status="consolidated", consolidated_celex=None)
    base.update(kw)
    return ActRecord(**base)


def unit(number="2043", text="Qualunque fatto doloso o colposo…", **kw):
    base = dict(id=f"cc:art:{number}", act_id="cc", kind="article", number=number, position=0,
                identifier=f"urn:nir:stato:regio.decreto:1942-03-16;262:2~art{number}",
                rubrica="Risarcimento per fatto illecito", parte=None, libro="LIBRO QUARTO", titolo="TITOLO IX",
                capo=None, sezione=None, text=text, fingerprint="f" * 64, abrogato=False,
                version="vigente", vigenza_al="2026-09-19", ultimo_aggiornamento=None,
                source_url="https://www.normattiva.it/art2043", fetched_at="2026-09-19T21:00:00")
    base.update(kw)
    return UnitRecord(**base)


class TestRuns:
    def test_start_finish_and_read_back(self, store):
        run_id = store.start_run({"only": ["cc"]}, started_at="2026-09-19T21:00:00")
        assert store.get_run(run_id)["status"] == "running"
        store.finish_run(run_id, "done", finished_at="2026-09-19T21:05:00", stats={"new": 3})
        run = store.get_run(run_id)
        assert run["status"] == "done"
        assert run["stats"] == {"new": 3}
        assert run["args"] == {"only": ["cc"]}
        assert store.latest_run()["id"] == run_id

    def test_running_runs_become_interrupted_on_the_next_start(self, store):
        crashed = store.start_run({}, started_at="2026-09-19T21:00:00")
        assert store.mark_running_as_interrupted() == [crashed]
        assert store.get_run(crashed)["status"] == "interrupted"
        assert store.latest_interrupted_run() == crashed
        assert store.mark_running_as_interrupted() == []


class TestUnits:
    def test_new_then_unchanged_then_updated(self, store):
        store.upsert_act(act(), unit_count=0, updated_at="2026-09-19T21:00:00")
        r1 = store.start_run({}, "2026-09-19T21:00:00")
        assert store.upsert_unit(unit(), r1) == "new"
        r2 = store.start_run({}, "2026-09-20T21:00:00")
        assert store.upsert_unit(unit(vigenza_al="2026-09-20", fetched_at="2026-09-20T21:00:00"), r2) == "unchanged"
        stored = store.get_unit("cc:art:2043")
        assert stored.vigenza_al == "2026-09-20", "an unchanged text is still 'in force as of' the new check"
        assert store.unit_run_columns("cc:art:2043") == (r1, r1, r2)
        r3 = store.start_run({}, "2026-09-21T21:00:00")
        assert store.upsert_unit(unit(text="Testo modificato."), r3) == "updated"
        stored = store.get_unit("cc:art:2043")
        assert stored.text == "Testo modificato."
        assert stored.text_hash == text_hash("Testo modificato.")
        assert store.unit_run_columns("cc:art:2043") == (r1, r3, r3)

    def test_metadata_changes_alone_do_not_count_as_updates(self, store):
        store.upsert_act(act(), unit_count=0, updated_at="x")
        r1 = store.start_run({}, "t")
        store.upsert_unit(unit(), r1)
        r2 = store.start_run({}, "t")
        assert store.upsert_unit(unit(rubrica="Nuova rubrica", fingerprint="g" * 64), r2) == "unchanged"
        stored = store.get_unit("cc:art:2043")
        assert stored.rubrica == "Nuova rubrica" and stored.fingerprint == "g" * 64

    def test_touch_checked_moves_the_check_and_the_vigenza(self, store):
        store.upsert_act(act(), unit_count=0, updated_at="x")
        r1 = store.start_run({}, "t")
        store.upsert_unit(unit(), r1)
        r2 = store.start_run({}, "t")
        store.touch_checked("cc:art:2043", r2, vigenza_al="2026-10-01")
        assert store.unit_run_columns("cc:art:2043") == (r1, r1, r2)
        assert store.get_unit("cc:art:2043").vigenza_al == "2026-10-01"

    def test_units_for_act_come_back_in_position_order(self, store):
        store.upsert_act(act(), unit_count=0, updated_at="x")
        r = store.start_run({}, "t")
        store.upsert_unit(unit("2044", position=1), r)
        store.upsert_unit(unit("2043", position=0), r)
        store.upsert_unit(UnitRecord(id="cc:rec:1", act_id="cc", kind="recital", number="1", position=0,
                                     identifier="x#rct_1", rubrica=None, parte=None, libro=None, titolo=None,
                                     capo=None, sezione=None, text="Considerando.", fingerprint=None,
                                     abrogato=False, version="vigente", vigenza_al="d", ultimo_aggiornamento=None,
                                     source_url="x", fetched_at="t"), r)
        numbers = [(u.kind, u.number) for u in store.units_for_act("cc")]
        assert numbers == [("article", "2043"), ("article", "2044"), ("recital", "1")]
        assert store.fingerprints_for_act("cc") == {"2043": "f" * 64, "2044": "f" * 64}

    def test_get_unit_missing(self, store):
        assert store.get_unit("nope") is None


class TestEnrichments:
    def test_upsert_replaces_by_key(self, store):
        store.upsert_act(act(), unit_count=0, updated_at="x")
        r = store.start_run({}, "t")
        store.upsert_enrichment("cc", "cc:art:2043", "cassazione", "giurisprudenza_su_norma",
                                {"riferimento": "art. 2043 c.c."}, "## Sentenze…", None, "ok", None, "t1", r)
        store.upsert_enrichment("cc", "cc:art:2043", "cassazione", "giurisprudenza_su_norma",
                                {"riferimento": "art. 2043 c.c."}, "## Sentenze nuove", None, "ok", None, "t2", r)
        rows = store.enrichments_for_act("cc")
        assert len(rows) == 1
        assert rows[0]["content_md"] == "## Sentenze nuove"
        assert rows[0]["fetched_at"] == "t2"
        got = store.get_enrichment("cc", "cc:art:2043", "cassazione")
        assert got["params"] == {"riferimento": "art. 2043 c.c."}
        assert got["content_hash"] == text_hash("## Sentenze nuove")

    def test_act_level_uses_the_empty_unit_id(self, store):
        store.upsert_act(act(), unit_count=0, updated_at="x")
        r = store.start_run({}, "t")
        store.upsert_enrichment("cc", "", "base_ue", "get_eu_basis", {"atto": "c.c."}, "nessuna", None, "empty", None, "t", r)
        assert store.get_enrichment("cc", "", "base_ue")["status"] == "empty"
        assert store.get_enrichment("cc", "cc:art:1", "base_ue") is None

    def test_json_content_round_trips(self, store):
        store.upsert_act(act(), unit_count=0, updated_at="x")
        r = store.start_run({}, "t")
        store.upsert_enrichment("cc", "cc:art:2043", "brocardi", "visualex.show_brocardi_info", {},
                                None, {"Ratio": "…", "Massime": ["a", "b"]}, "ok", None, "t", r)
        assert store.get_enrichment("cc", "cc:art:2043", "brocardi")["content_json"] == {"Ratio": "…", "Massime": ["a", "b"]}


class TestLogAndChange:
    def test_log_and_resume_set(self, store):
        r = store.start_run({}, "t")
        store.log_unit(r, "cc:art:1", "new")
        store.log_unit(r, "cc:art:2", "failed", "404 not in act")
        store.log_unit(r, "cc:art:2", "unchanged")  # a later outcome for the same unit replaces
        assert store.logged_unit_ids(r) == {"cc:art:1", "cc:art:2"}

    def test_act_changed_in_run(self, store):
        store.upsert_act(act(), unit_count=0, updated_at="x")
        r1 = store.start_run({}, "t")
        store.upsert_unit(unit(), r1)
        store.log_unit(r1, "cc:art:2043", "new")
        assert store.act_changed_in_run("cc", r1) is True
        r2 = store.start_run({}, "t")
        store.log_unit(r2, "cc:art:2043", "unchanged")
        assert store.act_changed_in_run("cc", r2) is False
        store.upsert_enrichment("cc", "cc:art:2043", "cassazione", "t", {}, "x", None, "ok", None, "t", r2)
        assert store.act_changed_in_run("cc", r2) is True


class TestActsAndExport:
    def test_act_upsert_and_listing(self, store):
        store.upsert_act(act(), unit_count=3, updated_at="t1")
        store.upsert_act(act(label="Codice civile (agg.)"), unit_count=4, updated_at="t2")
        acts = store.acts()
        assert len(acts) == 1 and acts[0].label == "Codice civile (agg.)"
        assert store.get_act("cc").annex == "2"

    def test_iter_units_joins_act_and_enrichments(self, store):
        store.upsert_act(act(), unit_count=1, updated_at="t")
        r = store.start_run({}, "t")
        store.upsert_unit(unit(), r)
        store.upsert_enrichment("cc", "cc:art:2043", "cassazione", "tool", {}, "md", None, "ok", None, "t", r)
        rows = list(store.iter_units())
        assert rows[0]["id"] == "cc:art:2043"
        assert rows[0]["area"] == "civile"
        assert rows[0]["enrichments"][0]["kind"] == "cassazione"
        assert "text_hash" in rows[0]
