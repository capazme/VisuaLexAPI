"""Tests for smart preset alias resolver — 50+ alias variations."""

import pytest
from visualex_api.tools.alias_resolver import resolve_alias, get_all_presets


class TestPresetLoading:
    """Verify the YAML preset library loads correctly."""

    def test_presets_load_non_empty(self):
        presets = get_all_presets()
        assert len(presets) >= 50

    def test_presets_all_have_act_type(self):
        for alias, params in get_all_presets().items():
            assert "act_type" in params, f"Alias '{alias}' missing act_type"


class TestExactAliasResolution:
    """AC: Common norm aliases resolved to structured parameters."""

    def test_gdpr(self):
        r = resolve_alias("gdpr")
        assert r["act_type"] == "regolamento UE"
        assert r["act_number"] == "679"
        assert r["date"] == "2016"

    def test_gdpr_case_insensitive(self):
        r = resolve_alias("GDPR")
        assert r is not None
        assert r["act_type"] == "regolamento UE"

    def test_codice_privacy(self):
        r = resolve_alias("codice privacy")
        assert r["act_type"] == "codice in materia di protezione dei dati personali"

    def test_codice_consumo(self):
        r = resolve_alias("codice consumo")
        assert r["act_type"] == "codice del consumo"

    def test_statuto_lavoratori(self):
        r = resolve_alias("statuto lavoratori")
        assert r["act_type"] == "legge"
        assert r["act_number"] == "300"
        assert r["date"] == "1970"

    def test_statuto_dei_lavoratori(self):
        r = resolve_alias("statuto dei lavoratori")
        assert r["act_type"] == "legge"
        assert r["act_number"] == "300"

    def test_legge_104(self):
        r = resolve_alias("legge 104")
        assert r["act_type"] == "legge"
        assert r["act_number"] == "104"
        assert r["date"] == "1992"

    def test_legge_fallimentare(self):
        r = resolve_alias("legge fallimentare")
        assert r["act_type"] == "regio decreto"
        assert r["act_number"] == "267"

    def test_testo_unico_edilizia(self):
        r = resolve_alias("testo unico edilizia")
        assert r["act_type"] == "decreto del presidente della repubblica"
        assert r["act_number"] == "380"
        assert r["date"] == "2001"

    def test_tu_edilizia_abbreviation(self):
        r = resolve_alias("tu edilizia")
        assert r["act_type"] == "decreto del presidente della repubblica"
        assert r["act_number"] == "380"

    def test_testo_unico_sicurezza(self):
        r = resolve_alias("testo unico sicurezza")
        assert r["act_type"] == "decreto legislativo"
        assert r["act_number"] == "81"
        assert r["date"] == "2008"

    def test_tus_abbreviation(self):
        r = resolve_alias("tus")
        assert r["act_number"] == "81"

    def test_testo_unico_bancario(self):
        r = resolve_alias("testo unico bancario")
        assert r["act_type"] == "decreto legislativo"
        assert r["act_number"] == "385"

    def test_tub_abbreviation(self):
        r = resolve_alias("tub")
        assert r["act_number"] == "385"

    def test_tuf_abbreviation(self):
        r = resolve_alias("tuf")
        assert r["act_number"] == "58"

    def test_tuir(self):
        r = resolve_alias("tuir")
        assert r["act_number"] == "917"

    def test_tuel(self):
        r = resolve_alias("tuel")
        assert r["act_number"] == "267"

    def test_tulps(self):
        r = resolve_alias("tulps")
        assert r["act_type"] == "regio decreto"
        assert r["act_number"] == "773"

    def test_codice_appalti(self):
        r = resolve_alias("codice appalti")
        assert r["act_type"] == "codice dei contratti pubblici"

    def test_codice_ambiente(self):
        r = resolve_alias("codice ambiente")
        assert r["act_type"] == "norme in materia ambientale"

    def test_codice_beni_culturali(self):
        r = resolve_alias("codice beni culturali")
        assert r["act_type"] == "codice dei beni culturali e del paesaggio"

    def test_jobs_act(self):
        r = resolve_alias("jobs act")
        assert r["act_type"] == "decreto legislativo"
        assert r["act_number"] == "81"
        assert r["date"] == "2015"

    def test_decreto_231(self):
        r = resolve_alias("decreto 231")
        assert r["act_type"] == "decreto legislativo"
        assert r["act_number"] == "231"

    def test_mediazione_civile(self):
        r = resolve_alias("mediazione civile")
        assert r["act_type"] == "decreto legislativo"
        assert r["act_number"] == "28"

    def test_legge_divorzio(self):
        r = resolve_alias("legge divorzio")
        assert r["act_number"] == "898"

    def test_smart_working(self):
        r = resolve_alias("smart working")
        assert r["act_type"] == "legge"
        assert r["act_number"] == "81"
        assert r["date"] == "2017"

    def test_legge_gelli(self):
        r = resolve_alias("legge gelli")
        assert r["act_number"] == "24"
        assert r["date"] == "2017"


class TestArticleWithAlias:
    """AC: Alias resolution supports 'art. N <alias>' pattern."""

    def test_art_gdpr(self):
        r = resolve_alias("art. 6 gdpr")
        assert r["act_type"] == "regolamento UE"
        assert r["act_number"] == "679"
        assert r["article"] == "6"

    def test_articolo_statuto_lavoratori(self):
        r = resolve_alias("articolo 18 statuto lavoratori")
        assert r["act_type"] == "legge"
        assert r["act_number"] == "300"
        assert r["article"] == "18"

    def test_art_testo_unico_edilizia(self):
        r = resolve_alias("art. 31 testo unico edilizia")
        assert r["act_number"] == "380"
        assert r["article"] == "31"

    def test_art_bis_with_alias(self):
        r = resolve_alias("art. 4 bis codice privacy")
        assert r["article"] == "4-bis"
        assert r["act_type"] == "codice in materia di protezione dei dati personali"


class TestGracefulFallback:
    """AC: Unrecognized input returns None."""

    def test_empty_string(self):
        assert resolve_alias("") is None

    def test_whitespace(self):
        assert resolve_alias("   ") is None

    def test_unknown_alias(self):
        assert resolve_alias("legge immaginaria") is None

    def test_none_input(self):
        assert resolve_alias(None) is None

    def test_number_only(self):
        assert resolve_alias("12345") is None

    def test_partial_match_no_false_positive(self):
        # "codice" alone should not match any alias
        assert resolve_alias("codice") is None


class TestResolveNlQueryWithAlias:
    """Test alias resolution integrated in _resolve_nl_query."""

    def _make_controller(self):
        from visualex_api.app import NormaController
        return NormaController.__new__(NormaController)

    def test_alias_resolved_via_query_field(self):
        ctrl = self._make_controller()
        result = ctrl._resolve_nl_query({"query": "gdpr"})
        assert result["act_type"] == "regolamento UE"
        assert result["act_number"] == "679"

    def test_alias_with_article_via_query(self):
        ctrl = self._make_controller()
        result = ctrl._resolve_nl_query({"query": "art. 6 gdpr"})
        assert result["act_type"] == "regolamento UE"
        assert result["article"] == "6"

    def test_explicit_act_type_skips_alias_merge(self):
        ctrl = self._make_controller()
        result = ctrl._resolve_nl_query({
            "query": "gdpr",
            "act_type": "legge",
        })
        assert result["act_type"] == "legge"
        # Alias number/date not merged because act_type conflicts
        assert "act_number" not in result

    def test_nl_parser_fallback_when_alias_misses(self):
        ctrl = self._make_controller()
        result = ctrl._resolve_nl_query({"query": "art. 2043 cc"})
        assert result["act_type"] == "codice civile"
        assert result["article"] == "2043"
