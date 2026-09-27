"""The manifest is the owner's file. It must fail loudly on a typo and
never guess: an unknown key, an unknown kind or a bad slug are errors."""
from pathlib import Path

import pytest
import yaml

from archivio_normativo.manifest import (
    AREAS, KINDS, ManifestError, expand_kinds, load_manifest, parse_article_selection,
)

SHIPPED = Path(__file__).resolve().parents[2] / "archivio_normativo" / "manifest.yaml"


def write(tmp_path, data):
    path = tmp_path / "manifest.yaml"
    path.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return path


def minimal(**overrides):
    act = {
        "id": "cc", "area": "civile", "label": "Codice civile", "source": "normattiva",
        "act_type": "codice civile", "cite": "c.c.",
    }
    act.update(overrides)
    return {"version": 1, "acts": [act]}


class TestLoading:
    def test_minimal_manifest_gets_defaults(self, tmp_path):
        m = load_manifest(write(tmp_path, minimal()))
        assert m.providers.visualex_base_url == "http://localhost:5000"
        assert m.providers.legalit_command == ()
        assert m.defaults.rate_per_second == 1.0
        assert m.defaults.enrich_rate_per_second == 0.5
        assert m.defaults.enrich_ttl_days == 90
        assert m.defaults.batch_size == 25
        act = m.act("cc")
        assert act.units == ("articles",)
        assert act.enrich == ()
        assert act.version == "vigente"
        assert act.date is None and act.act_number is None and act.annex is None

    def test_act_inherits_default_enrich_and_can_override(self, tmp_path):
        data = minimal()
        data["defaults"] = {"enrich": ["brocardi"]}
        data["acts"].append({
            "id": "gdpr", "area": "ue", "label": "GDPR", "source": "eurlex",
            "act_type": "regolamento ue", "date": "2016", "act_number": "679",
            "celex": "32016R0679", "cite": "GDPR", "units": ["articles", "recitals"],
            "enrich": ["annotazioni", "giurisprudenza"],
        })
        m = load_manifest(write(tmp_path, data))
        assert m.act("cc").enrich == ("brocardi",)
        assert m.act("gdpr").enrich == (
            "brocardi", "cassazione", "amministrativa", "tributaria", "cgue", "costituzionale",
        )
        assert m.act("gdpr").wants_recitals() is True
        assert m.act("gdpr").is_eu() is True
        assert m.act("cc").is_eu() is False

    def test_annex_is_kept_as_a_string(self, tmp_path):
        m = load_manifest(write(tmp_path, minimal(annex=2)))
        assert m.act("cc").annex == "2"

    def test_providers_are_read(self, tmp_path):
        data = minimal()
        data["providers"] = {
            "visualex": {"base_url": "http://127.0.0.1:5001/"},
            "legalit": {"command": ["bash", "~/x/start_server.sh"]},
        }
        m = load_manifest(write(tmp_path, data))
        assert m.providers.visualex_base_url == "http://127.0.0.1:5001"  # trailing slash dropped
        assert m.providers.legalit_command[0] == "bash"
        assert m.providers.legalit_command[1].startswith("/")  # ~ expanded

    def test_environment_overrides_the_legalit_command(self, tmp_path, monkeypatch):
        monkeypatch.setenv("LEGALIT_MCP_COMMAND", '["python", "run_server.py"]')
        m = load_manifest(write(tmp_path, minimal()))
        assert m.providers.legalit_command == ("python", "run_server.py")

    def test_select_by_ids_and_area(self, tmp_path):
        data = minimal()
        data["acts"].append({
            "id": "cp", "area": "penale", "label": "Codice penale", "source": "normattiva",
            "act_type": "codice penale", "cite": "c.p.",
        })
        m = load_manifest(write(tmp_path, data))
        assert [a.id for a in m.select(None, None)] == ["cc", "cp"]
        assert [a.id for a in m.select(["cp"], None)] == ["cp"]
        assert [a.id for a in m.select(None, "civile")] == ["cc"]
        with pytest.raises(ManifestError, match="unknown act"):
            m.select(["nope"], None)


class TestValidation:
    @pytest.mark.parametrize("bad, message", [
        ({"id": "Codice Civile"}, "slug"),
        ({"area": "commerciale"}, "area"),
        ({"source": "brocardi"}, "source"),
        ({"units": ["recitals", "tables"]}, "units"),
        ({"enrich": ["giurisprudenza", "oracolo"]}, "kind"),
        ({"enrich_articles": "1173-abc"}, "enrich_articles"),
        ({"celex_consolidated": "32002L0058"}, "celex_consolidated"),
        ({"cite": ""}, "cite"),
        ({"nonsense": 1}, "unknown key"),
    ])
    def test_bad_act_entries_are_errors(self, tmp_path, bad, message):
        with pytest.raises(ManifestError, match=message):
            load_manifest(write(tmp_path, minimal(**bad)))

    def test_duplicate_ids_are_an_error(self, tmp_path):
        data = minimal()
        data["acts"].append(dict(data["acts"][0]))
        with pytest.raises(ManifestError, match="duplicate"):
            load_manifest(write(tmp_path, data))

    def test_recitals_on_a_normattiva_act_is_an_error(self, tmp_path):
        with pytest.raises(ManifestError, match="recitals"):
            load_manifest(write(tmp_path, minimal(units=["articles", "recitals"])))

    def test_an_eu_act_needs_its_celex(self, tmp_path):
        eu = minimal(id="gdpr", area="ue", source="eurlex", act_type="regolamento ue", date="2016",
                     act_number="679", cite="GDPR")
        with pytest.raises(ManifestError, match=r"act 'gdpr'.*celex"):
            load_manifest(write(tmp_path, eu))
        eu["acts"][0]["celex"] = "32016R0679"
        assert load_manifest(write(tmp_path, eu)).act("gdpr").celex == "32016R0679"

    def test_attuazione_belongs_to_eu_acts_only(self, tmp_path):
        with pytest.raises(ManifestError, match=r"act 'cc'.*attuazione.*EUR-Lex"):
            load_manifest(write(tmp_path, minimal(enrich=["attuazione"])))

    def test_base_ue_belongs_to_normattiva_acts_only(self, tmp_path):
        eu = minimal(id="gdpr", area="ue", source="eurlex", act_type="regolamento ue", date="2016",
                     act_number="679", celex="32016R0679", cite="GDPR", enrich=["base_ue"])
        with pytest.raises(ManifestError, match=r"act 'gdpr'.*base_ue.*Normattiva"):
            load_manifest(write(tmp_path, eu))

    def test_the_act_level_kinds_on_the_right_source_load(self, tmp_path):
        data = minimal(enrich=["base_ue"])
        data["acts"].append({"id": "gdpr", "area": "ue", "label": "GDPR", "source": "eurlex",
                             "act_type": "regolamento ue", "date": "2016", "act_number": "679",
                             "celex": "32016R0679", "cite": "GDPR", "enrich": ["attuazione"]})
        m = load_manifest(write(tmp_path, data))
        assert m.act("cc").enrich == ("base_ue",) and m.act("gdpr").enrich == ("attuazione",)

    def test_unknown_top_level_key_is_an_error(self, tmp_path):
        data = minimal()
        data["defualts"] = {}
        with pytest.raises(ManifestError, match="unknown key"):
            load_manifest(write(tmp_path, data))

    def test_missing_file(self, tmp_path):
        with pytest.raises(ManifestError, match="not found"):
            load_manifest(tmp_path / "missing.yaml")


class TestKinds:
    def test_every_kind_has_a_level(self):
        assert {k.level for k in KINDS.values()} == {"unit", "act"}
        assert KINDS["attuazione"].level == "act"
        assert KINDS["base_ue"].level == "act"
        assert KINDS["brocardi"].level == "unit"

    def test_expand_resolves_aliases_and_groups_in_order(self):
        assert expand_kinds(["annotazioni", "giurisprudenza", "cassazione"]) == (
            "brocardi", "cassazione", "amministrativa", "tributaria", "cgue", "costituzionale",
        )

    def test_expand_rejects_unknown(self):
        with pytest.raises(ManifestError, match="oracolo"):
            expand_kinds(["oracolo"])


class TestArticleSelection:
    def test_ranges_and_explicit_numbers(self):
        sel = parse_article_selection("1173-2059, 2643, 2-bis")
        assert sel.contains("1173") and sel.contains("2059") and sel.contains("1500-ter")
        assert sel.contains("2643") and sel.contains("2-bis")
        assert not sel.contains("2644") and not sel.contains("2")

    def test_areas_are_the_eight_of_the_spec(self):
        assert AREAS == ("costituzionale", "civile", "penale", "amministrativo",
                         "tributario", "lavoro", "privacy-digitale", "ue")


class TestShippedManifest:
    def test_it_loads(self):
        m = load_manifest(SHIPPED)
        assert len(m.acts) >= 40

    def test_every_eu_act_has_a_celex_and_recitals(self):
        m = load_manifest(SHIPPED)
        for act in m.acts:
            if act.source == "eurlex":
                assert act.celex, act.id
                assert act.wants_recitals(), act.id

    def test_the_two_consolidated_versions_are_declared(self):
        m = load_manifest(SHIPPED)
        assert m.act("eprivacy").celex_consolidated == "02002L0058-20091219"
        assert m.act("eidas").celex_consolidated == "02014R0910-20241018"

    def test_every_area_is_populated(self):
        m = load_manifest(SHIPPED)
        assert {a.area for a in m.acts} == set(AREAS)
