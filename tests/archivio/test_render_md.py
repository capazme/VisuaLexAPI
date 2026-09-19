"""Markdown for reading, rendered from the store and nothing else."""
from pathlib import Path

from archivio_normativo.render_md import (
    anchor_for, demote_headings, escape_md, heading_for, render_act, render_index, write_outputs,
)
from archivio_normativo.store import ActRecord, Store, UnitRecord

GOLDEN = Path(__file__).parent / "golden"
RENDERED_AT = "2026-09-19T21:00:00"


def act():
    return ActRecord(id="cc", area="civile", label="Codice civile", source="normattiva",
                     identifier="urn:nir:stato:regio.decreto:1942-03-16;262", act_type="codice civile",
                     date="1942-03-16", act_number="262", annex="2", source_url="https://www.normattiva.it/x",
                     text_status="consolidated", consolidated_celex=None)


def article(number, position, rubrica, text, **kw):
    base = dict(id=f"cc:art:{number}", act_id="cc", kind="article", number=number, position=position,
                identifier=f"urn:nir:stato:regio.decreto:1942-03-16;262:2~art{number.replace('-', '')}",
                rubrica=rubrica, parte=None, libro="LIBRO QUARTO Delle obbligazioni",
                titolo="TITOLO IX Dei fatti illeciti", capo=None, sezione=None, text=text, fingerprint=None,
                abrogato=False, version="vigente", vigenza_al="2026-09-19", ultimo_aggiornamento="1942-04-21",
                source_url=f"https://www.normattiva.it/art{number}", fetched_at=RENDERED_AT)
    base.update(kw)
    return UnitRecord(**base)


def units():
    return [
        article("2043", 0, "Risarcimento per fatto illecito",
                "Qualunque fatto doloso o colposo che cagiona ad altri un danno ingiusto, "
                "obbliga colui che ha commesso il fatto a risarcire il danno."),
        article("2043-bis", 1, None, "(abrogato)", abrogato=True, ultimo_aggiornamento=None,
                titolo="TITOLO X Nuovo titolo"),
        UnitRecord(id="cc:rec:1", act_id="cc", kind="recital", number="1", position=0, identifier="X#rct_1",
                   rubrica=None, parte=None, libro=None, titolo=None, capo=None, sezione=None,
                   text="Considerando uno.", fingerprint=None, abrogato=False, version="vigente",
                   vigenza_al="2026-09-19", ultimo_aggiornamento=None, source_url=None, fetched_at="t"),
    ]


def enrichment(unit_id, kind, tool, *, content_md=None, content_json=None, status="ok", error=None):
    return {"act_id": "cc", "unit_id": unit_id, "kind": kind, "tool": tool, "params": {},
            "content_md": content_md, "content_json": content_json, "content_hash": "h",
            "fetched_at": RENDERED_AT, "run_id": 1, "status": status, "error": error}


def enrichments():
    return [
        enrichment("cc:art:2043", "brocardi", "visualex.show_brocardi_info", content_json={
            "Ratio": "La ratio <b>x</b>.", "Massime": ["Cass. 1/2024"],
            "Glossario": [{"termine": "Danno", "url": "https://brocardi.it/d"}], "link": "https://brocardi.it/2043"}),
        enrichment("cc:art:2043", "cassazione", "giurisprudenza_su_norma",
                   content_md="## Sentenze\n- Cass. <script>x</script> 5/2025"),
        enrichment("cc:art:2043-bis", "cassazione", "giurisprudenza_su_norma", status="empty"),
        enrichment("", "base_ue", "get_eu_basis", status="error", error="non raggiungibile"),
    ]


class TestPieces:
    def test_anchors_and_headings(self):
        assert anchor_for("article", "2-bis") == "art-2-bis"
        assert anchor_for("recital", "47") == "considerando-47"
        assert heading_for(units()[0]) == "Art. 2043 — Risarcimento per fatto illecito"
        assert heading_for(units()[1]) == "Art. 2043 bis"
        assert heading_for(units()[2]) == "Considerando 1"

    def test_escape_and_demote(self):
        assert escape_md("<script>") == "&lt;script>"
        assert demote_headings("## Sentenze\n# Top\ntesto\n####### no") == "##### Sentenze\n#### Top\ntesto\n####### no"


class TestGolden:
    def test_matches_the_golden_file(self):
        rendered = render_act(act(), units(), enrichments(), RENDERED_AT)
        expected = (GOLDEN / "cc.md").read_text(encoding="utf-8")
        assert rendered == expected

    def test_rendering_is_deterministic(self):
        assert render_act(act(), units(), enrichments(), RENDERED_AT) == render_act(act(), units(), enrichments(), RENDERED_AT)

    def test_oj_acts_carry_a_warning(self):
        oj = ActRecord(id="gdpr", area="ue", label="GDPR", source="eurlex", identifier="32016R0679",
                       act_type="regolamento ue", date="2016", act_number="679", annex=None, source_url="x",
                       text_status="oj", consolidated_celex=None)
        assert "non consolidato" in render_act(oj, [], [], RENDERED_AT)


class TestIndexAndFiles:
    def test_index_lists_acts_by_area(self):
        text = render_index([act()], {"cc": 3}, {"cc": "2026-09-19"},
                            {"started_at": RENDERED_AT, "status": "done"}, RENDERED_AT)
        assert "## civile" in text
        assert "- [Codice civile](civile/cc.md) — 3 unità, vigente al 2026-09-19" in text

    def test_write_outputs_builds_the_tree(self, tmp_path):
        with Store(tmp_path / "a.sqlite") as store:
            store.upsert_act(act(), unit_count=3, updated_at="t")
            run = store.start_run({}, RENDERED_AT)
            for u in units():
                store.upsert_unit(u, run)
            written = write_outputs(store, tmp_path / "out", None, RENDERED_AT)
        assert (tmp_path / "out" / "civile" / "cc.md").exists()
        assert (tmp_path / "out" / "INDICE.md").exists()
        assert [p.name for p in written] == ["cc.md", "INDICE.md"]

    def test_write_outputs_can_limit_to_changed_acts_but_always_refreshes_the_index(self, tmp_path):
        with Store(tmp_path / "a.sqlite") as store:
            store.upsert_act(act(), unit_count=0, updated_at="t")
            written = write_outputs(store, tmp_path / "out", [], RENDERED_AT)
        assert [p.name for p in written] == ["INDICE.md"]
