"""Integrity findings and the terminal summary."""
from archivio_normativo.pipeline import ActReport
from archivio_normativo.report import format_report
from archivio_normativo.store import ActRecord, Store, UnitRecord
from archivio_normativo.verify import Finding, format_findings, verify_act, verify_store


def unit(number, text, *, kind="article", abrogato=False, position=0):
    return UnitRecord(id=f"a:{'art' if kind == 'article' else 'rec'}:{number}", act_id="a", kind=kind,
                      number=number, position=position, identifier=None, rubrica=None, parte=None,
                      libro=None, titolo=None, capo=None, sezione=None, text=text, fingerprint=None,
                      abrogato=abrogato, version="vigente", vigenza_al="d", ultimo_aggiornamento=None,
                      source_url=None, fetched_at="t")


LONG = "Testo di un articolo abbastanza lungo da non essere sospetto, davvero."


class TestVerifyAct:
    def test_clean_act_has_no_findings(self):
        assert verify_act("a", [unit("1", LONG), unit("2", LONG + " Bis."), unit("2-bis", LONG + " Ter.")]) == []

    def test_gap_lists_the_missing_numbers(self):
        findings = verify_act("a", [unit("1", LONG), unit("4", LONG + "x"), unit("5", LONG + "y")])
        assert [f.kind for f in findings] == ["gap"]
        assert "2, 3" in findings[0].detail

    def test_empty_and_short_texts(self):
        findings = verify_act("a", [unit("1", ""), unit("2", "Breve."), unit("3", "(abrogato)"),
                                    unit("4", "Breve ma abrogato", abrogato=True)])
        kinds = {(f.kind, f.unit_ids[0]) for f in findings}
        assert ("empty", "a:art:1") in kinds
        assert ("short", "a:art:2") in kinds
        assert not any(f.unit_ids == ("a:art:3",) for f in findings), "a repeal notice is legitimately short"
        assert not any(f.unit_ids == ("a:art:4",) for f in findings)

    def test_identical_texts_are_flagged(self):
        findings = verify_act("a", [unit("1", LONG), unit("2", LONG), unit("3", LONG + "!")])
        identical = [f for f in findings if f.kind == "identical"]
        assert len(identical) == 1
        assert identical[0].unit_ids == ("a:art:1", "a:art:2")
        assert "2 articoli con testo identico: 1, 2" in identical[0].detail

    def test_recitals_are_not_part_of_the_numeric_sequence(self):
        findings = verify_act("a", [unit("1", LONG), unit("2", LONG + "x"), unit("9", LONG + "z", kind="recital")])
        assert findings == []


class TestVerifyStore:
    def test_walks_every_act(self, tmp_path):
        with Store(tmp_path / "a.sqlite") as store:
            for act_id in ("a", "b"):
                store.upsert_act(ActRecord(id=act_id, area="civile", label=act_id, source="normattiva", identifier="x",
                                           act_type="legge", date=None, act_number=None, annex=None, source_url="x",
                                           text_status="consolidated", consolidated_celex=None), 0, "t")
            run = store.start_run({}, "t")
            store.upsert_unit(unit("1", LONG), run)
            u = unit("1", "")
            u.id, u.act_id = "b:art:1", "b"
            store.upsert_unit(u, run)
            findings = verify_store(store)
            assert [(f.act_id, f.kind) for f in findings] == [("b", "empty")]
            assert verify_store(store, act_ids={"a"}) == []

    def test_format(self):
        assert format_findings([]) == "Verifica: nessuna anomalia."
        text = format_findings([Finding("cc", "gap", "3 numeri assenti", ())])
        assert "[gap] cc: 3 numeri assenti" in text


class TestReport:
    def test_run_report_has_table_totals_failures_and_findings(self):
        ok = ActReport("cc", "Codice civile", total=3, new=1, updated=1, unchanged=1, enrich_ok=2, enrich_kept=1)
        bad = ActReport("cpp", "c.p.p.", total=2, failed=1, failures=[("cpp:art:415-bis", "404 non presente")],
                        fingerprints_available=False)
        gone = ActReport("x", "X", resolved=False, reason="HTTP 404: Articolo 1 non presente")
        text = format_report([ok, bad, gone], [Finding("cc", "gap", "2 numeri assenti: 5, 6", ())],
                             duration_s=12.4, base_url="http://localhost:5000", run_id=7, dry_run=False)
        assert "Run 7" in text and "http://localhost:5000" in text
        assert "cc " in text and "2/0/0/1" in text
        assert "senza impronte (fetch completo)" in text
        assert "NON RISOLTO" in text and "HTTP 404" in text
        assert "cpp:art:415-bis: 404 non presente" in text
        assert "Totali: atti 3, risolti 2, unità 5, nuovi 1, aggiornati 1, invariati 1, falliti 1, saltati 0" in text
        assert "[gap] cc: 2 numeri assenti: 5, 6" in text

    def test_dry_run_report_speaks_of_plans(self):
        r = ActReport("cc", "Codice civile", total=3, planned_new=2, planned_changed=1, enrich_planned=6)
        text = format_report([r], [], duration_s=1, base_url="u", run_id=None, dry_run=True)
        assert "PROVA (dry-run)" in text
        assert "6 previste" in text
        assert "da scaricare 3" in text and "chiamate arricchimento previste 6" in text
        assert "Verifica" not in text
